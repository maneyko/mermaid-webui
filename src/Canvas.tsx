import { useCallback, useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { nodeIdFromElement } from './correlate'

// useMaxWidth would make mermaid size the SVG to its container, which fights a viewport that
// does its own scaling. Fixed natural dimensions leave zoom entirely to our transform.
mermaid.initialize({
  startOnLoad: false,
  suppressErrorRendering: true,
  flowchart: { useMaxWidth: false },
})

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const BUTTON_ZOOM_STEP = 1.2
// Chrome sends deltaY of roughly 120 per mouse-wheel notch, so this puts one notch at about
// 1.19x. Trackpads send many small deltas and come out smooth at the same divisor.
const WHEEL_ZOOM_DIVISOR = 700
const GRID_SPACING = 20
const FIT_PADDING = 48

interface Viewport {
  x: number
  y: number
  scale: number
}

const CENTERED: Viewport = { x: 0, y: 0, scale: 1 }

// mermaid renders into a DOM id it expects to be unused, and a slow render can still be in
// flight when the next keystroke starts another one.
let renderCount = 0

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

function markSelected(container: HTMLDivElement | null, nodeId: string | null): void {
  if (container === null) return
  for (const node of container.querySelectorAll('g.node')) {
    node.classList.toggle('selected', nodeIdFromElement(node) === nodeId)
  }
}

// Keeps the content under (pointerX, pointerY) pinned while the scale changes. Both are
// relative to the frame's centre, because that is the transform origin.
function zoomAbout(view: Viewport, pointerX: number, pointerY: number, factor: number): Viewport {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE)
  const ratio = scale / view.scale
  return {
    scale,
    x: pointerX - (pointerX - view.x) * ratio,
    y: pointerY - (pointerY - view.y) * ratio,
  }
}

// Below this many pixels of pointer travel, a drag counts as a click rather than a pan.
const CLICK_SLOP = 4

interface CanvasProps {
  source: string
  selected: string | null
  onSelect: (nodeId: string | null) => void
}

export default function Canvas({ source, selected, onSelect }: CanvasProps) {
  const [view, setView] = useState<Viewport>(CENTERED)
  const [panning, setPanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const diagram = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointerId: number
    x: number
    y: number
    from: Viewport
    moved: boolean
  } | null>(null)
  // A pan ends with a click event we do not want to treat as a selection.
  const panEndedHere = useRef(false)

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

  // React's onWheel is passive, so preventDefault there would be ignored and the page would
  // scroll instead of the diagram zooming.
  useEffect(() => {
    const element = frame.current
    if (element === null) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = element.getBoundingClientRect()
      setView((current) =>
        zoomAbout(
          current,
          event.clientX - bounds.left - bounds.width / 2,
          event.clientY - bounds.top - bounds.height / 2,
          Math.exp(-event.deltaY / WHEEL_ZOOM_DIVISOR),
        ),
      )
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const zoomIn = () => setView((current) => zoomAbout(current, 0, 0, BUTTON_ZOOM_STEP))
  const zoomOut = () => setView((current) => zoomAbout(current, 0, 0, 1 / BUTTON_ZOOM_STEP))
  const reset = () => setView(CENTERED)

  const fit = useCallback(() => {
    const element = frame.current
    const svg = diagram.current?.querySelector('svg')
    if (element === null || svg == null) return

    const width = svg.width.baseVal.value
    const height = svg.height.baseVal.value
    if (width === 0 || height === 0) return

    const bounds = element.getBoundingClientRect()
    const scale = Math.min(
      (bounds.width - FIT_PADDING * 2) / width,
      (bounds.height - FIT_PADDING * 2) / height,
      1,
    )
    setView({ x: 0, y: 0, scale: clamp(scale, MIN_SCALE, MAX_SCALE) })
  }, [])

  return (
    <section
      className={panning ? 'canvas panning' : 'canvas'}
      ref={frame}
      style={{
        backgroundSize: `${GRID_SPACING * view.scale}px ${GRID_SPACING * view.scale}px`,
        backgroundPosition: `calc(50% + ${view.x}px) calc(50% + ${view.y}px)`,
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          from: view,
          moved: false,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const active = drag.current
        if (active === null || active.pointerId !== event.pointerId) return

        const dx = event.clientX - active.x
        const dy = event.clientY - active.y
        if (!active.moved) {
          if (Math.abs(dx) < CLICK_SLOP && Math.abs(dy) < CLICK_SLOP) return
          active.moved = true
          setPanning(true)
        }

        setView({ scale: active.from.scale, x: active.from.x + dx, y: active.from.y + dy })
      }}
      onPointerUp={(event) => {
        const active = drag.current
        if (active?.pointerId !== event.pointerId) return
        drag.current = null
        setPanning(false)
        panEndedHere.current = active.moved
      }}
      // Selection rides on click rather than pointerup: pointer capture retargets pointer
      // events at this element, but click still reports the node actually under the cursor.
      onClick={(event) => {
        if (panEndedHere.current) {
          panEndedHere.current = false
          return
        }
        const node = (event.target as Element).closest('g.node')
        onSelect(node === null ? null : nodeIdFromElement(node))
      }}
    >
      <div
        className="viewport"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <div className="diagram" ref={diagram} />
      </div>

      <div className="toolbar" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Zoom out" onClick={zoomOut}>
          -
        </button>
        <span className="zoom">{Math.round(view.scale * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={zoomIn}>
          +
        </button>
        <span className="separator" />
        <button type="button" onClick={fit}>
          Fit
        </button>
        <button type="button" onClick={reset}>
          Reset
        </button>
      </div>

      {error !== null && <pre className="error">{error}</pre>}
    </section>
  )
}
