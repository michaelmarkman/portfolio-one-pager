export default function SystemHeader({ tag = '[ SYSTEM: FOLIO_V2026 ]' }) {
  return (
    <header className="system-header">
      <div className="system-tag fade-in delay-tag">{tag}</div>
    </header>
  )
}
