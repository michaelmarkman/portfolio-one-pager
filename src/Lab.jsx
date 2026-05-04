import { useEffect, useMemo, useRef, useState } from 'react'
import { useControls, folder } from 'leva'
import { track } from '@vercel/analytics'
import HtmlSource from './scene/HtmlSource.jsx'
import CrtScene from './scene/CrtScene.jsx'

const PROFILE = {
  name: 'MICHAEL MARKMAN',
  role: 'PRODUCT DESIGNER',
  location: 'NEW YORK CITY, NY',
  focus: 'SPATIAL COMPUTING & AGENTIC AI',
  currentRole: { label: 'ShapesXR', href: 'https://www.shapesxr.com/' },
}

const FOOTER_LINKS = [
  { label: 'TWITTER', href: 'https://x.com/michaelgmarkman' },
  { label: 'LINKEDIN', href: 'https://www.linkedin.com/in/michaelgmarkman/' },
  { label: 'EMAIL', href: 'mailto:michael@markman.io' },
]

// Curated CSS-filter color grades. Preset string is concatenated with the
// always-on slider adjustments below. Order matters: preset first so user
// sliders ride on top.
//
// 'off' and 'warm' share an identical sepia/saturate/hue-rotate structure
// so the browser can smoothly interpolate between them when the day/night
// 'auto' filter switches modes (see CSS .three-stage transition rule).
// Other presets are manual-pick only — toggling between them snaps.
const FILTER_PRESETS = {
  off: 'sepia(0) saturate(1) hue-rotate(0deg)',
  warm: 'sepia(0.12) saturate(1.05) hue-rotate(-6deg)',
  cool: 'hue-rotate(-12deg) saturate(0.92)',
  phosphor: 'hue-rotate(-8deg) saturate(1.35) contrast(1.08)',
  vhs: 'saturate(0.7) contrast(0.92) sepia(0.08)',
  bleach: 'saturate(0.45) contrast(1.25) brightness(1.05)',
  sepia: 'sepia(0.6) contrast(1.05)',
  bw: 'grayscale(1) contrast(1.08)',
  kodachrome: 'saturate(1.4) contrast(1.08) sepia(0.08) hue-rotate(-4deg)',
}

// Lerp a hex color toward black by `amount` (0–1). Used to derive the
// dim text variant from the secondary picker so the user only has to
// tune two text colors.
function darkenHex(hex, amount) {
  const h = (hex || '#000000').replace('#', '')
  const f = 1 - amount
  const r = Math.round(parseInt(h.slice(0, 2), 16) * f)
  const g = Math.round(parseInt(h.slice(2, 4), 16) * f)
  const b = Math.round(parseInt(h.slice(4, 6), 16) * f)
  return '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')
}

/**
 * Experimental page — same scene composition as App.jsx but with live leva
 * controls so you can dial in scale/position/rotation/screen-binding for a
 * new GLB without restarting. Free orbit + zoom enabled. Open the browser
 * console to see the diagnostic mesh dump from pickScreenMesh.
 */
export default function Lab() {
  const sourceRef = useRef(null)
  const [camDebug, setCamDebug] = useState(null)
  const [shakeIntensity, setShakeIntensity] = useState(0.06)

  const [t, setT] = useControls('Model', () => ({
    scene: folder({
      // Top-level scene aesthetic. Lab = synthwave green grid + atmospherics.
      // Cozy = warm afternoon sun + god rays + light dust + soft shadows.
      sceneMode: {
        value: 'lab',
        options: ['lab', 'cozy'],
        label: 'mode',
      },
      // Screen color palette — 'auto' picks phosphor for lab, amber-inverted
      // for cozy. Manual options override.
      // 'amber'           = dark screen, amber phosphor text (classic amber CRT)
      // 'amber-inverted' = light amber bg, dark amber text (paper-monitor)
      // 'custom'         = pick any bg + text colors via the three pickers
      //                    in the nested 'custom' folder (only shown when
      //                    'custom' is selected)
      screenPalette: {
        value: 'auto',
        options: ['auto', 'phosphor', 'amber', 'amber-inverted', 'mono', 'custom'],
        label: 'screen',
      },
    }),
    transform: folder({
      scale: { value: 5, min: 0.1, max: 20, step: 0.1 },
      posX: { value: 0, min: -5, max: 5, step: 0.05 },
      posY: { value: 0, min: -2, max: 5, step: 0.05 },
      posZ: { value: 0.5, min: -5, max: 5, step: 0.05 },
      rotX: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01 },
      rotY: { value: Math.PI, min: -Math.PI, max: Math.PI, step: 0.01 },
      rotZ: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01 },
    }),
    screen: folder({
      remapScreenUV: { value: true },
      screenForward: { value: 0.005, min: -0.1, max: 0.2, step: 0.001 },
      screenUVRotation: { value: 90, min: -180, max: 180, step: 90, label: 'uv rot°' },
      screenUVFlipX: { value: false, label: 'flip X' },
      screenUVFlipY: { value: false, label: 'flip Y' },
    }),
    visibility: folder({
      hideKeyboard: { value: false },
      hideBody: { value: false },
      glassMesh: { value: true, label: 'glass layer' },
      backOccluder: { value: false, label: 'back occluder' },
    }),
    glass: folder({
      // 'phong' = MeshPhongMaterial (Blinn-Phong, hotspot).
      // 'physical' = MeshPhysicalMaterial + IBL env reflection (looks more
      //   like real glass).
      glassMode: { value: 'physical', options: ['phong', 'physical'] },
      // --- Phong-only ---
      glassShininess: { value: 40, min: 1, max: 120, step: 1, label: 'shininess' },
      glassSpecular: { value: '#6b6b6b', label: 'specular' },
      glassReflectivity: { value: 0.4, min: 0, max: 1, step: 0.01, label: 'reflectivity' },
      // --- Physical-only ---
      glassRoughness: { value: 0.38, min: 0, max: 1, step: 0.01, label: 'roughness' },
      glassClearcoat: { value: 0.75, min: 0, max: 1, step: 0.01, label: 'clearcoat' },
      glassClearcoatRoughness: { value: 0.41, min: 0, max: 1, step: 0.01, label: 'cc rough' },
      glassEnvIntensity: { value: 0.4, min: 0, max: 3, step: 0.05, label: 'env mult' },
      envPreset: {
        value: 'auto',
        options: ['auto', 'studio', 'apartment', 'city', 'sunset', 'warehouse', 'forest', 'lobby', 'park'],
        label: 'env',
      },
      // Scene-wide IBL controls — affect every PBR material in the scene
      // (the case mesh too, not just the glass). Drag down to dim the
      // overall room-light contribution.
      envIntensity: { value: 0.2, min: 0, max: 3, step: 0.05, label: 'env brightness' },
      envRotationY: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01, label: 'env rot Y' },
      envBlur: { value: 0, min: 0, max: 1, step: 0.01, label: 'env blur' },
      // --- Both ---
      glassForward: { value: 0, min: -0.05, max: 0.1, step: 0.001, label: 'forward' },
    }),
    content: folder({
      // Top padding of the source DOM in rem. Higher = content lower on the
      // screen; lower = content higher. Production uses 7.
      contentTopRem: { value: 3.6, min: 0, max: 14, step: 0.1, label: 'top pad' },
      // Multiplies every font size in the lab variant. 1 = production size.
      contentScale: { value: 1.4, min: 0.7, max: 2.5, step: 0.05, label: 'text size' },
    }),
    camera: folder({
      fov: { value: 30, min: 10, max: 90, step: 0.5 },
      // World-units the orbit-target shifts toward where the mouse is.
      // 0 disables parallax. ~0.05-0.15 reads as a subtle living shot.
      mouseParallax: { value: 0.03, min: 0, max: 0.4, step: 0.01, label: 'parallax' },
      // Slow vertical sine-wave bob — both camera and target translate
      // together so the framing stays locked. 0 disables.
      idleBob: { value: 0.006, min: 0, max: 0.05, step: 0.0005, label: 'idle bob' },
      idleBobSpeed: { value: 0.35, min: 0.05, max: 1.5, step: 0.05, label: 'bob speed' },
      // Zoom on by default (caged + spring-back); pan stays off so the
      // framing target can't wander away from the PC.
      enableZoom: { value: true, label: 'zoom' },
      enablePan: { value: false, label: 'pan unlock' },
      // Free-roam mode for finding new framings. unlockCage widens all
      // rotation + distance limits so you can orbit anywhere; pauseReturn
      // disables the spring-back so the camera holds wherever you release.
      // Use both, then read the HUD values for a baked INTRO_CAM.
      unlockCage: { value: false, label: 'unlock cage' },
      pauseReturn: { value: false, label: 'pause return' },
    }),
    grade: folder({
      // Renderer tone-mapping enum + exposure. ACESFilmic is R3F's default
      // (saturated/film-y highlights). AgX/Neutral are newer and more
      // accurate. Linear/None give you the raw look. Switching modes
      // recompiles materials; exposure is a uniform-only update.
      toneMode: {
        value: 'ACESFilmic',
        options: ['None', 'Linear', 'Reinhard', 'Cineon', 'ACESFilmic', 'AgX', 'Neutral'],
        label: 'tone',
      },
      toneExposure: { value: 1, min: 0, max: 3, step: 0.05, label: 'exposure' },
    }),
    grid: folder({
      // Lab synthwave floor grid — toggle off to see the scene without it,
      // or change the line colors. Section lines are the bright ones every
      // 2.5 units; cell lines fill in between every 0.5 units.
      gridEnabled: { value: true, label: 'enabled' },
      gridSection: { value: '#163e21', label: 'section' },
      gridCell: { value: '#004522', label: 'cell' },
    }),
    filter: folder({
      // CSS filter on .three-stage — applies to the rendered canvas pixels
      // after Three.js is done. Preset gives you a starting look, sliders
      // ride on top so you can tweak any preset further.
      filterPreset: {
        value: 'auto',
        options: ['auto', 'off', 'warm', 'cool', 'phosphor', 'vhs', 'bleach', 'sepia', 'bw', 'kodachrome'],
        label: 'preset',
      },
      filterSat: { value: 1, min: 0, max: 2, step: 0.01, label: 'saturate' },
      filterHue: { value: 0, min: -180, max: 180, step: 1, label: 'hue°' },
      filterContrast: { value: 1, min: 0, max: 2, step: 0.01, label: 'contrast' },
      filterBrightness: { value: 1, min: 0, max: 2, step: 0.01, label: 'brightness' },
    }),
    grain: folder({
      // Custom additive-noise pass via EffectComposer + ShaderPass.
      // Adds zero-centered noise so darks AND lights speckle equally —
      // unlike Three's stock FilmPass which multiplies brightness.
      // Covers everything the WebGL renderer draws.
      grainEnabled: { value: false, label: 'enabled' },
      grainIntensity: { value: 0.15, min: 0, max: 0.6, step: 0.005, label: 'intensity' },
      grainGrayscale: { value: false, label: 'b&w' },
    }),
    custom: folder({
      // Three pickers driving the custom screen palette. Only meaningful
      // when 'screen' is set to 'custom' in the scene folder. Each
      // control individually conditional-renders so the folder header
      // hides cleanly when not in custom mode.
      customBg: {
        value: '#07130a',
        label: 'bg',
        render: (get) => get('Model.scene.screenPalette') === 'custom',
      },
      customPrimary: {
        value: '#15ff00',
        label: 'primary',
        render: (get) => get('Model.scene.screenPalette') === 'custom',
      },
      customSecondary: {
        value: '#0f9900',
        label: 'secondary',
        render: (get) => get('Model.scene.screenPalette') === 'custom',
      },
    }),
  }))

  // Each tap to day flips between the two amber looks (light-bg paper
  // monitor and dark-bg amber CRT). Stays in state so the visual sticks
  // through React renders. Manual leva picks override the alternation.
  const [cozyPalette, setCozyPalette] = useState('amber-inverted')
  const toggleScene = () => {
    const next = t.sceneMode === 'cozy' ? 'lab' : 'cozy'
    if (next === 'cozy') {
      setCozyPalette((p) => (p === 'amber-inverted' ? 'amber' : 'amber-inverted'))
    }
    setT({ sceneMode: next })
    // Tracked here only — the daytime auto-flip in the useEffect below
    // calls setT directly so it doesn't fire this analytics event.
    track('scene_toggle', { mode: next })
  }

  // Resolve 'auto' to phosphor in lab and to the current cozyPalette in
  // cozy. Manual options ('amber', 'amber-inverted', 'phosphor', 'mono')
  // pass through unchanged.
  const effectivePalette =
    t.screenPalette === 'auto'
      ? t.sceneMode === 'cozy' ? cozyPalette : 'phosphor'
      : t.screenPalette

  // Auto-flip to day mode partway through the intro if it's daytime in
  // the visitor's local timezone. Fires once on mount; bails if the user
  // has already flipped manually before the timer hits.
  const sceneModeRef = useRef(t.sceneMode)
  useEffect(() => {
    sceneModeRef.current = t.sceneMode
  }, [t.sceneMode])
  useEffect(() => {
    const hour = new Date().getHours()
    const isDaytime = hour >= 6 && hour < 18
    if (!isDaytime) return
    // Pre-flip hint: fake-hover the toggle for a second so the user sees
    // the icon highlight before the scene flips on its own — pointing at
    // the control they can use to switch back later.
    const hoverOn = setTimeout(() => {
      if (sceneModeRef.current !== 'lab') return
      const btn = document.querySelector('.day-night-toggle')
      if (btn) btn.setAttribute('data-fake-hover', '')
    }, 10000)
    const flip = setTimeout(() => {
      const btn = document.querySelector('.day-night-toggle')
      if (btn) btn.removeAttribute('data-fake-hover')
      if (sceneModeRef.current !== 'lab') return
      // Drop shake intensity for the auto-flip — it's a passive
      // transition, so the bump should be a soft nudge rather than the
      // punchy thump of a manual toggle. Restored after the shake's
      // duration so subsequent manual clicks feel normal.
      setShakeIntensity(0.018)
      setCozyPalette((p) =>
        p === 'amber-inverted' ? 'amber' : 'amber-inverted',
      )
      setT({ sceneMode: 'cozy' })
      setTimeout(() => setShakeIntensity(0.06), 700)
    }, 11000)
    return () => {
      clearTimeout(hoverOn)
      clearTimeout(flip)
      const btn = document.querySelector('.day-night-toggle')
      if (btn) btn.removeAttribute('data-fake-hover')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Whether the off-screen DOM should be inverted before capture (light bg,
  // dark text). Driven by the resolved palette so 'amber-inverted' always
  // inverts, regardless of sceneMode.
  const screenInvert = effectivePalette === 'amber-inverted'

  // Build the inline-style payload for the 'custom' palette. The three
  // user-picked colors map to --bg / --terminal-green / --terminal-mid;
  // --terminal-dim is auto-derived as a darkened secondary so we don't
  // burn a fourth picker on a value the shader crushes anyway.
  const customPalette = useMemo(() => {
    if (effectivePalette !== 'custom') return null
    return {
      bg: t.customBg,
      primary: t.customPrimary,
      secondary: t.customSecondary,
      dim: darkenHex(t.customSecondary, 0.35),
    }
  }, [effectivePalette, t.customBg, t.customPrimary, t.customSecondary])

  const canvasFilter = useMemo(() => {
    const presetKey =
      t.filterPreset === 'auto'
        ? t.sceneMode === 'cozy' ? 'warm' : 'off'
        : t.filterPreset
    const preset = FILTER_PRESETS[presetKey] ?? ''
    const adj = `saturate(${t.filterSat}) hue-rotate(${t.filterHue}deg) contrast(${t.filterContrast}) brightness(${t.filterBrightness})`
    return [preset, adj].filter(Boolean).join(' ')
  }, [t.filterPreset, t.sceneMode, t.filterSat, t.filterHue, t.filterContrast, t.filterBrightness])

  const filmGrain = useMemo(
    () => ({ enabled: t.grainEnabled, intensity: t.grainIntensity, grayscale: t.grainGrayscale }),
    [t.grainEnabled, t.grainIntensity, t.grainGrayscale],
  )

  return (
    <>
      <HtmlSource
        ref={sourceRef}
        profile={PROFILE}
        footerLinks={FOOTER_LINKS}
        variant="lab"
        pagePadTop={t.contentTopRem}
        contentScale={t.contentScale}
        audioSrc="/lofi.mp3"
        sceneMode={t.sceneMode}
        onToggleScene={toggleScene}
        screenInvert={screenInvert}
        screenPalette={effectivePalette}
        customPalette={customPalette}
      />
      <CrtScene
        sourceRef={sourceRef}
        modelUrl="/apple2-4k-compressed.glb"
        debugMeshes={import.meta.env.DEV}
        freeOrbit
        showLeva={import.meta.env.DEV}
        labBackground={t.sceneMode === 'lab'}
        sceneMode={t.sceneMode}
        filmGrain={filmGrain}
        shakeIntensity={shakeIntensity}
        screenPalette={effectivePalette}
        cameraOverride={{
          // Default zoomed in close on the screen face. Free orbit/zoom still
          // available via mouse.
          position: [-0.75, 1.26, 3.20],
          target: [-0.04, 1.29, 0.36],
          fov: t.fov,
        }}
        mouseParallax={t.mouseParallax}
        idleBob={t.idleBob}
        idleBobSpeed={t.idleBobSpeed}
        enableZoom={t.enableZoom}
        enablePan={t.enablePan}
        unlockCage={t.unlockCage}
        pauseReturn={t.pauseReturn}
        tone={useMemo(
          () => ({ mode: t.toneMode, exposure: t.toneExposure }),
          [t.toneMode, t.toneExposure],
        )}
        canvasFilter={canvasFilter}
        gridOverride={useMemo(
          () => ({
            enabled: t.gridEnabled,
            sectionColor: t.gridSection,
            cellColor: t.gridCell,
          }),
          [t.gridEnabled, t.gridSection, t.gridCell],
        )}
        modelTransform={{
          scale: t.scale,
          position: [t.posX, t.posY, t.posZ],
          rotation: [t.rotX, t.rotY, t.rotZ],
        }}
        screenForward={t.screenForward}
        remapScreenUV={t.remapScreenUV}
        screenUVRotation={t.screenUVRotation}
        screenUVFlipX={t.screenUVFlipX}
        screenUVFlipY={t.screenUVFlipY}
        useHitUv
        enableGlassMesh={t.glassMesh}
        enableBackOccluder={t.backOccluder}
        glassMode={t.glassMode}
        envPreset={t.envPreset}
        envIntensity={t.envIntensity}
        envRotationY={t.envRotationY}
        envBlur={t.envBlur}
        glassOverride={useMemo(
          () => ({
            shininess: t.glassShininess,
            specular: t.glassSpecular,
            reflectivity: t.glassReflectivity,
            roughness: t.glassRoughness,
            clearcoat: t.glassClearcoat,
            clearcoatRoughness: t.glassClearcoatRoughness,
            envMapIntensity: t.glassEnvIntensity,
            forwardOffset: t.glassForward,
          }),
          [
            t.glassShininess,
            t.glassSpecular,
            t.glassReflectivity,
            t.glassRoughness,
            t.glassClearcoat,
            t.glassClearcoatRoughness,
            t.glassEnvIntensity,
            t.glassForward,
          ],
        )}
        onCameraChange={setCamDebug}
        hideMeshes={useMemo(
          () =>
            [t.hideKeyboard ? 'keyboard' : null, t.hideBody ? 'body' : null].filter(Boolean),
          [t.hideKeyboard, t.hideBody],
        )}
      />
      {import.meta.env.DEV && camDebug && (
        <div
          style={{
            position: 'fixed',
            bottom: 12,
            left: 12,
            zIndex: 100,
            padding: '10px 14px',
            background: 'rgba(8, 16, 12, 0.85)',
            border: '1px solid #2a4a36',
            color: '#9bff8a',
            font: '11px/1.45 ui-monospace, Menlo, monospace',
            borderRadius: 6,
            pointerEvents: 'none',
            whiteSpace: 'pre',
          }}
        >
          {`position: [${camDebug.pos.map((n) => n.toFixed(2)).join(', ')}]
target:   [${camDebug.target.map((n) => n.toFixed(2)).join(', ')}]
fov:      ${camDebug.fov.toFixed(1)}
zoom (d): ${camDebug.distance.toFixed(2)}
azimuth:  ${camDebug.azimuthDeg.toFixed(1)}°  (${camDebug.azimuth.toFixed(3)})
polar:    ${camDebug.polarDeg.toFixed(1)}°  (${camDebug.polar.toFixed(3)})`}
        </div>
      )}
    </>
  )
}
