export default function Bio({ location, focus, currentRole }) {
  return (
    <div className="bio">
      <div className="bio__init">INITIALIZING BIO...</div>
      <div className="bio__body">
        Designer who codes. Obsessed with craft and novel ways of interacting with computers. Currently leading design at{' '}
        <a
          href={currentRole.href}
          className="bio__link"
          target="_blank"
          rel="noreferrer"
        >
          {currentRole.label}
        </a>
        .
      </div>
      <div className="bio__meta">
        <span className="bio__label">LOCATION:</span> {location}
      </div>
    </div>
  )
}
