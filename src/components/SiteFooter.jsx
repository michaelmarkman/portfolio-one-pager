import BackgroundAudio from './BackgroundAudio.jsx'

export default function SiteFooter({ status, links, audioSrc }) {
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
        {audioSrc && <BackgroundAudio src={audioSrc} />}
      </nav>

      {status && <div className="status-line">{status}</div>}
    </footer>
  )
}
