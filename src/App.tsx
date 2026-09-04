import { useState } from 'react'
import CodePane, { type Range } from './CodePane'
import Canvas from './Canvas'
import { findNodes } from './correlate'

const INITIAL_SOURCE = `flowchart TD
  A[Christmas] -->|Get money| B(Go shopping)
  B --> C{Let me think}
  C -->|One| D[Laptop]
  C -->|Two| E[iPhone]
  C -->|Three| F[Car]
`

export default function App() {
  const [source, setSource] = useState(INITIAL_SOURCE)
  const [selected, setSelected] = useState<string | null>(null)
  const [reveal, setReveal] = useState<Range | null>(null)

  const select = (nodeId: string | null) => {
    setSelected(nodeId)
    if (nodeId === null) {
      setReveal(null)
      return
    }

    const node = findNodes(source).get(nodeId)
    setReveal(node === undefined ? null : { from: node.from, to: node.to })
  }

  return (
    <main className="app">
      <CodePane
        source={source}
        reveal={reveal}
        onChange={(next) => {
          setSource(next)
          // Spans are offsets into the old text, so editing invalidates the selection.
          setSelected(null)
          setReveal(null)
        }}
      />
      <Canvas source={source} selected={selected} onSelect={select} />
    </main>
  )
}
