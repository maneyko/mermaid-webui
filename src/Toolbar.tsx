import { useState } from 'react'
import { COLORS, colorFromHue, QUICK_SHAPES, type NodeColor, type Shape } from './edit'
import ShapeMenu, { ShapeIcon } from './ShapeMenu'

export type Tool = 'select' | 'arrow' | 'shape'

export interface FileControls {
  name: string
  dirty: boolean
  supported: boolean
  onNew: () => void
  onOpen: () => void
  onSave: () => void
}

interface ToolbarProps {
  tool: Tool
  file: FileControls
  onToolChange: (tool: Tool) => void
  shape: Shape
  nodeShape: Shape | null
  onPickShape: (shape: Shape) => void
  hasNodeSelection: boolean
  color: NodeColor | null
  hue: number | null
  onPreviewColor: (color: NodeColor) => void
  onPickColor: (color: NodeColor | null) => void
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
  { tool: 'arrow', label: 'Arrow', shortcut: '2', icon: ArrowIcon },
]

const SHAPE_SHORTCUTS = ['3', '4', '5', '6']

// Mermaid's own default node, so the swatch that clears the colour shows what it returns you
// to rather than being an empty hole in the row.
const DEFAULT_SWATCH = { name: 'Default', fill: '#ececff', stroke: '#9370db' }

export default function Toolbar({
  tool,
  file,
  onToolChange,
  shape,
  nodeShape,
  onPickShape,
  hasNodeSelection,
  color,
  hue,
  onPreviewColor,
  onPickColor,
  canDelete,
  onDelete,
  scale,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
}: ToolbarProps) {
  // A shape button means "the selected node is this" when there is a selection, and "a new node
  // will be this" when there is not.
  const current = hasNodeSelection ? nodeShape : tool === 'shape' ? shape : null

  // The hue being dragged, written to the source once on release so a drag is one undo.
  const [draftHue, setDraftHue] = useState<number | null>(null)
  const commitHue = () => {
    if (draftHue !== null) onPickColor(colorFromHue(draftHue))
    setDraftHue(null)
  }

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
      {/* Hidden rather than disabled where the File System Access API is missing: the islands
          hold controls that work, and there is no half of this that does anything useful. */}
      {file.supported && (
        <div className="island file-controls">
          <span className="file-name" title={file.name}>
            {file.name}
            {file.dirty ? ' *' : ''}
          </span>
          <span className="separator" />
          <button type="button" title="Start a new diagram" onClick={file.onNew}>
            New
          </button>
          <button type="button" title="Open a .mmd file (cmd+O)" onClick={file.onOpen}>
            Open
          </button>
          <button type="button" title="Save to the .mmd file (cmd+S)" onClick={file.onSave}>
            Save
          </button>
        </div>
      )}

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

        {QUICK_SHAPES.map((each, position) => (
          <button
            key={each.key}
            type="button"
            className={each.key === current?.key ? 'tool active' : 'tool'}
            aria-label={hasNodeSelection ? `Make selection a ${each.name}` : `${each.name} tool`}
            aria-pressed={each.key === current?.key}
            title={
              hasNodeSelection
                ? `Change the selected node to a ${each.name.toLowerCase()}`
                : `${each.name} (${SHAPE_SHORTCUTS[position]}) -- drag from a node to add one`
            }
            onClick={() => onPickShape(each)}
          >
            <ShapeIcon shape={each} />
            <span className="shortcut">{SHAPE_SHORTCUTS[position]}</span>
          </button>
        ))}

        <ShapeMenu current={current} hasNodeSelection={hasNodeSelection} onPick={onPickShape} />

        <span className="separator" />

        {[null, ...COLORS].map((each) => {
          const swatch = each ?? DEFAULT_SWATCH
          const active =
            hasNodeSelection && (each === null ? color === null && hue === null : each.name === color?.name)
          return (
            <button
              key={swatch.name}
              type="button"
              className={active ? 'swatch active' : 'swatch'}
              disabled={!hasNodeSelection}
              aria-label={`${swatch.name} node`}
              aria-pressed={active}
              title={
                each === null
                  ? 'Clear the colour of the selected node'
                  : `Colour the selected node ${swatch.name.toLowerCase()}`
              }
              style={{ background: swatch.fill, borderColor: swatch.stroke }}
              onClick={() => onPickColor(each)}
            />
          )
        })}

        <input
          type="range"
          className="hue"
          min={0}
          max={359}
          value={draftHue ?? hue ?? 0}
          disabled={!hasNodeSelection}
          aria-label="Hue of the selected node"
          title="Colour the selected node any hue"
          onChange={(event) => {
            const picked = Number(event.target.value)
            setDraftHue(picked)
            onPreviewColor(colorFromHue(picked))
          }}
          onPointerUp={(event) => {
            commitHue()
            // A focused input switches off every canvas shortcut, Delete included.
            event.currentTarget.blur()
          }}
          onKeyUp={commitHue}
        />

        <span className="separator" />

        <button
          type="button"
          className="tool"
          disabled={!canDelete}
          aria-label="Delete selection"
          title="Delete the selection (Delete)"
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
