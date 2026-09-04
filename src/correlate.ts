// Correlating a rendered node back to the text that declared it. Mermaid's flowchart parser
// keeps no source positions, so the spans have to be recovered by scanning the source
// ourselves. This is deliberately a scanner and not a parser: it locates node declarations
// and nothing else.

export interface NodeSpan {
  id: string
  from: number
  to: number
  labelFrom: number | null
  labelTo: number | null
}

const KEYWORDS = new Set([
  'flowchart',
  'graph',
  'subgraph',
  'end',
  'direction',
  'style',
  'classDef',
  'class',
  'click',
  'linkStyle',
  'href',
  'call',
  'TB',
  'TD',
  'BT',
  'RL',
  'LR',
])

const SHAPE_CLOSERS: Record<string, string> = { '[': ']', '(': ')', '{': '}' }

// A hyphen only continues an id when a word character follows, so `A-->B` ends the id at `A`
// while `node-1` stays whole.
const IDENTIFIER = /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*/

function skipToNewline(source: string, index: number): number {
  const newline = source.indexOf('\n', index)
  return newline === -1 ? source.length : newline
}

function skipDelimited(source: string, index: number, delimiter: string): number {
  const closing = source.indexOf(delimiter, index + 1)
  return closing === -1 ? source.length : closing + 1
}

// Node labels nest (`[[Subroutine]]`, `((Circle))`), so match by depth. Returns the index
// just past the closing delimiter, or null if it never closes.
function skipShape(source: string, index: number, open: string, close: string): number | null {
  let depth = 0
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (character === open) {
      depth += 1
    } else if (character === close) {
      depth -= 1
      if (depth === 0) return cursor + 1
    }
  }
  return null
}

function collectOccurrences(source: string): NodeSpan[] {
  const found: NodeSpan[] = []
  let index = 0

  while (index < source.length) {
    if (source.startsWith('%%', index)) {
      index = skipToNewline(source, index)
      continue
    }

    const character = source[index]

    if (character === '"') {
      index = skipDelimited(source, index, '"')
      continue
    }

    // Edge labels are text, not node references.
    if (character === '|') {
      index = skipDelimited(source, index, '|')
      continue
    }

    const identifier = IDENTIFIER.exec(source.slice(index))
    if (identifier === null) {
      index += 1
      continue
    }

    const id = identifier[0]
    const idEnd = index + id.length

    if (KEYWORDS.has(id)) {
      index = idEnd
      continue
    }

    const opener = source[idEnd]
    const closer = opener === undefined ? undefined : SHAPE_CLOSERS[opener]
    if (opener !== undefined && closer !== undefined) {
      const shapeEnd = skipShape(source, idEnd, opener, closer)
      if (shapeEnd !== null) {
        found.push({ id, from: index, to: shapeEnd, labelFrom: idEnd + 1, labelTo: shapeEnd - 1 })
        index = shapeEnd
        continue
      }
    }

    found.push({ id, from: index, to: idEnd, labelFrom: null, labelTo: null })
    index = idEnd
  }

  return found
}

// A node can appear many times; the declaration is the occurrence that carries the label.
export function findNodes(source: string): Map<string, NodeSpan> {
  const declarations = new Map<string, NodeSpan>()

  for (const occurrence of collectOccurrences(source)) {
    const existing = declarations.get(occurrence.id)
    if (existing === undefined || (existing.labelFrom === null && occurrence.labelFrom !== null)) {
      declarations.set(occurrence.id, occurrence)
    }
  }

  return declarations
}

// Mermaid stamps rendered nodes with `<renderId>-flowchart-<nodeId>-<n>`, where `<n>` is an
// internal entity counter. Greedy matching leaves hyphenated ids like `node-1` intact.
const RENDERED_NODE_ID = /^mermaid-\d+-flowchart-(.+)-\d+$/

export function nodeIdFromElement(element: Element): string | null {
  return RENDERED_NODE_ID.exec(element.id)?.[1] ?? null
}
