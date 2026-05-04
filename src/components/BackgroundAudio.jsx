import { useEffect, useRef, useState } from 'react'

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

export default function BackgroundAudio({ src, scratchSrc = '/scratch.mp3', volume = 0.3 }) {
  const audioRefs = useRef(new Map())
  const scratchRef = useRef(null)
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(muted)
  useEffect(() => { mutedRef.current = muted }, [muted])
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
    audio.muted = mutedRef.current
    if (mutedRef.current) return
    audio.play().catch(() => {
      const start = () => {
        audio.muted = false
        audio.volume = volume
        audio.play().catch(() => {})
      }
      window.addEventListener('pointerdown', start, { once: true })
      window.addEventListener('keydown', start, { once: true })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // src change: kick the scratch sfx immediately (still in the click
  // call stack so the browser counts it as a user gesture), pause the
  // outgoing track, then 1s later play the new one. Each <audio>
  // element preserves its own currentTime, so resuming a track picks
  // up where it was paused.
  const prevSrcRef = useRef(src)
  useEffect(() => {
    if (prevSrcRef.current === src) return
    const prev = prevSrcRef.current
    prevSrcRef.current = src
    const outgoing = audioRefs.current.get(prev)
    if (outgoing) outgoing.pause()
    const scratch = scratchRef.current
    if (!mutedRef.current && scratch) {
      scratch.currentTime = 0
      scratch.volume = Math.min(1, volume * 2.5)
      scratch.play().catch(() => {})
    }
    const swapTimer = setTimeout(() => {
      const incoming = audioRefs.current.get(src)
      if (!incoming) return
      incoming.volume = volume
      incoming.muted = mutedRef.current
      if (!mutedRef.current) incoming.play().catch(() => {})
    }, SWAP_DELAY_MS)
    return () => clearTimeout(swapTimer)
  }, [src, volume])

  // Pause when the tab loses focus, resume when it returns (only if
  // the user hadn't manually muted). Doesn't touch the React `muted`
  // state so the icon keeps reflecting the user's intent.
  useEffect(() => {
    const onVisibility = () => {
      const audio = audioRefs.current.get(src)
      if (!audio) return
      if (document.hidden) {
        audio.pause()
      } else if (!muted) {
        audio.play().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [muted, src])

  const toggle = () => {
    const audio = audioRefs.current.get(src)
    if (!audio) return
    if (muted) {
      audio.muted = false
      audio.volume = volume
      audio.play().catch(() => {})
      setMuted(false)
    } else {
      audio.muted = true
      audio.pause()
      setMuted(true)
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
        aria-label={muted ? 'Unmute background audio' : 'Mute background audio'}
        aria-pressed={!muted}
        type="button"
      >
        {muted ? (
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
