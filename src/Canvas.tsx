import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { nodeIdFromElement } from './correlate'
import { edgeLabelCount, edgeLabelOf, labelOf, SHAPES, type Shape } from './edit'
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
// Padding, border and room for the caret, so the last character is never against the edge.
const INPUT_SLACK = 24

let measuringContext: CanvasRenderingContext2D | null | undefined

// The overlay has to be at least as wide as its own text. Sized to the element it covers, a
// label wider than its shape scrolls under the caret and hides its own beginning.
function textWidth(text: string, fontSize: number): number {
  measuringContext ??= document.createElement('canvas').getContext('2d')
  if (measuringContext == null) return text.length * fontSize * 0.6
  measuringContext.font = `${fontSize}px system-ui, sans-serif`
  return measuringContext.measureText(text).width
}

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
  onSetShape: (nodeId: string, shape: Shape) => void
  onAddNode: (fromId: string, shape: Shape) => string
  onAddStandalone: (shape: Shape) => string
}

export default function Canvas({
  source,
  selected,
  onSelect,
  onRename,
  onRenameEdge,
  onConnect,
  onSetShape,
  onAddNode,
  onAddStandalone,
}: CanvasProps) {
  const [tool, setTool] = useState<Tool>('select')
  const [shape, setShape] = useState<Shape>(SHAPES[0] as Shape)
  // A node added by dragging out does not exist in the DOM until the next render, so the
  // rename it should open with is deferred until the SVG that contains it arrives.
  const pendingRename = useRef<string | null>(null)
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

  const openEditorOn = (element: Element, target: EditTarget, label: string) => {
    if (frame.current === null) return
    const bounds = element.getBoundingClientRect()
    const frameBounds = frame.current.getBoundingClientRect()
    setEditing({
      target,
      value: label,
      original: label,
      left: bounds.left - frameBounds.left,
      top: bounds.top - frameBounds.top,
      width: bounds.width,
      height: bounds.height,
    })
  }

  // With a node selected the shape buttons restyle it; with nothing selected they arm the
  // shape tool, and a node of that shape is created by dragging out from an existing one.
  const pickShape = (picked: Shape) => {
    if (selected !== null) {
      onSetShape(selected, picked)
      return
    }
    setShape(picked)
    setTool('shape')
  }
  const latestPickShape = useRef(pickShape)
  latestPickShape.current = pickShape

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

          const pending = pendingRename.current
          if (pending !== null) {
            pendingRename.current = null
            const added = [...diagram.current.querySelectorAll('g.node')].find(
              (node) => nodeIdFromElement(node) === pending,
            )
            if (added !== undefined) openEditorOn(added, { kind: 'node', nodeId: pending }, '')
          }
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

  // Only the connecting tools ring nodes, so leaving them must clear any ring left behind.
  useEffect(() => {
    if (tool !== 'arrow' && tool !== 'shape') setHovered(null)
  }, [tool])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '1' || event.key === 'v' || event.key === 'Escape') setTool('select')
      if (event.key === 'h') setTool('hand')
      if (event.key === '2' || event.key === 'a') setTool('arrow')

      const shapeIndex = ['3', '4', '5', '6'].indexOf(event.key)
      const picked = shapeIndex === -1 ? undefined : SHAPES[shapeIndex]
      if (picked !== undefined) latestPickShape.current(picked)
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

        if (tool === 'arrow' || tool === 'shape') {
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

        if (tool === 'arrow' || tool === 'shape') {
          setHovered(nodeAt(event.clientX, event.clientY)?.id ?? null)
        }
        panZoom.move(event)
      }}
      onPointerUp={(event) => {
        if (connecting !== null) {
          const hit = nodeAt(event.clientX, event.clientY)
          setConnecting(null)
          setHovered(null)
          panEndedHere.current = true

          if (tool === 'shape') {
            // Empty space is where a new node goes; releasing on a node is the arrow tool's
            // gesture, not this one.
            if (hit === null) {
              pendingRename.current = onAddNode(connecting.fromId, shape)
              setTool('select')
            }
            return
          }

          // Dropping on empty space, or back on the start, cancels. Requiring two different
          // nodes means a stray click cannot silently add a self-loop.
          if (hit !== null && hit.id !== connecting.fromId) {
            onConnect(connecting.fromId, hit.id)
            setTool('select')
          }
          return
        }

        panEndedHere.current = panZoom.end(event)
      }}
      // Selection rides on click rather than pointerup: pointer capture retargets pointer
      // events at this element, but click still reports what is actually under the cursor.
      onClick={(event) => {
        if (panEndedHere.current) {
          panEndedHere.current = false
          return
        }

        if (tool === 'shape') {
          // Blank canvas is the only place a standalone node can be asked for; a click on a
          // node belongs to the drag-out gesture, which pointerup already handled.
          const onNode = (event.target as Element).closest('g.node')
          if (onNode === null) {
            pendingRename.current = onAddStandalone(shape)
            setTool('select')
          }
          return
        }

        if (tool !== 'select') return

        // Dragging is the only other thing a click could have meant, so there is no reason to
        // make renaming wait for a second one.
        const found = editTargetFor(event.target as Element, source, diagram.current)
        if (found === null) {
          onSelect(null)
          return
        }

        // Clicking an edge label is still a move away from whatever node was selected, so the
        // selection has to follow the click rather than linger on the previous node.
        onSelect(found.target.kind === 'node' ? found.target.nodeId : null)
        openEditorOn(found.element, found.target, found.label)
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
        shape={shape}
        onPickShape={pickShape}
        hasSelection={selected !== null}
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
          style={(() => {
            const fontSize = LABEL_FONT_SIZE * view.scale
            const width = Math.max(editing.width, textWidth(editing.value, fontSize) + INPUT_SLACK)
            return {
              // Grows from the centre, so the overlay stays over what it is editing.
              left: editing.left - (width - editing.width) / 2,
              top: editing.top,
              width,
              height: editing.height,
              fontSize: `${fontSize}px`,
            }
          })()}
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          // Clicking inside the box must not reach the canvas, which would read it as a click
          // on whatever sits behind and immediately reopen the editor.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
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
