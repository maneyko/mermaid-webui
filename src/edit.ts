// Writing changes back into the source. Every function here returns a new source string with
// the smallest possible edit applied: byte ranges outside the span being changed must come
// back identical, because the user hand-edits this text and keeps it in git.

import { findNodes } from './correlate'

// Anything that would terminate a shape early, or that mermaid reads as syntax inside one.
const NEEDS_QUOTING = /["[\]{}()|<>]/

export function quoteLabel(label: string): string {
  if (label !== '' && label === label.trim() && !NEEDS_QUOTING.test(label)) return label
  return `"${label.replaceAll('"', '#quot;')}"`
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
