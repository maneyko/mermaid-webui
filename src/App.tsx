import { useState } from 'react'
import CodePane, { type Range } from './CodePane'
import Canvas, { type EditTarget } from './Canvas'
import { findEdgeLabels, findEdges, findNodes } from './correlate'
import {
  addConnectedNode,
  addStandaloneNode,
  connectNodes,
  deleteEdge,
  deleteEdgeLabel,
  deleteNode,
  renameEdgeLabel,
  renameLabel,
  setNodeShape,
} from './edit'

const INITIAL_SOURCE = `flowchart TD
  A[Christmas] -->|Get money| B(Go shopping)
  B --> C{Let me think}
  C -->|One| D[Laptop]
  C -->|Two| E[iPhone]
  C -->|Three| F[Car]
`

export default function App() {
  const [source, setSource] = useState(INITIAL_SOURCE)
  const [selected, setSelected] = useState<EditTarget | null>(null)
  const [reveal, setReveal] = useState<Range | null>(null)

  // A node reveals its whole declaration, an edge label the text between its pipes, and an
  // edge the pair of nodes it joins -- which for `A --> B --> C` is the half you clicked.
  const spanOf = (target: EditTarget): Range | null => {
    if (target.kind === 'edgeLabel') return findEdgeLabels(source)[target.index] ?? null
    if (target.kind === 'edge') {
      const edge = findEdges(source)[target.index]
      return edge === undefined ? null : { from: edge.from, to: edge.to }
    }
    const node = findNodes(source).get(target.nodeId)
    return node === undefined ? null : { from: node.from, to: node.to }
  }

  const select = (target: EditTarget | null) => {
    setSelected(target)
    setReveal(target === null ? null : spanOf(target))
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
      <Canvas
        source={source}
        selected={selected}
        onSelect={select}
        onRename={(nodeId, label) => {
          // The rewritten text moves every span after the edit, so the old ones are dead.
          setSource(renameLabel(source, nodeId, label))
          setSelected(null)
          setReveal(null)
        }}
        onRenameEdge={(index, label) => {
          setSource(renameEdgeLabel(source, index, label))
          setSelected(null)
          setReveal(null)
        }}
        onConnect={(fromId, toId) => {
          setSource(connectNodes(source, fromId, toId))
          setSelected(null)
          setReveal(null)
        }}
        onSetShape={(nodeId, shape) => {
          setSource(setNodeShape(source, nodeId, shape))
          setSelected(null)
          setReveal(null)
        }}
        onAddNode={(fromId, shape) => {
          const added = addConnectedNode(source, fromId, shape)
          setSource(added.source)
          setSelected(null)
          setReveal(null)
          return added.nodeId
        }}
        onAddStandalone={(shape) => {
          const added = addStandaloneNode(source, shape)
          setSource(added.source)
          setSelected(null)
          setReveal(null)
          return added.nodeId
        }}
        onDelete={(target) => {
          setSource(
            target.kind === 'node'
              ? deleteNode(source, target.nodeId)
              : target.kind === 'edge'
                ? deleteEdge(source, target.index)
                : deleteEdgeLabel(source, target.index),
          )
          setSelected(null)
          setReveal(null)
        }}
      />
    </main>
  )
}
