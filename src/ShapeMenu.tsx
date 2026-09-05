import { useEffect, useRef, useState } from 'react'
import { SHAPES, type Shape } from './edit'

// One path per shape, drawn in a 24x24 box to roughly the outline mermaid renders. They are
// approximations by eye, not extracts of mermaid's own geometry, which is computed from the
// label's measured size and has no fixed form to copy.
const ICONS: Record<string, string> = {
  rect: 'M3 6.5h18v11H3z',
  rounded:
    'M6.5 6.5h11a3.5 3.5 0 0 1 3.5 3.5v4a3.5 3.5 0 0 1-3.5 3.5h-11A3.5 3.5 0 0 1 3 14v-4a3.5 3.5 0 0 1 3.5-3.5z',
  diam: 'M12 3.5 20.5 12 12 20.5 3.5 12z',
  circle: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z',
  stadium: 'M8.5 6.5h7a5.5 5.5 0 0 1 0 11h-7a5.5 5.5 0 0 1 0-11z',
  'dbl-circ':
    'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z M12 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z',
  'sm-circ': 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  'f-circ': 'M12 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z',
  'fr-circ':
    'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  'cross-circ': 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z M6 6l12 12M18 6 6 18',
  hex: 'M7.5 6.5h9l4.5 5.5-4.5 5.5h-9L3 12z',
  tri: 'M12 5 21 19H3z',
  'flip-tri': 'M3 5h18l-9 14z',
  'lean-r': 'M7 6.5h14l-4 11H3z',
  'lean-l': 'M3 6.5h14l4 11H7z',
  'trap-b': 'M7 6.5h10l4 11H3z',
  'trap-t': 'M3 6.5h18l-4 11H7z',
  text: 'M4 8h16M4 12h16M4 16h10',
  bang: 'M12 3.6l2.4 2.7 3.4-1.3-.3 3.6 3.5 1.4-2.7 2.4 2.1 2.9-3.6.6-.5 3.6-3.3-1.5-3.3 1.5-.5-3.6-3.6-.6 2.1-2.9L3 10l3.5-1.4-.3-3.6 3.4 1.3z',

  'fr-rect': 'M3 6.5h18v11H3z M6.5 6.5v11M17.5 6.5v11',
  'notch-rect': 'M7 6.5h14v11H3V10.5z',
  'lin-rect': 'M3 6.5h18v11H3z M6.5 6.5v11',
  'div-rect': 'M3 6.5h18v11H3z M3 10h18',
  'st-rect': 'M3 9h14v9H3z M5.5 9V6.5h14V15h-2.5',
  'tag-rect': 'M3 6.5h18v11H3z M16.5 17.5 21 13',
  'sl-rect': 'M3 9.5 21 6v11.5H3z',
  'bow-rect': 'M6 6.5h12q-2.5 5.5 0 11H6q2.5-5.5 0-11z',
  'win-pane': 'M3 6.5h18v11H3z M3 10h18M7 6.5v11',
  'notch-pent': 'M7 6.5h10l4 3.5v7.5H3V10z',
  'curv-trap': 'M3 12l4-5.5h8a5.5 5.5 0 0 1 0 11H7z',
  delay: 'M3 6.5h12a5.5 5.5 0 0 1 0 11H3z',
  hourglass: 'M5 6h14L5 18h14z',
  fork: 'M3 10.5h18v3H3z',
  bolt: 'M13.5 3 5.5 13.5H10L10.5 21l8-10.5H14z',
  flag: 'M6 5.5c4 3 8-3 12 0v12c-4 3-8-3-12 0z',
  odd: 'M3 6.5h18v11H3l4-5.5z',
  brace: 'M15 5h-2.5a2 2 0 0 0-2 2v3l-2.5 2 2.5 2v3a2 2 0 0 0 2 2H15',
  'brace-r': 'M9 5h2.5a2 2 0 0 1 2 2v3l2.5 2-2.5 2v3a2 2 0 0 1-2 2H9',
  braces:
    'M11 5H9.5a2 2 0 0 0-2 2v3L5 12l2.5 2v3a2 2 0 0 0 2 2H11 M13 5h1.5a2 2 0 0 1 2 2v3l2.5 2-2.5 2v3a2 2 0 0 1-2 2H13',
  doc: 'M4 5.5h16v11c-2.7 2.2-5.3-2.2-8 0s-5.3-2.2-8 0z',
  docs: 'M3 8.5h14v9c-2.3 2-4.7-2-7 0s-4.7-2-7 0z M5.5 8.5V6h14v9h-2.5',
  'lin-doc': 'M4 5.5h16v11c-2.7 2.2-5.3-2.2-8 0s-5.3-2.2-8 0z M7.5 5.5v12.2',
  'tag-doc': 'M4 5.5h16v11c-2.7 2.2-5.3-2.2-8 0s-5.3-2.2-8 0z M15.5 16.7 20 12.2',

  cyl: 'M6 8.5c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5v7c0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5z M18 8.5c0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5',
  'h-cyl':
    'M8.5 6h7c1.4 0 2.5 2.7 2.5 6s-1.1 6-2.5 6h-7C7.1 18 6 15.3 6 12s1.1-6 2.5-6z M15.5 6c-1.4 0-2.5 2.7-2.5 6s1.1 6 2.5 6',
  'lin-cyl':
    'M6 8.5c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5v7c0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5z M18 8.5c0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5 M18 11.5c0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5',
  datastore: 'M21 6.5H3v11h18',
  bucket: 'M5 7c0-1.1 3.1-2 7-2s7 .9 7 2c0 1.1-3.1 2-7 2S5 8.1 5 7z M5 7l2.2 9.5c.4 1.3 9.2 1.3 9.6 0L19 7',
  folder: 'M3 18V6.5h5.5L10 9h11v9z',
  console:
    'M5.5 5.5h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z M7 10l2.5 2L7 14 M11.5 14.5h5',
  browser: 'M3 6.5h18v11H3z M3 10h18 M5.4 8.2h.01M7.4 8.2h.01M9.4 8.2h.01',
  person:
    'M12 5.2a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8z M6 18.5v-1.6a4.6 4.6 0 0 1 4.6-4.6h2.8a4.6 4.6 0 0 1 4.6 4.6v1.6z',
  cloud: 'M7.6 17.5a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.5 1.3 3.4 3.4 0 0 1-.6 6.7z',
}

// Mermaid draws these two solid, and an outline of either is another shape in the list.
const SOLID = new Set(['f-circ', 'fork'])

export function ShapeIcon({ shape }: { shape: Shape }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill={SOLID.has(shape.key) ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[shape.key] ?? ''} />
    </svg>
  )
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M4 4.5h6v6H4zM14 4.5h6v6h-6zM4 13.5h6v6H4zM14 13.5h6v6h-6z" />
    </svg>
  )
}

const GROUPS = [...new Set(SHAPES.map((shape) => shape.group))]

interface ShapeMenuProps {
  current: Shape | null
  hasNodeSelection: boolean
  onPick: (shape: Shape) => void
}

// The forty-nine shapes that do not fit on the toolbar. Owns whether it is open, because
// nothing outside it opens or closes it.
export default function ShapeMenu({ current, hasNodeSelection, onPick }: ShapeMenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    // Capture, because the toolbar stops both of these before they reach the window.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div className="shape-menu-root" ref={root}>
      <button
        type="button"
        className={open ? 'tool active' : 'tool'}
        aria-label="All shapes"
        aria-expanded={open}
        title="All shapes"
        onClick={() => setOpen(!open)}
      >
        <LibraryIcon />
      </button>

      {open && (
        <div className="island shape-menu">
          {GROUPS.map((group) => (
            <section key={group}>
              <h2>{group}</h2>
              <div className="shape-grid">
                {SHAPES.filter((shape) => shape.group === group).map((shape) => (
                  <button
                    key={shape.key}
                    type="button"
                    className={shape.key === current?.key ? 'shape active' : 'shape'}
                    aria-pressed={shape.key === current?.key}
                    title={
                      hasNodeSelection
                        ? `Change the selected node to a ${shape.name.toLowerCase()}`
                        : `${shape.name} -- drag from a node to add one`
                    }
                    onClick={() => {
                      onPick(shape)
                      setOpen(false)
                    }}
                  >
                    <ShapeIcon shape={shape} />
                    <span>{shape.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
