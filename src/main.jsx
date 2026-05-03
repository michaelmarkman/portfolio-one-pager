import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'
import '@fontsource/space-mono/400-italic.css'
import './index.css'
import EmbeddedTerminal from './EmbeddedTerminal.jsx'

// Lazy-load App so phones never download three.js / drei / leva.
const App = lazy(() => import('./App.jsx'))
// Lab page — only requested when the user navigates to /lab.
const Lab = lazy(() => import('./Lab.jsx'))

const isEmbed = new URLSearchParams(window.location.search).has('embed')
const isMobile =
  typeof window !== 'undefined' &&
  (window.matchMedia('(max-width: 768px)').matches ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent))
const isLab = typeof window !== 'undefined' && window.location.pathname.startsWith('/lab')

// Lab bypasses the mobile/embed flat-view so we can preview the 3D scene on
// any device.
const useFlatView = !isLab && (isEmbed || isMobile)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {useFlatView ? (
      <EmbeddedTerminal />
    ) : (
      <Suspense fallback={null}>
        {isLab ? <Lab /> : <App />}
      </Suspense>
    )}
  </StrictMode>,
)
