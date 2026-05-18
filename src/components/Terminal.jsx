import TypewriterLine from './TypewriterLine.jsx'
import Bio from './Bio.jsx'
import InteractiveTerminal from './InteractiveTerminal.jsx'
import SystemLog from './SystemLog.jsx'

export default function Terminal({
  name,
  role,
  location,
  focus,
  currentRole,
  showSystemLog = true,
}) {
  return (
    <main className="terminal">
      <div className="terminal-stack">
        <TypewriterLine delay={1} className="heading-name">
          &gt; {name}
        </TypewriterLine>

        <TypewriterLine delay={2} className="heading-role">
          &gt; {role}
        </TypewriterLine>

        <Bio location={location} focus={focus} currentRole={currentRole} />

        <InteractiveTerminal />

        {showSystemLog && <SystemLog />}
      </div>
    </main>
  )
}
