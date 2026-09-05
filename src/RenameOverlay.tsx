import { useRef, useState } from 'react'

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

// Where the thing being renamed sits, in coordinates relative to the canvas frame.
export interface Anchor {
  left: number
  top: number
  width: number
  height: number
}

interface RenameOverlayProps {
  label: string
  anchor: Anchor
  scale: number
  onCommit: (label: string) => void
  onClose: () => void
}

// Owns the text being typed and how the edit ends; the caller decides only what is being
// renamed and where it is on screen. Mount it to open the box and unmount it to take it away
// -- there is no close method, because the caller clearing its own state is the close.
export default function RenameOverlay({
  label,
  anchor,
  scale,
  onCommit,
  onClose,
}: RenameOverlayProps) {
  const [value, setValue] = useState(label)
  const abandoned = useRef(false)

  const fontSize = LABEL_FONT_SIZE * scale
  const width = Math.max(anchor.width, textWidth(value, fontSize) + INPUT_SLACK)

  return (
    <input
      className="rename"
      autoFocus
      value={value}
      style={{
        // Grows from the centre, so the overlay stays over what it is editing.
        left: anchor.left - (width - anchor.width) / 2,
        top: anchor.top,
        width,
        height: anchor.height,
        fontSize: `${fontSize}px`,
      }}
      onChange={(event) => setValue(event.target.value)}
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
        onClose()
        if (!cancelled && value !== label) onCommit(value)
      }}
    />
  )
}
