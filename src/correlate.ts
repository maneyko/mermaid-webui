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

// The closing `|` of an edge label, skipping quoted stretches so `|"yes|no"|` -- which we
// emit ourselves for a label containing a pipe -- does not terminate at the inner one.
// Returns -1 when the label does not close on its line, which makes the `|` ordinary text.
function closingPipe(source: string, index: number): number {
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (character === '\n') return -1
    if (character === '"') {
      cursor = skipDelimited(source, cursor, '"') - 1
      continue
    }
    if (character === '|') return cursor
  }
  return -1
}

// Node labels nest (`[[Subroutine]]`, `((Circle))`), so match by depth. Delimiters inside a
// quoted label are text and must not count, or `A["Buy [things"]` -- which mermaid accepts
// and which we ourselves emit for a label containing a bracket -- never closes. Returns the
// index just past the closing delimiter, or null if it never closes.
function skipShape(source: string, index: number, open: string, close: string): number | null {
  let depth = 0
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const character = source[cursor]
    if (character === '"') {
      cursor = skipDelimited(source, cursor, '"') - 1
    } else if (character === open) {
      depth += 1
    } else if (character === close) {
      depth -= 1
      if (depth === 0) return cursor + 1
    }
  }
  return null
}

// A statement is one mermaid instruction: the text between newlines or semicolons, trimmed.
// `keyword` is the leading keyword for the statements that have one (`style`, `subgraph`,
// `flowchart`), and null for the graph statements that declare and connect nodes. `scope` is
// the index of the enclosing `subgraph` statement, or -1 at the top level -- a node belongs
// to whichever subgraph mentions it, so scope is the difference between two mentions of the
// same id being interchangeable and not.
export interface Statement {
  from: number
  to: number
  keyword: string | null
  scope: number
  nodes: NodeSpan[]
}

function assignScopes(statements: Statement[]): void {
  const open: number[] = []
  statements.forEach((statement, index) => {
    if (statement.keyword === 'end') open.pop()
    statement.scope = open.at(-1) ?? -1
    if (statement.keyword === 'subgraph') open.push(index)
  })
}

// Splitting on `;` has to skip quotes and shapes for the same reason locating nodes does --
// a semicolon inside a label is text -- so the split and the node walk are one pass.
export function findStatements(source: string): Statement[] {
  const statements: Statement[] = []
  let index = 0
  let start = 0
  let keyword: string | null = null
  let nodes: NodeSpan[] = []

  const finish = (stop: number) => {
    let from = start
    let to = stop
    while (from < to && /\s/.test(source[from] as string)) from += 1
    while (to > from && /\s/.test(source[to - 1] as string)) to -= 1
    if (to > from) statements.push({ from, to, keyword, scope: -1, nodes })
    start = stop + 1
    keyword = null
    nodes = []
  }

  while (index < source.length) {
    const character = source[index]

    if (character === '\n' || character === ';') {
      finish(index)
      index += 1
      continue
    }

    if (source.startsWith('%%', index)) {
      index = skipToNewline(source, index)
      continue
    }

    if (character === '"') {
      index = skipDelimited(source, index, '"')
      continue
    }

    // Edge labels are text, not node references.
    if (character === '|') {
      const closing = closingPipe(source, index)
      index = closing === -1 ? index + 1 : closing + 1
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
      if (keyword === null && nodes.length === 0) keyword = id
      index = idEnd
      continue
    }

    // The arrowheads of `A --x B` and `A --o B`. Both are also perfectly good node ids, so
    // what separates them is sitting hard against the link with no space: `A --> x` is a node.
    if ((id === 'x' || id === 'o') && '-.=~'.includes(source[index - 1] ?? '')) {
      index = idEnd
      continue
    }

    const opener = source[idEnd]
    const closer = opener === undefined ? undefined : SHAPE_CLOSERS[opener]
    if (opener !== undefined && closer !== undefined) {
      const shapeEnd = skipShape(source, idEnd, opener, closer)
      if (shapeEnd !== null) {
        // A doubled delimiter is one shape, not nesting: the label of `A((Circle))` is
        // `Circle`, and treating the inner pair as part of it would make a rename rewrite
        // `A((x))` as `A(x)` and quietly turn the circle into a rounded rectangle.
        const width = source[idEnd + 1] === opener ? 2 : 1
        nodes.push({
          id,
          from: index,
          to: shapeEnd,
          labelFrom: idEnd + width,
          labelTo: shapeEnd - width,
        })
        index = shapeEnd
        continue
      }
    }

    nodes.push({ id, from: index, to: idEnd, labelFrom: null, labelTo: null })
    index = idEnd
  }

  finish(source.length)
  assignScopes(statements)
  return statements
}

// A node can appear many times; the declaration is the occurrence that carries the label.
export function findNodes(source: string): Map<string, NodeSpan> {
  const declarations = new Map<string, NodeSpan>()

  for (const statement of findStatements(source)) {
    for (const occurrence of statement.nodes) {
      const existing = declarations.get(occurrence.id)
      if (existing === undefined || (existing.labelFrom === null && occurrence.labelFrom !== null)) {
        declarations.set(occurrence.id, occurrence)
      }
    }
  }

  return declarations
}

export interface Span {
  from: number
  to: number
}

export interface EdgeSpan extends Span {
  linkFrom: number
  linkTo: number
  statement: Statement
  position: number
}

// What can sit between two node references and still be one link, once any `|label|` is
// taken out. Requiring two or more link characters is what rejects the `&` list form:
// `A & B --> C` is two edges into C rather than a chain, and mermaid orders them in a way
// this does not model, so the statement is dropped and the count guard declines the edit.
const LINK = /^\s*[<xo]?[-.=~]{2,}[>xo]?\s*$/

function isLink(text: string): boolean {
  return LINK.test(text.replaceAll(/"[^"]*"/g, '').replaceAll(/\|[^|]*\|/g, ''))
}

// One edge per consecutive pair of node references in a statement, so `A --> B --> C` is two.
// Deliberately no identity, for the same reason edge labels have none: callers pair the k-th
// rendered `path.flowchart-link` with the k-th span here, having checked the counts agree.
export function findEdges(source: string): EdgeSpan[] {
  const edges: EdgeSpan[] = []

  for (const statement of findStatements(source)) {
    if (statement.keyword !== null) continue

    const chain: EdgeSpan[] = []
    for (let position = 1; position < statement.nodes.length; position += 1) {
      const before = statement.nodes[position - 1] as NodeSpan
      const after = statement.nodes[position] as NodeSpan
      if (!isLink(source.slice(before.to, after.from))) {
        chain.length = 0
        break
      }
      chain.push({
        from: before.from,
        to: after.to,
        linkFrom: before.to,
        linkTo: after.from,
        statement,
        position,
      })
    }

    edges.push(...chain)
  }

  return edges
}

// The text inside each `|...|` edge label, in declaration order. Node shapes and quoted
// strings are skipped so a pipe inside a node label -- `A["a|b"]` -- is not mistaken for a
// delimiter. Deliberately does not enumerate edges: rendered edge labels carry no identity of
// any kind, so the only usable key is position, and callers pair the k-th non-empty rendered
// label with the k-th span here.
export function findEdgeLabels(source: string): Span[] {
  const spans: Span[] = []
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

    if (character === '|') {
      const closing = closingPipe(source, index)
      if (closing === -1) {
        index += 1
        continue
      }
      spans.push({ from: index + 1, to: closing })
      index = closing + 1
      continue
    }

    const identifier = IDENTIFIER.exec(source.slice(index))
    if (identifier === null) {
      index += 1
      continue
    }

    const idEnd = index + identifier[0].length
    const opener = source[idEnd]
    const closer = opener === undefined ? undefined : SHAPE_CLOSERS[opener]
    index = closer === undefined || opener === undefined ? idEnd : (skipShape(source, idEnd, opener, closer) ?? idEnd)
  }

  return spans
}

// Mermaid stamps rendered nodes with `<renderId>-flowchart-<nodeId>-<n>`, where `<n>` is an
// internal entity counter. Greedy matching leaves hyphenated ids like `node-1` intact.
const RENDERED_NODE_ID = /^mermaid-\d+-flowchart-(.+)-\d+$/

export function nodeIdFromElement(element: Element): string | null {
  return RENDERED_NODE_ID.exec(element.id)?.[1] ?? null
}
