import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'

export interface Viewport {
  x: number
  y: number
  scale: number
}

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const BUTTON_ZOOM_STEP = 1.2
// Chrome sends deltaY of roughly 120 per mouse-wheel notch, so this puts one notch at about
// 1.19x. Trackpads send many small deltas and come out smooth at the same divisor.
const WHEEL_ZOOM_DIVISOR = 700
const FIT_PADDING = 48
// Below this many pixels of pointer travel, a drag counts as a click rather than a pan.
const CLICK_SLOP = 4

const CENTERED: Viewport = { x: 0, y: 0, scale: 1 }

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
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

// Owns the viewport and the pan drag. Gesture *policy* -- which tool pans, what a click means
// -- stays with the caller, which is why begin/move/end are exposed rather than a set of
// ready-made handlers.
export function usePanZoom(frame: RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState<Viewport>(CENTERED)
  const [panning, setPanning] = useState(false)
  const drag = useRef<{
    pointerId: number
    x: number
    y: number
    from: Viewport
    moved: boolean
  } | null>(null)

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
  }, [frame])

  const begin = (event: PointerEvent<HTMLElement>) => {
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      from: view,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const move = (event: PointerEvent<HTMLElement>) => {
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
  }

  // Returns whether the pointer actually travelled, so the caller can tell a pan from a click.
  const end = (event: PointerEvent<HTMLElement>): boolean => {
    const active = drag.current
    if (active?.pointerId !== event.pointerId) return false
    drag.current = null
    setPanning(false)
    return active.moved
  }

  const fitTo = (width: number, height: number) => {
    const element = frame.current
    if (element === null || width === 0 || height === 0) return

    const bounds = element.getBoundingClientRect()
    // Capped at 1: blowing a three-node flowchart up to fill a wide window looks absurd, and
    // "fit" usefully means "make sure I can see all of it".
    const scale = Math.min(
      (bounds.width - FIT_PADDING * 2) / width,
      (bounds.height - FIT_PADDING * 2) / height,
      1,
    )
    setView({ x: 0, y: 0, scale: clamp(scale, MIN_SCALE, MAX_SCALE) })
  }

  return {
    view,
    panning,
    begin,
    move,
    end,
    fitTo,
    zoomIn: () => setView((current) => zoomAbout(current, 0, 0, BUTTON_ZOOM_STEP)),
    zoomOut: () => setView((current) => zoomAbout(current, 0, 0, 1 / BUTTON_ZOOM_STEP)),
    reset: () => setView(CENTERED),
  }
}
