import { forwardRef } from 'react'
import SystemHeader from '../components/SystemHeader.jsx'
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
const HtmlSource = forwardRef(function HtmlSource({ profile, footerLinks, status }, ref) {
  return (
    <div ref={ref} className="html-source" aria-hidden="true">
      <div className="html-source__page">
        <SystemHeader />
        <Terminal {...profile} />
        <SiteFooter status={status} links={footerLinks} />
      </div>
    </div>
  )
})

export default HtmlSource
