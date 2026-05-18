// Tiny synthesized SFX engine. No asset files — every preset is a
// short oscillator/noise burst with an envelope, scheduled on a single
// shared AudioContext. Plays nicely with the existing background-audio
// mute toggle: when `setSfxMuted(true)` is called from BackgroundAudio's
// audible-state effect, playSfx() returns silently.
//
// The AudioContext is lazy-created on first call so nothing happens
// until a user gesture, dodging Chromium's autoplay block.

let ctx = null
let masterGain = null
let muted = false

function ensureCtx() {
  if (ctx) return ctx
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  masterGain = ctx.createGain()
  masterGain.gain.value = 1.0
  masterGain.connect(ctx.destination)
  // Kick off the keyboard + click sample fetch+decode as soon as we
  // have a context, so by the time the bio typewriter or first toggle
  // click fires the buffers are ready.
  loadKeyBuffer()
  loadClickBuffer()
  return ctx
}

// Install a one-time gesture listener at module load so the first
// click/keypress anywhere primes (and resumes) the AudioContext
// BEFORE the user reaches a sfx-triggering button. Without this, the
// very first thunk/click can be silent because resume() is still
// pending when the sfx is scheduled.
if (typeof window !== 'undefined') {
  const unlock = () => {
    const c = ensureCtx()
    if (c?.state === 'suspended') c.resume().catch(() => {})
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
}

export function setSfxMuted(value) {
  muted = !!value
}

export function isSfxMuted() {
  return muted
}

// A short white-noise buffer for keytick / scratch-flavor effects.
let noiseBufRef = null
function getNoiseBuffer() {
  if (!ctx) return null
  if (noiseBufRef) return noiseBufRef
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5
  noiseBufRef = buf
  return buf
}

// click — sampled UI boop (/click.wav). Lazy-decoded once and replayed
// from a fresh BufferSource each time so back-to-back clicks don't
// truncate each other.
let clickBufRef = null
let clickBufLoading = null
function loadClickBuffer() {
  if (clickBufRef || clickBufLoading) return clickBufLoading
  if (!ctx) return null
  clickBufLoading = fetch('/click.wav')
    .then((r) => r.arrayBuffer())
    .then((ab) => ctx.decodeAudioData(ab))
    .then((buf) => {
      clickBufRef = buf
      return buf
    })
    .catch(() => null)
  return clickBufLoading
}

function playClick() {
  const c = ensureCtx()
  if (!c) return
  if (!clickBufRef) {
    loadClickBuffer()
    return
  }
  const now = c.currentTime
  const src = c.createBufferSource()
  src.buffer = clickBufRef
  const g = c.createGain()
  g.gain.value = 0.85
  src.connect(g)
  g.connect(masterGain)
  src.start(now)
}

// thunk — heavier, mid-low body for the day/night toggle. Two sines +
// noise transient at the head for snap. Frequencies kept up around
// 200–700 Hz so laptop speakers can actually reproduce them.
function playThunk() {
  const c = ensureCtx()
  if (!c) return
  const now = c.currentTime
  // Body
  const osc1 = c.createOscillator()
  osc1.type = 'sine'
  osc1.frequency.setValueAtTime(280, now)
  osc1.frequency.exponentialRampToValueAtTime(140, now + 0.1)
  const osc2 = c.createOscillator()
  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(700, now)
  osc2.frequency.exponentialRampToValueAtTime(310, now + 0.1)
  const g = c.createGain()
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.55, now + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
  osc1.connect(g)
  osc2.connect(g)
  g.connect(masterGain)
  // Snap
  const buf = getNoiseBuffer()
  if (buf) {
    const noise = c.createBufferSource()
    noise.buffer = buf
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2400
    bp.Q.value = 1.5
    const ng = c.createGain()
    ng.gain.setValueAtTime(0.5, now)
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.03)
    noise.connect(bp)
    bp.connect(ng)
    ng.connect(masterGain)
    noise.start(now)
    noise.stop(now + 0.05)
  }
  osc1.start(now)
  osc2.start(now)
  osc1.stop(now + 0.25)
  osc2.stop(now + 0.25)
}

// keytick — plays /keyboard.wav as a one-shot sample. Lazy-decoded the
// first time it's called and cached; subsequent calls just spin up a
// new BufferSource so overlapping taps don't truncate each other. A
// small random gain + playbackRate jitter keeps a run of taps from
// sounding identical.
let keyBufRef = null
let keyBufLoading = null
// Onset offsets (in seconds) detected in the source buffer. Each one
// is the start of an actual key tap; picking from this list avoids
// the silent gaps between taps that produced "empty" sound slices.
let keyOnsetsRef = null

// Simple onset detector: RMS in 5 ms windows; flag a window as an
// onset when it crosses a noise floor AND is at least 1.5× the
// previous window's RMS, with a min-gap so we don't fire twice on the
// attack-then-decay of the same tap.
function detectOnsets(buf) {
  const ch = buf.getChannelData(0)
  const sr = buf.sampleRate
  const win = Math.max(1, Math.floor(sr * 0.005)) // 5 ms
  const minGapSamples = Math.floor(sr * 0.08) // 80 ms between onsets
  const NOISE_FLOOR = 0.05
  const RISE = 1.6
  const onsets = []
  let prevRms = 0
  let lastOnsetIdx = -minGapSamples
  for (let i = 0; i + win < ch.length; i += win) {
    let sum = 0
    for (let j = 0; j < win; j++) {
      const s = ch[i + j]
      sum += s * s
    }
    const rms = Math.sqrt(sum / win)
    if (rms > NOISE_FLOOR && rms > prevRms * RISE && i - lastOnsetIdx > minGapSamples) {
      // Back up a hair so we start just before the attack.
      const onsetIdx = Math.max(0, i - win)
      onsets.push(onsetIdx / sr)
      lastOnsetIdx = i
    }
    prevRms = rms
  }
  return onsets
}

function loadKeyBuffer() {
  if (keyBufRef || keyBufLoading) return keyBufLoading
  if (!ctx) return null
  keyBufLoading = fetch('/keyboard.wav')
    .then((r) => r.arrayBuffer())
    .then((ab) => ctx.decodeAudioData(ab))
    .then((buf) => {
      keyBufRef = buf
      keyOnsetsRef = detectOnsets(buf)
      return buf
    })
    .catch(() => null)
  return keyBufLoading
}

// Slice each tap out of a random offset in the source buffer, with a
// tiny fade-in/out so the boundary doesn't pop. The source contains
// ~7.5 s of varied taps. Playback rate stays at 1.0 — pitch jitter
// made bursts sound sped-up during the bio intro. We get variation
// from the random offset instead.
const SLICE_DURATION = 0.18 // long enough to capture tap + decay
const SLICE_FADE = 0.006
// Min wall-clock between keyticks. The bio types at 18 ms/char (9 ms
// on mobile), which would fire 55 taps/sec — way faster than real
// typing. We throttle to ~70 ms here so a sustained run of chars only
// emits ~14 taps/sec, but human keystrokes (always slower) fire on
// every press.
const KEYTICK_COOLDOWN_MS = 70
let lastKeyTickAt = 0
function playKeyTick() {
  const c = ensureCtx()
  if (!c) return
  if (!keyBufRef) {
    loadKeyBuffer()
    return // skip this tap while the sample decodes; subsequent ones land
  }
  const tNow = (typeof performance !== 'undefined' ? performance.now() : Date.now())
  if (tNow - lastKeyTickAt < KEYTICK_COOLDOWN_MS) return
  lastKeyTickAt = tNow

  // Pick an offset that lines up with a real tap onset, not a silent
  // gap. Fall back to a random offset if onset detection didn't run.
  let offset
  if (keyOnsetsRef && keyOnsetsRef.length > 0) {
    offset = keyOnsetsRef[Math.floor(Math.random() * keyOnsetsRef.length)]
  } else {
    const max = Math.max(0, keyBufRef.duration - SLICE_DURATION - 0.02)
    offset = Math.random() * max
  }
  const dur = SLICE_DURATION
  const now = c.currentTime

  const src = c.createBufferSource()
  src.buffer = keyBufRef
  const g = c.createGain()
  const peak = 0.55 + Math.random() * 0.2
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(peak, now + SLICE_FADE)
  g.gain.setValueAtTime(peak, now + dur - SLICE_FADE)
  g.gain.linearRampToValueAtTime(0, now + dur)
  src.connect(g)
  g.connect(masterGain)
  src.start(now, offset, dur)
  src.stop(now + dur + 0.01)
}

const PRESETS = {
  click: playClick,
  thunk: playThunk,
  keytick: playKeyTick,
}

export function playSfx(name) {
  if (muted) return
  const fn = PRESETS[name]
  if (!fn) return
  // Resume context if it was created before a gesture and is suspended.
  if (ctx?.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  try {
    fn()
  } catch {
    /* synthesis failure — fail silent */
  }
}
