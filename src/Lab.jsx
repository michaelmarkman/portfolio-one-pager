import { useMemo, useRef, useState } from 'react'
import { useControls, folder } from 'leva'
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

/**
 * Experimental page — same scene composition as App.jsx but with live leva
 * controls so you can dial in scale/position/rotation/screen-binding for a
 * new GLB without restarting. Free orbit + zoom enabled. Open the browser
 * console to see the diagnostic mesh dump from pickScreenMesh.
 */
export default function Lab() {
  const sourceRef = useRef(null)
  const [camDebug, setCamDebug] = useState(null)

  const t = useControls('Model', {
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
        value: 'lobby',
        options: ['studio', 'apartment', 'city', 'sunset', 'warehouse', 'forest', 'lobby', 'park'],
        label: 'env',
      },
      // Scene-wide IBL controls — affect every PBR material in the scene
      // (the case mesh too, not just the glass). Drag down to dim the
      // overall room-light contribution.
      envIntensity: { value: 1.0, min: 0, max: 3, step: 0.05, label: 'env brightness' },
      envRotationY: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01, label: 'env rot Y' },
      envBlur: { value: 0, min: 0, max: 1, step: 0.01, label: 'env blur' },
      // --- Both ---
      glassForward: { value: 0, min: -0.05, max: 0.1, step: 0.001, label: 'forward' },
    }),
    content: folder({
      // Top padding of the source DOM in rem. Higher = content lower on the
      // screen; lower = content higher. Production uses 7.
      contentTopRem: { value: 4.8, min: 0, max: 14, step: 0.1, label: 'top pad' },
      // Multiplies every font size in the lab variant. 1 = production size.
      contentScale: { value: 1.4, min: 0.7, max: 2.5, step: 0.05, label: 'text size' },
    }),
    camera: folder({
      fov: { value: 30, min: 10, max: 90, step: 0.5 },
      // World-units the orbit-target shifts toward where the mouse is.
      // 0 disables parallax. ~0.05-0.15 reads as a subtle living shot.
      mouseParallax: { value: 0.04, min: 0, max: 0.4, step: 0.01, label: 'parallax' },
    }),
  })

  return (
    <>
      <HtmlSource
        ref={sourceRef}
        profile={PROFILE}
        footerLinks={FOOTER_LINKS}
        status="STATUS: LAB"
        variant="lab"
        pagePadTop={t.contentTopRem}
        contentScale={t.contentScale}
      />
      <CrtScene
        sourceRef={sourceRef}
        modelUrl="/apple2-4k-compressed.glb"
        debugMeshes
        freeOrbit
        showLeva
        labBackground
        cameraOverride={{
          // Default zoomed in close on the screen face. Free orbit/zoom still
          // available via mouse.
          position: [-1.05, 1.54, 3.51],
          target: [-0.06, 1.2, 0.36],
          fov: t.fov,
        }}
        mouseParallax={t.mouseParallax}
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
      {camDebug && (
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
