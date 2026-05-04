import { useMemo } from 'react'
import * as THREE from 'three'

/**
 * Cheap volumetric god-ray shafts. A small stack of slanted, semi-transparent
 * planes — each uses the same vertical-stripe-and-fade texture, additively
 * blended at low opacity. Layered along the camera's Z axis so the planes
 * accumulate into a visible wedge of light coming from off-screen upper-right.
 *
 * Geometry intentionally kept simple: every plane has the same
 * orientation (a single shared slant), and the spacing is along Z so
 * the user always sees the stripe pattern at the correct angle from
 * the default camera framing.
 */
export default function GodRayShafts({
  count = 3,
  // Pushed +X so the wedge sits on camera-right (off the model toward
  // the imagined window) instead of crossing the whole frame.
  position = [1.9, 2.4, -0.3],
  // -π/6 around Z tilts the (otherwise vertical) stripes ~30° clockwise,
  // so they read as rays falling from upper-right toward lower-left.
  rotation = [0, 0, -Math.PI / 6],
  size = [2.6, 5],
  depthSpacing = 0.55,
  color = '#ffe8b8',
  opacity = 0.09,
}) {
  const stripeTexture = useMemo(() => {
    const w = 256
    const h = 512
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    const stripes = 3
    for (let i = 0; i < stripes; i++) {
      const x = (w / stripes) * i + (w / stripes) * 0.30
      const sw = (w / stripes) * 0.32
      const grad = ctx.createLinearGradient(x, 0, x + sw, 0)
      grad.addColorStop(0, 'rgba(255,255,255,0)')
      grad.addColorStop(0.5, 'rgba(255,255,255,1)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = grad
      ctx.fillRect(x, 0, sw, h)
    }
    // Vertical falloff so the rays fade out near the top + bottom.
    const v = ctx.createLinearGradient(0, 0, 0, h)
    v.addColorStop(0, 'rgba(0,0,0,0.7)')
    v.addColorStop(0.4, 'rgba(0,0,0,0)')
    v.addColorStop(0.85, 'rgba(0,0,0,0)')
    v.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = v
    ctx.fillRect(0, 0, w, h)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
    return tex
  }, [])

  const halfRange = ((count - 1) * depthSpacing) / 2
  const planes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        key: i,
        // Spread along Z (depth) so additive layering builds volume from
        // the camera's perspective. Center the stack on `position[2]`.
        position: [position[0], position[1], position[2] + (i * depthSpacing - halfRange)],
      })),
    [count, position, depthSpacing, halfRange],
  )

  return (
    <group>
      {planes.map((p) => (
        <mesh key={p.key} position={p.position} rotation={rotation}>
          <planeGeometry args={size} />
          <meshBasicMaterial
            map={stripeTexture}
            color={color}
            transparent
            opacity={opacity}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  )
}
