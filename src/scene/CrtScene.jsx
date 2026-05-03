import { Suspense, useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Grid, OrbitControls } from '@react-three/drei'
import { Leva, useControls, folder } from 'leva'
import * as THREE from 'three'
import CrtModel from './CrtModel.jsx'
import DustField from './DustField.jsx'
import WindowBlindsLight from './WindowBlindsLight.jsx'
import { useHtmlCanvasTexture } from './useHtmlCanvasTexture.js'

const CAMERA = {
  posX: -0.4, posY: 2.0, posZ: 4.7, fov: 35,
  targetX: 0, targetY: 2.0, targetZ: 1,
}

const SWAY = {
  swayY: 0.018, swayX: 0.010,
  speedY: 0.18, speedX: 0.13,
  damping: 2.5,
  bobAmplitude: 0.02, // very subtle vertical bob (world units)
  bobSpeed: 0.55, // ~11s period
}

const LIGHTS = {
  ambient: 0.85,
  keyDir: 1.05,
  rimDir: 0.5,
  fillDir: 0.3,
  phosphorIntensity: 0.4,
  phosphorColor: '#15ff00',
  phosphorDistance: 7,
}

const SHADER = {
  barrel: 0.09,
  chromatic: 0.0011,
  scanlineStrength: 0.18,
  scanlineFreq: 720,
  vignette: 0.55,
  rollSpeed: 0.08,
}

const GLASS = {
  shininess: 60,
  specular: '#6b6b6b',
  reflectivity: 0.4,
  forwardOffset: 0.11,
}

const ORBIT_LIMITS = {
  minAz: -Math.PI * 0.09,
  maxAz: Math.PI * 0.04,
  minPolar: Math.PI * 0.45,
  maxPolar: Math.PI * 0.55,
}

const TONE_MAP = {
  None: THREE.NoToneMapping,
  Linear: THREE.LinearToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
  Cineon: THREE.CineonToneMapping,
  ACESFilmic: THREE.ACESFilmicToneMapping,
  AgX: THREE.AgXToneMapping,
  Neutral: THREE.NeutralToneMapping,
}

/**
 * Drives a flickering intensity on a light (gentle constant flutter + a
 * sharper dip every few seconds). Returns refs/handlers for two light types.
 */
function useFlicker(seed, baseIntensity, dip = 0.3) {
  const ref = useRef()
  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.elapsedTime + seed
    // Gentler breath: ±3% (was ±8%).
    const breathe = 1 + Math.sin(t * 7.3) * 0.015 + Math.sin(t * 11.7) * 0.012
    // Slower dip cycle (mean ~10s instead of ~3.5s) so it's a rare event.
    const cycle = (t * 0.1 + seed * 0.5) % 1
    const dipAmt = cycle > 0.97 ? Math.sin(((cycle - 0.97) / 0.03) * Math.PI) * dip : 0
    ref.current.intensity = baseIntensity * breathe * (1 - dipAmt)
  })
  return ref
}

function FlickerPointLight({ baseIntensity, seed = 0, dip, ...props }) {
  const ref = useFlicker(seed, baseIntensity, dip)
  return <pointLight ref={ref} intensity={baseIntensity} {...props} />
}

function FlickerDirectionalLight({ baseIntensity, seed = 0, dip, ...props }) {
  const ref = useFlicker(seed, baseIntensity, dip)
  return <directionalLight ref={ref} intensity={baseIntensity} {...props} />
}

/**
 * Subtle idle sway on the model group — gives the scene a sense of life
 * without fighting OrbitControls. Two slow sin/cos waves on rotation, with
 * lerped damping so it eases in and never snaps.
 */
function IdleSway({ children }) {
  const groupRef = useRef()
  const targetRot = useRef({ x: 0, y: 0 })
  useFrame((state, delta) => {
    if (!groupRef.current) return
    const t = state.clock.elapsedTime
    targetRot.current.y = Math.sin(t * SWAY.speedY) * SWAY.swayY
    targetRot.current.x = Math.cos(t * SWAY.speedX) * SWAY.swayX
    const lerp = 1 - Math.exp(-delta * SWAY.damping)
    groupRef.current.rotation.y += (targetRot.current.y - groupRef.current.rotation.y) * lerp
    groupRef.current.rotation.x += (targetRot.current.x - groupRef.current.rotation.x) * lerp
    // Very subtle vertical bob — applied to the model (visually equivalent
    // to bobbing the camera, but doesn't fight OrbitControls).
    const targetBob = Math.sin(t * SWAY.bobSpeed) * SWAY.bobAmplitude
    groupRef.current.position.y += (targetBob - groupRef.current.position.y) * lerp
  })
  return <group ref={groupRef}>{children}</group>
}

/**
 * After the user releases an orbit drag, springs the camera back to the
 * starting azimuth/polar. Underdamped so it overshoots and settles —
 * gives a "bounce" feel, especially when released at a cage limit.
 */
function OrbitResetController({ orbitLimits }) {
  const controls = useThree((s) => s.controls)
  const draggingRef = useRef(false)
  const azVelRef = useRef(0)
  const polarVelRef = useRef(0)

  // Default azimuth + polar derived from CAMERA position relative to target.
  const dx = CAMERA.posX - CAMERA.targetX
  const dy = CAMERA.posY - CAMERA.targetY
  const dz = CAMERA.posZ - CAMERA.targetZ
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const targetAzimuth = Math.atan2(dx, dz)
  const targetPolar = Math.acos(dy / distance)

  // Spring tuning — underdamped so the rebound is visible but settles fast.
  const STIFFNESS = 12
  const DAMPING_RATIO = 0.55 // 1 = critical, <1 bouncy, >1 sluggish
  const dampingCoef = 2 * Math.sqrt(STIFFNESS) * DAMPING_RATIO

  // On release, kick velocity AWAY from the cage limit if user was sitting
  // at it — sells the "tug at the wall" rubber-band feel before springing
  // back through the default.
  const EDGE_EPS = 0.005
  const REBOUND_KICK = 1.6 // rad/sec impulse magnitude

  useEffect(() => {
    if (!controls) return
    const onStart = () => {
      draggingRef.current = true
      azVelRef.current = 0
      polarVelRef.current = 0
    }
    const onEnd = () => {
      draggingRef.current = false
      // Apply a spring-back kick if the drag ended at an azimuth/polar limit.
      const az = controls.getAzimuthalAngle()
      const polar = controls.getPolarAngle()
      if (Math.abs(az - orbitLimits.minAz) < EDGE_EPS) azVelRef.current = REBOUND_KICK
      else if (Math.abs(az - orbitLimits.maxAz) < EDGE_EPS) azVelRef.current = -REBOUND_KICK
      if (Math.abs(polar - orbitLimits.minPolar) < EDGE_EPS) polarVelRef.current = REBOUND_KICK
      else if (Math.abs(polar - orbitLimits.maxPolar) < EDGE_EPS) polarVelRef.current = -REBOUND_KICK
    }
    controls.addEventListener('start', onStart)
    controls.addEventListener('end', onEnd)
    return () => {
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('end', onEnd)
    }
  }, [controls, orbitLimits])

  useFrame((_, delta) => {
    if (!controls || draggingRef.current) return
    if (typeof controls.getAzimuthalAngle !== 'function') return
    const currentAz = controls.getAzimuthalAngle()
    const currentPolar = controls.getPolarAngle()
    // Bail when settled (both pos and velocity quiet).
    const azDelta = targetAzimuth - currentAz
    const polarDelta = targetPolar - currentPolar
    if (
      Math.abs(azDelta) < 1e-4 && Math.abs(azVelRef.current) < 1e-4 &&
      Math.abs(polarDelta) < 1e-4 && Math.abs(polarVelRef.current) < 1e-4
    ) {
      azVelRef.current = 0
      polarVelRef.current = 0
      return
    }
    // Spring-damper integration (semi-implicit Euler).
    const azAccel = STIFFNESS * azDelta - dampingCoef * azVelRef.current
    const polarAccel = STIFFNESS * polarDelta - dampingCoef * polarVelRef.current
    azVelRef.current += azAccel * delta
    polarVelRef.current += polarAccel * delta
    controls.setAzimuthalAngle(currentAz + azVelRef.current * delta)
    controls.setPolarAngle(currentPolar + polarVelRef.current * delta)
  })

  return null
}

/**
 * Dampened mouse pan — translates camera AND orbit target in lock-step
 * along the camera-relative right/up axes. The look direction stays
 * constant so it reads as a smooth parallax pan rather than a head-turn.
 * Each frame we strip the previous offset off both camera + target,
 * compute a new desired offset from mouse, lerp toward it, then re-apply.
 * OrbitControls keeps full freedom; the user can still drag to orbit and
 * the pan rides on top.
 */
function MouseParallax({ strength = 0.08, lerpAmt = 0.025 }) {
  const controls = useThree((s) => s.controls)
  const camera = useThree((s) => s.camera)
  const mouse = useThree((s) => s.mouse)
  const prev = useRef(new THREE.Vector3())
  const tmpDir = useRef(new THREE.Vector3())
  const tmpRight = useRef(new THREE.Vector3())
  const tmpUp = useRef(new THREE.Vector3())
  const tmpTarget = useRef(new THREE.Vector3())

  useFrame(() => {
    if (!controls?.target) return
    // Recover the orbit-driven base position by subtracting last frame's
    // parallax offset from BOTH camera and target.
    controls.target.sub(prev.current)
    camera.position.sub(prev.current)
    // Camera-relative right + up axes (world space).
    camera.getWorldDirection(tmpDir.current)
    tmpRight.current.crossVectors(tmpDir.current, camera.up).normalize()
    tmpUp.current.crossVectors(tmpRight.current, tmpDir.current).normalize()
    // Desired pan offset in world space. Negative so the camera drifts
    // OPPOSITE the cursor — mouse-right shifts the camera left, which makes
    // the model appear to move with the cursor (counter-parallax / follow).
    tmpTarget.current
      .copy(tmpRight.current)
      .multiplyScalar(-mouse.x * strength)
      .addScaledVector(tmpUp.current, -mouse.y * strength)
    // Smooth-ease (this IS the damping — small lerpAmt = slower follow).
    prev.current.lerp(tmpTarget.current, lerpAmt)
    // Re-apply offset to both — pan, not look-around.
    controls.target.add(prev.current)
    camera.position.add(prev.current)
    controls.update()
  })
  return null
}

/**
 * Syncs tone-mapping mode + exposure onto the WebGLRenderer. Changing the
 * mode requires materials to recompile (the tone-mapping shader chunk is
 * baked into each material), so we walk the scene and flag needsUpdate.
 * Exposure is a uniform — no recompile needed.
 */
function ToneMappingSync({ mode, exposure }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    gl.toneMapping = mode
    scene.traverse((obj) => {
      if (!obj.material) return
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      mats.forEach((m) => { m.needsUpdate = true })
    })
  }, [gl, scene, mode])
  useEffect(() => {
    gl.toneMappingExposure = exposure
  }, [gl, exposure])
  return null
}

/**
 * Pushes live FOV updates onto the perspective camera. Canvas's `camera`
 * prop only seeds initial values; later prop changes are ignored, so we
 * sync explicitly from a leva slider.
 */
function CameraFovSync({ fov }) {
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    if (camera.fov === fov) return
    camera.fov = fov
    camera.updateProjectionMatrix()
  }, [camera, fov])
  return null
}

/**
 * Reads the live camera + OrbitControls state on every change and pushes
 * it back to the parent via onChange. Used by the lab page to power an
 * on-screen debug HUD so we can capture exact framing values from a
 * screenshot.
 */
function CameraSpy({ onChange }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  useEffect(() => {
    if (!controls || !onChange) return
    const push = () => {
      const az = controls.getAzimuthalAngle?.() ?? 0
      const polar = controls.getPolarAngle?.() ?? 0
      onChange({
        pos: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
        fov: camera.fov,
        distance: camera.position.distanceTo(controls.target),
        azimuth: az,
        polar: polar,
        azimuthDeg: (az * 180) / Math.PI,
        polarDeg: (polar * 180) / Math.PI,
      })
    }
    push()
    controls.addEventListener('change', push)
    return () => controls.removeEventListener('change', push)
  }, [camera, controls, onChange])
  return null
}

function CrtScreen({ sourceRef, modelUrl, debugMeshes, modelTransform, screenForward, remapScreenUV, screenUVRotation, screenUVFlipX, screenUVFlipY, hideMeshes, useHitUv, enableGlassMesh, enableBackOccluder, glassOverride, glassMode }) {
  const { texture } = useHtmlCanvasTexture(sourceRef)
  return (
    <CrtModel
      texture={texture}
      sourceRef={sourceRef}
      shader={SHADER}
      glass={glassOverride ?? GLASS}
      screenForward={screenForward ?? GLASS.forwardOffset}
      modelUrl={modelUrl}
      debugMeshes={debugMeshes}
      modelTransform={modelTransform}
      remapScreenUV={remapScreenUV}
      screenUVRotation={screenUVRotation}
      screenUVFlipX={screenUVFlipX}
      screenUVFlipY={screenUVFlipY}
      hideMeshes={hideMeshes}
      useHitUv={useHitUv}
      enableGlassMesh={enableGlassMesh}
      enableBackOccluder={enableBackOccluder}
      glassMode={glassMode}
    />
  )
}

export default function CrtScene({
  sourceRef,
  modelUrl,
  debugMeshes,
  freeOrbit = false,
  modelTransform,
  screenForward,
  remapScreenUV,
  screenUVRotation,
  screenUVFlipX,
  screenUVFlipY,
  hideMeshes,
  useHitUv,
  enableGlassMesh,
  enableBackOccluder,
  glassOverride,
  glassMode = 'phong',
  envPreset = 'studio',
  envIntensity = 1,
  envRotationY = 0,
  envBlur = 0,
  labBackground = false,
  showLeva = false,
  mouseParallax = 0,
  tone,
  canvasFilter,
  cameraOverride,
  onCameraChange,
}) {
  const cam = {
    posX: cameraOverride?.position?.[0] ?? CAMERA.posX,
    posY: cameraOverride?.position?.[1] ?? CAMERA.posY,
    posZ: cameraOverride?.position?.[2] ?? CAMERA.posZ,
    fov: cameraOverride?.fov ?? CAMERA.fov,
    targetX: cameraOverride?.target?.[0] ?? CAMERA.targetX,
    targetY: cameraOverride?.target?.[1] ?? CAMERA.targetY,
    targetZ: cameraOverride?.target?.[2] ?? CAMERA.targetZ,
  }
  const lights = useControls('Lights', {
    ambient: { value: LIGHTS.ambient, min: 0, max: 4, step: 0.05 },
    key: folder({
      keyIntensity: { value: LIGHTS.keyDir, min: 0, max: 5, step: 0.05 },
      keyColor: '#ffe7c4',
      keyPosX: { value: 3, min: -10, max: 10, step: 0.1 },
      keyPosY: { value: 4, min: -10, max: 10, step: 0.1 },
      keyPosZ: { value: 5, min: -10, max: 10, step: 0.1 },
    }),
    rim: folder({
      rimIntensity: { value: LIGHTS.rimDir, min: 0, max: 5, step: 0.05 },
      rimColor: '#9bd1ff',
      rimPosX: { value: -4, min: -10, max: 10, step: 0.1 },
      rimPosY: { value: 2, min: -10, max: 10, step: 0.1 },
      rimPosZ: { value: -3, min: -10, max: 10, step: 0.1 },
    }),
    rim2: folder({
      rim2Intensity: { value: 0, min: 0, max: 5, step: 0.05 },
      rim2Color: '#cfe6ff',
      rim2PosX: { value: 5, min: -10, max: 10, step: 0.1 },
      rim2PosY: { value: 4, min: -10, max: 10, step: 0.1 },
      rim2PosZ: { value: -4, min: -10, max: 10, step: 0.1 },
    }),
    fill: folder({
      fillIntensity: { value: LIGHTS.fillDir, min: 0, max: 5, step: 0.05 },
      fillColor: '#ffffff',
      fillPosX: { value: 0, min: -10, max: 10, step: 0.1 },
      fillPosY: { value: -2, min: -10, max: 10, step: 0.1 },
      fillPosZ: { value: 4, min: -10, max: 10, step: 0.1 },
    }),
    phosphor: folder({
      phosphorIntensity: { value: LIGHTS.phosphorIntensity, min: 0, max: 4, step: 0.05 },
      phosphorColor: LIGHTS.phosphorColor,
      phosphorDistance: { value: LIGHTS.phosphorDistance, min: 1, max: 20, step: 0.5 },
    }),
    spot: folder({
      spotIntensity: { value: 1.2, min: 0, max: 5, step: 0.05 },
      spotAngle: { value: 0.45, min: 0.1, max: 1.5, step: 0.01 },
      spotPenumbra: { value: 0.85, min: 0, max: 1, step: 0.01 },
    }),
  })

  return (
    <>
      <Leva hidden={!showLeva} titleBar={{ title: 'Tune' }} collapsed={false} />
      <div className="source-mask" aria-hidden="true" />
      <div className="phosphor-glow" aria-hidden="true" />
      <div className="three-stage" style={canvasFilter ? { filter: canvasFilter } : undefined}>
        <Canvas
          dpr={[1, 3]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{
            position: [cam.posX, cam.posY, cam.posZ],
            fov: cam.fov,
            near: 0.1,
            far: 100,
          }}
        >
          {glassMode === 'physical' && (
            <Suspense fallback={null}>
              <Environment
                preset={envPreset}
                background={false}
                environmentIntensity={envIntensity}
                environmentRotation={[0, envRotationY, 0]}
                blur={envBlur}
              />
            </Suspense>
          )}
          <ambientLight intensity={lights.ambient} />
          <FlickerDirectionalLight
            position={[lights.keyPosX, lights.keyPosY, lights.keyPosZ]}
            baseIntensity={lights.keyIntensity}
            color={lights.keyColor}
            seed={1.7}
            dip={0.18}
          />
          <directionalLight
            position={[lights.rimPosX, lights.rimPosY, lights.rimPosZ]}
            intensity={lights.rimIntensity}
            color={lights.rimColor}
          />
          {lights.rim2Intensity > 0 && (
            <directionalLight
              position={[lights.rim2PosX, lights.rim2PosY, lights.rim2PosZ]}
              intensity={lights.rim2Intensity}
              color={lights.rim2Color}
            />
          )}
          <FlickerDirectionalLight
            position={[lights.fillPosX, lights.fillPosY, lights.fillPosZ]}
            baseIntensity={lights.fillIntensity}
            color={lights.fillColor}
            seed={4.2}
            dip={0.12}
          />
          <FlickerPointLight
            position={[0, 0.2, 1.6]}
            baseIntensity={lights.phosphorIntensity}
            color={lights.phosphorColor}
            distance={lights.phosphorDistance}
            decay={2}
            seed={0}
            dip={0.4}
          />

          {/* Atmospheric fog. Lab uses a deeper green tint with denser fog
              for the phosphor/synthwave atmosphere. */}
          {labBackground ? (
            <fogExp2 attach="fog" args={['#02160c', 0.115]} />
          ) : (
            <fogExp2 attach="fog" args={['#171c19', 0.085]} />
          )}

          {labBackground ? (
            // Lab: phosphor-green perspective grid receding into fog.
            <Grid
              position={[0, 0.001, 0]}
              args={[40, 40]}
              cellSize={0.5}
              cellColor="#0d3a23"
              cellThickness={0.6}
              sectionSize={2.5}
              sectionColor="#3fff8a"
              sectionThickness={1.4}
              fadeDistance={22}
              fadeStrength={1.4}
              infiniteGrid
              followCamera={false}
            />
          ) : (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
              <planeGeometry args={[120, 120]} />
              <meshStandardMaterial color="#181d1a" roughness={0.92} metalness={0.05} />
            </mesh>
          )}

          {/* Soft contact shadow under the TV — grounds the model. */}
          <ContactShadows
            position={[0, 0.01, labBackground ? 0 : 1]}
            scale={6}
            blur={2.6}
            far={2}
            opacity={labBackground ? 0.7 : 0.55}
            resolution={512}
            color="#000000"
          />

          {/* Lab atmospherics: a big phosphor-green halo behind the model
              + a warm rim from the side for a hint of color separation +
              the dust motes from production for that volumetric grit. */}
          {labBackground && (
            <>
              <pointLight
                position={[0, 2.0, -2.0]}
                color="#3fff8a"
                intensity={5.5}
                distance={18}
                decay={1.5}
              />
              <pointLight
                position={[3.5, 1.8, -1.0]}
                color="#5cffd0"
                intensity={1.6}
                distance={10}
                decay={1.8}
              />
              <pointLight
                position={[-3.5, 0.8, 1.0]}
                color="#1a8a4a"
                intensity={1.2}
                distance={8}
                decay={1.8}
              />
              <DustField />
            </>
          )}

          {/* Production-only warm spotlight + window blinds + dust. */}
          {!labBackground && (
            <>
              <spotLight
                position={[0, 6, 1]}
                target-position={[0, 0, 1]}
                intensity={lights.spotIntensity}
                angle={lights.spotAngle}
                penumbra={lights.spotPenumbra}
                color="#ffe6c0"
                distance={10}
                decay={1.5}
              />
              <WindowBlindsLight />
              <DustField />
            </>
          )}

          <Suspense fallback={null}>
            {freeOrbit ? (
              <CrtScreen sourceRef={sourceRef} modelUrl={modelUrl} debugMeshes={debugMeshes} modelTransform={modelTransform} screenForward={screenForward} remapScreenUV={remapScreenUV} screenUVRotation={screenUVRotation} screenUVFlipX={screenUVFlipX} screenUVFlipY={screenUVFlipY} hideMeshes={hideMeshes} useHitUv={useHitUv} enableGlassMesh={enableGlassMesh} enableBackOccluder={enableBackOccluder} glassOverride={glassOverride} glassMode={glassMode} />
            ) : (
              <IdleSway>
                <CrtScreen sourceRef={sourceRef} modelUrl={modelUrl} debugMeshes={debugMeshes} modelTransform={modelTransform} screenForward={screenForward} remapScreenUV={remapScreenUV} screenUVRotation={screenUVRotation} screenUVFlipX={screenUVFlipX} screenUVFlipY={screenUVFlipY} hideMeshes={hideMeshes} useHitUv={useHitUv} enableGlassMesh={enableGlassMesh} enableBackOccluder={enableBackOccluder} glassOverride={glassOverride} glassMode={glassMode} />
              </IdleSway>
            )}
          </Suspense>

          {freeOrbit ? (
            <OrbitControls
              makeDefault
              enableZoom
              enablePan
              enableDamping
              // Lower zoomSpeed + heavier damping = silky-smooth wheel zoom.
              dampingFactor={0.12}
              zoomSpeed={0.4}
              rotateSpeed={0.7}
              panSpeed={0.6}
              target={[cam.targetX, cam.targetY, cam.targetZ]}
            />
          ) : (
            <>
              <OrbitControls
                makeDefault
                enableZoom={false}
                enablePan={false}
                enableDamping
                dampingFactor={0.08}
                target={[CAMERA.targetX, CAMERA.targetY, CAMERA.targetZ]}
                // Tight orbit cage: ~±10° horizontal, ~±8° vertical from the
                // default angle. Default azimuth is ~-6° (camera at -0.4, 4.7).
                minAzimuthAngle={ORBIT_LIMITS.minAz}
                maxAzimuthAngle={ORBIT_LIMITS.maxAz}
                minPolarAngle={ORBIT_LIMITS.minPolar}
                maxPolarAngle={ORBIT_LIMITS.maxPolar}
              />
              <OrbitResetController orbitLimits={ORBIT_LIMITS} />
            </>
          )}
          {onCameraChange && <CameraSpy onChange={onCameraChange} />}
          {cameraOverride?.fov != null && <CameraFovSync fov={cameraOverride.fov} />}
          {mouseParallax > 0 && <MouseParallax strength={mouseParallax} />}
          {tone?.mode && (
            <ToneMappingSync
              mode={TONE_MAP[tone.mode] ?? THREE.ACESFilmicToneMapping}
              exposure={tone.exposure ?? 1}
            />
          )}
        </Canvas>
      </div>
    </>
  )
}
