import { expect, test } from 'bun:test'
import { labelOf, quoteLabel, renameLabel, unquoteLabel } from './edit'

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
