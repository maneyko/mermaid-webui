import { StreamLanguage } from '@codemirror/language'

// Highlighting only. This deliberately does not build a parse tree -- see AGENTS.md on why
// milestone 4 needs real source spans and cannot get them from a tokenizer like this one.

const KEYWORD = /^(?:flowchart|graph|subgraph|end|direction|click|href|call|class|classDef|style|linkStyle|accTitle|accDescr)\b/
const DIRECTION = /^(?:TB|TD|BT|RL|LR)\b/
const ARROW = /^(?:<?-\.+->?|<?[-=]{2,}[->ox]?|~{3})/
const IDENTIFIER = /^[A-Za-z_][\w-]*/

const CLOSERS: Record<string, string> = { '[': ']', '(': ')', '{': '}' }

interface LabelState {
  open: string | null
  close: string | null
  depth: number
  inEdgeLabel: boolean
}

export const mermaidLanguage = StreamLanguage.define<LabelState>({
  name: 'mermaid',

  startState: () => ({ open: null, close: null, depth: 0, inEdgeLabel: false }),

  token(stream, state) {
    // Bracketed node labels nest (`[[Subroutine]]`, `((Circle))`), so track depth rather
    // than stopping at the first closer.
    if (state.close !== null) {
      while (!stream.eol()) {
        const character = stream.next()
        if (character === state.open) {
          state.depth += 1
        } else if (character === state.close) {
          state.depth -= 1
          if (state.depth === 0) {
            state.open = null
            state.close = null
            break
          }
        }
      }
      return 'string'
    }

    if (state.inEdgeLabel) {
      if (stream.eat('|')) {
        state.inEdgeLabel = false
        return 'punctuation'
      }
      // A quoted stretch goes in whole, so the pipe in `|"yes|no"|` -- which is what we emit
      // for an edge label containing one -- does not close the label early.
      if (stream.eat('"')) {
        while (!stream.eol() && stream.next() !== '"') continue
        return 'string'
      }
      stream.eatWhile(/[^|"]/)
      return 'string'
    }

    if (stream.eatSpace()) return null
    if (stream.match('%%')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match(DIRECTION)) return 'keyword'
    if (stream.match(KEYWORD)) return 'keyword'
    if (stream.match(ARROW)) return 'operator'

    if (stream.eat('|')) {
      state.inEdgeLabel = true
      return 'punctuation'
    }

    const next = stream.peek()
    if (next !== undefined && next in CLOSERS) {
      stream.next()
      state.open = next
      state.close = CLOSERS[next] ?? null
      state.depth = 1
      return 'punctuation'
    }

    if (stream.match(IDENTIFIER)) return 'variableName'

    stream.next()
    return null
  },
})
