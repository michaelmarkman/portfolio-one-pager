import { useEffect, useRef, useState } from 'react'
import { track } from '@vercel/analytics'
import { playSfx, setSfxMuted } from '../lib/sfx.js'

/**
 * Background audio with a fixed-position mute toggle. Tries to autoplay
 * unmuted on mount; if the browser blocks (most do, until a user gesture
 * fires), we attach a one-shot global pointer/key listener and start the
 * track on first interaction. Toggle button mutes+pauses or unmutes+plays
 * together so the icon never lies about whether sound is happening.
 *
 * On `src` change: plays the record-scratch sfx, then 1s after the change
 * swaps to the new track. Each known src gets its own <audio> element so
 * pausing one and playing another preserves the playback position
 * automatically — flipping back picks up where you left off.
 */
const SWAP_DELAY_MS = 1000

export default function BackgroundAudio({ src, scratchSrc = '/scratch.mp3', volume = 0.18 }) {
  const audioRefs = useRef(new Map())
  const scratchRef = useRef(null)
  // `audible` is the source of truth for the icon. Defaults to true
  // so the page doesn't load with a "muted" icon (we always *try* to
  // autoplay unmuted; if the browser blocks until first gesture, the
  // gesture-fallback path below still flips the audio on without ever
  // having reported a muted state). The play/pause/volumechange
  // listeners below keep it honest after any subsequent change.
  const [audible, setAudible] = useState(true)
  // Set of every src seen so far — we render one <audio> per entry so
  // each track keeps its own currentTime independently.
  const [knownSrcs, setKnownSrcs] = useState(() => new Set([src]))
  useEffect(() => {
    setKnownSrcs((prev) => (prev.has(src) ? prev : new Set([...prev, src])))
  }, [src])

  const setAudioRef = (key) => (el) => {
    if (el) audioRefs.current.set(key, el)
    else audioRefs.current.delete(key)
  }

  // Initial mount: try to autoplay the first track. Falls back to a
  // one-shot gesture listener if the browser blocks. Also clears any
  // MediaSession metadata so the OS Now-Playing widget / browser
  // "new media item detected" notification doesn't pop up for the
  // background loop — this is decorative scene audio, not a track the
  // visitor wants surfaced as media.
  const isMountedRef = useRef(false)
  useEffect(() => {
    if (isMountedRef.current) return
    isMountedRef.current = true
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = null
        navigator.mediaSession.playbackState = 'none'
        for (const action of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack']) {
          try { navigator.mediaSession.setActionHandler(action, null) } catch { /* unsupported action */ }
        }
      } catch { /* mediaSession not writable */ }
    }
    const audio = audioRefs.current.get(src)
    if (!audio) return
    audio.volume = volume
    audio.muted = false
    // Try autoplay, but don't attach a global "any gesture starts it"
    // fallback — that listener was racing the audio-toggle click and
    // pre-starting the loop just before the toggle handler ran, so the
    // toggle would see "already playing" and immediately mute. The
    // toggle click is itself a valid user gesture; the toggle handler
    // starts audio directly when the user wants it on.
    audio.play().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Subscribe to play/pause/volumechange on the active <audio> element so
  // `audible` (icon state) always tracks what the browser is doing. Re-
  // bound when src changes (the element switches with the track).
  useEffect(() => {
    const audio = audioRefs.current.get(src)
    if (!audio) return
    const sync = () => setAudible(!audio.paused && !audio.muted)
    // Skip the immediate sync — at mount the audio element is still
    // paused while play() resolves, and we don't want the icon to flash
    // muted before the autoplay attempt actually completes.
    audio.addEventListener('play', sync)
    audio.addEventListener('pause', sync)
    audio.addEventListener('volumechange', sync)
    return () => {
      audio.removeEventListener('play', sync)
      audio.removeEventListener('pause', sync)
      audio.removeEventListener('volumechange', sync)
    }
  }, [src, knownSrcs])

  // src change: kick the scratch sfx immediately (still in the click
  // call stack so the browser counts it as a user gesture), pause the
  // outgoing track, then 1s later play the new one. Each <audio>
  // element preserves its own currentTime, so resuming a track picks
  // up where it was paused. Whether the user is currently muted is read
  // off the outgoing element directly so the swap matches reality even
  // if the icon hasn't re-rendered yet.
  const prevSrcRef = useRef(src)
  useEffect(() => {
    if (prevSrcRef.current === src) return
    const prev = prevSrcRef.current
    prevSrcRef.current = src
    const outgoing = audioRefs.current.get(prev)
    const wasMuted = outgoing ? outgoing.muted : false
    if (outgoing) outgoing.pause()
    const scratch = scratchRef.current
    if (!wasMuted && scratch) {
      scratch.currentTime = 0
      scratch.volume = Math.min(1, volume * 2.5)
      scratch.play().catch(() => {})
    }
    const swapTimer = setTimeout(() => {
      const incoming = audioRefs.current.get(src)
      if (!incoming) return
      incoming.volume = volume
      incoming.muted = wasMuted
      if (!wasMuted) incoming.play().catch(() => {})
    }, SWAP_DELAY_MS)
    return () => clearTimeout(swapTimer)
  }, [src, volume])

  // Pause when the tab loses focus, resume when it returns (only if
  // the active track wasn't manually muted). Reads .muted off the
  // element directly so it can't drift from a stale React snapshot.
  useEffect(() => {
    const onVisibility = () => {
      const audio = audioRefs.current.get(src)
      if (!audio) return
      if (document.hidden) {
        audio.pause()
      } else if (!audio.muted) {
        audio.play().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [src])

  const toggle = () => {
    const audio = audioRefs.current.get(src)
    if (!audio) return
    // Drive the action off the element's current state, not React's —
    // even if the icon momentarily disagrees, the click does the right
    // thing relative to whatever's actually playing right now. The
    // 'play'/'pause'/'volumechange' listeners then sync `audible` back.
    if (!audio.paused && !audio.muted) {
      // Click feedback before we silence everything.
      playSfx('click')
      audio.muted = true
      audio.pause()
      setSfxMuted(true)
      track('audio_mute')
    } else {
      audio.muted = false
      audio.volume = volume
      audio.play().catch(() => {})
      setSfxMuted(false)
      playSfx('click')
      track('audio_unmute')
    }
  }

  return (
    <>
      {Array.from(knownSrcs).map((trackSrc) => (
        <audio
          key={trackSrc}
          ref={setAudioRef(trackSrc)}
          src={trackSrc}
          loop
          preload="auto"
          disableRemotePlayback
        />
      ))}
      <audio ref={scratchRef} src={scratchSrc} preload="auto" disableRemotePlayback />
      <button
        className="audio-toggle"
        onClick={toggle}
        aria-label={audible ? 'Mute background audio' : 'Unmute background audio'}
        aria-pressed={audible}
        type="button"
      >
        {!audible ? (
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5L6 9H2v6h4l5 4V5z" />
            <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
          </svg>
        )}
      </button>
    </>
  )
}
