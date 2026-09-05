import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { nodeIdFromElement } from './correlate'
import { labelOf } from './edit'
import { usePanZoom } from './usePanZoom'
import Toolbar, { type Tool } from './Toolbar'

// useMaxWidth would make mermaid size the SVG to its container, which fights a viewport that
// does its own scaling. Fixed natural dimensions leave zoom entirely to our transform.
mermaid.initialize({
  startOnLoad: false,
  suppressErrorRendering: true,
  flowchart: { useMaxWidth: false },
})

const GRID_SPACING = 20
// Matches mermaid's default node label size, so the overlay sits at the size of the text
// it replaces.
const LABEL_FONT_SIZE = 16

// mermaid renders into a DOM id it expects to be unused, and a slow render can still be in
// flight when the next keystroke starts another one.
let renderCount = 0

function markSelected(container: HTMLDivElement | null, nodeId: string | null): void {
  if (container === null) return
  for (const node of container.querySelectorAll('g.node')) {
    node.classList.toggle('selected', nodeIdFromElement(node) === nodeId)
  }
}

// Shortcuts must not fire while the user is typing in the editor or the rename overlay.
function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, [contenteditable="true"]') !== null
}

interface Editing {
  nodeId: string
  value: string
  original: string
  left: number
  top: number
  width: number
  height: number
}

interface CanvasProps {
  source: string
  selected: string | null
  onSelect: (nodeId: string | null) => void
  onRename: (nodeId: string, label: string) => void
}

export default function Canvas({ source, selected, onSelect, onRename }: CanvasProps) {
  const [tool, setTool] = useState<Tool>('select')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abandoned = useRef(false)
  const frame = useRef<HTMLDivElement>(null)
  const diagram = useRef<HTMLDivElement>(null)
  // A pan ends with a click event we do not want to treat as a selection.
  const panEndedHere = useRef(false)

  const panZoom = usePanZoom(frame)
  const { view } = panZoom

  // Re-rendering replaces the whole SVG, so the selection has to be reapplied afterwards.
  // Read through a ref to keep the render effect keyed on `source` alone.
  const latestSelected = useRef(selected)
  latestSelected.current = selected

  useEffect(() => {
    let stale = false

    const timer = setTimeout(async () => {
      try {
        const { svg } = await mermaid.render(`mermaid-${++renderCount}`, source)
        if (stale) return
        if (diagram.current !== null) {
          diagram.current.innerHTML = svg
          markSelected(diagram.current, latestSelected.current)
        }
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

  useEffect(() => {
    markSelected(diagram.current, selected)
  }, [selected])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '1' || event.key === 'v' || event.key === 'Escape') setTool('select')
      if (event.key === 'h') setTool('hand')
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const fit = () => {
    const svg = diagram.current?.querySelector('svg')
    if (svg == null) return
    panZoom.fitTo(svg.width.baseVal.value, svg.height.baseVal.value)
  }

  const classes = ['canvas', `tool-${tool}`]
  if (panZoom.panning) classes.push('panning')

  return (
    <section
      className={classes.join(' ')}
      ref={frame}
      style={{
        backgroundSize: `${GRID_SPACING * view.scale}px ${GRID_SPACING * view.scale}px`,
        backgroundPosition: `calc(50% + ${view.x}px) calc(50% + ${view.y}px)`,
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        panZoom.begin(event)
      }}
      onPointerMove={panZoom.move}
      onPointerUp={(event) => {
        panEndedHere.current = panZoom.end(event)
      }}
      // Selection rides on click rather than pointerup: pointer capture retargets pointer
      // events at this element, but click still reports the node actually under the cursor.
      onClick={(event) => {
        if (panEndedHere.current) {
          panEndedHere.current = false
          return
        }
        if (tool !== 'select') return
        const node = (event.target as Element).closest('g.node')
        onSelect(node === null ? null : nodeIdFromElement(node))
      }}
      // dblclick retargets to the common ancestor of the two clicks, which for a mermaid node
      // is the canvas itself. Hit-testing the coordinates instead gives the real node.
      onDoubleClick={(event) => {
        if (tool !== 'select') return
        const node = document.elementFromPoint(event.clientX, event.clientY)?.closest('g.node')
        if (node == null || frame.current === null) return
        const nodeId = nodeIdFromElement(node)
        if (nodeId === null) return

        // getBoundingClientRect already accounts for the viewport transform, so the overlay
        // lands on the node at any pan or zoom.
        const nodeBounds = node.getBoundingClientRect()
        const frameBounds = frame.current.getBoundingClientRect()
        const label = labelOf(source, nodeId)

        setEditing({
          nodeId,
          value: label,
          original: label,
          left: nodeBounds.left - frameBounds.left,
          top: nodeBounds.top - frameBounds.top,
          width: nodeBounds.width,
          height: nodeBounds.height,
        })
      }}
    >
      <div
        className="viewport"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <div className="diagram" ref={diagram} />
      </div>

      <Toolbar
        tool={tool}
        onToolChange={setTool}
        scale={view.scale}
        onZoomIn={panZoom.zoomIn}
        onZoomOut={panZoom.zoomOut}
        onFit={fit}
        onReset={panZoom.reset}
      />

      {editing !== null && (
        <input
          className="rename"
          autoFocus
          value={editing.value}
          style={{
            left: editing.left,
            top: editing.top,
            width: editing.width,
            height: editing.height,
            fontSize: `${LABEL_FONT_SIZE * view.scale}px`,
          }}
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          onPointerDown={(event) => event.stopPropagation()}
          // Enter and Escape both blur, so committing has exactly one path.
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              abandoned.current = true
              event.currentTarget.blur()
            }
          }}
          onBlur={() => {
            const cancelled = abandoned.current
            abandoned.current = false
            setEditing(null)
            if (!cancelled && editing.value !== editing.original) {
              onRename(editing.nodeId, editing.value)
            }
          }}
        />
      )}

      {error !== null && <pre className="error">{error}</pre>}
    </section>
  )
}
