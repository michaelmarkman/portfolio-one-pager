import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'
import '@fontsource/space-mono/400-italic.css'
import './index.css'
import EmbeddedTerminal from './EmbeddedTerminal.jsx'

// Lazy-load App so phones never download three.js / drei / leva.
const App = lazy(() => import('./App.jsx'))

const isEmbed = new URLSearchParams(window.location.search).has('embed')
const isMobile =
  typeof window !== 'undefined' &&
  (window.matchMedia('(max-width: 768px)').matches ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent))

const useFlatView = isEmbed || isMobile

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {useFlatView ? (
      <EmbeddedTerminal />
    ) : (
      <Suspense fallback={null}>
        <App />
      </Suspense>
    )}
  </StrictMode>,
)
