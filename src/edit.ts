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
