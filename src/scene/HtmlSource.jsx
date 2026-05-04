import { forwardRef } from 'react'
import Terminal from '../components/Terminal.jsx'
import SiteFooter from '../components/SiteFooter.jsx'

/**
 * Off-screen 1024×768 DOM hosting the live terminal — the source for
 * html-to-image. Rendered off-page (left:-99999) so layout still computes
 * (visibility:hidden would prevent capture).
 *
 * The CRT effects (scanlines, noise, glare, vignette, distortion) are NOT
 * rendered here — they're added per-pixel in the shader on the 3D mesh.
 */
const HtmlSource = forwardRef(function HtmlSource(
  {
    profile,
    footerLinks,
    status,
    variant,
    pagePadTop,
    contentScale,
    audioSrc,
    sceneMode,
    onToggleScene,
    screenInvert,
    screenPalette,
    customPalette,
  },
  ref,
) {
  // 'day' modifier inverts the source via CSS filter so the screen reads
  // light-bg/dark-text. Driven by an explicit `screenInvert` prop when
  // present (so manual palettes like 'amber-inverted' can opt in regardless
  // of sceneMode). Falls back to sceneMode==='cozy' for older callers.
  const isInverted = screenInvert != null ? screenInvert : sceneMode === 'cozy'
  const baseClass = variant ? `html-source html-source--${variant}` : 'html-source'
  const isCustom = screenPalette === 'custom' && customPalette
  const rootClass = isCustom
    ? `${baseClass} html-source--custom`
    : isInverted ? `${baseClass} html-source--day` : baseClass
  // Optional inline override so leva can move the content up/down on the
  // captured texture without touching CSS.
  const pageStyle = pagePadTop != null ? { paddingTop: `${pagePadTop}rem` } : undefined
  // Override the lab variant's --lab-scale variable from the slider.
  // When the 'custom' palette is active, also push the four CSS vars
  // it needs so the user-picked colors take over without burning a
  // CSS class per palette.
  const rootStyle = (() => {
    if (!isCustom && contentScale == null) return undefined
    const s = {}
    if (contentScale != null) s['--lab-scale'] = contentScale
    if (isCustom) {
      s['--bg'] = customPalette.bg
      s['--terminal-green'] = customPalette.primary
      s['--terminal-mid'] = customPalette.secondary
      s['--terminal-dim'] = customPalette.dim
    }
    return s
  })()
  return (
    <div ref={ref} className={rootClass} aria-hidden="true" style={rootStyle}>
      <div className="html-source__page" style={pageStyle}>
        <Terminal {...profile} />
        <SiteFooter
          status={status}
          links={footerLinks}
          audioSrc={audioSrc}
          sceneMode={sceneMode}
          onToggleScene={onToggleScene}
        />
      </div>
    </div>
  )
})

export default HtmlSource
