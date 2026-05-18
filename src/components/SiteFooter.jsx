import { track } from '@vercel/analytics'
import { playSfx } from '../lib/sfx.js'
import BackgroundAudio from './BackgroundAudio.jsx'
import DayNightToggle from './DayNightToggle.jsx'

// Inline icon SVGs for the social links, keyed by the label string from
// the links array. Filled glyphs (twitter X, linkedin); stroked outline
// for email since a filled envelope reads heavier than the others. Sized
// 1em so font-size on the link drives icon size.
const LINK_ICONS = {
  TWITTER: (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  ),
  LINKEDIN: (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
    </svg>
  ),
  EMAIL: (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 7L2 7" />
    </svg>
  ),
}

export default function SiteFooter({
  status,
  links,
  audioSrc,
  sceneMode,
  onToggleScene,
  iconLinks = false,
}) {
  return (
    <footer className="site-footer">
      <nav className={iconLinks ? 'nav nav--icons' : 'nav'}>
        <div className="nav__links">
          {links.map(({ label, href }) => {
            const icon = iconLinks ? LINK_ICONS[label] : null
            return (
              <a
                key={label}
                href={href}
                className={icon ? 'nav__link nav__link--icon' : 'nav__link'}
                target="_blank"
                rel="noreferrer"
                aria-label={icon ? label : undefined}
                onClick={() => {
                  playSfx('click')
                  track('link_click', { label })
                }}
              >
                {icon ?? `[ ${label} ]`}
              </a>
            )
          })}
        </div>
        <div className="nav__actions">
          {audioSrc && <BackgroundAudio src={audioSrc} />}
          {onToggleScene && (
            <DayNightToggle mode={sceneMode} onToggle={onToggleScene} />
          )}
        </div>
      </nav>

      {status && <div className="status-line">{status}</div>}
    </footer>
  )
}
