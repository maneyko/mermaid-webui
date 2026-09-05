import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { nodeIdFromElement } from './correlate'
import {
  colorOf,
  edgeCount,
  edgeLabelCount,
  edgeLabelOf,
  labelOf,
  QUICK_SHAPES,
  shapeOf,
  type NodeColor,
  type Shape,
} from './edit'
import { usePanZoom } from './usePanZoom'
import RenameOverlay, { type Anchor } from './RenameOverlay'
import Toolbar, { type FileControls, type Tool } from './Toolbar'
import { ShapeIcon } from './ShapeMenu'

// useMaxWidth would make mermaid size the SVG to its container, which fights a viewport that
// does its own scaling. Fixed natural dimensions leave zoom entirely to our transform.
mermaid.initialize({
  startOnLoad: false,
  suppressErrorRendering: true,
  flowchart: { useMaxWidth: false },
})

const GRID_SPACING = 20

// mermaid renders into a DOM id it expects to be unused, and a slow render can still be in
// flight when the next keystroke starts another one.
let renderCount = 0

// An unlabelled edge still emits a `g.edgeLabel`, but an empty one has nothing to point at,
// so the clickable labels are the non-empty ones.
function renderedEdgeLabels(container: HTMLDivElement | null): Element[] {
  return [...(container?.querySelectorAll('g.edgeLabels > g.edgeLabel') ?? [])].filter(
    (label) => label.textContent?.trim() !== '',
  )
}

function renderedEdges(container: HTMLDivElement | null): Element[] {
  return [...(container?.querySelectorAll('g.edgePaths > path.flowchart-link') ?? [])]
}

// A rendered edge is a 1px stroke, which nobody can be asked to click. Each one gets a wide
// transparent twin behind it to be the hit target, rebuilt with the SVG on every render.
function addEdgeHandles(container: HTMLDivElement) {
  for (const edge of renderedEdges(container)) {
    const handle = edge.cloneNode() as SVGPathElement
    handle.setAttribute('class', 'edge-handle')
    handle.removeAttribute('id')
    handle.removeAttribute('marker-end')
    handle.removeAttribute('marker-start')
    edge.parentNode?.insertBefore(handle, edge)
  }
}

function mark(container: HTMLDivElement | null, className: string, target: EditTarget | null) {
  if (container === null) return

  for (const node of container.querySelectorAll('g.node')) {
    const mine = target?.kind === 'node' && nodeIdFromElement(node) === target.nodeId
    node.classList.toggle(className, mine)
  }

  renderedEdgeLabels(container).forEach((label, index) => {
    label.classList.toggle(className, target?.kind === 'edgeLabel' && target.index === index)
  })

  renderedEdges(container).forEach((edge, index) => {
    edge.classList.toggle(className, target?.kind === 'edge' && target.index === index)
  })
}

// Rendered edge labels carry no id, so the only key is position: the k-th non-empty label on
// screen is the k-th `|...|` in the source. That holds only while both sequences are the same
// length, so a mismatch -- syntax the scanner does not understand -- declines the edit rather
// than renaming some other edge.
function edgeLabelIndex(element: Element, source: string, container: HTMLDivElement | null) {
  const rendered = renderedEdgeLabels(container)
  if (rendered.length !== edgeLabelCount(source)) return null
  const index = rendered.indexOf(element)
  return index === -1 ? null : index
}

// Edges are addressed the same way and for the same reason: `data-id` counts entities rather
// than pairs, so position is the only key. A count the scanner disagrees with means syntax it
// does not model -- the `&` list form -- and the edit is declined rather than aimed at random.
function edgeIndex(handle: Element, source: string, container: HTMLDivElement | null) {
  const handles = [...(container?.querySelectorAll('path.edge-handle') ?? [])]
  if (handles.length !== edgeCount(source)) return null
  const index = handles.indexOf(handle)
  return index === -1 ? null : index
}

// Hover runs on every pointer move, so an unchanged target has to compare equal or React
// re-renders the canvas continuously.
function sameTarget(a: EditTarget | null, b: EditTarget | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind === 'node') return b.kind === 'node' && a.nodeId === b.nodeId
  if (b.kind === 'node') return false
  return a.kind === b.kind && a.index === b.index
}

// Shortcuts must not fire while the user is typing in the editor or the rename overlay.
function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, [contenteditable="true"]') !== null
}

// `edge` is the connection itself and `edgeLabel` the text riding on it -- two separate
// things to click, and the vocabulary rule above says which word means which.
export type EditTarget =
  | { kind: 'node'; nodeId: string }
  | { kind: 'edge'; index: number }
  | { kind: 'edgeLabel'; index: number }

// An edge carries no label of its own to rename. Everything selectable can be deleted.
export type Renameable = Exclude<EditTarget, { kind: 'edge' }>

interface Editing {
  target: Renameable
  label: string
  anchor: Anchor
}

// Remounts the overlay when the rename moves to something else, so it cannot carry the
// previous label across.
function targetKey(target: Renameable): string {
  return target.kind === 'node' ? `node:${target.nodeId}` : `label:${target.index}`
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

// The shape a click would add, carried on the cursor. `from` is the node it would hang off, or
// null when it would land on its own, and that is the whole reason to draw it: the release
// point contributes nothing to where dagre puts the node, so the only honest thing to preview
// is what it will be attached to.
interface Ghost {
  at: Point
  from: Point | null
}

// Roughly a node's size at 100%, scaled with the viewport so it reads against the diagram.
const GHOST_SIZE = 60

// How far below a node the ghost sits when it would hang off it. Below rather than under the
// cursor because a line drawn between two things in the same place says nothing, and below
// rather than beside because that is what "descendant" looks like in the default direction.
const GHOST_GAP = 26

interface CanvasProps {
  source: string
  selected: EditTarget | null
  file: FileControls
  onSelect: (target: EditTarget | null) => void
  onRename: (nodeId: string, label: string) => void
  onRenameEdge: (index: number, label: string) => void
  onConnect: (fromId: string, toId: string) => void
  onSetShape: (nodeId: string, shape: Shape) => void
  onSetColor: (nodeId: string, color: NodeColor | null) => void
  onAddNode: (fromId: string, shape: Shape) => string
  onAddStandalone: (shape: Shape) => string
  onDelete: (target: EditTarget) => void
}

export default function Canvas({
  source,
  selected,
  file,
  onSelect,
  onRename,
  onRenameEdge,
  onConnect,
  onSetShape,
  onSetColor,
  onAddNode,
  onAddStandalone,
  onDelete,
}: CanvasProps) {
  const [tool, setTool] = useState<Tool>('select')
  const [shape, setShape] = useState<Shape>(QUICK_SHAPES[0] as Shape)
  // A new node does not exist in the DOM until the next render, so what the canvas owes it --
  // the rename box, and the pulse that says where the layout put it -- waits for the SVG that
  // contains it.
  const landed = useRef<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [hovered, setHovered] = useState<EditTarget | null>(null)
  const [connecting, setConnecting] = useState<Connecting | null>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [error, setError] = useState<string | null>(null)
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

  // Everything the select tool acts on: a node, an edge label, or an edge. Checked in that
  // order, which is also how they are stacked, so the topmost thing under the cursor wins.
  const targetAt = (clientX: number, clientY: number) => {
    const hit = document.elementFromPoint(clientX, clientY)
    if (hit == null) return null

    const node = hit.closest('g.node')
    if (node !== null) {
      const nodeId = nodeIdFromElement(node)
      return nodeId === null ? null : { element: node, target: { kind: 'node', nodeId } as EditTarget }
    }

    const label = hit.closest('g.edgeLabel')
    if (label !== null) {
      const index = edgeLabelIndex(label, source, diagram.current)
      return index === null
        ? null
        : { element: label, target: { kind: 'edgeLabel', index } as EditTarget }
    }

    const handle = hit.closest('path.edge-handle')
    if (handle === null) return null
    const index = edgeIndex(handle, source, diagram.current)
    return index === null ? null : { element: handle, target: { kind: 'edge', index } as EditTarget }
  }

  // An edge has nothing of its own to rename, so a double-click on one does nothing.
  const renameable = (target: EditTarget): Renameable | null =>
    target.kind === 'edge' ? null : target

  const labelFor = (target: Renameable) =>
    target.kind === 'node' ? labelOf(source, target.nodeId) : edgeLabelOf(source, target.index)

  const hover = (next: EditTarget | null) =>
    setHovered((current) => (sameTarget(current, next) ? current : next))

  const nodeTarget = (hit: { id: string } | null): EditTarget | null =>
    hit === null ? null : { kind: 'node', nodeId: hit.id }

  // The shape buttons and delete act on a node; an edge label is selectable but is not one.
  const selectedNode = selected?.kind === 'node' ? selected.nodeId : null

  const centreOf = (element: Element): Point => {
    const bounds = element.getBoundingClientRect()
    return toFrame(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
  }

  const belowOf = (element: Element): Point => {
    const bounds = element.getBoundingClientRect()
    return toFrame(bounds.left + bounds.width / 2, bounds.bottom + GHOST_GAP * view.scale)
  }

  const openEditorOn = (element: Element, target: Renameable, label: string) => {
    if (frame.current === null) return
    const bounds = element.getBoundingClientRect()
    const frameBounds = frame.current.getBoundingClientRect()
    setEditing({
      target,
      label,
      anchor: {
        left: bounds.left - frameBounds.left,
        top: bounds.top - frameBounds.top,
        width: bounds.width,
        height: bounds.height,
      },
    })
  }

  // With a node selected the shape buttons restyle it; with nothing selected they arm the
  // shape tool, and a node of that shape is created by dragging out from an existing one.
  const pickShape = (picked: Shape) => {
    if (selectedNode !== null) {
      onSetShape(selectedNode, picked)
      return
    }
    setShape(picked)
    setTool('shape')
  }
  const latestPickShape = useRef(pickShape)
  latestPickShape.current = pickShape
  const latestDelete = useRef(onDelete)
  latestDelete.current = onDelete

  useEffect(() => {
    let stale = false

    const timer = setTimeout(async () => {
      try {
        const { svg } = await mermaid.render(`mermaid-${++renderCount}`, source)
        if (stale) return
        if (diagram.current !== null) {
          diagram.current.innerHTML = svg
          addEdgeHandles(diagram.current)
          mark(diagram.current, 'selected', latestSelected.current)
          mark(diagram.current, 'connect-target', latestHovered.current)

          const created = landed.current
          if (created !== null) {
            landed.current = null
            const added = [...diagram.current.querySelectorAll('g.node')].find(
              (node) => nodeIdFromElement(node) === created,
            )
            if (added !== undefined) {
              // Adding a node reflows the whole diagram, so every node on screen has just
              // moved. The pulse is what says which of them is the new one.
              added.classList.add('landed')
              openEditorOn(added, { kind: 'node', nodeId: created }, '')
            }
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
    mark(diagram.current, 'selected', selected)
  }, [selected])

  useEffect(() => {
    mark(diagram.current, 'connect-target', hovered)
  }, [hovered])

  // The hand tool acts on the canvas rather than on any node, so it rings nothing.
  useEffect(() => {
    if (tool === 'hand') setHovered(null)
    if (tool !== 'shape') setGhost(null)
  }, [tool])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '1' || event.key === 'v' || event.key === 'Escape') setTool('select')
      if (event.key === 'h') setTool('hand')
      if (event.key === '2' || event.key === 'a') setTool('arrow')

      const current = latestSelected.current
      if ((event.key === 'Backspace' || event.key === 'Delete') && current !== null) {
        event.preventDefault()
        latestDelete.current(current)
      }

      const shapeIndex = ['3', '4', '5', '6'].indexOf(event.key)
      const picked = shapeIndex === -1 ? undefined : QUICK_SHAPES[shapeIndex]
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

  // The dashed line, whether it is following a real drag or only showing what a hover would
  // attach to. Both mean the same thing, so they are one drawing.
  const band =
    connecting !== null
      ? { from: connecting.from, to: connecting.to }
      : ghost !== null && ghost.from !== null
        ? { from: ghost.from, to: ghost.at }
        : null

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
          const to = toFrame(event.clientX, event.clientY)
          setConnecting({ ...connecting, to })

          // The new node hangs off where the drag started whatever is under the cursor, so the
          // ring stays on the source rather than following onto nodes with no part in it.
          if (tool === 'shape') {
            setGhost({ at: to, from: connecting.from })
            hover({ kind: 'node', nodeId: connecting.fromId })
            return
          }

          const hit = nodeAt(event.clientX, event.clientY)
          hover(hit === null || hit.id === connecting.fromId ? null : nodeTarget(hit))
          return
        }

        // Hovering rings whatever a click or a drag would act on. Only select acts on edge
        // labels; the arrow and shape tools drag out from a node, so they ring nodes alone.
        if (tool === 'select') {
          hover(targetAt(event.clientX, event.clientY)?.target ?? null)
        } else if (tool !== 'hand') {
          const hit = nodeAt(event.clientX, event.clientY)
          hover(nodeTarget(hit))
          // Over a node the ghost snaps below it, joined by the band, so what is on screen is
          // the attachment rather than a position nothing can promise. Over empty canvas it
          // follows the cursor with no band, which is what standalone looks like.
          if (tool === 'shape') {
            setGhost(
              hit === null
                ? { at: toFrame(event.clientX, event.clientY), from: null }
                : { at: belowOf(hit.element), from: centreOf(hit.element) },
            )
          }
        }
        panZoom.move(event)
      }}
      onPointerLeave={() => setGhost(null)}
      onPointerUp={(event) => {
        if (connecting !== null) {
          setConnecting(null)
          setHovered(null)
          // A cancelled drag would otherwise leave the band hanging off its source node until
          // the pointer moved again.
          setGhost(null)
          panEndedHere.current = true

          // Where the release lands says nothing -- it never reaches the source -- so the whole
          // gesture is "which node does this hang off", and it can end anywhere, including on
          // the node it began on. That last case is a plain click, with no travel at all.
          if (tool === 'shape') {
            landed.current = onAddNode(connecting.fromId, shape)
            setTool('select')
            return
          }

          // Dropping on empty space, or back on the start, cancels. Requiring two different
          // nodes means a stray click cannot silently add a self-loop.
          const hit = nodeAt(event.clientX, event.clientY)
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

        // Hit-test by coordinate, never by event target. Panning captures the pointer on
        // every press, and capture retargets the compatibility mouse events too, so
        // `event.target` here is this section rather than whatever was clicked.
        const under = document.elementFromPoint(event.clientX, event.clientY)
        if (under == null) return

        if (tool === 'shape') {
          // Blank canvas is the only place a standalone node can be asked for; a click on a
          // node belongs to the drag-out gesture, which pointerup already handled.
          if (under.closest('g.node') === null) {
            landed.current = onAddStandalone(shape)
            setTool('select')
          }
          return
        }

        if (tool !== 'select') return

        // A click selects and only selects. Renaming needs a gesture of its own now that
        // selection is what delete acts on -- a click that opened an input made the Delete
        // key unreachable, because the input swallowed it.
        onSelect(targetAt(event.clientX, event.clientY)?.target ?? null)
      }}
      // dblclick retargets to the common ancestor of its two clicks, which for a mermaid node
      // is the canvas, so this hit-tests coordinates like everything else here.
      onDoubleClick={(event) => {
        if (tool !== 'select') return
        const found = targetAt(event.clientX, event.clientY)
        if (found === null) return
        const target = renameable(found.target)
        if (target === null) return
        openEditorOn(found.element, target, labelFor(target))
      }}
    >
      <div
        className="viewport"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <div className="diagram" ref={diagram} />
      </div>

      {band !== null && (
        <svg className="rubber-band">
          <line x1={band.from.x} y1={band.from.y} x2={band.to.x} y2={band.to.y} />
        </svg>
      )}

      {tool === 'shape' && ghost !== null && (
        <div className="shape-ghost" style={{ left: ghost.at.x, top: ghost.at.y }}>
          <ShapeIcon shape={shape} size={GHOST_SIZE * view.scale} />
        </div>
      )}

      <Toolbar
        tool={tool}
        file={file}
        onToolChange={setTool}
        shape={shape}
        nodeShape={selectedNode === null ? null : shapeOf(source, selectedNode)}
        onPickShape={pickShape}
        hasNodeSelection={selectedNode !== null}
        color={selectedNode === null ? null : colorOf(source, selectedNode)}
        onPickColor={(picked) => {
          if (selectedNode !== null) onSetColor(selectedNode, picked)
        }}
        canDelete={selected !== null}
        onDelete={() => {
          if (selected !== null) onDelete(selected)
        }}
        scale={view.scale}
        onZoomIn={panZoom.zoomIn}
        onZoomOut={panZoom.zoomOut}
        onFit={fit}
        onReset={panZoom.reset}
      />

      {editing !== null && (
        <RenameOverlay
          key={targetKey(editing.target)}
          label={editing.label}
          anchor={editing.anchor}
          scale={view.scale}
          onClose={() => setEditing(null)}
          onCommit={(next) => {
            if (editing.target.kind === 'node') onRename(editing.target.nodeId, next)
            else onRenameEdge(editing.target.index, next)
          }}
        />
      )}

      {error !== null && <pre className="error">{error}</pre>}
    </section>
  )
}
