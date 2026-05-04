import BackgroundAudio from './BackgroundAudio.jsx'
import DayNightToggle from './DayNightToggle.jsx'

export default function SiteFooter({
  status,
  links,
  audioSrc,
  sceneMode,
  onToggleScene,
}) {
  return (
    <footer className="site-footer">
      <nav className="nav">
        <div className="nav__links">
          {links.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              className="nav__link"
              target="_blank"
              rel="noreferrer"
            >
              [ {label} ]
            </a>
          ))}
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
