import CrtEffects from './components/CrtEffects.jsx'
import Terminal from './components/Terminal.jsx'
import SiteFooter from './components/SiteFooter.jsx'

const PROFILE = {
  name: 'MICHAEL MARKMAN',
  role: 'PRODUCT DESIGNER',
  location: 'NEW YORK CITY, NY',
  focus: 'SPATIAL COMPUTING & AGENTIC AI',
  currentRole: { label: 'ShapesXR', href: 'https://www.shapesxr.com/ai' },
}

const FOOTER_LINKS = [
  { label: 'TWITTER', href: 'https://x.com/michaelgmarkman' },
  { label: 'LINKEDIN', href: 'https://www.linkedin.com/in/michaelgmarkman/' },
  { label: 'EMAIL', href: 'mailto:michael@markman.io' },
]

/**
 * The terminal page rendered standalone for embedding inside an iframe on the
 * CRT model's screen. Same components as the full app, no 3D wrapper.
 */
export default function EmbeddedTerminal() {
  return (
    <div className="embed-page">
      <CrtEffects />
      <div className="page__inner">
        <Terminal {...PROFILE} showSystemLog={false} />
        <SiteFooter
          status="PSST... THIS SITE IS MORE FUN ON DESKTOP"
          links={FOOTER_LINKS}
          iconLinks
        />
      </div>
    </div>
  )
}
