import { useEffect, useState } from 'react'
import TypewriterLine from './TypewriterLine.jsx'

const TYPE_SPEED_MS = 18 // per character — snappy but readable
const BODY_START_DELAY_MS = 6100 // start typing right after INITIALIZING BIO finishes (delay-3 + 1.5s)

function TypingBody({ currentRole }) {
  const text = `Designer who codes. Obsessed with craft and novel ways of interacting with computers. Currently leading design at ${currentRole.label}.`
  const linkStart = text.indexOf(currentRole.label)
  const linkEnd = linkStart + currentRole.label.length
  const [chars, setChars] = useState(0)

  useEffect(() => {
    const start = setTimeout(() => {
      let i = 0
      const id = setInterval(() => {
        i += 1
        setChars(i)
        if (i >= text.length) clearInterval(id)
      }, TYPE_SPEED_MS)
      return () => clearInterval(id)
    }, BODY_START_DELAY_MS)
    return () => clearTimeout(start)
  }, [text.length])

  // Reserve full layout space upfront so LOCATION below doesn't shift up
  // as the bio types out; render the visible portion as text, swapping
  // in the actual <a> tag once the typing has reached the link span.
  const visible = (() => {
    if (chars <= linkStart) return text.slice(0, chars)
    if (chars <= linkEnd) {
      return (
        <>
          {text.slice(0, linkStart)}
          <a
            href={currentRole.href}
            className="bio__link"
            target="_blank"
            rel="noreferrer"
          >
            {text.slice(linkStart, chars)}
          </a>
        </>
      )
    }
    return (
      <>
        {text.slice(0, linkStart)}
        <a
          href={currentRole.href}
          className="bio__link"
          target="_blank"
          rel="noreferrer"
        >
          {currentRole.label}
        </a>
        {text.slice(linkEnd, chars)}
      </>
    )
  })()

  return (
    <div className="bio__body">
      <span className="bio__body-shadow" aria-hidden="true">{text}</span>
      <span className="bio__body-visible">{visible}</span>
    </div>
  )
}

export default function Bio({ location, focus, currentRole }) {
  return (
    <div className="bio">
      <TypewriterLine delay={3} className="bio__init" as="div">
        INITIALIZING BIO...
      </TypewriterLine>
      <TypingBody currentRole={currentRole} />
      <TypewriterLine delay={5} className="bio__meta" as="div">
        <span className="bio__label">LOCATION:</span> {location}
      </TypewriterLine>
    </div>
  )
}
