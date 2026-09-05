// Writing changes back into the source. Every function here returns a new source string with
// the smallest possible edit applied: byte ranges outside the span being changed must come
// back identical, because the user hand-edits this text and keeps it in git.

import {
  findEdgeLabels,
  findEdges,
  findNodes,
  findStatements,
  type NodeSpan,
  type Span,
  type Statement,
} from './correlate'

// Anything that would terminate a shape early, or that mermaid reads as syntax inside one.
const NEEDS_QUOTING = /["[\]{}()|<>]/

// Mermaid rejects an empty label in every shape -- `A[""]`, `A(("" ))` and friends are all
// parse errors -- so a cleared label is stored as a single blank space, which parses
// everywhere and renders as an empty node.
const BLANK_LABEL = ' '

export function quoteLabel(label: string): string {
  const text = label === '' ? BLANK_LABEL : label
  if (text === text.trim() && !NEEDS_QUOTING.test(text)) return text
  return `"${text.replaceAll('"', '#quot;')}"`
}

export function unquoteLabel(label: string): string {
  if (label.length < 2 || !label.startsWith('"') || !label.endsWith('"')) return label
  return label.slice(1, -1).replaceAll('#quot;', '"')
}

export function labelOf(source: string, nodeId: string): string {
  const node = findNodes(source).get(nodeId)
  if (node === undefined) return ''
  // A node with no label renders as its own id, so that is what is on screen to edit.
  if (node.labelFrom === null || node.labelTo === null) return nodeId
  return unquoteLabel(source.slice(node.labelFrom, node.labelTo))
}

export function edgeLabelOf(source: string, index: number): string {
  const span = findEdgeLabels(source)[index]
  return span === undefined ? '' : unquoteLabel(source.slice(span.from, span.to))
}

export function renameEdgeLabel(source: string, index: number, label: string): string {
  const span = findEdgeLabels(source)[index]
  if (span === undefined) return source
  return source.slice(0, span.from) + quoteLabel(label) + source.slice(span.to)
}

// Rendered edge labels are matched to source spans by position, so that is only safe while
// both sequences have the same length. Anything the scanner does not understand -- the
// `A -- text --> B` inline form, most likely -- shows up here as a mismatch, and the caller
// declines to edit rather than renaming the wrong edge.
export function edgeLabelCount(source: string): number {
  return findEdgeLabels(source).length
}

const DEFAULT_INDENT = '  '

// Copies the indentation of the last statement so an appended line matches the file it lands
// in, rather than imposing a house style on someone else's formatting.
function trailingIndent(source: string): string {
  const lines = source.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') continue
    return /^\s*/.exec(line)?.[0] ?? DEFAULT_INDENT
  }
  return DEFAULT_INDENT
}

// `key` is mermaid's own short name for the shape, which is what `@{ shape: ... }` takes and
// what everything here addresses a shape by. Four of them predate that syntax and have
// delimiters instead; `group` is only for the picker.
export interface Shape {
  key: string
  name: string
  group: string
  open?: string
  close?: string
}

// Mermaid 11.17.2's whole flowchart vocabulary, in the order the picker shows it. The four
// with delimiters come first so they are also the first four of QUICK_SHAPES.
export const SHAPES: Shape[] = [
  { key: 'rect', name: 'Rectangle', group: 'Basic', open: '[', close: ']' },
  { key: 'rounded', name: 'Rounded', group: 'Basic', open: '(', close: ')' },
  { key: 'diam', name: 'Diamond', group: 'Basic', open: '{', close: '}' },
  { key: 'circle', name: 'Circle', group: 'Basic', open: '((', close: '))' },
  { key: 'stadium', name: 'Stadium', group: 'Basic' },
  { key: 'dbl-circ', name: 'Double circle', group: 'Basic' },
  { key: 'sm-circ', name: 'Small circle', group: 'Basic' },
  { key: 'f-circ', name: 'Filled circle', group: 'Basic' },
  { key: 'fr-circ', name: 'Framed circle', group: 'Basic' },
  { key: 'cross-circ', name: 'Crossed circle', group: 'Basic' },
  { key: 'hex', name: 'Hexagon', group: 'Basic' },
  { key: 'tri', name: 'Triangle', group: 'Basic' },
  { key: 'flip-tri', name: 'Flipped triangle', group: 'Basic' },
  { key: 'lean-r', name: 'Lean right', group: 'Basic' },
  { key: 'lean-l', name: 'Lean left', group: 'Basic' },
  { key: 'trap-b', name: 'Trapezoid', group: 'Basic' },
  { key: 'trap-t', name: 'Flipped trapezoid', group: 'Basic' },
  { key: 'text', name: 'Text block', group: 'Basic' },
  { key: 'bang', name: 'Bang', group: 'Basic' },

  { key: 'fr-rect', name: 'Subprocess', group: 'Process' },
  { key: 'notch-rect', name: 'Card', group: 'Process' },
  { key: 'lin-rect', name: 'Lined process', group: 'Process' },
  { key: 'div-rect', name: 'Divided process', group: 'Process' },
  { key: 'st-rect', name: 'Multi-process', group: 'Process' },
  { key: 'tag-rect', name: 'Tagged process', group: 'Process' },
  { key: 'sl-rect', name: 'Manual input', group: 'Process' },
  { key: 'bow-rect', name: 'Stored data', group: 'Process' },
  { key: 'win-pane', name: 'Internal storage', group: 'Process' },
  { key: 'notch-pent', name: 'Loop limit', group: 'Process' },
  { key: 'curv-trap', name: 'Display', group: 'Process' },
  { key: 'delay', name: 'Delay', group: 'Process' },
  { key: 'hourglass', name: 'Collate', group: 'Process' },
  { key: 'fork', name: 'Fork or join', group: 'Process' },
  { key: 'bolt', name: 'Com link', group: 'Process' },
  { key: 'flag', name: 'Paper tape', group: 'Process' },
  { key: 'odd', name: 'Odd', group: 'Process' },
  { key: 'brace', name: 'Comment', group: 'Process' },
  { key: 'brace-r', name: 'Comment right', group: 'Process' },
  { key: 'braces', name: 'Comment both', group: 'Process' },
  { key: 'doc', name: 'Document', group: 'Process' },
  { key: 'docs', name: 'Multi-document', group: 'Process' },
  { key: 'lin-doc', name: 'Lined document', group: 'Process' },
  { key: 'tag-doc', name: 'Tagged document', group: 'Process' },

  { key: 'cyl', name: 'Database', group: 'Technical' },
  { key: 'h-cyl', name: 'Direct access', group: 'Technical' },
  { key: 'lin-cyl', name: 'Disk storage', group: 'Technical' },
  { key: 'datastore', name: 'Data store', group: 'Technical' },
  { key: 'bucket', name: 'Bucket', group: 'Technical' },
  { key: 'folder', name: 'Folder', group: 'Technical' },
  { key: 'console', name: 'Console', group: 'Technical' },
  { key: 'browser', name: 'Browser', group: 'Technical' },
  { key: 'person', name: 'Person', group: 'Technical' },
  { key: 'cloud', name: 'Cloud', group: 'Technical' },
]

// The four mermaid gives delimiters to, which is also what a hand-written flowchart uses. They
// stay on the toolbar itself, and the 3-6 shortcuts address this list.
export const QUICK_SHAPES = SHAPES.filter((shape) => shape.open !== undefined)

// The metadata block is YAML, where an unquoted scalar stops at the first comma: a label of
// `Hello, world` renders as `Hello`. So this one always quotes, unlike the delimiter forms.
// `#quot;` is the escape in both -- a backslash is a parse error.
function quoteMeta(label: string): string {
  const text = label === '' ? BLANK_LABEL : label
  return `"${text.replaceAll('"', '#quot;')}"`
}

// Mermaid has delimiters for four shapes and `@{ shape: ... }` for the other forty-nine, so a
// declaration is written one way or the other depending on which shape it is for.
function declaration(nodeId: string, label: string, shape: Shape): string {
  if (shape.open === undefined || shape.close === undefined) {
    return `${nodeId}@{ shape: ${shape.key}, label: ${quoteMeta(label)} }`
  }
  return `${nodeId}${shape.open}${quoteLabel(label)}${shape.close}`
}

function occurrences(source: string, nodeId: string): NodeSpan[] {
  return findStatements(source).flatMap((statement) =>
    statement.nodes.filter((node) => node.id === nodeId),
  )
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// Single letters match how flowcharts are written by hand. findNodes over-reports slightly
// (subgraph names, stray identifiers), which is the safe direction for avoiding a collision.
export function nextNodeId(source: string): string {
  const taken = findNodes(source)
  for (const letter of LETTERS) {
    if (!taken.has(letter)) return letter
  }
  for (let suffix = 1; ; suffix += 1) {
    const id = `N${suffix}`
    if (!taken.has(id)) return id
  }
}

function appendNode(source: string, prefix: string, shape: Shape) {
  const nodeId = nextNodeId(source)
  const body = source.endsWith('\n') || source === '' ? source : `${source}\n`
  return {
    source: `${body}${trailingIndent(source)}${prefix}${declaration(nodeId, '', shape)}\n`,
    nodeId,
  }
}

export function addConnectedNode(source: string, fromId: string, shape: Shape) {
  return appendNode(source, `${fromId} --> `, shape)
}

// Standalone nodes are their own dagre component, so this one will not render where the user
// clicked. That is understood and asked for: sometimes you want a node before you know what
// it connects to.
export function addStandaloneNode(source: string, shape: Shape) {
  return appendNode(source, '', shape)
}

// What the node is drawn as, so the picker can show which shape is current. Mermaid's aliases
// -- `db` for `cyl`, and forty more -- are not recognised: an unfamiliar one reports nothing
// selected, and picking a shape rewrites it into the canonical name anyway.
export function shapeOf(source: string, nodeId: string): Shape | null {
  // A separate `A@{ shape: ... }` outranks the declaration, which is how mermaid.ai writes
  // shapes, so it is what the node is actually drawn as.
  const node = occurrences(source, nodeId).find((each) => each.meta) ?? findNodes(source).get(nodeId)
  if (node === undefined) return null

  if (node.meta) {
    const key = /[{,]\s*shape\s*:\s*"?([\w-]+)/.exec(source.slice(node.from, node.to))?.[1]
    return SHAPES.find((shape) => shape.key === key) ?? null
  }

  // A bare id renders as a rectangle, which is the first shape in the list.
  if (node.labelFrom === null) return SHAPES[0] as Shape
  const open = source.slice(node.from + nodeId.length, node.labelFrom)
  return SHAPES.find((shape) => shape.open === open) ?? null
}

// The label is re-quoted for the shape it moves into rather than carried across as text: the
// two forms do not quote the same characters, and the metadata block truncates an unquoted
// label at the first comma.
export function setNodeShape(source: string, nodeId: string, shape: Shape): string {
  const declared = findNodes(source).get(nodeId)
  if (declared === undefined) return source

  const label =
    declared.labelFrom === null || declared.labelTo === null
      ? nodeId
      : unquoteLabel(source.slice(declared.labelFrom, declared.labelTo))

  // Any other `A@{ shape: ... }` goes back to a bare mention. Mermaid lets one override the
  // declaration, so leaving it in place would silently outrank the shape just picked.
  const edits = occurrences(source, nodeId)
    .filter((node) => node.from === declared.from || node.meta)
    .map((node) => ({
      ...node,
      text: node.from === declared.from ? declaration(nodeId, label, shape) : nodeId,
    }))

  let result = source
  for (const edit of edits.reverse()) {
    result = result.slice(0, edit.from) + edit.text + result.slice(edit.to)
  }
  return result
}

export interface NodeColor {
  name: string
  fill: string
  stroke: string
}

// Fill and stroke together, never fill alone: mermaid's default node stroke is purple, and it
// stays purple over a red fill unless the style statement replaces it too.
export const COLORS: NodeColor[] = [
  { name: 'Grey', fill: '#e9ecef', stroke: '#868e96' },
  { name: 'Red', fill: '#ffc9c9', stroke: '#e03131' },
  { name: 'Orange', fill: '#ffd8a8', stroke: '#f08c00' },
  { name: 'Green', fill: '#b2f2bb', stroke: '#2f9e44' },
  { name: 'Blue', fill: '#a5d8ff', stroke: '#1971c2' },
  { name: 'Purple', fill: '#d0bfff', stroke: '#6741d9' },
]

// `style A fill:...` is one statement per node, and the id is the first thing in it.
function styleStatement(source: string, nodeId: string): Statement | undefined {
  return findStatements(source).find(
    (statement) => statement.keyword === 'style' && statement.nodes[0]?.id === nodeId,
  )
}

function declarationsOf(source: string, statement: Statement): string {
  const id = statement.nodes[0] as NodeSpan
  return source.slice(id.to, statement.to)
}

const COLOR_PROPERTIES = new Set(['fill', 'stroke'])

// Everything the palette does not own is carried across, so a hand-written `stroke-width:4px`
// survives being recoloured.
function withoutColor(declarations: string): string[] {
  return declarations
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !COLOR_PROPERTIES.has(part.split(':')[0]?.trim() ?? ''))
}

export function colorOf(source: string, nodeId: string): NodeColor | null {
  const statement = styleStatement(source, nodeId)
  if (statement === undefined) return null
  const fill = /(?:^|,)\s*fill\s*:\s*([^,]+)/.exec(declarationsOf(source, statement))?.[1]?.trim()
  return COLORS.find((color) => color.fill === fill) ?? null
}

export function setNodeColor(source: string, nodeId: string, color: NodeColor | null): string {
  // `style X` on an unknown id compiles to an addVertex, so this would invent a blank node.
  if (!findNodes(source).has(nodeId)) return source

  const statement = styleStatement(source, nodeId)

  if (statement === undefined) {
    if (color === null) return source
    const body = source.endsWith('\n') || source === '' ? source : `${source}\n`
    const indent = trailingIndent(source)
    return `${body}${indent}style ${nodeId} fill:${color.fill},stroke:${color.stroke}\n`
  }

  const kept = withoutColor(declarationsOf(source, statement))
  const applied = color === null ? [] : [`fill:${color.fill}`, `stroke:${color.stroke}`]
  const declarations = [...applied, ...kept]

  // Nothing left to say about the node, so the statement goes rather than sitting there empty.
  if (declarations.length === 0) {
    const span = removalSpan(source, statement)
    return source.slice(0, span.from) + source.slice(span.to)
  }

  const rewritten = `style ${nodeId} ${declarations.join(',')}`
  return source.slice(0, statement.from) + rewritten + source.slice(statement.to)
}

export function connectNodes(source: string, fromId: string, toId: string): string {
  const body = source.endsWith('\n') || source === '' ? source : `${source}\n`
  return `${body}${trailingIndent(source)}${fromId} --> ${toId}\n`
}

// Statements that only attach something to a node, and so have to leave with it. `style X`
// is the one that matters: mermaid compiles it to an addVertex, so a style line outliving
// its node brings the node back as a blank box rather than erroring.
const ATTACHMENTS = new Set(['style', 'class', 'click'])

function lineStartOf(source: string, index: number): number {
  return source.lastIndexOf('\n', index - 1) + 1
}

function indentOf(source: string, index: number): string {
  const prefix = source.slice(lineStartOf(source, index), index)
  return prefix.trim() === '' ? prefix : ''
}

// A statement alone on its line takes the whole line with it; one packed onto a line with
// others takes only its own text and the separator that followed it.
function removalSpan(source: string, statement: Statement): Span {
  let to = statement.to
  while (source[to] === ' ' || source[to] === '\t') to += 1
  if (source[to] === ';') {
    to += 1
    while (source[to] === ' ' || source[to] === '\t') to += 1
  }

  const start = lineStartOf(source, statement.from)
  if (source.slice(start, statement.from).trim() !== '') return { from: statement.from, to }
  if (to !== source.length && source[to] !== '\n') return { from: statement.from, to }
  return { from: start, to: to === source.length ? to : to + 1 }
}

// What a statement becomes: the lines standing in its place, or nothing, in which case the
// statement's line goes too. Continuation lines take the statement's own indentation, which
// is what keeps a rescued node inside its subgraph.
function restatement(source: string, statement: Statement, lines: string[]) {
  const span = lines.length === 0 ? removalSpan(source, statement) : statement
  return { from: span.from, to: span.to, text: lines.join(`\n${indentOf(source, statement.from)}`) }
}

// Deleting a node deletes its edges and nothing else. Because mermaid declares most nodes
// inside an edge statement, removing those statements would take the neighbours' labels with
// them, so any node left without a declaration is re-emitted where its statement stood --
// which also keeps it inside whatever subgraph it was in.
export function deleteNode(source: string, nodeId: string): string {
  const statements = findStatements(source)
  const doomed = statements.filter(
    (statement) =>
      (statement.keyword === null || ATTACHMENTS.has(statement.keyword)) &&
      statement.nodes.some((node) => node.id === nodeId),
  )
  if (doomed.length === 0) return source

  // Keyed by scope as well as id, because a node belongs to the subgraph that mentions it:
  // losing its only mention inside a box would silently move it out of the box.
  const key = (scope: number, id: string) => `${scope} ${id}`
  const surviving = new Set(
    statements
      .filter((statement) => statement.keyword === null && !doomed.includes(statement))
      .flatMap((statement) => statement.nodes.map((node) => key(statement.scope, node.id))),
  )

  const declarations = findNodes(source)
  const rescued = new Set<string>()

  // Worked out front to back so a node orphaned by several statements comes back at the first
  // of them, then applied back to front so the earlier offsets stay valid.
  const edits = doomed.map((statement) => {
    const lost: string[] = []
    if (statement.keyword === null) {
      for (const node of statement.nodes) {
        const here = key(statement.scope, node.id)
        if (node.id === nodeId || rescued.has(here)) continue
        // A declaration is where the node's label and shape live, so it has to come back even
        // when the id itself survives: every other mention may be a bare reference, and
        // letting this one go strips the label off a node nobody asked to change.
        if (surviving.has(here) && node.labelFrom === null && !node.meta) continue
        rescued.add(here)
        const declaration = declarations.get(node.id)
        lost.push(
          declaration === undefined ? node.id : source.slice(declaration.from, declaration.to),
        )
      }
    }
    return { statement, lost }
  })

  let result = source
  for (const { statement, lost } of edits.reverse()) {
    const { from, to, text } = restatement(source, statement, lost)
    result = result.slice(0, from) + text + result.slice(to)
  }

  return result
}

export function edgeCount(source: string): number {
  return findEdges(source).length
}

// Takes the pipes with it, leaving `A --> B`. Not the same as renaming the label to nothing:
// mermaid has no empty label, so a cleared one is stored as a quoted blank and still renders
// an empty box sitting on the edge.
export function deleteEdgeLabel(source: string, index: number): string {
  const span = findEdgeLabels(source)[index]
  if (span === undefined) return source
  return source.slice(0, span.from - 1) + source.slice(span.to + 1)
}

// Deleting an edge splits the statement that carried it, rather than removing it: the halves
// either side of the link are still chains, and `A --> B --> C` losing its first edge has to
// leave `B --> C` behind. A half that is a single node is dropped when it is only a bare
// reference to a node mentioned elsewhere, and kept when dropping it would lose the node or
// its label.
export function deleteEdge(source: string, index: number): string {
  const edge = findEdges(source)[index]
  if (edge === undefined) return source

  const { statement, position } = edge
  const elsewhere = new Set(
    findStatements(source)
      // Compared by offset, not identity: `statement` came out of the scan inside findEdges,
      // so the object here that stands for the same statement is a different one.
      .filter(
        (other) =>
          other.keyword === null &&
          other.from !== statement.from &&
          other.scope === statement.scope,
      )
      .flatMap((other) => other.nodes.map((node) => node.id)),
  )

  const parts: string[] = []
  for (const half of [statement.nodes.slice(0, position), statement.nodes.slice(position)]) {
    const first = half[0] as NodeSpan
    const last = half[half.length - 1] as NodeSpan
    if (half.length === 1 && first.labelFrom === null && !first.meta && elsewhere.has(first.id))
      continue
    parts.push(source.slice(first.from, last.to))
    for (const node of half) elsewhere.add(node.id)
  }

  const { from, to, text } = restatement(source, statement, parts)
  return source.slice(0, from) + text + source.slice(to)
}

export function renameLabel(source: string, nodeId: string, label: string): string {
  const node = findNodes(source).get(nodeId)
  if (node === undefined) return source

  if (node.labelFrom !== null && node.labelTo !== null) {
    const replacement = node.meta ? quoteMeta(label) : quoteLabel(label)
    return source.slice(0, node.labelFrom) + replacement + source.slice(node.labelTo)
  }

  // `A@{ shape: cyl }` has no delimiters to put a label between, so it goes in the block, after
  // the last entry rather than after the padding that follows it.
  if (node.meta) {
    let end = node.to - 1
    while (/\s/.test(source[end - 1] as string)) end -= 1
    return `${source.slice(0, end)}, label: ${quoteMeta(label)}${source.slice(end)}`
  }

  // Bare node: give it a shape in place, leaving every other mention of the id alone.
  return `${source.slice(0, node.to)}[${quoteLabel(label)}]${source.slice(node.to)}`
}
