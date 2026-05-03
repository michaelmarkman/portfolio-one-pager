import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { toCanvas as htmlToCanvas } from 'html-to-image'
import spaceMono400Url from '@fontsource/space-mono/files/space-mono-latin-400-normal.woff2?url'
import spaceMono700Url from '@fontsource/space-mono/files/space-mono-latin-700-normal.woff2?url'

const SOURCE_W = 1024
const SOURCE_H = 768
const CAPTURE_INTERVAL_MS = 120 // ~8fps; the terminal's animations are subtle

// Pre-fetch and base64-encode Space Mono so we can pass inline @font-face
// rules to html-to-image. Otherwise the SVG foreignObject fails to embed the
// fonts and falls back to system mono — text wraps differently and the click
// bridge maps cursor positions to the wrong source pixels.
async function buildFontEmbedCSS() {
  const toDataUri = async (url) => {
    const res = await fetch(url)
    const buf = await res.arrayBuffer()
    let bin = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return `data:font/woff2;base64,${btoa(bin)}`
  }
  const [u400, u700] = await Promise.all([
    toDataUri(spaceMono400Url),
    toDataUri(spaceMono700Url),
  ])
  return `
    @font-face {
      font-family: 'Space Mono';
      font-style: normal;
      font-weight: 400;
      src: url('${u400}') format('woff2');
    }
    @font-face {
      font-family: 'Space Mono';
      font-style: normal;
      font-weight: 700;
      src: url('${u700}') format('woff2');
    }
  `
}

let fontEmbedCSSPromise = null
function getFontEmbedCSS() {
  if (!fontEmbedCSSPromise) fontEmbedCSSPromise = buildFontEmbedCSS().catch(() => '')
  return fontEmbedCSSPromise
}

/**
 * Live-rasterizes the off-screen DOM source into a THREE.CanvasTexture using
 * html-to-image (SVG foreignObject under the hood). Fonts must be served from
 * the same origin (no Google Fonts) or html-to-image's CSS-rule walk fails.
 */
export function useHtmlCanvasTexture(sourceRef) {
  const { texture, canvas } = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = SOURCE_W
    c.height = SOURCE_H
    const ctx2d = c.getContext('2d')
    ctx2d.fillStyle = '#07130a'
    ctx2d.fillRect(0, 0, SOURCE_W, SOURCE_H)

    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    // Mipmaps + trilinear filter + 16x anisotropic = clean rendering of
    // high-frequency screen content (scanlines, slot mask) at any angle.
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.generateMipmaps = true
    t.anisotropy = 16
    t.flipY = true
    t.needsUpdate = true
    return { texture: t, canvas: c }
  }, [])

  useEffect(() => {
    const el = sourceRef.current
    if (!el) return
    const ctx = canvas.getContext('2d')

    let raf = 0
    let cancelled = false
    let lastAt = 0
    let inFlight = false

    // Force-load Space Mono weights — the browser otherwise lazy-loads fonts
    // and the off-screen .html-source can be skipped from font fetches.
    Promise.all([
      document.fonts.load('400 1rem "Space Mono"'),
      document.fonts.load('700 1rem "Space Mono"'),
      document.fonts.load('italic 400 1rem "Space Mono"'),
    ]).catch(() => {})

    let captureCount = 0
    const tick = async (now) => {
      if (cancelled) return
      if (!inFlight && now - lastAt >= CAPTURE_INTERVAL_MS) {
        inFlight = true
        try {
          const fontCSS = await getFontEmbedCSS()
          const captured = await htmlToCanvas(el, {
            canvasWidth: SOURCE_W,
            canvasHeight: SOURCE_H,
            pixelRatio: 1,
            cacheBust: false,
            skipFonts: true, // we provide the font CSS ourselves
            fontEmbedCSS: fontCSS,
          })
          if (!cancelled) {
            ctx.clearRect(0, 0, SOURCE_W, SOURCE_H)
            ctx.drawImage(captured, 0, 0, SOURCE_W, SOURCE_H)
            texture.needsUpdate = true
            captureCount++
            if (captureCount <= 3) {
              // eslint-disable-next-line no-console
              console.log('[useHtmlCanvasTexture] capture', captureCount, 'el=', el?.tagName, el?.className, 'capturedSize=', captured.width, 'x', captured.height)
            }
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[useHtmlCanvasTexture] capture failed', err)
        } finally {
          inFlight = false
          lastAt = now
        }
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [sourceRef, texture, canvas])

  return { texture, sourceSize: { width: SOURCE_W, height: SOURCE_H } }
}
