import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { nodeIdFromElement } from './correlate'
import { edgeLabelCount, edgeLabelOf, labelOf } from './edit'
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

function markNodes(container: HTMLDivElement | null, className: string, nodeId: string | null) {
  if (container === null) return
  for (const node of container.querySelectorAll('g.node')) {
    node.classList.toggle(className, nodeIdFromElement(node) === nodeId)
  }
}

// Rendered edge labels carry no id, so the only key is position: the k-th non-empty label on
// screen is the k-th `|...|` in the source. That holds only while both sequences are the same
// length, so a mismatch -- syntax the scanner does not understand -- declines the edit rather
// than renaming some other edge.
function edgeLabelIndex(element: Element, source: string, container: HTMLDivElement | null) {
  const rendered = [...(container?.querySelectorAll('g.edgeLabels > g.edgeLabel') ?? [])].filter(
    (label) => label.textContent?.trim() !== '',
  )
  if (rendered.length !== edgeLabelCount(source)) return null
  const index = rendered.indexOf(element)
  return index === -1 ? null : index
}

function editTargetFor(hit: Element, source: string, container: HTMLDivElement | null) {
  const node = hit.closest('g.node')
  if (node !== null) {
    const nodeId = nodeIdFromElement(node)
    if (nodeId === null) return null
    return { element: node, target: { kind: 'node', nodeId } as const, label: labelOf(source, nodeId) }
  }

  const edgeLabel = hit.closest('g.edgeLabel')
  if (edgeLabel === null) return null
  const index = edgeLabelIndex(edgeLabel, source, container)
  if (index === null) return null
  return {
    element: edgeLabel,
    target: { kind: 'edge', index } as const,
    label: edgeLabelOf(source, index),
  }
}

// Shortcuts must not fire while the user is typing in the editor or the rename overlay.
function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, [contenteditable="true"]') !== null
}

type EditTarget = { kind: 'node'; nodeId: string } | { kind: 'edge'; index: number }

interface Editing {
  target: EditTarget
  value: string
  original: string
  left: number
  top: number
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

interface Connecting {
  fromId: string
  from: Point
  to: Point
}

interface CanvasProps {
  source: string
  selected: string | null
  onSelect: (nodeId: string | null) => void
  onRename: (nodeId: string, label: string) => void
  onRenameEdge: (index: number, label: string) => void
  onConnect: (fromId: string, toId: string) => void
}

export default function Canvas({
  source,
  selected,
  onSelect,
  onRename,
  onRenameEdge,
  onConnect,
}: CanvasProps) {
  const [tool, setTool] = useState<Tool>('select')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<Connecting | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abandoned = useRef(false)
  const frame = useRef<HTMLDivElement>(null)
  const diagram = useRef<HTMLDivElement>(null)
  // A pan or a connect drag ends with a click event we do not want to act on.
  const panEndedHere = useRef(false)

  const panZoom = usePanZoom(frame)
  const { view } = panZoom

  // Re-rendering replaces the whole SVG, so the marks have to be reapplied afterwards. Read
  // through refs to keep the render effect keyed on `source` alone.
  const latestSelected = useRef(selected)
  latestSelected.current = selected
  const latestHovered = useRef(hovered)
  latestHovered.current = hovered

  // Frame-relative coordinates, which is what the rubber band overlay is positioned in.
  const toFrame = (clientX: number, clientY: number): Point => {
    const bounds = frame.current?.getBoundingClientRect()
    return { x: clientX - (bounds?.left ?? 0), y: clientY - (bounds?.top ?? 0) }
  }

  // Hit-testing by coordinate rather than event target, because pointer capture during a
  // connect drag retargets every pointer event at the canvas.
  const nodeAt = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY)?.closest('g.node')
    if (element == null) return null
    const id = nodeIdFromElement(element)
    return id === null ? null : { element, id }
  }

  const centreOf = (element: Element): Point => {
    const bounds = element.getBoundingClientRect()
    return toFrame(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
  }

  useEffect(() => {
    let stale = false

    const timer = setTimeout(async () => {
      try {
        const { svg } = await mermaid.render(`mermaid-${++renderCount}`, source)
        if (stale) return
        if (diagram.current !== null) {
          diagram.current.innerHTML = svg
          markNodes(diagram.current, 'selected', latestSelected.current)
          markNodes(diagram.current, 'connect-target', latestHovered.current)
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
    markNodes(diagram.current, 'selected', selected)
  }, [selected])

  useEffect(() => {
    markNodes(diagram.current, 'connect-target', hovered)
  }, [hovered])

  // Only the arrow tool rings nodes, so leaving it must clear any ring left behind.
  useEffect(() => {
    if (tool !== 'arrow') setHovered(null)
  }, [tool])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '1' || event.key === 'v' || event.key === 'Escape') setTool('select')
      if (event.key === 'h') setTool('hand')
      if (event.key === '2' || event.key === 'a') setTool('arrow')
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

        if (tool === 'arrow') {
          const hit = nodeAt(event.clientX, event.clientY)
          if (hit !== null) {
            event.currentTarget.setPointerCapture(event.pointerId)
            const from = centreOf(hit.element)
            setConnecting({ fromId: hit.id, from, to: from })
            return
          }
        }

        panZoom.begin(event)
      }}
      onPointerMove={(event) => {
        if (connecting !== null) {
          setConnecting({ ...connecting, to: toFrame(event.clientX, event.clientY) })
          const hit = nodeAt(event.clientX, event.clientY)
          setHovered(hit === null || hit.id === connecting.fromId ? null : hit.id)
          return
        }

        if (tool === 'arrow') setHovered(nodeAt(event.clientX, event.clientY)?.id ?? null)
        panZoom.move(event)
      }}
      onPointerUp={(event) => {
        if (connecting !== null) {
          const hit = nodeAt(event.clientX, event.clientY)
          setConnecting(null)
          setHovered(null)
          // Dropping on empty space, or back on the start, cancels. Requiring two different
          // nodes means a stray click cannot silently add a self-loop.
          if (hit !== null && hit.id !== connecting.fromId) {
            onConnect(connecting.fromId, hit.id)
            setTool('select')
          }
          panEndedHere.current = true
          return
        }

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
        if (tool !== 'select' || frame.current === null) return
        const hit = document.elementFromPoint(event.clientX, event.clientY)
        if (hit == null) return

        const found = editTargetFor(hit, source, diagram.current)
        if (found === null) return

        // getBoundingClientRect already accounts for the viewport transform, so the overlay
        // lands on what it replaces at any pan or zoom.
        const bounds = found.element.getBoundingClientRect()
        const frameBounds = frame.current.getBoundingClientRect()

        setEditing({
          target: found.target,
          value: found.label,
          original: found.label,
          left: bounds.left - frameBounds.left,
          top: bounds.top - frameBounds.top,
          width: bounds.width,
          height: bounds.height,
        })
      }}
    >
      <div
        className="viewport"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <div className="diagram" ref={diagram} />
      </div>

      {connecting !== null && (
        <svg className="rubber-band">
          <line
            x1={connecting.from.x}
            y1={connecting.from.y}
            x2={connecting.to.x}
            y2={connecting.to.y}
          />
        </svg>
      )}

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
            if (cancelled || editing.value === editing.original) return
            if (editing.target.kind === 'node') onRename(editing.target.nodeId, editing.value)
            else onRenameEdge(editing.target.index, editing.value)
          }}
        />
      )}

      {error !== null && <pre className="error">{error}</pre>}
    </section>
  )
}
