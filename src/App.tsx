import { useState } from 'react'
import CodePane from './CodePane'
import Canvas from './Canvas'

const INITIAL_SOURCE = `flowchart TD
  A[Christmas] -->|Get money| B(Go shopping)
  B --> C{Let me think}
  C -->|One| D[Laptop]
  C -->|Two| E[iPhone]
  C -->|Three| F[Car]
`

export default function App() {
  const [source, setSource] = useState(INITIAL_SOURCE)

  return (
    <main className="app">
      <CodePane source={source} onChange={setSource} />
      <Canvas source={source} />
    </main>
  )
}
