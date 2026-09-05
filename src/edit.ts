// Writing changes back into the source. Every function here returns a new source string with
// the smallest possible edit applied: byte ranges outside the span being changed must come
// back identical, because the user hand-edits this text and keeps it in git.

import { findEdgeLabels, findNodes } from './correlate'

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
