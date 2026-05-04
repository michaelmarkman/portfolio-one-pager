import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Grid, OrbitControls, useProgress } from '@react-three/drei'
import { Leva, useControls, folder } from 'leva'
import * as THREE from 'three'
import CrtModel from './CrtModel.jsx'
import DustField from './DustField.jsx'
import WindowBlindsLight from './WindowBlindsLight.jsx'
import GodRayShafts from './GodRayShafts.jsx'
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
  phosphorIntensity: 0.05,
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

// Free-orbit cage for the lab/production page — wider than ORBIT_LIMITS
// since the lab framing sits at azimuth ~-15° and we want some swing room.
// Polar is kept near horizontal so users can't tilt straight up/down.
// Distance bounds the dolly so users can't scroll into the model or fly
// off into the fog. Default cam sits at ~3.32 units from target.
const FREE_ORBIT_LIMITS = {
  minAz: -Math.PI * 0.20,    // ~-36°
  maxAz: Math.PI * 0.04,     // ~+7°
  minPolar: Math.PI * 0.38,  // ~68°
  maxPolar: Math.PI * 0.55,  // ~99°
  minDistance: 1.0,
  maxDistance: 4.0,
}

// Where the camera starts on first load — full side profile of the PC,
// ~12 units out at azimuth -90°. CameraIntro snaps here, then springs to
// the rest framing once the model finishes loading.
const INTRO_CAM = {
  posX: -12.25,
  posY: 1.13,
  posZ: 0.37,
}
const INTRO_HOLD = 0 // seconds pinned at INTRO_CAM before the spring releases

const TONE_MAP = {
  None: THREE.NoToneMapping,
  Linear: THREE.LinearToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
  Cineon: THREE.CineonToneMapping,
  ACESFilmic: THREE.ACESFilmicToneMapping,
  AgX: THREE.AgXToneMapping,
  Neutral: THREE.NeutralToneMapping,
}

// Day/night crossfade. transitionTRef is a mutable ref animated each frame
// from the current value toward `targetT` (0 = lab/non-cozy, 1 = cozy) over
// TRANSITION_MS with easeOutCubic. Children read the ref directly in their
// own useFrame to lerp uniforms, opacities, colors etc. — no React state,
// no re-renders during the 2.5s ramp.
const TRANSITION_MS = 1500
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3)

function TransitionDriver({ targetT, transitionTRef }) {
  const startTRef = useRef(transitionTRef.current)
  const startTimeRef = useRef(0)
  const prevTargetRef = useRef(targetT)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (prevTargetRef.current !== targetT) {
      // Restart the ramp from wherever we are now — handles mid-transition
      // toggles without snapping or backtracking.
      startTRef.current = transitionTRef.current
      startTimeRef.current = t
      prevTargetRef.current = targetT
    }
    const elapsed = t - startTimeRef.current
    const progress = Math.min(elapsed / (TRANSITION_MS / 1000), 1)
    const eased = easeOutCubic(progress)
    transitionTRef.current =
      startTRef.current + (targetT - startTRef.current) * eased
  })
  return null
}

// Day/night fog endpoints. Lab is dense dark green (synthwave); cozy is
// light warm haze (afternoon). Production has its own constant fog handled
// outside the transition.
const FOG_LAB = { color: '#02160c', density: 0.115 }
const FOG_COZY = { color: '#e8d8c2', density: 0.04 }
// Background: lab uses the fog color (so the far edges read seamless);
// cozy is a soft sunset beige.
const BG_LAB = '#02160c'
const BG_COZY = '#f4e4cf'

/**
 * Mutates scene.fog (color + density) each frame based on transitionTRef.
 * Renders nothing — the fogExp2 instance is JSX-attached to scene.fog
 * separately. This component just lerps its properties.
 */
function FogTransition({ transitionTRef }) {
  const scene = useThree((s) => s.scene)
  const labColor = useMemo(() => new THREE.Color(FOG_LAB.color), [])
  const cozyColor = useMemo(() => new THREE.Color(FOG_COZY.color), [])
  const tmp = useMemo(() => new THREE.Color(), [])
  useFrame(() => {
    if (!scene.fog) return
    const t = transitionTRef.current
    tmp.copy(labColor).lerp(cozyColor, t)
    scene.fog.color.copy(tmp)
    scene.fog.density = THREE.MathUtils.lerp(FOG_LAB.density, FOG_COZY.density, t)
  })
  return null
}

// ContactShadows endpoints. Lab uses pure black at the model's foot; cozy
// is a warm sepia, slightly forward (matches the imagined sun direction).
const SHADOW_LAB = { position: [0, 0.01, 0], opacity: 0.7, color: '#000000' }
const SHADOW_COZY = { position: [0, 0.01, 1], opacity: 0.45, color: '#3a2a1a' }

/**
 * Warm wood floor plane that fades in atop the synthwave Grid as t→1.
 * Reaches full opacity at t=0.5 (first half of the transition) so the grid
 * underneath is fully covered by the time GridDayHide snaps it off — keeps
 * the floor seamless without ever showing the grid through cozy mode.
 * Transparent + depthWrite disabled so the Grid below renders cleanly when
 * the wood is partially opaque mid-transition.
 */
function FloorWoodPlane({ transitionTRef }) {
  const matRef = useRef()
  useFrame(() => {
    if (!matRef.current) return
    matRef.current.opacity = Math.min(transitionTRef.current * 2, 1)
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
      <planeGeometry args={[120, 120]} />
      <meshStandardMaterial
        ref={matRef}
        color="#d8c3a5"
        roughness={0.95}
        metalness={0}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </mesh>
  )
}

// Wood floor color — Grid section/cell uniforms lerp toward this in cozy
// mode so grid lines blend invisibly into the floor.
const FLOOR_COZY_COLOR = '#d8c3a5'

/**
 * Lerps drei Grid's cellColor + sectionColor uniforms toward the warm
 * floor color as transitionTRef → 1, so the grid lines visually disappear
 * by blending with the wood plane (rather than snapping invisible). Keeps
 * the lab synthwave colors intact at t=0.
 */
function GridDayBlend({
  transitionTRef,
  gridRef,
  labCellColor,
  labSectionColor,
}) {
  const labCell = useMemo(() => new THREE.Color(labCellColor), [labCellColor])
  const labSec = useMemo(() => new THREE.Color(labSectionColor), [labSectionColor])
  const floor = useMemo(() => new THREE.Color(FLOOR_COZY_COLOR), [])
  useFrame(() => {
    if (!gridRef.current) return
    const mat = gridRef.current.material
    if (!mat || !mat.uniforms) return
    const t = transitionTRef.current
    // drei's Grid exposes cellColor/sectionColor as Color uniforms (the
    // names match the prop names; no `u` prefix). Mutate the underlying
    // Color so we don't trigger material recompiles.
    const cell = mat.uniforms.cellColor?.value
    const sec = mat.uniforms.sectionColor?.value
    if (cell) cell.copy(labCell).lerp(floor, t)
    if (sec) sec.copy(labSec).lerp(floor, t)
  })
  return null
}

/**
 * Lerps ContactShadows position.z, material.opacity, and material.color
 * between lab and cozy endpoints. Single shadow instance so the model
 * never has two overlapping shadows mid-transition.
 */
function CrossfadeContactShadows({ transitionTRef }) {
  const groupRef = useRef()
  const labColor = useMemo(() => new THREE.Color(SHADOW_LAB.color), [])
  const cozyColor = useMemo(() => new THREE.Color(SHADOW_COZY.color), [])
  useFrame(() => {
    if (!groupRef.current) return
    const t = transitionTRef.current
    groupRef.current.position.set(
      SHADOW_LAB.position[0],
      SHADOW_LAB.position[1],
      THREE.MathUtils.lerp(SHADOW_LAB.position[2], SHADOW_COZY.position[2], t),
    )
    groupRef.current.traverse((node) => {
      const mat = node.material
      if (!mat) return
      mat.opacity = THREE.MathUtils.lerp(SHADOW_LAB.opacity, SHADOW_COZY.opacity, t)
      if (mat.color) mat.color.copy(labColor).lerp(cozyColor, t)
    })
  })
  return (
    <ContactShadows
      ref={groupRef}
      position={SHADOW_LAB.position}
      scale={6}
      blur={2.6}
      far={2}
      opacity={SHADOW_LAB.opacity}
      resolution={512}
      color={SHADOW_LAB.color}
    />
  )
}

/**
 * Sets scene.background to a shared THREE.Color and lerps it each frame
 * between BG_LAB and BG_COZY based on transitionTRef. Restores the previous
 * background on unmount so production page (which never mounts this) keeps
 * its null/transparent default.
 */
function BackgroundTransition({ transitionTRef }) {
  const scene = useThree((s) => s.scene)
  const labColor = useMemo(() => new THREE.Color(BG_LAB), [])
  const cozyColor = useMemo(() => new THREE.Color(BG_COZY), [])
  const sharedColor = useMemo(() => new THREE.Color(BG_LAB), [])
  useEffect(() => {
    const prev = scene.background
    scene.background = sharedColor
    return () => {
      scene.background = prev
    }
  }, [scene, sharedColor])
  useFrame(() => {
    const t = transitionTRef.current
    sharedColor.copy(labColor).lerp(cozyColor, t)
  })
  return null
}

/**
 * Drives a flickering intensity on a light (gentle constant flutter + a
 * sharper dip every few seconds). Returns refs/handlers for two light types.
 * Optional `transitionMul()` callback returns a per-frame multiplier so the
 * light fades during day/night transitions.
 */
function useFlicker(seed, baseIntensity, dip = 0.3, transitionMul) {
  const ref = useRef()
  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.elapsedTime + seed
    // Gentler breath: ±3% (was ±8%).
    const breathe = 1 + Math.sin(t * 7.3) * 0.015 + Math.sin(t * 11.7) * 0.012
    // Slower dip cycle (mean ~10s instead of ~3.5s) so it's a rare event.
    const cycle = (t * 0.1 + seed * 0.5) % 1
    const dipAmt = cycle > 0.97 ? Math.sin(((cycle - 0.97) / 0.03) * Math.PI) * dip : 0
    const mul = transitionMul ? transitionMul() : 1
    ref.current.intensity = baseIntensity * breathe * (1 - dipAmt) * mul
  })
  return ref
}

function FlickerPointLight({ baseIntensity, seed = 0, dip, transitionMul, ...props }) {
  const ref = useFlicker(seed, baseIntensity, dip, transitionMul)
  return <pointLight ref={ref} intensity={baseIntensity} {...props} />
}

function FlickerDirectionalLight({ baseIntensity, seed = 0, dip, transitionMul, ...props }) {
  const ref = useFlicker(seed, baseIntensity, dip, transitionMul)
  return <directionalLight ref={ref} intensity={baseIntensity} {...props} />
}

/**
 * Per-frame intensity multiplier driven by transitionTRef. side='cozy' fades
 * IN as t→1 (cozy mode); side='lab' fades OUT (multiplies by 1-t). Used for
 * lights that crossfade between the two scene modes.
 */
function useCrossfadeIntensity(baseIntensity, side, transitionTRef) {
  const ref = useRef()
  useFrame(() => {
    if (!ref.current) return
    const t = transitionTRef.current
    const mul = side === 'cozy' ? t : 1 - t
    ref.current.intensity = baseIntensity * mul
  })
  return ref
}

function CrossfadePointLight({ baseIntensity, side, transitionTRef, ...props }) {
  const ref = useCrossfadeIntensity(baseIntensity, side, transitionTRef)
  return <pointLight ref={ref} intensity={0} {...props} />
}

function CrossfadeHemisphereLight({ baseIntensity, side, transitionTRef, color, groundColor }) {
  const ref = useCrossfadeIntensity(baseIntensity, side, transitionTRef)
  return <hemisphereLight ref={ref} intensity={0} color={color} groundColor={groundColor} />
}

/**
 * Same crossfade pattern as CrossfadePointLight, but additionally toggles
 * castShadow off when the multiplier is ~0 — saves a full shadow-map render
 * per frame when the cozy sun is faded out in lab mode.
 */
function CrossfadeDirectionalLight({
  baseIntensity, side, transitionTRef, castShadow, ...props
}) {
  const ref = useRef()
  useFrame(() => {
    if (!ref.current) return
    const t = transitionTRef.current
    const mul = side === 'cozy' ? t : 1 - t
    ref.current.intensity = baseIntensity * mul
    if (castShadow !== undefined) {
      ref.current.castShadow = castShadow && mul > 0.005
    }
  })
  return <directionalLight ref={ref} intensity={0} castShadow={castShadow} {...props} />
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
function OrbitResetController({ orbitLimits, defaultCam, sceneMode }) {
  const controls = useThree((s) => s.controls)
  const camera = useThree((s) => s.camera)
  const draggingRef = useRef(false)
  const wheelEndTimerRef = useRef(null)
  const azVelRef = useRef(0)
  const polarVelRef = useRef(0)
  const distVelRef = useRef(0)
  // On every sceneMode change, kick the camera outward. Velocity 3.8
  // produces a peak distance around 6 (rest ~3.2 + ~2.8) before the
  // damped spring (STIFFNESS=4, DAMPING_RATIO=0.85) carries it back —
  // gives the day/night toggle a "boop out and return" feel.
  const prevSceneModeRef = useRef(sceneMode)
  useEffect(() => {
    if (prevSceneModeRef.current === sceneMode) return
    prevSceneModeRef.current = sceneMode
    distVelRef.current = 3.8
  }, [sceneMode])

  // Default azimuth + polar + distance derived from defaultCam position
  // relative to target. The spring rests at these values.
  const dx = defaultCam.posX - defaultCam.targetX
  const dy = defaultCam.posY - defaultCam.targetY
  const dz = defaultCam.posZ - defaultCam.targetZ
  const targetDistance = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const targetAzimuth = Math.atan2(dx, dz)
  const targetPolar = Math.acos(dy / targetDistance)

  // Spring tuning — softer + more damped than a typical spring. Lower
  // stiffness means a slower return; higher damping ratio means it
  // settles without bouncing past the default.
  const STIFFNESS = 4
  const DAMPING_RATIO = 0.85 // 1 = critical, <1 bouncy, >1 sluggish
  const dampingCoef = 2 * Math.sqrt(STIFFNESS) * DAMPING_RATIO

  // On release, kick velocity AWAY from the cage limit if user was sitting
  // at it — sells the "tug at the wall" rubber-band feel before springing
  // back through the default.
  const EDGE_EPS = 0.005
  const REBOUND_KICK = 1.0 // rad/sec impulse magnitude (rotation)
  const DIST_REBOUND_KICK = 2.0 // world-units/sec impulse magnitude (zoom)

  useEffect(() => {
    if (!controls) return
    const onStart = () => {
      // Cancel any pending debounce — a new gesture means the previous
      // 'end' shouldn't fire its delayed callback.
      if (wheelEndTimerRef.current) {
        clearTimeout(wheelEndTimerRef.current)
        wheelEndTimerRef.current = null
      }
      draggingRef.current = true
      azVelRef.current = 0
      polarVelRef.current = 0
      distVelRef.current = 0
    }
    const onEnd = () => {
      // OrbitControls fires start+end synchronously per wheel event, and
      // Apple trackpads keep emitting wheel events for ~hundreds of ms
      // after the fingers leave. Without a debounce the spring fires
      // between every inertial tick and gets immediately cancelled. Wait
      // for a quiet period before releasing draggingRef.
      if (wheelEndTimerRef.current) clearTimeout(wheelEndTimerRef.current)
      wheelEndTimerRef.current = setTimeout(() => {
        wheelEndTimerRef.current = null
        draggingRef.current = false
        // Apply a spring-back kick if we settled at a cage limit.
        const az = controls.getAzimuthalAngle()
        const polar = controls.getPolarAngle()
        const dist = camera.position.distanceTo(controls.target)
        if (Math.abs(az - orbitLimits.minAz) < EDGE_EPS) azVelRef.current = REBOUND_KICK
        else if (Math.abs(az - orbitLimits.maxAz) < EDGE_EPS) azVelRef.current = -REBOUND_KICK
        if (Math.abs(polar - orbitLimits.minPolar) < EDGE_EPS) polarVelRef.current = REBOUND_KICK
        else if (Math.abs(polar - orbitLimits.maxPolar) < EDGE_EPS) polarVelRef.current = -REBOUND_KICK
        if (orbitLimits.minDistance != null && Math.abs(dist - orbitLimits.minDistance) < EDGE_EPS * 4) {
          distVelRef.current = DIST_REBOUND_KICK
        } else if (orbitLimits.maxDistance != null && Math.abs(dist - orbitLimits.maxDistance) < EDGE_EPS * 4) {
          distVelRef.current = -DIST_REBOUND_KICK
        }
      }, 140)
    }
    controls.addEventListener('start', onStart)
    controls.addEventListener('end', onEnd)
    return () => {
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('end', onEnd)
      if (wheelEndTimerRef.current) {
        clearTimeout(wheelEndTimerRef.current)
        wheelEndTimerRef.current = null
      }
    }
  }, [controls, camera, orbitLimits])

  useFrame((_, delta) => {
    if (!controls || draggingRef.current) return
    if (typeof controls.getAzimuthalAngle !== 'function') return
    const currentAz = controls.getAzimuthalAngle()
    const currentPolar = controls.getPolarAngle()
    const currentDist = camera.position.distanceTo(controls.target)
    // Bail when all three components are settled.
    const azDelta = targetAzimuth - currentAz
    const polarDelta = targetPolar - currentPolar
    const distDelta = targetDistance - currentDist
    if (
      Math.abs(azDelta) < 1e-4 && Math.abs(azVelRef.current) < 1e-4 &&
      Math.abs(polarDelta) < 1e-4 && Math.abs(polarVelRef.current) < 1e-4 &&
      Math.abs(distDelta) < 1e-3 && Math.abs(distVelRef.current) < 1e-3
    ) {
      azVelRef.current = 0
      polarVelRef.current = 0
      distVelRef.current = 0
      return
    }
    // Spring-damper integration (semi-implicit Euler).
    const azAccel = STIFFNESS * azDelta - dampingCoef * azVelRef.current
    const polarAccel = STIFFNESS * polarDelta - dampingCoef * polarVelRef.current
    const distAccel = STIFFNESS * distDelta - dampingCoef * distVelRef.current
    azVelRef.current += azAccel * delta
    polarVelRef.current += polarAccel * delta
    distVelRef.current += distAccel * delta
    controls.setAzimuthalAngle(currentAz + azVelRef.current * delta)
    controls.setPolarAngle(currentPolar + polarVelRef.current * delta)
    // Distance: scale the camera's offset from target to the new radius.
    const newDist = currentDist + distVelRef.current * delta
    if (Math.abs(newDist - currentDist) > 1e-5) {
      const dir = camera.position.clone().sub(controls.target).normalize()
      camera.position.copy(controls.target).addScaledVector(dir, newDist)
      controls.update()
    }
  })

  return null
}

/**
 * Idle camera bob — slow vertical sine-wave offset applied equally to
 * camera AND orbit target, so the look direction stays fixed (a pure
 * translation, like a drone hover). Same un-apply / re-apply pattern
 * as MouseParallax so it composes cleanly without fighting OrbitControls
 * or the spring (relative camera→target offset is preserved).
 */
function CameraIdleBob({ amplitude = 0.015, speed = 0.35 }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const prev = useRef(0)

  useFrame((state) => {
    if (!controls?.target) return
    // Strip previous bob from both ends
    camera.position.y -= prev.current
    controls.target.y -= prev.current
    // New offset
    const bob = Math.sin(state.clock.elapsedTime * speed * Math.PI * 2) * amplitude
    camera.position.y += bob
    controls.target.y += bob
    prev.current = bob
    controls.update()
  })
  return null
}

/**
 * Trauma-based camera shake on sceneMode change. Translates camera+target
 * together (lockstep, like MouseParallax) so OrbitControls' spherical
 * coords stay stable. Shake amplitude = trauma², so it feels punchy and
 * fades quickly. Strip-and-reapply each frame so it never accumulates.
 */
function CameraShake({ sceneMode, intensity = 0.06, duration = 0.45 }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const traumaRef = useRef(0)
  const offsetRef = useRef(new THREE.Vector3())
  const tmpDir = useRef(new THREE.Vector3())
  const tmpRight = useRef(new THREE.Vector3())
  const tmpUp = useRef(new THREE.Vector3())
  const prevSceneModeRef = useRef(sceneMode)
  useEffect(() => {
    if (prevSceneModeRef.current === sceneMode) return
    prevSceneModeRef.current = sceneMode
    traumaRef.current = 1.0
  }, [sceneMode])
  useFrame((_, delta) => {
    if (!controls?.target) return
    // Strip previous shake from both ends so OrbitControls / spring see
    // a clean state.
    camera.position.sub(offsetRef.current)
    controls.target.sub(offsetRef.current)
    if (traumaRef.current > 0.001) {
      camera.getWorldDirection(tmpDir.current)
      tmpRight.current.crossVectors(tmpDir.current, camera.up).normalize()
      tmpUp.current.crossVectors(tmpRight.current, tmpDir.current).normalize()
      const shake = traumaRef.current * traumaRef.current * intensity
      const rx = (Math.random() * 2 - 1) * shake
      const ry = (Math.random() * 2 - 1) * shake
      offsetRef.current
        .copy(tmpRight.current)
        .multiplyScalar(rx)
        .addScaledVector(tmpUp.current, ry)
      camera.position.add(offsetRef.current)
      controls.target.add(offsetRef.current)
      traumaRef.current = Math.max(0, traumaRef.current - delta / duration)
    } else {
      offsetRef.current.set(0, 0, 0)
    }
    controls.update()
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
    // Desired pan offset in world space. Positive so the camera drifts
    // WITH the cursor — mouse-right shifts the camera right, which makes
    // the model appear to drift opposite the cursor (parallax).
    tmpTarget.current
      .copy(tmpRight.current)
      .multiplyScalar(mouse.x * strength)
      .addScaledVector(tmpUp.current, mouse.y * strength)
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
 * Intro: snap the camera to INTRO_CAM, hold there for `hold` seconds,
 * then fire onComplete. The spring-back is run by OrbitResetController
 * (which mounts as soon as the intro ends) so the user can interact +
 * parallax + bob start immediately while the spring continues quietly
 * in the background.
 */
function CameraIntro({ introCam, hold, modelReady, onComplete }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const phaseRef = useRef('init') // init → hold → done
  const readyAtRef = useRef(0)

  useFrame((state) => {
    if (phaseRef.current === 'done') return
    if (!modelReady) return

    if (phaseRef.current === 'init') {
      readyAtRef.current = state.clock.elapsedTime
      camera.position.set(introCam.posX, introCam.posY, introCam.posZ)
      if (controls) controls.update()
      phaseRef.current = 'hold'
      return
    }

    // Pin to introCam during hold so OrbitControls' own update doesn't
    // drift it back toward the spherical-derived position.
    camera.position.set(introCam.posX, introCam.posY, introCam.posZ)
    if (controls) controls.update()

    if (state.clock.elapsedTime - readyAtRef.current >= hold) {
      phaseRef.current = 'done'
      onComplete?.()
    }
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

/**
 * Full-viewport boot overlay. Visibility is latched on `modelReady` (set
 * by CrtModel after its first render frame), NOT on useProgress.active —
 * the loader queue can flip idle while Three.js is still compiling shaders
 * and a second asset (the lobby HDR) can kick a new load mid-gap, both of
 * which would otherwise cause the overlay to flicker.
 *
 * The % counter tracks the highest progress value we've ever seen, so it
 * only climbs — drei's raw progress drops mid-flight when a new asset
 * joins the queue and the loaded/total ratio re-bases.
 */
function LoadingOverlay({ modelReady }) {
  const { progress } = useProgress()
  const [peak, setPeak] = useState(0)
  useEffect(() => {
    setPeak((prev) => (progress > prev ? progress : prev))
  }, [progress])
  const display = modelReady ? 100 : peak
  return (
    <div
      className="boot-overlay"
      style={{
        opacity: modelReady ? 0 : 1,
        pointerEvents: modelReady ? 'none' : 'auto',
      }}
    >
      <div>BOOTING…</div>
      <div className="boot-progress">{Math.round(display)}%</div>
    </div>
  )
}

function CrtScreen({ sourceRef, modelUrl, debugMeshes, modelTransform, screenForward, remapScreenUV, screenUVRotation, screenUVFlipX, screenUVFlipY, hideMeshes, useHitUv, enableGlassMesh, enableBackOccluder, glassOverride, glassMode, screenPalette, transitionTRef, onModelReady }) {
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
      screenPalette={screenPalette}
      transitionTRef={transitionTRef}
      onModelReady={onModelReady}
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
  sceneMode, // 'lab' | 'cozy' | undefined (falls back to labBackground)
  screenPalette,
  showLeva = false,
  mouseParallax = 0,
  idleBob = 0,
  idleBobSpeed = 0.35,
  tone,
  canvasFilter,
  gridOverride,
  enableZoom = false,
  enablePan = false,
  unlockCage = false,
  pauseReturn = false,
  cameraOverride,
  onCameraChange,
}) {
  const [modelReady, setModelReady] = useState(false)
  const handleModelReady = useCallback(() => setModelReady(true), [])
  // introActive covers JUST the hold phase. After hold, OrbitControls
  // becomes interactable, parallax/bob/spring all mount, and the spring
  // runs the actual fly-in.
  const [introActive, setIntroActive] = useState(true)
  const handleIntroDone = useCallback(() => setIntroActive(false), [])
  // cageWide stays true through the whole intro AND for a few seconds
  // after, so the spring can travel the long distance from INTRO_CAM
  // back to the rest framing without OrbitControls clamping mid-flight.
  const [cageWide, setCageWide] = useState(true)
  useEffect(() => {
    if (introActive) return
    const t = setTimeout(() => setCageWide(false), 3000)
    return () => clearTimeout(t)
  }, [introActive])
  // Re-widen the cage on every sceneMode change so OrbitResetController's
  // outward kick has room to swing past the normal max-distance limit
  // (cozy peak distance ≈ 6 vs the cage's normal max of 4.0). Held wide
  // for ~3s, matching the spring's settle time.
  const prevSceneModeRef = useRef(sceneMode)
  useEffect(() => {
    if (prevSceneModeRef.current === sceneMode) return
    prevSceneModeRef.current = sceneMode
    if (introActive) return
    setCageWide(true)
    const t = setTimeout(() => setCageWide(false), 3000)
    return () => clearTimeout(t)
  }, [sceneMode, introActive])

  // sceneMode wins over the legacy labBackground bool when both passed.
  const isCozy = sceneMode === 'cozy'
  const isLab = !isCozy && labBackground
  // Lab page (lab OR cozy mode) uses the day/night crossfade. Production
  // page (sceneMode undefined, labBackground=false) bypasses the transition
  // entirely and renders its own atmospherics block.
  const transitionable = isCozy || labBackground
  // Day/night crossfade signal: 0 = lab/non-cozy, 1 = cozy. Animated each
  // frame by TransitionDriver (inside Canvas). Child components read the
  // ref to lerp their uniforms / opacities — no re-renders.
  const transitionTRef = useRef(isCozy ? 1 : 0)
  const targetT = isCozy ? 1 : 0
  // Mesh ref into drei's Grid so GridDayHide can flip its visibility
  // without re-rendering the whole tree.
  const gridMeshRef = useRef()

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
      <LoadingOverlay modelReady={modelReady} />
      <div className="source-mask" aria-hidden="true" />
      <div className="phosphor-glow" aria-hidden="true" />
      <div className="three-stage" style={canvasFilter ? { filter: canvasFilter } : undefined}>
        <Canvas
          shadows="soft"
          dpr={[1, 3]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{
            // Keep the rest position as the initial camera so CrtModel's
            // setup useEffect (which picks the screen's forward axis from
            // the current camera direction) computes the right axis. The
            // intro snaps the camera to INTRO_CAM only AFTER modelReady,
            // by which point setup has already run.
            position: [cam.posX, cam.posY, cam.posZ],
            fov: cam.fov,
            near: 0.1,
            far: 100,
          }}
        >
          <TransitionDriver targetT={targetT} transitionTRef={transitionTRef} />
          {glassMode === 'physical' && (
            <Suspense fallback={null}>
              <Environment
                preset={
                  envPreset === 'auto'
                    ? isCozy ? 'sunset' : 'lobby'
                    : envPreset
                }
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
            transitionMul={() => 1 - transitionTRef.current}
          />


          {/* Atmospheric fog. Lab page (transitionable) uses a single
              fogExp2 mutated each frame by FogTransition between the lab
              and cozy endpoints. Production has its own constant fog. */}
          {transitionable ? (
            <>
              <fogExp2 attach="fog" args={[FOG_LAB.color, FOG_LAB.density]} />
              <FogTransition transitionTRef={transitionTRef} />
              <BackgroundTransition transitionTRef={transitionTRef} />
            </>
          ) : (
            <fogExp2 attach="fog" args={['#171c19', 0.085]} />
          )}

          {/* Floor: transitionable scenes render the Grid (lab look) and a
              warm wood plane (cozy look) simultaneously. Wood fades in as
              t→1, and GridDayBlend lerps grid line colors toward the wood
              color so distant lines visually disappear in daytime instead
              of snapping off. Production has its own static floor. */}
          {transitionable ? (
            <>
              {gridOverride?.enabled !== false && (
                <>
                  <Grid
                    ref={gridMeshRef}
                    position={[0, 0.001, 0]}
                    args={[40, 40]}
                    cellSize={0.5}
                    cellColor={gridOverride?.cellColor ?? '#004522'}
                    cellThickness={0.9}
                    sectionSize={2.5}
                    sectionColor={gridOverride?.sectionColor ?? '#163e21'}
                    sectionThickness={1.8}
                    fadeDistance={22}
                    fadeStrength={1.4}
                    infiniteGrid
                    followCamera={false}
                  />
                  <GridDayBlend
                    transitionTRef={transitionTRef}
                    gridRef={gridMeshRef}
                    labCellColor={gridOverride?.cellColor ?? '#004522'}
                    labSectionColor={gridOverride?.sectionColor ?? '#163e21'}
                  />
                </>
              )}
              <FloorWoodPlane transitionTRef={transitionTRef} />
            </>
          ) : (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
              <planeGeometry args={[120, 120]} />
              <meshStandardMaterial color="#181d1a" roughness={0.92} metalness={0.05} />
            </mesh>
          )}

          {/* Soft contact shadow under the TV — grounds the model.
              Transitionable scenes lerp between lab/cozy endpoints; production
              uses a single static shadow. */}
          {transitionable ? (
            <CrossfadeContactShadows transitionTRef={transitionTRef} />
          ) : (
            <ContactShadows
              position={[0, 0.01, 1]}
              scale={6}
              blur={2.6}
              far={2}
              opacity={0.55}
              resolution={512}
              color="#000000"
            />
          )}

          {/* Lab + cozy atmospherics rendered simultaneously and crossfaded
              via transitionTRef. Lights below use side='lab' (multiply by
              1-t) or side='cozy' (multiply by t). Atmospheric props
              (DustField, WindowBlindsLight, GodRayShafts) still gated by
              the active mode for now — they get their own crossfade in
              later tasks. */}
          {transitionable && (
            <>
              {/* Lab atmospherics: phosphor halo, warm rim, dim green fill */}
              <CrossfadePointLight
                side="lab"
                transitionTRef={transitionTRef}
                position={[0, 2.0, -2.0]}
                color="#3fff8a"
                baseIntensity={5.5}
                distance={18}
                decay={1.5}
              />
              <CrossfadePointLight
                side="lab"
                transitionTRef={transitionTRef}
                position={[3.5, 1.8, -1.0]}
                color="#5cffd0"
                baseIntensity={1.6}
                distance={10}
                decay={1.8}
              />
              <CrossfadePointLight
                side="lab"
                transitionTRef={transitionTRef}
                position={[-3.5, 0.8, 1.0]}
                color="#1a8a4a"
                baseIntensity={1.2}
                distance={8}
                decay={1.8}
              />
              {/* Cozy daytime: hemisphere sky/ground fill + warm directional
                  sun (real-time shadows, gated off when faded out). */}
              <CrossfadeHemisphereLight
                side="cozy"
                transitionTRef={transitionTRef}
                color="#cfe6ff"
                groundColor="#caa37a"
                baseIntensity={0.55}
              />
              <CrossfadeDirectionalLight
                side="cozy"
                transitionTRef={transitionTRef}
                position={[6, 5, 4]}
                baseIntensity={1.6}
                color="#ffd9a3"
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
                shadow-bias={-0.0005}
                shadow-normalBias={0.02}
                shadow-camera-near={0.5}
                shadow-camera-far={20}
                shadow-camera-left={-6}
                shadow-camera-right={6}
                shadow-camera-top={6}
                shadow-camera-bottom={-6}
              />
              {/* Single dust field that lerps its palette uniforms between
                  phosphor (lab) and warm (cozy) via transitionTRef. */}
              <DustField transitionTRef={transitionTRef} />
              {/* Blinds + god-rays render always; their material opacity
                  is multiplied by transitionTRef so they fade in with t. */}
              <WindowBlindsLight transitionTRef={transitionTRef} />
              <GodRayShafts transitionTRef={transitionTRef} />
            </>
          )}

          {/* Production-only warm spotlight + window blinds + dust.
              Production never transitions, so this block stays static. */}
          {!isLab && !isCozy && (
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
              <CrtScreen sourceRef={sourceRef} modelUrl={modelUrl} debugMeshes={debugMeshes} modelTransform={modelTransform} screenForward={screenForward} remapScreenUV={remapScreenUV} screenUVRotation={screenUVRotation} screenUVFlipX={screenUVFlipX} screenUVFlipY={screenUVFlipY} hideMeshes={hideMeshes} useHitUv={useHitUv} enableGlassMesh={enableGlassMesh} enableBackOccluder={enableBackOccluder} glassOverride={glassOverride} glassMode={glassMode} screenPalette={screenPalette} transitionTRef={transitionTRef} onModelReady={handleModelReady} />
            ) : (
              <IdleSway>
                <CrtScreen sourceRef={sourceRef} modelUrl={modelUrl} debugMeshes={debugMeshes} modelTransform={modelTransform} screenForward={screenForward} remapScreenUV={remapScreenUV} screenUVRotation={screenUVRotation} screenUVFlipX={screenUVFlipX} screenUVFlipY={screenUVFlipY} hideMeshes={hideMeshes} useHitUv={useHitUv} enableGlassMesh={enableGlassMesh} enableBackOccluder={enableBackOccluder} glassOverride={glassOverride} glassMode={glassMode} screenPalette={screenPalette} transitionTRef={transitionTRef} onModelReady={handleModelReady} />
              </IdleSway>
            )}
          </Suspense>

          {freeOrbit ? (
            <>
              <OrbitControls
                makeDefault
                enabled={!introActive}
                enableZoom={enableZoom}
                enablePan={enablePan}
                enableDamping
                // Higher dampingFactor + lower zoomSpeed = silky inertial
                // wheel zoom that decays slowly instead of snapping.
                dampingFactor={0.18}
                zoomSpeed={0.1}
                panSpeed={0.6}
                rotateSpeed={0.7}
                target={[cam.targetX, cam.targetY, cam.targetZ]}
                // While the cage is wide (intro hold + spring-back travel
                // window) or the user has toggled 'unlock cage' in leva,
                // remove all clamps so the spring can swing the camera
                // through the full INTRO_CAM → rest distance.
                minAzimuthAngle={(cageWide || unlockCage) ? -Math.PI : FREE_ORBIT_LIMITS.minAz}
                maxAzimuthAngle={(cageWide || unlockCage) ? Math.PI : FREE_ORBIT_LIMITS.maxAz}
                minPolarAngle={(cageWide || unlockCage) ? 0.01 : FREE_ORBIT_LIMITS.minPolar}
                maxPolarAngle={(cageWide || unlockCage) ? Math.PI - 0.01 : FREE_ORBIT_LIMITS.maxPolar}
                minDistance={(cageWide || unlockCage) ? 0.1 : FREE_ORBIT_LIMITS.minDistance}
                maxDistance={(cageWide || unlockCage) ? 50 : FREE_ORBIT_LIMITS.maxDistance}
              />
              {!introActive && !pauseReturn && <OrbitResetController orbitLimits={FREE_ORBIT_LIMITS} defaultCam={cam} sceneMode={sceneMode} />}
              {introActive && (
                <CameraIntro
                  introCam={INTRO_CAM}
                  hold={INTRO_HOLD}
                  modelReady={modelReady}
                  onComplete={handleIntroDone}
                />
              )}
            </>
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
              <OrbitResetController orbitLimits={ORBIT_LIMITS} defaultCam={cam} />
            </>
          )}
          {onCameraChange && <CameraSpy onChange={onCameraChange} />}
          {cameraOverride?.fov != null && <CameraFovSync fov={cameraOverride.fov} />}
          {!introActive && mouseParallax > 0 && <MouseParallax strength={mouseParallax} />}
          {!introActive && transitionable && <CameraShake sceneMode={sceneMode} />}
          {!introActive && idleBob > 0 && <CameraIdleBob amplitude={idleBob} speed={idleBobSpeed} />}
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
