import { useCallback, useEffect, useRef, useState } from 'react'
import Cursor from './Cursor.jsx'
import { playSfx } from '../lib/sfx.js'

const SHELL = 'michael@folio:~$'

// Time after mount before keystrokes are accepted. Lets the bio
// typewriter finish without competing with user input. ~7s on desktop
// (matches BODY_START_DELAY_MS + bio length); halved on mobile to
// match the faster boot cadence.
const READY_DELAY_DESKTOP_MS = 7200
const READY_DELAY_MOBILE_MS = 3500

const isMobile =
  typeof window !== 'undefined' &&
  window.matchMedia('(max-width: 768px)').matches
const READY_DELAY_MS = isMobile ? READY_DELAY_MOBILE_MS : READY_DELAY_DESKTOP_MS

// Multi-line replies are stored as a single string with \n; the
// renderer splits and outputs one <div> per line.
const COFFEE_MUG = `   ( (
    ) )
  ........
  |      |]
  \\      /
   \`----'`

const FILES = {
  'bio.txt': `Designer who codes. Obsessed with craft and novel ways of interacting with computers. Building agentic frameworks for AI wearables at ShapesXR.`,
  'resume.txt': [
    'head_of_design  shapesxr            2024 — present',
    'founding_pd     shapesxr            2022 — 2024',
    'senior_ux       arthur              2020 — 2022',
    'design_lead     mega particle       (poker_vr.quest)',
    'co-founder      moment              2016 — 2018  (boostvc t10)',
    'edu             umass amherst       2013 — 2017  (compsci)',
    'edu             uc berkeley         2023         (product mgmt)',
  ].join('\n'),
  'contact.txt': [
    'email     michael@markman.io',
    'twitter   x.com/michaelgmarkman',
    'linkedin  linkedin.com/in/michaelgmarkman',
  ].join('\n'),
}

const HELP_TEXT = [
  'available commands:',
  '  help              show this',
  "  whoami            who's there",
  '  ls                list files',
  '  cat <file>        print a file',
  '  date              current time',
  '  echo <text>       repeat text',
  '  coffee            brew up',
  '  clear             clear the screen',
].join('\n')

function runCommand(raw) {
  const trimmed = raw.trim()
  if (!trimmed) return { out: null }

  const [cmd, ...rest] = trimmed.split(/\s+/)
  const args = rest.join(' ')

  switch (cmd) {
    case 'help':
      return { out: HELP_TEXT }
    case 'whoami':
      return { out: 'michael — designer who codes' }
    case 'ls':
      return { out: 'bio.txt   resume.txt   contact.txt' }
    case 'cat': {
      if (!args) return { out: 'cat: missing operand. try `ls`.' }
      const f = FILES[args]
      if (!f) return { out: `cat: ${args}: no such file` }
      return { out: f }
    }
    case 'date':
      return { out: new Date().toString() }
    case 'echo':
      return { out: args }
    case 'coffee':
      return { out: COFFEE_MUG }
    case 'clear':
      return { clear: true }
    case 'sudo':
      return { out: 'nice try.' }
    case 'rm':
      return { out: "i wouldn't." }
    case 'cd':
      if (args === '~' || args === '/') return { out: "you can't go home." }
      return { out: `cd: ${args || '?'}: nope` }
    case 'vim':
    case 'vi':
      return { out: "you'll be stuck forever." }
    case 'emacs':
      return { out: 'no.' }
    case 'exit':
    case 'logout':
    case 'quit':
      return { out: "there's no escape." }
    default:
      return { out: `command not found: ${cmd}. try \`help\`.` }
  }
}

export default function InteractiveTerminal() {
  const [entries, setEntries] = useState([])
  const [buffer, setBuffer] = useState('')
  // ready flips true after the bio finishes typing — at that point any
  // keystroke flows into the terminal without requiring a click first
  // (clicks on the rasterized CRT screen route through the html-to-
  // image pipeline and don't reliably reach this DOM node).
  const [ready, setReady] = useState(false)
  const historyRef = useRef([])
  const historyIdxRef = useRef(null)

  useEffect(() => {
    const id = setTimeout(() => setReady(true), READY_DELAY_MS)
    return () => clearTimeout(id)
  }, [])

  // Cap total *visual* rendered lines so the active prompt always
  // stays inside the bezel-cropped CRT window. html-to-image clones
  // the DOM with scrollTop=0, so a CSS overflow-scroll approach would
  // always show the TOP of the buffer in the captured texture — we
  // drop old entries from state instead. The cap accounts for word
  // wrap at roughly CHARS_PER_LINE characters (calibrated for the lab
  // variant at --lab-scale=1.4).
  const MAX_VISIBLE_LINES = 7
  const CHARS_PER_LINE = 44
  const submit = useCallback((raw) => {
    const result = runCommand(raw)
    if (result.clear) {
      setEntries([])
      return
    }
    setEntries((prev) => {
      const next = [...prev, { kind: 'in', text: raw }]
      if (result.out != null) next.push({ kind: 'out', text: result.out })
      // Trim from the front until total rendered lines fits in the
      // visible window. Each text-line is wrap-counted (long bio.txt
      // output is one string but renders as several lines).
      const linesFor = (e) =>
        e.text.split('\n').reduce(
          (sum, ln) => sum + Math.max(1, Math.ceil((ln.length + (e.kind === 'in' ? SHELL.length + 1 : 0)) / CHARS_PER_LINE)),
          0,
        )
      let total = next.reduce((n, e) => n + linesFor(e), 0)
      while (total > MAX_VISIBLE_LINES && next.length > 1) {
        total -= linesFor(next.shift())
      }
      return next
    })
  }, [])

  // Global keydown — captured once the prompt is "live". Filters keys
  // we care about.
  useEffect(() => {
    if (!ready) return
    const onKey = (event) => {
      // Don't fight other inputs.
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return

      if (event.key === 'Enter') {
        event.preventDefault()
        const line = buffer
        if (line.trim()) historyRef.current.push(line)
        historyIdxRef.current = null
        setBuffer('')
        submit(line)
        playSfx('keytick')
        return
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        if (buffer.length > 0) playSfx('keytick')
        setBuffer((b) => b.slice(0, -1))
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setBuffer('')
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const h = historyRef.current
        if (h.length === 0) return
        const cur = historyIdxRef.current
        const next = cur == null ? h.length - 1 : Math.max(0, cur - 1)
        historyIdxRef.current = next
        setBuffer(h[next])
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const h = historyRef.current
        const cur = historyIdxRef.current
        if (cur == null) return
        const next = cur + 1
        if (next >= h.length) {
          historyIdxRef.current = null
          setBuffer('')
        } else {
          historyIdxRef.current = next
          setBuffer(h[next])
        }
        return
      }
      // Printable single character
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        setBuffer((b) => b + event.key)
        playSfx('keytick')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready, buffer, submit])

  return (
    <div className="terminal-shell">
      {entries.map((e, i) => (
        <div
          key={i}
          className={e.kind === 'in' ? 'terminal-shell__in' : 'terminal-shell__out'}
        >
          {e.kind === 'in' ? (
            <>
              <span className="prompt__shell">{SHELL}</span>{' '}
              <span>{e.text}</span>
            </>
          ) : (
            e.text.split('\n').map((line, j) => (
              <div key={j}>{line || ' '}</div>
            ))
          )}
        </div>
      ))}
      <div className="prompt">
        <span className="prompt__shell">{SHELL}</span>
        {buffer && <span className="terminal-shell__buffer">&nbsp;{buffer}</span>}
        <Cursor />
      </div>
    </div>
  )
}
