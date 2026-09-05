import { expect, test } from 'bun:test'
import { edgeLabelSpan, findEdges, findNodes, findStatements } from './correlate'

// The text of each edge's label, or null where the edge has none.
function edgeLabels(source: string): (string | null)[] {
  return findEdges(source).map((edge) => {
    const span = edgeLabelSpan(source, edge)
    return span === null ? null : source.slice(span.from, span.to)
  })
}

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

// A doubled delimiter is one shape, not a nested pair, so the label excludes both halves.
// Renaming would otherwise rewrite `B((Circle))` as `B(Wrapped)` and lose the shape.
test('handles doubled shape delimiters', () => {
  const source = 'flowchart TD\n  A[[Subroutine]] --> B((Circle))\n'
  expect(spanOf(source, 'A')).toBe('A[[Subroutine]]')
  expect(labelOf(source, 'A')).toBe('Subroutine')
  expect(spanOf(source, 'B')).toBe('B((Circle))')
  expect(labelOf(source, 'B')).toBe('Circle')
})

test('a balanced pair inside a single delimiter is still part of the label', () => {
  const source = 'flowchart TD\n  A[a (b) c] --> B\n'
  expect(labelOf(source, 'A')).toBe('a (b) c')
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

test('delimiters inside a quoted label do not affect nesting', () => {
  const source = 'flowchart TD\n  A["Buy [things"] --> B\n'
  expect(spanOf(source, 'A')).toBe('A["Buy [things"]')
  expect(labelOf(source, 'A')).toBe('"Buy [things"')
})

test('an unterminated shape does not swallow the rest of the file', () => {
  const source = 'flowchart TD\n  A[Unclosed\n  B --> C\n'
  expect(spanOf(source, 'A')).toBe('A')
  expect(findNodes(source).has('C')).toBe(true)
})

// findEdgeLabels learned to skip the quotes here; this walk had not, so it took `no` for a
// node and then ran the unpaired quote to the end of the file, losing every node after it.
test('a pipe inside a quoted edge label does not end the label', () => {
  const source = 'flowchart TD\n  A -->|"yes|no"| B\n  B --> C\n'
  expect([...findNodes(source).keys()]).toEqual(['A', 'B', 'C'])
})

const text = (source: string) => findStatements(source).map((s) => source.slice(s.from, s.to))

test('statements are split on newlines, trimmed of their indentation', () => {
  expect(text('flowchart TD\n  A --> B\n  B --> C\n')).toEqual([
    'flowchart TD',
    'A --> B',
    'B --> C',
  ])
})

test('a semicolon separates statements, but one inside a label does not', () => {
  expect(text('flowchart TD\n  A --> B; C --> D\n')).toEqual([
    'flowchart TD',
    'A --> B',
    'C --> D',
  ])
  expect(text('flowchart TD\n  A["a;b"] --> B\n')).toEqual(['flowchart TD', 'A["a;b"] --> B'])
})

test('a statement reports its leading keyword, and a graph statement reports none', () => {
  const source = 'flowchart TD\n  A --> B\n  style A fill:#f9f\n'
  expect(findStatements(source).map((s) => s.keyword)).toEqual(['flowchart', null, 'style'])
})

test('statements know which subgraph encloses them', () => {
  const source = 'flowchart TD\n  subgraph Box\n    A --> B\n  end\n  B --> C\n'
  const statements = findStatements(source)
  // The header and the `end` belong outside the box; only `A --> B` is inside it.
  expect(statements.map((s) => s.scope)).toEqual([-1, -1, 1, -1, -1])
})

// x and o are arrowheads hard against the link, and ordinary node ids anywhere else.
test('does not mistake an arrowhead for a node', () => {
  expect([...findNodes('flowchart TD\n  A --x B\n').keys()]).toEqual(['A', 'B'])
  expect([...findNodes('flowchart TD\n  A --o B\n').keys()]).toEqual(['A', 'B'])
  expect([...findNodes('flowchart TD\n  A --> x\n').keys()]).toEqual(['A', 'x'])
})

// Mermaid 11's shape metadata. The keys inside the block are the trap: read as identifiers,
// `shape` and `cyl` become nodes that are not in the diagram.
test('reads a metadata declaration and its label', () => {
  const source = 'flowchart TD\n  A@{ shape: cyl, label: "Christmas" } --> B\n'
  expect([...findNodes(source).keys()]).toEqual(['A', 'B'])
  expect(spanOf(source, 'A')).toBe('A@{ shape: cyl, label: "Christmas" }')
  expect(labelOf(source, 'A')).toBe('"Christmas"')
})

test('a metadata block without a label is still a declaration', () => {
  const source = 'flowchart TD\n  A@{ shape: cyl }\n'
  expect(spanOf(source, 'A')).toBe('A@{ shape: cyl }')
  expect(labelOf(source, 'A')).toBeNull()
  expect(findNodes(source).get('A')?.meta).toBe(true)
})

test('label may come first in the block, and may be unquoted', () => {
  expect(labelOf('flowchart TD\n  A@{ label: Christmas, shape: cyl }\n', 'A')).toBe('Christmas')
  expect(labelOf('flowchart TD\n  A@{ label: Christmas }\n', 'A')).toBe('Christmas')
})

test('a brace inside a quoted metadata label does not close the block', () => {
  const source = 'flowchart TD\n  A@{ shape: cyl, label: "a}b" } --> B\n'
  expect([...findNodes(source).keys()]).toEqual(['A', 'B'])
  expect(labelOf(source, 'A')).toBe('"a}b"')
})

test('a pipe inside a metadata label is not an edge label', () => {
  expect(edgeLabels('flowchart TD\n  A@{ shape: cyl, label: "a|b" } -->|Real| B\n')).toEqual([
    'Real',
  ])
})

// The label belongs to the edge it rides on, so it is found inside the link span rather than
// by counting `|` pairs across the file. An edge without one reports null, not the next one.
test('each edge reports its own label, and null where it has none', () => {
  const source = 'flowchart TD\n  A -->|x| B\n  B --> C\n  C -->|y| D\n'
  expect(edgeLabels(source)).toEqual(['x', null, 'y'])
})

test('a pipe inside a node label is not mistaken for an edge label', () => {
  expect(edgeLabels('flowchart TD\n  A["a|b"] -->|Real| B\n')).toEqual(['Real'])
})

test('a pipe inside a quoted edge label does not end it', () => {
  expect(edgeLabels('flowchart TD\n  A -->|"yes|no"| B\n')).toEqual(['"yes|no"'])
})

test('an edge label in a comment is not an edge at all', () => {
  expect(edgeLabels('flowchart TD\n  %% A -->|Ghost| B\n  A -->|Real| B\n')).toEqual(['Real'])
})

test('sibling subgraphs are different scopes', () => {
  const source = 'flowchart TD\n  subgraph One\n    A\n  end\n  subgraph Two\n    B\n  end\n'
  const statements = findStatements(source)
  expect(statements[2]?.scope).toBe(1)
  expect(statements[5]?.scope).toBe(4)
})
