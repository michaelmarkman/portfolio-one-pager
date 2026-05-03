import { useCallback, useEffect, useRef, useState } from 'react'

const INTERACTIVE_SELECTOR = 'a, button, [role="button"]'
const HOVER_ATTR = 'data-fake-hover'

// The screen mesh's UV crop on the V axis (matches what shader samples).
const UV_V_MIN = 0.105
const UV_V_MAX = 0.895

/**
 * Maps a raycast hit on the screen mesh into the corresponding pixel of the
 * off-screen source DOM. Two strategies depending on the model:
 *  - useHitUv=false (default, prod CRT GLB): the curved screen mesh has
 *    non-linear UV interpolation, so we recompute the texture coord from the
 *    hit point's normalized mesh-local position, then crop to the bezel
 *    visible V range [0.105, 0.895].
 *  - useHitUv=true (lab Apple II, etc.): the screen mesh is a flat plane and
 *    its UVs span [0,1] (after remap/rotation), so hit.uv IS the texture
 *    sample coord directly.
 * Then applies the same barrel distortion the shader applies to find the
 * texture pixel being displayed at that point, and maps to a DOM element.
 */
export function useScreenInteraction({
  sourceRef,
  sourceSize,
  barrelK = 0.18,
  useHitUv = false,
}) {
  const [hovering, setHovering] = useState(false)
  const lastHoveredRef = useRef(null)

  // Apply the same UV warp as the fragment shader: 0.5 + (uv - 0.5) * (1 + k * r²)
  const barrelUv = useCallback(
    (uv) => {
      const cx = uv.x - 0.5
      const cy = uv.y - 0.5
      const r2 = cx * cx + cy * cy
      const m = 1 + barrelK * r2
      return { x: 0.5 + cx * m, y: 0.5 + cy * m }
    },
    [barrelK],
  )

  const findElementAt = useCallback(
    (hit) => {
      const container = sourceRef.current
      if (!container || !hit?.point) return null

      let texU, texV
      if (useHitUv) {
        // Flat plane mesh with [0,1] UVs (after any remap/rotation we
        // applied at mount). The raycast UV IS the texture sample coord.
        if (!hit.uv) return null
        texU = hit.uv.x
        texV = hit.uv.y
      } else {
        if (!hit.object?.geometry?.boundingBox) return null
        // Curved screen mesh — recompute from local position to dodge
        // non-linear UV interpolation across triangles.
        const local = hit.point.clone()
        hit.object.worldToLocal(local)
        const bb = hit.object.geometry.boundingBox
        // Local axes: X = horizontal, Z = vertical (up), Y = depth (Z-up
        // Blender export).
        const normX = (local.x - bb.min.x) / (bb.max.x - bb.min.x)
        const normZ = (local.z - bb.min.z) / (bb.max.z - bb.min.z)
        // The mesh's UV V range is [0.105, 0.895] — those are the texture
        // rows actually rendered; outside that range is hidden behind the
        // bezel.
        texU = normX
        texV = UV_V_MIN + normZ * (UV_V_MAX - UV_V_MIN)
      }

      // Apply the same barrel distortion the shader does on its UV lookup.
      const warped = barrelUv({ x: texU, y: texV })
      if (warped.x < 0 || warped.x > 1 || warped.y < 0 || warped.y > 1) return null

      const x = warped.x * sourceSize.width
      const y = (1 - warped.y) * sourceSize.height

      const containerRect = container.getBoundingClientRect()
      const candidates = container.querySelectorAll(INTERACTIVE_SELECTOR)
      for (let i = candidates.length - 1; i >= 0; i--) {
        const el = candidates[i]
        const r = el.getBoundingClientRect()
        const localLeft = r.left - containerRect.left
        const localTop = r.top - containerRect.top
        if (
          x >= localLeft &&
          x <= localLeft + r.width &&
          y >= localTop &&
          y <= localTop + r.height
        ) {
          return el
        }
      }
      return null
    },
    [sourceRef, sourceSize.width, sourceSize.height, barrelUv, useHitUv],
  )

  const setHover = useCallback((el) => {
    const prev = lastHoveredRef.current
    if (prev === el) return
    if (prev) prev.removeAttribute(HOVER_ATTR)
    if (el) el.setAttribute(HOVER_ATTR, '')
    lastHoveredRef.current = el
    setHovering(Boolean(el))
  }, [])

  // Cleanup hover on unmount.
  useEffect(() => {
    return () => {
      const prev = lastHoveredRef.current
      if (prev) prev.removeAttribute(HOVER_ATTR)
    }
  }, [])

  const onPointerMove = useCallback(
    (hit) => {
      if (!hit) return
      const el = findElementAt(hit)
      setHover(el)
    },
    [findElementAt, setHover],
  )

  const onPointerOut = useCallback(() => {
    setHover(null)
  }, [setHover])

  const onClick = useCallback(
    ({ hit, nativeEvent }) => {
      if (!hit) return
      const el = findElementAt(hit)
      if (!el) return

      nativeEvent?.preventDefault?.()
      nativeEvent?.stopPropagation?.()

      if (el.tagName === 'A') {
        el.click()
      } else {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }
    },
    [findElementAt],
  )

  return { onPointerMove, onPointerOut, onClick, hovering }
}
