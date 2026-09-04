import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true })

const INITIAL_SOURCE = `flowchart TD
  A[Christmas] -->|Get money| B(Go shopping)
  B --> C{Let me think}
  C -->|One| D[Laptop]
  C -->|Two| E[iPhone]
  C -->|Three| F[Car]
`

// mermaid renders into a DOM id it expects to be unused, and a slow render can still be in
// flight when the next keystroke starts another one.
let renderCount = 0

export default function App() {
  const [source, setSource] = useState(INITIAL_SOURCE)
  const [error, setError] = useState<string | null>(null)
  const canvas = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let stale = false

    const timer = setTimeout(async () => {
      try {
        const { svg } = await mermaid.render(`mermaid-${++renderCount}`, source)
        if (stale) return
        if (canvas.current !== null) canvas.current.innerHTML = svg
        setError(null)
      } catch (cause) {
        if (!stale) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }, 150)

    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [source])

  return (
    <main className="app">
      <textarea
        className="code"
        value={source}
        onChange={(event) => setSource(event.target.value)}
        spellCheck={false}
      />
      <section className="canvas">
        <div className="diagram" ref={canvas} />
        {error !== null && <pre className="error">{error}</pre>}
      </section>
    </main>
  )
}
