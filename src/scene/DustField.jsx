import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const COUNT = 450
const BOX = {
  xMin: -3.0, xMax: 3.0,
  yMin: 0.2, yMax: 4.5,
  zMin: -2.0, zMax: 2.6,
}
const SPEED_MIN = 0.025
const SPEED_MAX = 0.07

/**
 * Volumetric dust drifting upward through the scene. Phosphor-green tint at
 * the front of the box (closest to camera) fading to white at the back.
 */
export default function DustField() {
  const pointsRef = useRef()

  const { geometry, speeds } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3)
    const speedArr = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3 + 0] = THREE.MathUtils.lerp(BOX.xMin, BOX.xMax, Math.random())
      positions[i * 3 + 1] = THREE.MathUtils.lerp(BOX.yMin, BOX.yMax, Math.random())
      positions[i * 3 + 2] = THREE.MathUtils.lerp(BOX.zMin, BOX.zMax, Math.random())
      speedArr[i] = THREE.MathUtils.lerp(SPEED_MIN, SPEED_MAX, Math.random())
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return { geometry: g, speeds: speedArr }
  }, [])

  const spriteTexture = useMemo(() => {
    const size = 32
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.4, 'rgba(255,255,255,0.55)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(canvas)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    return tex
  }, [])

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: spriteTexture },
        uColorFront: { value: new THREE.Color('#9bff8a') },
        uColorBack: { value: new THREE.Color('#dde6df') },
        uZRange: { value: new THREE.Vector2(BOX.zMin, BOX.zMax) },
        uOpacity: { value: 0.32 },
      },
      vertexShader: /* glsl */ `
        varying float vDepth;
        uniform vec2 uZRange;
        void main() {
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPos;
          vDepth = clamp((position.z - uZRange.x) / (uZRange.y - uZRange.x), 0.0, 1.0);
          gl_PointSize = 14.0 / max(0.5, -mvPos.z);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vDepth;
        uniform sampler2D uMap;
        uniform vec3 uColorFront;
        uniform vec3 uColorBack;
        uniform float uOpacity;
        void main() {
          vec4 sprite = texture2D(uMap, gl_PointCoord);
          if (sprite.a < 0.02) discard;
          vec3 col = mix(uColorBack, uColorFront, vDepth);
          gl_FragColor = vec4(col, sprite.a * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  }, [spriteTexture])

  useFrame((_, delta) => {
    const points = pointsRef.current
    if (!points) return
    const positions = points.geometry.attributes.position.array
    for (let i = 0; i < COUNT; i++) {
      const yi = i * 3 + 1
      positions[yi] += speeds[i] * delta
      if (positions[yi] > BOX.yMax) {
        positions[yi] = BOX.yMin
        positions[i * 3 + 0] = THREE.MathUtils.lerp(BOX.xMin, BOX.xMax, Math.random())
        positions[i * 3 + 2] = THREE.MathUtils.lerp(BOX.zMin, BOX.zMax, Math.random())
      }
    }
    points.geometry.attributes.position.needsUpdate = true
  })

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
}
