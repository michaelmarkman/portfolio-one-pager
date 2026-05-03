import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { createCrtMaterial } from './crtShader.js'
import { useScreenInteraction } from './useScreenInteraction.js'

const SOURCE_SIZE = { width: 1024, height: 768 }

const SCREEN_NAME_HINTS = ['screen', 'display', 'glass', 'tube', 'crt', 'monitor']

function pickScreenMesh(scene) {
  const meshes = []
  scene.traverse((node) => {
    if (node.isMesh) meshes.push(node)
  })
  const named = meshes.find((m) => {
    const n = (m.name || '').toLowerCase()
    const matName = ((m.material && m.material.name) || '').toLowerCase()
    return SCREEN_NAME_HINTS.some((h) => n.includes(h) || matName.includes(h))
  })
  if (named) return named
  let best = null
  let bestScore = -Infinity
  for (const m of meshes) {
    m.geometry.computeBoundingBox()
    const b = m.geometry.boundingBox
    if (!b) continue
    const dx = b.max.x - b.min.x
    const dy = b.max.y - b.min.y
    const dz = b.max.z - b.min.z
    const score = (dx * dy) / (dz + 0.01)
    if (score > bestScore) {
      bestScore = score
      best = m
    }
  }
  return best
}

const DEFAULT_SHADER = {
  barrel: 0.09,
  chromatic: 0.0011,
  scanlineStrength: 0.18,
  scanlineFreq: 720,
  vignette: 0.55,
  rollSpeed: 0.08,
}
const DEFAULT_GLASS = { shininess: 60, specular: '#6b6b6b', reflectivity: 0.4 }

/**
 * Loads the GLB and binds the live shader-CRT material to the screen mesh.
 * Accepts live `shader`/`glass`/`screenForward` props from the leva controls;
 * uniforms and material params are synced per-frame.
 */
export default function CrtModel({
  texture,
  sourceRef,
  shader = DEFAULT_SHADER,
  glass = DEFAULT_GLASS,
  screenForward = 0.08,
  screenGimbal,
}) {
  const baseScreenScaleRef = useRef(null)
  const { scene } = useGLTF('/crt-tv.glb')
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const raycaster = useThree((s) => s.raycaster)
  const materialRef = useRef(null)
  const glassMatRef = useRef(null)
  const glassMeshRef = useRef(null)
  const backMeshRef = useRef(null)
  const forwardAxisRef = useRef(new THREE.Vector3(0, -1, 0))
  const previousPosRef = useRef(new THREE.Vector3())
  const pointerNdc = useRef(new THREE.Vector2(-2, -2))

  const interaction = useScreenInteraction({
    sourceRef,
    sourceSize: SOURCE_SIZE,
    barrelK: shader.barrel,
  })

  const { cloned, screenMesh } = useMemo(() => {
    const c = scene.clone(true)
    const picked = pickScreenMesh(c)
    return { cloned: c, screenMesh: picked }
  }, [scene])

  // Mount-once: bind shader material + glass mesh; remember forward axis.
  useEffect(() => {
    if (!screenMesh || !texture) return

    const previous = screenMesh.material
    const mat = createCrtMaterial(texture)
    materialRef.current = mat
    baseScreenScaleRef.current = screenMesh.scale.clone()
    screenMesh.material = mat
    screenMesh.castShadow = false
    screenMesh.receiveShadow = false

    cloned.updateMatrixWorld(true)
    const screenWP = new THREE.Vector3()
    screenMesh.getWorldPosition(screenWP)
    const towardCamera = camera.position.clone().sub(screenWP).normalize()
    const parentWorldQuat = new THREE.Quaternion()
    if (screenMesh.parent) screenMesh.parent.getWorldQuaternion(parentWorldQuat)

    const candidates = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    ]
    let bestVec = candidates[0]
    let bestDot = -Infinity
    for (const v of candidates) {
      const w = v.clone().applyQuaternion(parentWorldQuat)
      const d = w.dot(towardCamera)
      if (d > bestDot) { bestDot = d; bestVec = v }
    }
    forwardAxisRef.current = bestVec
    previousPosRef.current.copy(screenMesh.position)

    // Grunge texture from /public served by Vite. Loaded via TextureLoader
    // so it gets proper mipmaps + anisotropic filtering.
    const dustTex = new THREE.TextureLoader().load('/grunge_2-1K.png')
    dustTex.wrapS = dustTex.wrapT = THREE.RepeatWrapping
    dustTex.minFilter = THREE.LinearMipmapLinearFilter
    dustTex.magFilter = THREE.LinearFilter
    dustTex.generateMipmaps = true
    dustTex.anisotropy = 16
    dustTex.colorSpace = THREE.SRGBColorSpace

    // Glass specular layer (mirrors screen geometry) + dust map.
    const glassGeo = screenMesh.geometry.clone()
    const glassMat = new THREE.MeshPhongMaterial({
      color: 0x222222, // not pure black — lets dust map show via diffuse
      map: dustTex,
      specular: new THREE.Color(glass.specular),
      shininess: glass.shininess,
      reflectivity: glass.reflectivity,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      depthWrite: false,
    })
    const glassMesh = new THREE.Mesh(glassGeo, glassMat)
    glassMesh.rotation.copy(screenMesh.rotation)
    glassMesh.scale.copy(screenMesh.scale)
    glassMesh.renderOrder = 2
    glassMesh.raycast = () => {}
    screenMesh.parent.add(glassMesh)
    glassMatRef.current = glassMat
    glassMeshRef.current = glassMesh

    // Black backdrop behind the screen mesh — occludes the case mesh's
    // baked SMPTE color test pattern that would otherwise leak through any
    // gap between the screen edge and the bezel opening as the model sways.
    const backGeo = screenMesh.geometry.clone()
    const backMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
    })
    const backMesh = new THREE.Mesh(backGeo, backMat)
    backMesh.rotation.copy(screenMesh.rotation)
    // Slightly larger than the screen so it covers the gap from oblique angles.
    backMesh.scale.copy(screenMesh.scale).multiplyScalar(1.06)
    backMesh.renderOrder = -1
    backMesh.raycast = () => {}
    screenMesh.parent.add(backMesh)
    backMeshRef.current = backMesh

    return () => {
      screenMesh.material = previous
      screenMesh.position.copy(previousPosRef.current)
      screenMesh.parent?.remove(glassMesh)
      screenMesh.parent?.remove(backMesh)
      glassGeo.dispose()
      glassMat.dispose()
      dustTex.dispose()
      backGeo.dispose()
      backMat.dispose()
      mat.dispose()
      materialRef.current = null
      glassMatRef.current = null
      glassMeshRef.current = null
      backMeshRef.current = null
    }
    // Intentionally omit prop deps — material is mounted once and reconfigured
    // each frame in useFrame from the live leva values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenMesh, texture, camera, cloned])

  // Track pointer in NDC for raycasting.
  useEffect(() => {
    const dom = gl.domElement
    const onMove = (ev) => {
      const r = dom.getBoundingClientRect()
      pointerNdc.current.x = ((ev.clientX - r.left) / r.width) * 2 - 1
      pointerNdc.current.y = -((ev.clientY - r.top) / r.height) * 2 + 1
    }
    const onLeave = () => {
      pointerNdc.current.x = -2
      pointerNdc.current.y = -2
      interaction.onPointerOut()
    }
    const onClick = (ev) => {
      if (!screenMesh) return
      const r = dom.getBoundingClientRect()
      pointerNdc.current.x = ((ev.clientX - r.left) / r.width) * 2 - 1
      pointerNdc.current.y = -((ev.clientY - r.top) / r.height) * 2 + 1
      raycaster.setFromCamera(pointerNdc.current, camera)
      const hits = raycaster.intersectObject(screenMesh, false)
      if (hits.length === 0) return
      interaction.onClick({ hit: hits[0], nativeEvent: ev })
    }
    dom.addEventListener('pointermove', onMove)
    dom.addEventListener('pointerleave', onLeave)
    dom.addEventListener('click', onClick)
    return () => {
      dom.removeEventListener('pointermove', onMove)
      dom.removeEventListener('pointerleave', onLeave)
      dom.removeEventListener('click', onClick)
    }
  }, [gl, raycaster, camera, interaction, screenMesh])

  // Per-frame: sync uniforms from leva, drive time, run hover raycaster, and
  // re-apply screen/glass forward offset (cheap; lets the slider move live).
  useFrame((state) => {
    if (materialRef.current) {
      const u = materialRef.current.uniforms
      u.uTime.value = state.clock.elapsedTime
      u.uBarrel.value = shader.barrel
      u.uChromatic.value = shader.chromatic
      u.uScanlineStrength.value = shader.scanlineStrength
      u.uScanlineFreq.value = shader.scanlineFreq
      u.uVignetteStrength.value = shader.vignette
      u.uRollSpeed.value = shader.rollSpeed
    }
    if (glassMatRef.current) {
      const m = glassMatRef.current
      m.shininess = glass.shininess
      m.specular.set(glass.specular)
      m.reflectivity = glass.reflectivity
    }
    // Re-position screen + glass + back-occluder each frame from current
    // screenForward slider. Backdrop sits slightly BEHIND the screen.
    if (screenMesh && glassMeshRef.current) {
      const dir = forwardAxisRef.current
      const ex = screenGimbal?.extraOffsetX ?? 0
      const ey = screenGimbal?.extraOffsetY ?? 0
      const sc = screenGimbal?.scale ?? 1
      const rx = screenGimbal?.rotX ?? 0
      const ry = screenGimbal?.rotY ?? 0
      const rz = screenGimbal?.rotZ ?? 0

      screenMesh.position
        .copy(previousPosRef.current)
        .addScaledVector(dir, screenForward)
        .add(new THREE.Vector3(ex, ey, 0))
      screenMesh.rotation.set(rx, ry, rz)
      if (baseScreenScaleRef.current) {
        screenMesh.scale.copy(baseScreenScaleRef.current).multiplyScalar(sc)
      }

      glassMeshRef.current.position
        .copy(previousPosRef.current)
        .addScaledVector(dir, screenForward + 0.015)
        .add(new THREE.Vector3(ex, ey, 0))
      glassMeshRef.current.rotation.set(rx, ry, rz)
      if (baseScreenScaleRef.current) {
        glassMeshRef.current.scale.copy(baseScreenScaleRef.current).multiplyScalar(sc)
      }

      if (backMeshRef.current) {
        backMeshRef.current.position
          .copy(previousPosRef.current)
          .addScaledVector(dir, screenForward - 0.04)
          .add(new THREE.Vector3(ex, ey, 0))
        backMeshRef.current.rotation.set(rx, ry, rz)
        if (baseScreenScaleRef.current) {
          backMeshRef.current.scale.copy(baseScreenScaleRef.current).multiplyScalar(sc * 1.06)
        }
      }
    }

    if (!screenMesh || pointerNdc.current.x < -1.5) {
      // Disable cursor halo when pointer leaves canvas
      if (materialRef.current) materialRef.current.uniforms.uCursorUV.value.z = 0
      return
    }
    raycaster.setFromCamera(pointerNdc.current, camera)
    const hits = raycaster.intersectObject(screenMesh, false)
    if (hits.length === 0) {
      interaction.onPointerOut()
      if (materialRef.current) materialRef.current.uniforms.uCursorUV.value.z = 0
    } else {
      interaction.onPointerMove(hits[0])
      // Feed the texture-space cursor position to the shader. The hit's UV
      // is the mesh UV, which the shader uses directly to sample the texture.
      const hitUv = hits[0].uv
      if (materialRef.current && hitUv) {
        const u = materialRef.current.uniforms.uCursorUV.value
        u.x = hitUv.x
        u.y = hitUv.y
        u.z = 1
      }
    }
  })

  useEffect(() => {
    gl.domElement.style.cursor = interaction.hovering ? 'pointer' : ''
  }, [interaction.hovering, gl])

  return <primitive object={cloned} />
}

useGLTF.preload('/crt-tv.glb')
