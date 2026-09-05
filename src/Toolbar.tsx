export type Tool = 'select' | 'hand'

interface ToolbarProps {
  tool: Tool
  onToolChange: (tool: Tool) => void
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

const TOOLS: { tool: Tool; label: string; shortcut: string; icon: () => React.ReactElement }[] = [
  { tool: 'select', label: 'Select', shortcut: '1', icon: CursorIcon },
  { tool: 'hand', label: 'Hand', shortcut: 'H', icon: HandIcon },
]

export default function Toolbar({
  tool,
  onToolChange,
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
