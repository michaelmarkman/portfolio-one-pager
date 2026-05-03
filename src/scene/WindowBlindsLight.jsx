import { useMemo } from 'react'
import * as THREE from 'three'

/**
 * Fakes "light through window blinds" by laying an additive-blended plane
 * on the floor with vertical stripes. Cheaper and more reliable than a
 * gobo'd spotlight (Three.js core spotLight has no map support).
 */
export default function WindowBlindsLight({
  position = [-1.5, 0.012, 1.5],
  rotation = [-Math.PI / 2, 0, -0.4],
  size = [9, 9],
  color = '#ffe6c0',
  opacity = 0.45,
}) {
  const stripeTexture = useMemo(() => {
    const w = 256
    const h = 256
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    // Vertical stripes — bright bands with gaps between.
    const stripes = 6
    for (let i = 0; i < stripes; i++) {
      const x = (w / stripes) * i + (w / stripes) * 0.18
      const sw = (w / stripes) * 0.5
      const grad = ctx.createLinearGradient(x, 0, x + sw, 0)
      grad.addColorStop(0, 'rgba(255,255,255,0)')
      grad.addColorStop(0.5, 'rgba(255,255,255,1)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = grad
      ctx.fillRect(x, 0, sw, h)
    }
    // Soft radial vignette so the cast fades at edges.
    const radial = ctx.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w * 0.55)
    radial.addColorStop(0, 'rgba(0,0,0,0)')
    radial.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = radial
    ctx.fillRect(0, 0, w, h)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
    return tex
  }, [])

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: stripeTexture,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [stripeTexture, color, opacity],
  )

  return (
    <mesh position={position} rotation={rotation} material={material}>
      <planeGeometry args={size} />
    </mesh>
  )
}
