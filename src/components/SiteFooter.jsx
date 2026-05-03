export default function SiteFooter({ status, links }) {
  return (
    <footer className="site-footer">
      <nav className="nav">
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
      </nav>

      {status && <div className="status-line">{status}</div>}
    </footer>
  )
}
