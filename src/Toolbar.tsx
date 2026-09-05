import { SHAPES, type Shape } from './edit'

export type Tool = 'select' | 'hand' | 'arrow' | 'shape'

interface ToolbarProps {
  tool: Tool
  onToolChange: (tool: Tool) => void
  shape: Shape
  onPickShape: (shape: Shape) => void
  hasNodeSelection: boolean
  canDelete: boolean
  onDelete: () => void
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onReset: () => void
}

function CursorIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M5 2.5 L5 18.5 L9.2 14.4 L11.8 20.5 L14.2 19.4 L11.6 13.6 L17.5 13.2 Z"
        fill="currentColor"
      />
    </svg>
  )
}

function HandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 12V6a1.5 1.5 0 0 1 3 0v5" />
      <path d="M11 11V4.8a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 11.2V6.5a1.5 1.5 0 0 1 3 0V13" />
      <path d="M17 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.5a7 7 0 0 1-7-7v-1.5a1.5 1.5 0 0 1 3 0" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19 L19 5" />
      <path d="M12 5 H19 V12" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4.5h5v2" />
      <path d="M6.5 6.5 7.5 20h9l1-13.5" />
      <path d="M10 10v6.5M14 10v6.5" />
    </svg>
  )
}

const TOOLS: { tool: Tool; label: string; shortcut: string; icon: () => React.ReactElement }[] = [
  { tool: 'select', label: 'Select', shortcut: '1', icon: CursorIcon },
  { tool: 'hand', label: 'Hand', shortcut: 'H', icon: HandIcon },
  { tool: 'arrow', label: 'Arrow', shortcut: '2', icon: ArrowIcon },
]

function shapeIcon(children: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const SHAPE_ICONS: Record<string, React.ReactElement> = {
  Rectangle: shapeIcon(<rect x="3.5" y="6.5" width="17" height="11" />),
  Rounded: shapeIcon(<rect x="3.5" y="6.5" width="17" height="11" rx="5.5" />),
  Diamond: shapeIcon(<path d="M12 3.5 L20.5 12 L12 20.5 L3.5 12 Z" />),
  Circle: shapeIcon(<circle cx="12" cy="12" r="8.5" />),
}

const SHAPE_SHORTCUTS = ['3', '4', '5', '6']

export default function Toolbar({
  tool,
  onToolChange,
  shape,
  onPickShape,
  hasNodeSelection,
  canDelete,
  onDelete,
  scale,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
}: ToolbarProps) {
  return (
    // Every one of these would otherwise reach the canvas behind the buttons: pointer-down
    // starts a pan, click reads as a click on empty space and clears the selection, and
    // double-click tries to open a rename.
    <div
      className="chrome"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="island tools">
        {TOOLS.map(({ tool: each, label, shortcut, icon: Icon }) => (
          <button
            key={each}
            type="button"
            className={each === tool ? 'tool active' : 'tool'}
            aria-label={`${label} tool`}
            aria-pressed={each === tool}
            title={`${label} (${shortcut})`}
            onClick={() => onToolChange(each)}
          >
            <Icon />
            <span className="shortcut">{shortcut}</span>
          </button>
        ))}

        <span className="separator" />

        {SHAPES.map((each, position) => (
          <button
            key={each.name}
            type="button"
            className={tool === 'shape' && shape.name === each.name ? 'tool active' : 'tool'}
            aria-label={hasNodeSelection ? `Make selection a ${each.name}` : `${each.name} tool`}
            aria-pressed={tool === 'shape' && shape.name === each.name}
            title={
              hasNodeSelection
                ? `Change the selected node to a ${each.name.toLowerCase()}`
                : `${each.name} (${SHAPE_SHORTCUTS[position]}) -- drag from a node to add one`
            }
            onClick={() => onPickShape(each)}
          >
            {SHAPE_ICONS[each.name]}
            <span className="shortcut">{SHAPE_SHORTCUTS[position]}</span>
          </button>
        ))}

        <span className="separator" />

        <button
          type="button"
          className="tool"
          disabled={!canDelete}
          aria-label="Delete selection"
          title="Delete the selected node or edge (Delete)"
          onClick={onDelete}
        >
          <TrashIcon />
        </button>
      </div>

      <div className="island zoom-controls">
        <button type="button" aria-label="Zoom out" onClick={onZoomOut}>
          -
        </button>
        <span className="zoom">{Math.round(scale * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={onZoomIn}>
          +
        </button>
        <span className="separator" />
        <button type="button" onClick={onFit}>
          Fit
        </button>
        <button type="button" onClick={onReset}>
          Reset
        </button>
      </div>
    </div>
  )
}
