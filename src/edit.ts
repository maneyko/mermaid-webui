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

export interface Shape {
  name: string
  open: string
  close: string
}

export const SHAPES: Shape[] = [
  { name: 'Rectangle', open: '[', close: ']' },
  { name: 'Rounded', open: '(', close: ')' },
  { name: 'Diamond', open: '{', close: '}' },
  { name: 'Circle', open: '((', close: '))' },
]

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
  const blank = quoteLabel('')
  return {
    source: `${body}${trailingIndent(source)}${prefix}${nodeId}${shape.open}${blank}${shape.close}\n`,
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

// The label is carried across verbatim rather than re-quoted, so an already-quoted one such as
// `"a|b"` survives a shape change untouched.
export function setNodeShape(source: string, nodeId: string, shape: Shape): string {
  const node = findNodes(source).get(nodeId)
  if (node === undefined) return source

  const label =
    node.labelFrom === null || node.labelTo === null
      ? quoteLabel(nodeId)
      : source.slice(node.labelFrom, node.labelTo)

  return `${source.slice(0, node.from)}${nodeId}${shape.open}${label}${shape.close}${source.slice(node.to)}`
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
        // A labelled occurrence is where the node's label lives, so it has to come back even
        // when the id itself survives: every other mention may be a bare reference, and
        // letting this one go strips the label off a node nobody asked to change.
        if (surviving.has(here) && node.labelFrom === null) continue
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
    const span = lost.length === 0 ? removalSpan(source, statement) : statement
    result =
      result.slice(0, span.from) +
      lost.join(`\n${indentOf(source, statement.from)}`) +
      result.slice(span.to)
  }

  return result
}

export function edgeCount(source: string): number {
  return findEdges(source).length
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
    if (half.length === 1 && first.labelFrom === null && elsewhere.has(first.id)) continue
    parts.push(source.slice(first.from, last.to))
    for (const node of half) elsewhere.add(node.id)
  }

  const span = parts.length === 0 ? removalSpan(source, statement) : statement
  return (
    source.slice(0, span.from) +
    parts.join(`\n${indentOf(source, statement.from)}`) +
    source.slice(span.to)
  )
}

export function renameLabel(source: string, nodeId: string, label: string): string {
  const node = findNodes(source).get(nodeId)
  if (node === undefined) return source

  const replacement = quoteLabel(label)

  if (node.labelFrom !== null && node.labelTo !== null) {
    return source.slice(0, node.labelFrom) + replacement + source.slice(node.labelTo)
  }

  // Bare node: give it a shape in place, leaving every other mention of the id alone.
  return `${source.slice(0, node.to)}[${replacement}]${source.slice(node.to)}`
}
