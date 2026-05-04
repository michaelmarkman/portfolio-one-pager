import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { createCrtMaterial } from './crtShader.js'
import { useScreenInteraction } from './useScreenInteraction.js'

const SOURCE_SIZE = { width: 1024, height: 768 }

const SCREEN_NAME_HINTS = ['screen', 'display', 'glass', 'tube', 'crt', 'monitor']

function pickScreenMesh(scene, { debug = false } = {}) {
  const meshes = []
  scene.traverse((node) => {
    if (node.isMesh) meshes.push(node)
  })
  const named = meshes.find((m) => {
    const n = (m.name || '').toLowerCase()
    const matName = ((m.material && m.material.name) || '').toLowerCase()
    return SCREEN_NAME_HINTS.some((h) => n.includes(h) || matName.includes(h))
  })
  const scored = meshes.map((m) => {
    m.geometry.computeBoundingBox()
    const b = m.geometry.boundingBox
    if (!b) return { mesh: m, score: -Infinity, dx: 0, dy: 0, dz: 0 }
    const dx = b.max.x - b.min.x
    const dy = b.max.y - b.min.y
    const dz = b.max.z - b.min.z
    return { mesh: m, score: (dx * dy) / (dz + 0.01), dx, dy, dz }
  })
  if (debug) {
    // eslint-disable-next-line no-console
    console.log(
      '[CrtModel] meshes:\n' +
        scored
          .map(
            (s) =>
              `  ${s.mesh.name.padEnd(20)} mat=${(s.mesh.material?.name || '').padEnd(10)} ` +
              `dx=${s.dx.toFixed(3)} dy=${s.dy.toFixed(3)} dz=${s.dz.toFixed(3)} ` +
              `score=${Number.isFinite(s.score) ? s.score.toFixed(3) : s.score}`,
          )
          .join('\n'),
    )
  }
  if (named) {
    if (debug) console.log('[CrtModel] picked by name:', named.name)
    return named
  }
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a), { score: -Infinity })
  if (debug) console.log('[CrtModel] picked by fallback (largest XY/flat-Z):', best.mesh?.name)
  return best.mesh
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
  modelUrl = '/crt-tv.glb',
  debugMeshes = false,
  modelTransform,
  remapScreenUV = false,
  screenUVRotation = 0, // degrees; rotates the screen mesh UVs around (0.5, 0.5)
  screenUVFlipX = false,
  screenUVFlipY = false,
  hideMeshes, // optional array of mesh names to hide (e.g., ['keyboard'])
  useHitUv = false, // for flat-plane screens with [0,1] UVs (Apple II)
  enableGlassMesh = true,
  enableBackOccluder = true,
  glassMode = 'phong', // 'phong' | 'physical'
  screenPalette = 'phosphor', // 'phosphor' | 'amber' | 'mono' | 'auto'
  transitionTRef, // optional ref for 'auto' mode — lerps phosphor→amber
  onModelReady,
}) {
  const baseScreenScaleRef = useRef(null)
  const { scene } = useGLTF(modelUrl)

  // Fire onModelReady after the model has been rendered at least once. R3F
  // calls useFrame BEFORE each renderer.render(), so by the 2nd useFrame the
  // first (slow) compile-+-draw is behind us and the model is on screen.
  // Latched via ref so we only signal once. setTimeout fallback covers the
  // edge case where the render loop is paused before we hit 2 frames.
  const readyFiredRef = useRef(false)
  const frameCountRef = useRef(0)
  useFrame(() => {
    if (readyFiredRef.current || !onModelReady) return
    frameCountRef.current += 1
    if (frameCountRef.current >= 2) {
      readyFiredRef.current = true
      onModelReady()
    }
  })
  useEffect(() => {
    if (!onModelReady) return
    const t = setTimeout(() => {
      if (!readyFiredRef.current) {
        readyFiredRef.current = true
        onModelReady()
      }
    }, 3000)
    return () => clearTimeout(t)
  }, [onModelReady])
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const raycaster = useThree((s) => s.raycaster)
  const r3fScene = useThree((s) => s.scene)
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
    useHitUv,
  })

  const { cloned, screenMesh } = useMemo(() => {
    const c = scene.clone(true)
    const picked = pickScreenMesh(c, { debug: debugMeshes })
    return { cloned: c, screenMesh: picked }
  }, [scene, debugMeshes])

  // Toggle visibility of named meshes (e.g., hide the keyboard half of an
  // Apple II asset pack so only the monitor remains).
  useEffect(() => {
    if (!cloned) return
    const set = new Set((hideMeshes ?? []).map((n) => n.toLowerCase()))
    const restore = []
    cloned.traverse((node) => {
      if (!node.isMesh) return
      const name = (node.name || '').toLowerCase()
      if (set.has(name)) {
        restore.push([node, node.visible])
        node.visible = false
      }
    })
    return () => {
      for (const [node, v] of restore) node.visible = v
    }
  }, [cloned, hideMeshes])

  // Expose live (mounted) instance to window for in-page debugging.
  useEffect(() => {
    if (debugMeshes && typeof window !== 'undefined') {
      window.__crtModel = cloned
      window.__crtScreen = screenMesh
    }
  }, [cloned, screenMesh, debugMeshes])

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

    // Enable shadow casting on every other mesh in the cloned model
    // (case body, keyboard, etc.) so the cozy mode's directional sun
    // can throw a real shadow onto the floor. The screen / glass / back
    // meshes stay opted-out — we don't want shadows landing on the
    // emissive screen face.
    cloned.traverse((node) => {
      if (!node.isMesh) return
      if (node === screenMesh) return
      node.castShadow = true
    })

    // Some GLB exports map the screen mesh to a tiny sub-rect of the shared
    // texture atlas (e.g. a 15%×15% corner). Remap the existing UVs so they
    // span [0..1], letting the live html-canvas texture fill the whole face.
    // Optionally also rotate/flip the UVs around (0.5, 0.5) to fix screen
    // meshes whose UV axes don't align with world up/right.
    let originalUVs = null
    const needsUVEdit = remapScreenUV || screenUVRotation !== 0 || screenUVFlipX || screenUVFlipY
    if (needsUVEdit && screenMesh.geometry.attributes.uv) {
      const uv = screenMesh.geometry.attributes.uv
      originalUVs = new Float32Array(uv.array.length)
      originalUVs.set(uv.array)
      let uMin = 0, uMax = 1, vMin = 0, vMax = 1
      if (remapScreenUV) {
        uMin = +Infinity; uMax = -Infinity; vMin = +Infinity; vMax = -Infinity
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i), v = uv.getY(i)
          if (u < uMin) uMin = u; if (u > uMax) uMax = u
          if (v < vMin) vMin = v; if (v > vMax) vMax = v
        }
      }
      const uRange = Math.max(uMax - uMin, 1e-6)
      const vRange = Math.max(vMax - vMin, 1e-6)
      const rad = (screenUVRotation * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      for (let i = 0; i < uv.count; i++) {
        let u = remapScreenUV ? (uv.getX(i) - uMin) / uRange : uv.getX(i)
        let v = remapScreenUV ? (uv.getY(i) - vMin) / vRange : uv.getY(i)
        // Flip
        if (screenUVFlipX) u = 1 - u
        if (screenUVFlipY) v = 1 - v
        // Rotate around (0.5, 0.5)
        if (screenUVRotation !== 0) {
          const cu = u - 0.5
          const cv = v - 0.5
          u = cos * cu - sin * cv + 0.5
          v = sin * cu + cos * cv + 0.5
        }
        uv.setX(i, u)
        uv.setY(i, v)
      }
      uv.needsUpdate = true
    }

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
    if (debugMeshes && typeof window !== 'undefined') {
      window.__crtForward = bestVec.clone()
      window.__crtTowardCamera = towardCamera.clone()
      window.__crtParentQuat = parentWorldQuat.clone()
    }

    // Optional glass + grunge layer. Adds specular highlight + dust on top
    // of the screen face. For models whose body mesh already gives a clean
    // bezel/recess shading (Apple II), this can be disabled to avoid a
    // bright streak leaking into the bezel cutout.
    let dustTex = null
    let glassGeo = null
    let glassMat = null
    let glassMesh = null
    if (enableGlassMesh) {
      // Grunge texture from /public served by Vite. Loaded via TextureLoader
      // so it gets proper mipmaps + anisotropic filtering.
      dustTex = new THREE.TextureLoader().load('/grunge_2-1K.png')
      dustTex.wrapS = dustTex.wrapT = THREE.RepeatWrapping
      dustTex.minFilter = THREE.LinearMipmapLinearFilter
      dustTex.magFilter = THREE.LinearFilter
      dustTex.generateMipmaps = true
      dustTex.anisotropy = 16
      dustTex.colorSpace = THREE.SRGBColorSpace

      glassGeo = screenMesh.geometry.clone()
      if (glassMode === 'physical') {
        // PBR glass — uses scene.environment for uniform IBL reflection
        // (set up by <Environment /> in CrtScene). Dim-gray base instead
        // of pure black so the dust map's diffuse contribution actually
        // shows through additive blending; otherwise color * map = 0 and
        // the grunge texture is invisible. Roughness controls how sharp
        // the reflection is.
        glassMat = new THREE.MeshPhysicalMaterial({
          color: 0x222222,
          map: dustTex,
          metalness: 0,
          roughness: glass.roughness ?? 0.18,
          clearcoat: glass.clearcoat ?? 0.5,
          clearcoatRoughness: glass.clearcoatRoughness ?? 0.08,
          envMapIntensity: glass.envMapIntensity ?? 0.9,
          transparent: true,
          blending: THREE.AdditiveBlending,
          side: THREE.FrontSide,
          depthWrite: false,
        })
      } else {
        glassMat = new THREE.MeshPhongMaterial({
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
      }
      glassMesh = new THREE.Mesh(glassGeo, glassMat)
      glassMesh.rotation.copy(screenMesh.rotation)
      glassMesh.scale.copy(screenMesh.scale)
      glassMesh.renderOrder = 2
      glassMesh.raycast = () => {}
      screenMesh.parent.add(glassMesh)
      glassMatRef.current = glassMat
      glassMeshRef.current = glassMesh
    }

    // Optional black backdrop behind the screen mesh — occludes the case
    // mesh's baked SMPTE color test pattern in the old crt-tv.glb model.
    // Models without that pattern can disable this to avoid a black band
    // leaking around the screen edges into the bezel recess.
    let backGeo = null
    let backMat = null
    let backMesh = null
    if (enableBackOccluder) {
      backGeo = screenMesh.geometry.clone()
      backMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.DoubleSide,
      })
      backMesh = new THREE.Mesh(backGeo, backMat)
      backMesh.rotation.copy(screenMesh.rotation)
      // Slightly larger than the screen so it covers the gap from oblique angles.
      backMesh.scale.copy(screenMesh.scale).multiplyScalar(1.06)
      backMesh.renderOrder = -1
      backMesh.raycast = () => {}
      screenMesh.parent.add(backMesh)
      backMeshRef.current = backMesh
    }

    return () => {
      screenMesh.material = previous
      screenMesh.position.copy(previousPosRef.current)
      if (glassMesh) screenMesh.parent?.remove(glassMesh)
      if (backMesh) screenMesh.parent?.remove(backMesh)
      // Restore original UVs so swapping models / hot-reloading doesn't
      // double-remap into a degenerate range.
      if (originalUVs) {
        const uv = screenMesh.geometry.attributes.uv
        uv.array.set(originalUVs)
        uv.needsUpdate = true
      }
      glassGeo?.dispose()
      glassMat?.dispose()
      dustTex?.dispose()
      backGeo?.dispose()
      backMat?.dispose()
      mat.dispose()
      materialRef.current = null
      glassMatRef.current = null
      glassMeshRef.current = null
      backMeshRef.current = null
    }
    // Intentionally omit most prop deps — material is mounted once and
    // reconfigured each frame in useFrame from the live leva values.
    // UV-related props ARE included so toggling them via leva re-runs the
    // mount and re-applies the UV transforms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenMesh, texture, camera, cloned, remapScreenUV, screenUVRotation, screenUVFlipX, screenUVFlipY, enableGlassMesh, enableBackOccluder, glassMode])

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
      // Sync palette per frame so the leva mode toggle takes effect live.
      // 'auto' lerps phosphor (no palette tint) → amber based on
      // transitionTRef, used by the day/night crossfade in CrtScene.
      if (screenPalette === 'auto') {
        const t = transitionTRef ? transitionTRef.current : 0
        u.uPaletteAmount.value = THREE.MathUtils.lerp(0, 0.85, t)
        u.uPaletteColor.value.setRGB(1.5, 0.95, 0.32)
      } else if (screenPalette === 'amber' || screenPalette === 'amber-inverted') {
        // Both share the same shader-side amber tint. The DOM-level invert
        // for 'amber-inverted' is handled by HtmlSource's `screenInvert` prop.
        u.uPaletteAmount.value = 0.85
        u.uPaletteColor.value.setRGB(1.5, 0.95, 0.32)
      } else if (screenPalette === 'mono') {
        u.uPaletteAmount.value = 0.85
        u.uPaletteColor.value.setRGB(1.05, 1.05, 1.05)
      } else {
        // Plain phosphor + every per-class palette ('phosphor-inv',
        // 'paper-phosphor', 'amber-inv', 'paper-amber', 'blue',
        // 'red-alert'). Each one bakes its colors into the DOM via a
        // CSS class, so the shader passes the captured texture through
        // without applying any additional tint.
        u.uPaletteAmount.value = 0
      }
    }
    if (glassMatRef.current) {
      const m = glassMatRef.current
      if (m.isMeshPhysicalMaterial) {
        if (glass.roughness != null) m.roughness = glass.roughness
        if (glass.clearcoat != null) m.clearcoat = glass.clearcoat
        if (glass.clearcoatRoughness != null) m.clearcoatRoughness = glass.clearcoatRoughness
        if (glass.envMapIntensity != null) m.envMapIntensity = glass.envMapIntensity
        // Explicitly bind scene.environment to the material's envMap so
        // envMapIntensity actually scales reflection. Without this, three.js
        // uses scene.environment as an implicit fallback that envMapIntensity
        // does NOT scale. Re-check each frame in case the env loads after
        // the material was created.
        if (m.envMap !== r3fScene.environment) {
          m.envMap = r3fScene.environment
          m.needsUpdate = true
        }
      } else {
        m.shininess = glass.shininess
        m.specular.set(glass.specular)
        m.reflectivity = glass.reflectivity
      }
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

  if (modelTransform) {
    return (
      <group
        position={modelTransform.position ?? [0, 0, 0]}
        rotation={modelTransform.rotation ?? [0, 0, 0]}
        scale={modelTransform.scale ?? 1}
      >
        <primitive object={cloned} />
      </group>
    )
  }
  return <primitive object={cloned} />
}

useGLTF.preload('/crt-tv.glb')
// Lab page model — preload kept conditional on the path so the production
// page doesn't pay for it.
if (typeof window !== 'undefined' && window.location.pathname.startsWith('/lab')) {
  useGLTF.preload('/apple2-4k-compressed.glb')
}
