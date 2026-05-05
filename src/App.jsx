import { useRef } from 'react'
import HtmlSource from './scene/HtmlSource.jsx'
import CrtScene from './scene/CrtScene.jsx'

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

export default function App() {
  const sourceRef = useRef(null)
  return (
    <>
      <HtmlSource
        ref={sourceRef}
        profile={PROFILE}
        footerLinks={FOOTER_LINKS}
        status="STATUS: ACTIVE"
      />
      <CrtScene sourceRef={sourceRef} />
    </>
  )
}
