import Cursor from './Cursor.jsx'

export default function Prompt({ shell = 'michael@folio:~$' }) {
  return (
    <div className="prompt">
      <span className="prompt__shell">{shell}</span>
      <Cursor />
    </div>
  )
}
