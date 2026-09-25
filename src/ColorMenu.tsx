import { useState, type PointerEvent, type ReactNode } from 'react'
import {
  colorFromFill,
  COLORS,
  DEFAULT_COLOR,
  hexToHsl,
  hslToHex,
  normalizeHex,
  type NodeColor,
} from './edit'
import usePopover from './usePopover'

interface ColorMenuProps {
  fill: string | null
  disabled: boolean
  onPreview: (color: NodeColor) => void
  onPick: (color: NodeColor) => void
  // The shade slider, inside the root so pressing it does not count as a press outside.
  children: ReactNode
}

const HUES = [0, 60, 120, 180, 240, 300, 360]

function wheel(lightness: string): string {
  return `conic-gradient(${HUES.map((h) => `hsl(${h} 100% ${lightness})`).join(', ')})`
}

// Any colour at all: a wheel for hue and saturation, and fields for an exact hex or RGB. The
// shade slider beside it owns lightness, so the wheel is drawn at the node's own lightness.
export default function ColorMenu({ fill, disabled, onPreview, onPick, children }: ColorMenuProps) {
  const { open, setOpen, root } = usePopover()
  const [draft, setDraft] = useState<NodeColor | null>(null)

  const custom = fill !== null && !COLORS.some((color) => color.fill === fill)
  const current = hexToHsl(draft?.fill ?? fill ?? DEFAULT_COLOR.fill) ?? { h: 0, s: 0, l: 0.85 }
  // Mermaid's default is too pale to show a wheel at, and a wheel much darker than the black
  // label text allows would offer colours nobody can read a node in.
  const lightness = fill === null ? 0.85 : Math.min(Math.max(current.l, 0.5), 0.9)
  const percent = `${Math.round(lightness * 100)}%`

  // The same drag-then-commit as the shade slider, so a drag across the wheel is one undo.
  const pickAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const dx = event.clientX - (box.left + box.width / 2)
    const dy = event.clientY - (box.top + box.height / 2)
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
    const s = Math.min(Math.hypot(dx, dy) / (box.width / 2), 1)
    const picked = colorFromFill(hslToHex({ h, s, l: lightness }))
    setDraft(picked)
    onPreview(picked)
  }

  const hex = fill !== null && hexToHsl(fill) !== null ? fill : DEFAULT_COLOR.fill
  const angle = (current.h * Math.PI) / 180

  return (
    <div className="color-menu-root" ref={root}>
      <button
        type="button"
        className={custom ? 'swatch any-color active' : 'swatch any-color'}
        disabled={disabled}
        aria-label="Any colour"
        aria-expanded={open}
        aria-pressed={custom}
        title="Pick any colour for the selected node"
        // Inline, like the swatches, so the island's hover background cannot replace it.
        style={{ background: wheel('72%') }}
        onClick={() => setOpen(!open)}
      />

      {children}

      {open && !disabled && (
        <div className="island color-menu">
          <div
            className="color-wheel"
            style={{
              background: `radial-gradient(closest-side, hsl(0 0% ${percent}), transparent), ${wheel(percent)}`,
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              pickAt(event)
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) pickAt(event)
            }}
            onPointerUp={() => {
              if (draft !== null) onPick(draft)
              setDraft(null)
            }}
          >
            <span
              className="color-wheel-marker"
              style={{
                left: `${50 + Math.sin(angle) * current.s * 50}%`,
                top: `${50 - Math.cos(angle) * current.s * 50}%`,
              }}
            />
          </div>
          {/* Keyed on the colour, so the fields start over from whatever the node now has. */}
          <ColorFields key={hex} hex={hex} onPick={onPick} />
        </div>
      )}
    </div>
  )
}

function ColorFields({ hex, onPick }: { hex: string; onPick: (color: NodeColor) => void }) {
  const [text, setText] = useState(hex)
  const [rgb, setRgb] = useState(() => [1, 3, 5].map((at) => String(parseInt(hex.slice(at, at + 2), 16))))

  const commitHex = () => {
    const typed = normalizeHex(text)
    if (typed === null) setText(hex)
    else if (typed !== hex) onPick(colorFromFill(typed))
  }

  const commitRgb = () => {
    const channels = rgb.map((value) => Number(value))
    if (channels.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      setRgb([1, 3, 5].map((at) => String(parseInt(hex.slice(at, at + 2), 16))))
      return
    }
    const typed = `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`
    if (typed !== hex) onPick(colorFromFill(typed))
  }

  return (
    <form
      className="color-fields"
      onSubmit={(event) => {
        event.preventDefault()
        commitHex()
        commitRgb()
      }}
    >
      <label>
        Hex
        <input
          className="hex"
          value={text}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitHex}
        />
      </label>
      {['R', 'G', 'B'].map((channel, index) => (
        <label key={channel}>
          {channel}
          <input
            inputMode="numeric"
            value={rgb[index]}
            onChange={(event) => setRgb(rgb.map((value, at) => (at === index ? event.target.value : value)))}
            onBlur={commitRgb}
          />
        </label>
      ))}
      {/* Enter in any field submits, and a form only does that with a submit button in it. */}
      <button type="submit" hidden />
    </form>
  )
}
