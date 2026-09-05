import { expect, test } from 'bun:test'
import {
  connectNodes,
  edgeLabelCount,
  edgeLabelOf,
  labelOf,
  quoteLabel,
  renameEdgeLabel,
  renameLabel,
  unquoteLabel,
} from './edit'

const SOURCE = `flowchart TD
  A[Christmas] -->|Get money| B(Go shopping)
  B --> C{Let me think}
`

test('renames a label and leaves the rest of the line byte-identical', () => {
  const next = renameLabel(SOURCE, 'A', 'Hanukkah')
  expect(next).toBe(`flowchart TD
  A[Hanukkah] -->|Get money| B(Go shopping)
  B --> C{Let me think}
`)
})

test('renames inside a shape it did not choose the delimiter for', () => {
  expect(renameLabel(SOURCE, 'C', 'Decide')).toContain('C{Decide}')
  expect(renameLabel(SOURCE, 'B', 'Shop')).toContain('B(Shop)')
})

test('touches only the declaration, not other mentions of the id', () => {
  const next = renameLabel(SOURCE, 'B', 'Shop')
  expect(next).toContain('B(Shop)')
  expect(next).toContain('  B --> C{Let me think}')
})

test('quotes a label that would otherwise break the shape', () => {
  expect(renameLabel(SOURCE, 'A', 'Buy [things]')).toContain('A["Buy [things]"]')
  expect(renameLabel(SOURCE, 'A', 'a|b')).toContain('A["a|b"]')
})

test('escapes embedded quotes rather than emitting broken syntax', () => {
  expect(quoteLabel('say "hi"')).toBe('"say #quot;hi#quot;"')
  expect(unquoteLabel('"say #quot;hi#quot;"')).toBe('say "hi"')
})

test('quoting round-trips through unquoting', () => {
  for (const label of ['plain', 'Buy [things]', 'a|b', 'say "hi"', ' padded ', '']) {
    expect(unquoteLabel(quoteLabel(label))).toBe(label)
  }
})

test('leaves an ordinary label unquoted', () => {
  expect(quoteLabel('Go shopping')).toBe('Go shopping')
})

test('gives a bare node a shape without disturbing its other mentions', () => {
  const source = 'flowchart TD\n  A --> B\n  B --> C\n'
  expect(renameLabel(source, 'B', 'Middle')).toBe('flowchart TD\n  A --> B[Middle]\n  B --> C\n')
})

test('reads back the label that is on screen', () => {
  expect(labelOf(SOURCE, 'A')).toBe('Christmas')
  expect(labelOf(SOURCE, 'C')).toBe('Let me think')
  expect(labelOf('flowchart TD\n  A --> B\n', 'B')).toBe('B')
  expect(labelOf('flowchart TD\n  A["a|b"] --> B\n', 'A')).toBe('a|b')
})

test('connecting appends one line and leaves the rest untouched', () => {
  expect(connectNodes(SOURCE, 'B', 'C')).toBe(`${SOURCE}  B --> C\n`)
})

test('an appended connection matches the existing indentation', () => {
  const deep = 'flowchart TD\n      A --> B\n'
  expect(connectNodes(deep, 'B', 'A')).toBe('flowchart TD\n      A --> B\n      B --> A\n')
})

test('connecting copes with a source that does not end in a newline', () => {
  expect(connectNodes('flowchart TD\n  A --> B', 'B', 'C')).toBe(
    'flowchart TD\n  A --> B\n  B --> C\n',
  )
})

test('a self-connection is left to mermaid, which renders it as a loop', () => {
  expect(connectNodes(SOURCE, 'A', 'A')).toContain('A --> A')
})

test('an appended connection is readable by the scanner', () => {
  const next = connectNodes(SOURCE, 'B', 'C')
  expect(labelOf(next, 'B')).toBe('Go shopping')
  expect(labelOf(next, 'C')).toBe('Let me think')
})

const LABELLED = `flowchart TD
  A[Christmas] -->|Get money| B(Go shopping)
  B --> C{Let me think}
  C -->|One| D[Laptop]
  C -->|Three| F[Car]
`

test('edge labels are found in declaration order, skipping unlabelled edges', () => {
  expect(edgeLabelCount(LABELLED)).toBe(3)
  expect([0, 1, 2].map((i) => edgeLabelOf(LABELLED, i))).toEqual(['Get money', 'One', 'Three'])
})

test('renaming an edge label leaves the rest of the line byte-identical', () => {
  expect(renameEdgeLabel(LABELLED, 0, 'Find cash')).toBe(`flowchart TD
  A[Christmas] -->|Find cash| B(Go shopping)
  B --> C{Let me think}
  C -->|One| D[Laptop]
  C -->|Three| F[Car]
`)
})

test('renaming edge label 1 does not touch edge label 0 or 2', () => {
  const next = renameEdgeLabel(LABELLED, 1, 'First')
  expect([0, 1, 2].map((i) => edgeLabelOf(next, i))).toEqual(['Get money', 'First', 'Three'])
})

test('a pipe inside a node label is not mistaken for an edge label', () => {
  const source = 'flowchart TD\n  A["a|b"] -->|Real| B\n'
  expect(edgeLabelCount(source)).toBe(1)
  expect(edgeLabelOf(source, 0)).toBe('Real')
})

test('an edge label containing a pipe is quoted and round-trips', () => {
  const next = renameEdgeLabel(LABELLED, 0, 'yes|no')
  expect(next).toContain('|"yes|no"|')
  expect(edgeLabelOf(next, 0)).toBe('yes|no')
  expect(edgeLabelCount(next)).toBe(3)
})

test('edge labels in comments are ignored', () => {
  const source = 'flowchart TD\n  %% A -->|Ghost| B\n  A -->|Real| B\n'
  expect(edgeLabelCount(source)).toBe(1)
  expect(edgeLabelOf(source, 0)).toBe('Real')
})

test('an out-of-range edge index leaves the source untouched', () => {
  expect(renameEdgeLabel(LABELLED, 9, 'nope')).toBe(LABELLED)
})

test('an unknown node leaves the source untouched', () => {
  expect(renameLabel(SOURCE, 'ZZZ', 'nope')).toBe(SOURCE)
})

test('an emptied label stays valid mermaid', () => {
  expect(renameLabel(SOURCE, 'A', '')).toContain('A[""]')
})

test('a rename survives a second rename', () => {
  const once = renameLabel(SOURCE, 'A', 'Buy [things]')
  expect(labelOf(once, 'A')).toBe('Buy [things]')
  expect(renameLabel(once, 'A', 'Plain')).toContain('A[Plain]')
})

// An unbalanced delimiter is the case that broke: we emit it happily, so we must be able to
// read it back, or a second rename appends a second shape instead of replacing the label.
test('a label with an unbalanced delimiter round-trips', () => {
  for (const awkward of ['Buy [things', 'close ) paren', 'open { brace']) {
    const once = renameLabel(SOURCE, 'A', awkward)
    expect(labelOf(once, 'A')).toBe(awkward)
    expect(renameLabel(once, 'A', 'Plain')).toContain('A[Plain]')
  }
})
