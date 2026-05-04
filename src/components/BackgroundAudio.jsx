import { useEffect, useRef, useState } from 'react'

/**
 * Background audio with a fixed-position mute toggle. Tries to autoplay
 * unmuted on mount; if the browser blocks (most do, until a user gesture
 * fires), we attach a one-shot global pointer/key listener and start the
 * track on first interaction. Toggle button mutes+pauses or unmutes+plays
 * together so the icon never lies about whether sound is happening.
 */
export default function BackgroundAudio({ src, volume = 0.3 }) {
  const audioRef = useRef(null)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.muted = false
    audio.play().catch(() => {
      // Autoplay rejected — wait for first user gesture and try again.
      const start = () => {
        audio.muted = false
        audio.volume = volume
        audio.play().catch(() => {})
      }
      window.addEventListener('pointerdown', start, { once: true })
      window.addEventListener('keydown', start, { once: true })
      return () => {
        window.removeEventListener('pointerdown', start)
        window.removeEventListener('keydown', start)
      }
    })
  }, [volume])

  // Pause when the tab loses focus, resume when it returns (only if the
  // user hadn't manually muted). Doesn't touch the React `muted` state so
  // the icon keeps reflecting the user's intent, not the visibility state.
  useEffect(() => {
    const onVisibility = () => {
      const audio = audioRef.current
      if (!audio) return
      if (document.hidden) {
        audio.pause()
      } else if (!muted) {
        audio.play().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [muted])

  const toggle = () => {
    const audio = audioRef.current
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
      <audio ref={audioRef} src={src} loop preload="auto" />
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
