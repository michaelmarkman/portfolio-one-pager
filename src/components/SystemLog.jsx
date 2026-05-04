import { useEffect, useRef, useState } from 'react'

const VISIBLE = 3
const TICK_MS = 3500
const FIRST_DELAY_MS = 0 // start ticking immediately on mount

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1))

// Pseudo-system-log lines drawn from real LinkedIn experience: career
// roles, customers, lab projects, contact, languages. Mixed in with a
// couple of "live" entries (uptime / rtt) so the feel stays system-y.
const TEMPLATES = [
  () => '[active] head_of_design @ shapesxr (2024-06—present)',
  () => '[loaded] /work/shapesxr/founding-pd (2022-02—2024-05)',
  () => '[loaded] /work/arthur/senior-ux (2020-03—2022-02)',
  () => '[loaded] /work/mega-particle/design-lead (poker_vr.quest)',
  () => '[loaded] /work/moment/co-founder-ceo (2016—2018, boostvc-tribe10)',
  () => '[edu] compsci.umass-amherst (2013—2017)',
  () => '[edu] product-mgmt.uc-berkeley (2023-11)',
  (uptime) => {
    const totalMin = Math.floor(uptime / 60000)
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    return `[uptime ${h}h ${m}m] heartbeat ok`
  },
  () => `[render] ${randInt(58, 60)}fps · ${randInt(48, 96)}k tris`,
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
  const mountedAtRef = useRef(0)
  const queueRef = useRef([])

  useEffect(() => {
    mountedAtRef.current = Date.now()
    const start = setTimeout(() => {
      const tick = () => {
        if (queueRef.current.length === 0) queueRef.current = shuffle(TEMPLATES)
        const template = queueRef.current.shift()
        const uptime = Date.now() - mountedAtRef.current
        const text = template(uptime)
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
