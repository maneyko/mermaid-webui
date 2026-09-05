import { useEffect, useRef, useState } from 'react'
import CodePane, { type Range } from './CodePane'
import Canvas, { type EditTarget } from './Canvas'
import { findEdgeLabels, findEdges, findNodes } from './correlate'
import {
  filesSupported,
  pickToOpen,
  pickToSave,
  readAutosave,
  writeAutosave,
  writeFile,
} from './storage'
import {
  addConnectedNode,
  addStandaloneNode,
  connectNodes,
  deleteEdge,
  deleteEdgeLabel,
  deleteNode,
  renameEdgeLabel,
  renameLabel,
  setNodeColor,
  setNodeShape,
} from './edit'

const INITIAL_SOURCE = `flowchart TD
  A[Christmas] -->|Get money| B(Go shopping)
  B --> C{Let me think}
  C -->|One| D[Laptop]
  C -->|Two| E[iPhone]
  C -->|Three| F[Car]
`

const BLANK_SOURCE = 'flowchart TD\n'

export default function App() {
  // The sample is only ever the first-run document; after that the autosave is what you left.
  const [source, setSource] = useState(() => readAutosave() ?? INITIAL_SOURCE)
  const [selected, setSelected] = useState<EditTarget | null>(null)
  const [reveal, setReveal] = useState<Range | null>(null)
  const [file, setFile] = useState<FileSystemFileHandle | null>(null)
  const [savedSource, setSavedSource] = useState<string | null>(null)

  useEffect(() => {
    writeAutosave(source)
  }, [source])

  const openFile = async () => {
    const opened = await pickToOpen()
    if (opened === null) return
    setFile(opened.handle)
    setSavedSource(opened.text)
    setSource(opened.text)
    setSelected(null)
    setReveal(null)
  }

  // A failed write leaves savedSource alone, so the unsaved marker stays up rather than the
  // save silently appearing to have worked.
  const saveFile = async () => {
    const handle = file ?? (await pickToSave('diagram.mmd'))
    if (handle === null) return
    await writeFile(handle, source)
    setFile(handle)
    setSavedSource(source)
  }

  // No confirmation, because this goes through the editor like any other rewrite and cmd+Z
  // brings the old document straight back.
  const newFile = () => {
    setFile(null)
    setSavedSource(null)
    setSource(BLANK_SOURCE)
    setSelected(null)
    setReveal(null)
  }

  const latestFileActions = useRef({ openFile, saveFile })
  latestFileActions.current = { openFile, saveFile }

  useEffect(() => {
    if (!filesSupported) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key !== 's' && key !== 'o') return
      // Otherwise this is the browser's own Save Page and Open File.
      event.preventDefault()
      const { openFile: open, saveFile: save } = latestFileActions.current
      void (key === 's' ? save() : open())
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // A node reveals its whole declaration, an edge label the text between its pipes, and an
  // edge the pair of nodes it joins -- which for `A --> B --> C` is the half you clicked.
  // Takes the text to measure against rather than closing over it, because recolouring keeps
  // the selection and has to recompute the span against the rewritten source.
  const spanOf = (target: EditTarget, text: string): Range | null => {
    if (target.kind === 'edgeLabel') return findEdgeLabels(text)[target.index] ?? null
    if (target.kind === 'edge') {
      const edge = findEdges(text)[target.index]
      return edge === undefined ? null : { from: edge.from, to: edge.to }
    }
    const node = findNodes(text).get(target.nodeId)
    return node === undefined ? null : { from: node.from, to: node.to }
  }

  const select = (target: EditTarget | null) => {
    setSelected(target)
    setReveal(target === null ? null : spanOf(target, source))
  }

  // Every rewrite moves the spans after it, so the selection goes with the text it pointed
  // at. Colour is the one exception, and says so where it breaks the rule.
  const rewrite = (next: string) => {
    setSource(next)
    setSelected(null)
    setReveal(null)
  }

  return (
    <main className="app">
      <CodePane
        source={source}
        reveal={reveal}
        onChange={rewrite}
      />
      <Canvas
        source={source}
        selected={selected}
        file={{
          name: file?.name ?? 'Untitled',
          // Only meaningful against a file: with no file, nothing is saved by definition.
          dirty: file !== null && source !== savedSource,
          supported: filesSupported,
          onNew: newFile,
          onOpen: () => void openFile(),
          onSave: () => void saveFile(),
        }}
        onSelect={select}
        onRename={(nodeId, label) => rewrite(renameLabel(source, nodeId, label))}
        onRenameEdge={(index, label) => rewrite(renameEdgeLabel(source, index, label))}
        onConnect={(fromId, toId) => rewrite(connectNodes(source, fromId, toId))}
        onSetShape={(nodeId, shape) => rewrite(setNodeShape(source, nodeId, shape))}
        // The one edit that keeps its selection: trying a colour and then another is the
        // whole gesture, so the span is recomputed against the new text instead of dropped.
        onSetColor={(nodeId, color) => {
          const next = setNodeColor(source, nodeId, color)
          setSource(next)
          setReveal(spanOf({ kind: 'node', nodeId }, next))
        }}
        onAddNode={(fromId, shape) => {
          const added = addConnectedNode(source, fromId, shape)
          rewrite(added.source)
          return added.nodeId
        }}
        onAddStandalone={(shape) => {
          const added = addStandaloneNode(source, shape)
          rewrite(added.source)
          return added.nodeId
        }}
        onDelete={(target) => {
          if (target.kind === 'node') rewrite(deleteNode(source, target.nodeId))
          else if (target.kind === 'edge') rewrite(deleteEdge(source, target.index))
          else rewrite(deleteEdgeLabel(source, target.index))
        }}
      />
    </main>
  )
}
