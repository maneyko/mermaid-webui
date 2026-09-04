import { expect, test } from 'bun:test'
import { findNodes } from './correlate'

function spanOf(source: string, id: string): string {
  const node = findNodes(source).get(id)
  if (node === undefined) throw new Error(`no node ${id}`)
  return source.slice(node.from, node.to)
}

function labelOf(source: string, id: string): string | null {
  const node = findNodes(source).get(id)
  if (node === undefined) throw new Error(`no node ${id}`)
  if (node.labelFrom === null || node.labelTo === null) return null
  return source.slice(node.labelFrom, node.labelTo)
}

test('finds a declaration and its label', () => {
  const source = 'flowchart TD\n  A[Christmas] --> B(Go shopping)\n'
  expect(spanOf(source, 'A')).toBe('A[Christmas]')
  expect(labelOf(source, 'A')).toBe('Christmas')
  expect(spanOf(source, 'B')).toBe('B(Go shopping)')
  expect(labelOf(source, 'B')).toBe('Go shopping')
})

test('prefers the labelled occurrence over an earlier bare one', () => {
  const source = 'flowchart TD\n  A --> B\n  B[Later label] --> C\n'
  expect(spanOf(source, 'B')).toBe('B[Later label]')
})

test('keeps a bare node when it never carries a label', () => {
  const source = 'flowchart TD\n  A --> B\n'
  expect(spanOf(source, 'B')).toBe('B')
  expect(labelOf(source, 'B')).toBeNull()
})

test('handles nested shape delimiters', () => {
  const source = 'flowchart TD\n  A[[Subroutine]] --> B((Circle))\n'
  expect(spanOf(source, 'A')).toBe('A[[Subroutine]]')
  expect(labelOf(source, 'A')).toBe('[Subroutine]')
  expect(spanOf(source, 'B')).toBe('B((Circle))')
})

test('does not mistake edge labels for nodes', () => {
  const source = 'flowchart TD\n  A -->|Get money| B\n'
  expect(findNodes(source).has('Get')).toBe(false)
  expect(findNodes(source).has('money')).toBe(false)
})

test('ignores comments', () => {
  const source = 'flowchart TD\n  %% Ghost[Not real]\n  A --> B\n'
  expect(findNodes(source).has('Ghost')).toBe(false)
})

test('ignores keywords and directions', () => {
  const source = 'flowchart LR\n  subgraph Box\n    A --> B\n  end\n'
  for (const keyword of ['flowchart', 'LR', 'subgraph', 'end']) {
    expect(findNodes(source).has(keyword)).toBe(false)
  }
})

test('ends an id at an arrow rather than eating the dashes', () => {
  const source = 'flowchart TD\n  A-->B\n'
  expect(findNodes(source).has('A')).toBe(true)
  expect(findNodes(source).has('B')).toBe(true)
})

test('keeps hyphens inside an id', () => {
  const source = 'flowchart TD\n  node-1[First] --> node-2[Second]\n'
  expect(spanOf(source, 'node-1')).toBe('node-1[First]')
  expect(spanOf(source, 'node-2')).toBe('node-2[Second]')
})

test('spans point at the right offsets in the original text', () => {
  const source = 'flowchart TD\n  A[Christmas] --> B\n'
  const node = findNodes(source).get('A')
  expect(node?.from).toBe(source.indexOf('A[Christmas]'))
  expect(node?.to).toBe(source.indexOf('A[Christmas]') + 'A[Christmas]'.length)
})

test('an unterminated shape does not swallow the rest of the file', () => {
  const source = 'flowchart TD\n  A[Unclosed\n  B --> C\n'
  expect(spanOf(source, 'A')).toBe('A')
  expect(findNodes(source).has('C')).toBe(true)
})
