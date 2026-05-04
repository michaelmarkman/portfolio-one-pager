import { useEffect, useRef, useState } from 'react'

const VISIBLE = 3
const TICK_MS = 3500
const FIRST_DELAY_MS = 0 // start ticking immediately on mount

// Pseudo-system-log lines drawn from real LinkedIn experience: career
// roles + education only. Each tick shows one entry from a shuffled
// queue so they cycle without immediate repeats.
const TEMPLATES = [
  '[active] head_of_design @ shapesxr (2024-06—present)',
  '[loaded] /work/shapesxr/founding-pd (2022-02—2024-05)',
  '[loaded] /work/arthur/senior-ux (2020-03—2022-02)',
  '[loaded] /work/mega-particle/design-lead (poker_vr.quest)',
  '[loaded] /work/moment/co-founder-ceo (2016—2018, boostvc-tribe10)',
  '[edu] compsci.umass-amherst (2013—2017)',
  '[edu] product-mgmt.uc-berkeley (nov23)',
]

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Periodic pseudo-system-log ticker. Pulls from a shuffled queue of
 * career-fact templates so each tick shows something new without
 * immediate repeats; when the queue empties it re-shuffles.
 */
export default function SystemLog() {
  const [entries, setEntries] = useState([])
  const idRef = useRef(0)
  const queueRef = useRef([])
  const lastShownRef = useRef(null)

  useEffect(() => {
    const start = setTimeout(() => {
      const tick = () => {
        if (queueRef.current.length === 0) {
          queueRef.current = shuffle(TEMPLATES)
          // Guard the boundary between shuffles — if the freshly-shuffled
          // queue starts with the line we just showed, swap it with the
          // next so we never tick the same entry twice in a row.
          if (
            queueRef.current.length > 1 &&
            queueRef.current[0] === lastShownRef.current
          ) {
            ;[queueRef.current[0], queueRef.current[1]] =
              [queueRef.current[1], queueRef.current[0]]
          }
        }
        const text = queueRef.current.shift()
        lastShownRef.current = text
        setEntries((prev) => {
          const next = [...prev, { id: ++idRef.current, text }]
          return next.length > VISIBLE ? next.slice(next.length - VISIBLE) : next
        })
      }
      tick()
      const id = setInterval(tick, TICK_MS)
      return () => clearInterval(id)
    }, FIRST_DELAY_MS)
    return () => clearTimeout(start)
  }, [])

  return (
    <div className="system-log" aria-hidden="true">
      {entries.map((e) => (
        <div key={e.id} className="system-log__entry">
          {e.text}
        </div>
      ))}
    </div>
  )
}
