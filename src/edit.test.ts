import { expect, test } from 'bun:test'
import {
  addConnectedNode,
  addStandaloneNode,
  colorOf,
  COLORS,
  connectNodes,
  setNodeColor,
  deleteEdge,
  deleteEdgeLabel,
  deleteNode,
  edgeCount,
  nextNodeId,
  setNodeShape,
  SHAPES,
  edgeLabelCount,
  edgeLabelOf,
  labelOf,
  quoteLabel,
  renameEdgeLabel,
  renameLabel,
  shapeOf,
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
  for (const label of ['plain', 'Buy [things]', 'a|b', 'say "hi"', ' padded ']) {
    expect(unquoteLabel(quoteLabel(label))).toBe(label)
  }
})

// Verified against mermaid 11.17.2: `A[""]`, `A("")`, `A{""}` and `A((""))` are all parse
// errors, while a quoted blank space parses in every shape.
test('a cleared label becomes a blank space, because mermaid has no empty label', () => {
  expect(quoteLabel('')).toBe('" "')
  expect(unquoteLabel(quoteLabel(''))).toBe(' ')
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

const shape = (key: string) => {
  const found = SHAPES.find((s) => s.key === key)
  if (found === undefined) throw new Error(`no shape ${key}`)
  return found
}

test('a new node id avoids every id already in use', () => {
  expect(nextNodeId(SOURCE)).toBe('D')
  expect(nextNodeId('flowchart TD\n  A --> B\n')).toBe('C')
})

test('adding a connected node appends one line and reports the new id', () => {
  const added = addConnectedNode(SOURCE, 'C', shape('diam'))
  expect(added.nodeId).toBe('D')
  expect(added.source).toBe(`${SOURCE}  C --> D{" "}\n`)
})

test('a standalone node is appended with no edge', () => {
  const added = addStandaloneNode(SOURCE, shape('rect'))
  expect(added.nodeId).toBe('D')
  expect(added.source).toBe(`${SOURCE}  D[" "]\n`)
})

test('a standalone node is readable back and nameable', () => {
  const added = addStandaloneNode(SOURCE, shape('diam'))
  expect(labelOf(added.source, 'D')).toBe(' ')
  expect(renameLabel(added.source, 'D', 'Alone')).toContain('D{Alone}')
})

test('a newly added node is readable back by the scanner', () => {
  const added = addConnectedNode(SOURCE, 'C', shape('circle'))
  expect(added.source).toContain('C --> D((" "))')
  expect(labelOf(added.source, 'D')).toBe(' ')
  // The shape must survive being named, which is what the doubled-delimiter fix is for.
  expect(renameLabel(added.source, 'D', 'Wrap it')).toContain('D((Wrap it))')
})

test('changing a shape keeps the label and the rest of the line', () => {
  expect(setNodeShape(SOURCE, 'A', shape('diam'))).toBe(`flowchart TD
  A{Christmas} -->|Get money| B(Go shopping)
  B --> C{Let me think}
`)
})

test('changing a shape carries an already-quoted label across untouched', () => {
  const source = 'flowchart TD\n  A["a|b"] --> B\n'
  const next = setNodeShape(source, 'A', shape('rounded'))
  expect(next).toBe('flowchart TD\n  A("a|b") --> B\n')
  expect(labelOf(next, 'A')).toBe('a|b')
})

test('giving a bare node a shape uses its id as the label it already displayed', () => {
  expect(setNodeShape('flowchart TD\n  A --> B\n', 'B', shape('diam'))).toBe(
    'flowchart TD\n  A --> B{B}\n',
  )
})

test('changing shape is reversible', () => {
  const diamond = setNodeShape(SOURCE, 'A', shape('diam'))
  expect(setNodeShape(diamond, 'A', shape('rect'))).toBe(SOURCE)
})

test('an unknown node keeps its shape request to itself', () => {
  expect(setNodeShape(SOURCE, 'ZZZ', shape('circle'))).toBe(SOURCE)
})

// Only four shapes have delimiters; the other forty-nine are written as metadata, which
// replaces the declaration rather than sitting on a line of its own.
test('a shape with no delimiters is written into the declaration', () => {
  expect(setNodeShape(SOURCE, 'A', shape('cyl'))).toBe(`flowchart TD
  A@{ shape: cyl, label: "Christmas" } -->|Get money| B(Go shopping)
  B --> C{Let me think}
`)
})

test('a metadata shape is reversible, back to delimiters', () => {
  const cylinder = setNodeShape(SOURCE, 'A', shape('cyl'))
  expect(setNodeShape(cylinder, 'A', shape('rect'))).toBe(SOURCE)
  expect(setNodeShape(cylinder, 'A', shape('hex'))).toContain('A@{ shape: hex, label: "Christmas" }')
})

test('the metadata form always quotes, because an unquoted label stops at the comma', () => {
  const source = setNodeShape('flowchart TD\n  A[Hello, world]\n', 'A', shape('cyl'))
  expect(source).toBe('flowchart TD\n  A@{ shape: cyl, label: "Hello, world" }\n')
  expect(labelOf(source, 'A')).toBe('Hello, world')
})

test('a bare node given a metadata shape keeps showing its id', () => {
  expect(setNodeShape('flowchart TD\n  A --> B\n', 'B', shape('doc'))).toBe(
    'flowchart TD\n  A --> B@{ shape: doc, label: "B" }\n',
  )
})

// Mermaid lets a separate `A@{ shape: ... }` override the declaration -- it is how mermaid.ai
// writes shapes -- so one left standing would outrank the shape just picked.
test('a separate metadata statement goes back to a bare mention', () => {
  const source = 'flowchart TD\n  A["Cylinder"] --> B\n  A@{ shape: cyl }\n'
  expect(setNodeShape(source, 'A', shape('hex'))).toBe(
    'flowchart TD\n  A@{ shape: hex, label: "Cylinder" } --> B\n  A\n',
  )
})

test('renaming a metadata node replaces only the label value', () => {
  const source = 'flowchart TD\n  A@{ shape: cyl, label: "Christmas" } --> B\n'
  expect(renameLabel(source, 'A', 'Hanukkah')).toBe(
    'flowchart TD\n  A@{ shape: cyl, label: "Hanukkah" } --> B\n',
  )
})

test('renaming a metadata node that has no label adds one', () => {
  const source = 'flowchart TD\n  A@{ shape: cyl }\n'
  const next = renameLabel(source, 'A', 'Christmas')
  expect(next).toBe('flowchart TD\n  A@{ shape: cyl, label: "Christmas" }\n')
  expect(labelOf(next, 'A')).toBe('Christmas')
})

test('what a metadata shape writes is readable back by the scanner', () => {
  const next = setNodeShape(SOURCE, 'B', shape('cyl'))
  expect(labelOf(next, 'B')).toBe('Go shopping')
  expect(edgeCount(next)).toBe(2)
  expect(edgeLabelCount(next)).toBe(1)
  expect(nextNodeId(next)).toBe('D')
  expect(renameLabel(next, 'B', 'a|b, "c"')).toContain('label: "a|b, #quot;c#quot;"')
})

test('adding a node with a metadata shape', () => {
  const added = addConnectedNode(SOURCE, 'C', shape('cyl'))
  expect(added.source).toBe(`${SOURCE}  C --> D@{ shape: cyl, label: " " }\n`)
  expect(labelOf(added.source, 'D')).toBe(' ')
})

test('the current shape reads back from either form', () => {
  expect(shapeOf(SOURCE, 'A')?.key).toBe('rect')
  expect(shapeOf(SOURCE, 'C')?.key).toBe('diam')
  expect(shapeOf('flowchart TD\n  A --> B\n', 'B')?.key).toBe('rect')
  expect(shapeOf('flowchart TD\n  A((Round))\n', 'A')?.key).toBe('circle')
  expect(shapeOf('flowchart TD\n  A@{ shape: h-cyl }\n', 'A')?.key).toBe('h-cyl')
  expect(shapeOf('flowchart TD\n  A["x"]\n  A@{ shape: hex }\n', 'A')?.key).toBe('hex')
  // An alias mermaid accepts but this list does not carry, and a node that is not there.
  expect(shapeOf('flowchart TD\n  A@{ shape: db }\n', 'A')).toBeNull()
  expect(shapeOf(SOURCE, 'ZZZ')).toBeNull()
})

test('a metadata declaration is rescued when its statement is deleted', () => {
  const source = 'flowchart TD\n  A --> B@{ shape: cyl }\n  B --> C\n'
  expect(deleteNode(source, 'A')).toBe('flowchart TD\n  B@{ shape: cyl }\n  B --> C\n')
})

test('splitting a statement keeps a half that carries a metadata shape', () => {
  const source = 'flowchart TD\n  A --> B@{ shape: cyl }\n  B --> C\n'
  expect(deleteEdge(source, 0)).toBe('flowchart TD\n  A\n  B@{ shape: cyl }\n  B --> C\n')
})

test('deleting a node takes its metadata statement with it', () => {
  const source = 'flowchart TD\n  A --> B\n  B@{ shape: cyl }\n'
  expect(deleteNode(source, 'B')).toBe('flowchart TD\n  A\n')
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
  expect(renameLabel(SOURCE, 'A', '')).toContain('A[" "]')
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

const color = (name: string) => {
  const found = COLORS.find((each) => each.name === name)
  if (found === undefined) throw new Error(`no color ${name}`)
  return found
}

test('colouring a node appends one style statement', () => {
  expect(setNodeColor(SOURCE, 'A', color('Red'))).toBe(`${SOURCE}  style A fill:#ffc9c9,stroke:#e03131\n`)
})

test('a second colour rewrites the statement rather than adding another', () => {
  const once = setNodeColor(SOURCE, 'A', color('Red'))
  const twice = setNodeColor(once, 'A', color('Blue'))
  expect(twice).toBe(`${SOURCE}  style A fill:#a5d8ff,stroke:#1971c2\n`)
})

test('the colour reads back, and clearing it removes the line', () => {
  const red = setNodeColor(SOURCE, 'A', color('Red'))
  expect(colorOf(red, 'A')?.name).toBe('Red')
  expect(colorOf(red, 'B')).toBeNull()
  expect(setNodeColor(red, 'A', null)).toBe(SOURCE)
})

// A style statement is not only ours to write, so recolouring must not throw away what else
// it says about the node.
test('other style declarations survive a recolour', () => {
  const source = 'flowchart TD\n  A --> B\n  style A stroke-width:4px,fill:#f9f\n'
  expect(setNodeColor(source, 'A', color('Green'))).toBe(
    'flowchart TD\n  A --> B\n  style A fill:#b2f2bb,stroke:#2f9e44,stroke-width:4px\n',
  )
})

test('clearing the colour keeps a statement that still says something else', () => {
  const source = 'flowchart TD\n  A --> B\n  style A fill:#f9f,stroke-width:4px\n'
  expect(setNodeColor(source, 'A', null)).toBe(
    'flowchart TD\n  A --> B\n  style A stroke-width:4px\n',
  )
})

test('colouring leaves every other node and its style alone', () => {
  const source = 'flowchart TD\n  A --> B\n  style B fill:#f9f\n'
  expect(setNodeColor(source, 'A', color('Blue'))).toBe(
    'flowchart TD\n  A --> B\n  style B fill:#f9f\n  style A fill:#a5d8ff,stroke:#1971c2\n',
  )
})

// `style X` on an unknown id compiles to an addVertex, so this would draw a node that is not
// in the diagram.
test('colouring an unknown node leaves the source untouched', () => {
  expect(setNodeColor(SOURCE, 'ZZZ', color('Red'))).toBe(SOURCE)
})

test('a coloured node still deletes cleanly, style line and all', () => {
  const source = setNodeColor('flowchart TD\n  A --> B\n', 'B', color('Red'))
  expect(deleteNode(source, 'B')).toBe('flowchart TD\n  A\n')
})

test('what colouring writes is readable back by the scanner', () => {
  const red = setNodeColor(SOURCE, 'C', color('Red'))
  expect(labelOf(red, 'C')).toBe('Let me think')
  expect(edgeCount(red)).toBe(2)
  expect(renameLabel(red, 'C', 'Decide')).toContain('C{Decide}')
})

const HUB = `flowchart TD
  A[Christmas] -->|Get money| B(Go shopping)
  B --> C{Let me think}
  C -->|One| D[Laptop]
  C -->|Two| E[iPhone]
`

test('deleting a node takes its edges and leaves every other node standing', () => {
  expect(deleteNode(HUB, 'C')).toBe(`flowchart TD
  A[Christmas] -->|Get money| B(Go shopping)
  D[Laptop]
  E[iPhone]
`)
})

test('a node that still has a declaration elsewhere is not re-emitted', () => {
  // B is declared on the line that survives, so removing `B --> C` must not add a second B.
  expect(deleteNode(HUB, 'C')).not.toContain('\n  B\n')
})

test('a rescued node keeps its shape and label', () => {
  const next = deleteNode(HUB, 'C')
  expect(labelOf(next, 'D')).toBe('Laptop')
  expect(setNodeShape(next, 'D', shape('circle'))).toContain('D((Laptop))')
})

test('a bare node comes back bare rather than gaining a shape', () => {
  expect(deleteNode('flowchart TD\n  A --> B\n', 'A')).toBe('flowchart TD\n  B\n')
})

test('deleting a standalone node removes its line entirely', () => {
  expect(deleteNode('flowchart TD\n  A --> B\n  C[Lonely]\n', 'C')).toBe(
    'flowchart TD\n  A --> B\n',
  )
})

test('a node orphaned by several statements is rescued exactly once', () => {
  const source = 'flowchart TD\n  A --> B\n  A --> B\n'
  expect(deleteNode(source, 'A')).toBe('flowchart TD\n  B\n')
})

test('a rescued node stays inside its subgraph and keeps its indentation', () => {
  const source = 'flowchart TD\n  subgraph Box\n    A --> B\n  end\n  B --> C\n'
  expect(deleteNode(source, 'A')).toBe('flowchart TD\n  subgraph Box\n    B\n  end\n  B --> C\n')
})

// `style X ...` compiles to an addVertex, so a style line outliving its node would bring the
// node back as an unlabelled box instead of failing loudly.
test('deleting a node takes its style, class and click lines with it', () => {
  const source =
    'flowchart TD\n  A --> B\n  style B fill:#f9f\n  class B big\n  click B href "x"\n'
  expect(deleteNode(source, 'B')).toBe('flowchart TD\n  A\n')
})

test('another node keeps its own style line', () => {
  const source = 'flowchart TD\n  A --> B\n  style A fill:#f9f\n'
  expect(deleteNode(source, 'B')).toBe('flowchart TD\n  A\n  style A fill:#f9f\n')
})

test('classDef and the header are left alone', () => {
  const source = 'flowchart TD\n  classDef big fill:#f9f\n  A --> B\n'
  expect(deleteNode(source, 'A')).toBe('flowchart TD\n  classDef big fill:#f9f\n  B\n')
})

test('deleting an unknown node leaves the source untouched', () => {
  expect(deleteNode(HUB, 'ZZZ')).toBe(HUB)
})

test('deleting the last node leaves a header that still parses', () => {
  expect(deleteNode('flowchart TD\n  A[Only]\n', 'A')).toBe('flowchart TD\n')
})

test('a semicolon-separated statement is deleted without taking its neighbour', () => {
  expect(deleteNode('flowchart TD\n  A --> B; C --> D\n', 'D')).toBe(
    'flowchart TD\n  A --> B; C\n',
  )
  expect(deleteNode('flowchart TD\n  A --> B; C --> D\n', 'A')).toBe(
    'flowchart TD\n  B; C --> D\n',
  )
})

test('an edge label is not mistaken for a node when deleting', () => {
  const source = 'flowchart TD\n  A -->|Get money| B\n'
  expect(deleteNode(source, 'Get')).toBe(source)
  expect(deleteNode(source, 'A')).toBe('flowchart TD\n  B\n')
})

test('a comment naming the node is left alone', () => {
  const source = 'flowchart TD\n  %% A --> B\n  A --> B\n'
  expect(deleteNode(source, 'A')).toBe('flowchart TD\n  %% A --> B\n  B\n')
})

test('what delete writes is readable back by the scanner', () => {
  const next = deleteNode(HUB, 'C')
  expect(nextNodeId(next)).toBe('C')
  expect(deleteNode(next, 'D')).toBe(`flowchart TD
  A[Christmas] -->|Get money| B(Go shopping)
  E[iPhone]
`)
})

// The label lives on the declaration, so a surviving bare mention elsewhere is not enough to
// let the declaration go with the statement.
test('a node keeps its label when only a bare mention of it survives', () => {
  const source = 'flowchart TD\n  A[Christmas] --> C\n  A --> B\n'
  expect(deleteNode(source, 'C')).toBe('flowchart TD\n  A[Christmas]\n  A --> B\n')
})

test('counts one edge per link, and a chain as one edge per arrow', () => {
  expect(edgeCount(HUB)).toBe(4)
  expect(edgeCount('flowchart TD\n  A --> B --> C\n')).toBe(2)
  expect(edgeCount('flowchart TD\n  A[Only]\n')).toBe(0)
})

// Verified against mermaid 11.17.2: it renders two edges for each of these, but not the two
// this scanner would guess, so the count has to disagree and the caller decline.
test('declines to count syntax it does not model', () => {
  expect(edgeCount('flowchart TD\n  A & B --> C\n')).toBe(0)
  expect(edgeCount('flowchart TD\n  A --> B & C\n')).toBe(0)
})

test('counts the arrow shapes mermaid accepts', () => {
  expect(edgeCount('flowchart TD\n  A -.-> B\n  B ==> C\n  C --x D\n  D <--> E\n  E ~~~ F\n')).toBe(5)
})

test('an edge label containing a pipe does not break the link', () => {
  expect(edgeCount('flowchart TD\n  A -->|"yes|no"| B\n')).toBe(1)
})

test('deleting an edge keeps both nodes when each carries its label', () => {
  const source = 'flowchart TD\n  A[Christmas] -->|Get money| B(Go shopping)\n'
  expect(deleteEdge(source, 0)).toBe('flowchart TD\n  A[Christmas]\n  B(Go shopping)\n')
})

test('deleting an edge removes the line when both nodes live elsewhere', () => {
  const source = 'flowchart TD\n  A[One] --> B[Two]\n  A --> B\n'
  expect(deleteEdge(source, 1)).toBe('flowchart TD\n  A[One] --> B[Two]\n')
})

test('deleting the first edge of a chain leaves the rest of the chain', () => {
  expect(deleteEdge('flowchart TD\n  A --> B --> C\n', 0)).toBe('flowchart TD\n  A\n  B --> C\n')
})

test('deleting the last edge of a chain leaves the rest of the chain', () => {
  expect(deleteEdge('flowchart TD\n  A --> B --> C\n', 1)).toBe('flowchart TD\n  A --> B\n  C\n')
})

test('deleting one edge of a hub leaves the others alone', () => {
  expect(deleteEdge(HUB, 2)).toBe(`flowchart TD
  A[Christmas] -->|Get money| B(Go shopping)
  B --> C{Let me think}
  D[Laptop]
  C -->|Two| E[iPhone]
`)
})

test('deleting a self-connection keeps the node once', () => {
  expect(deleteEdge('flowchart TD\n  A --> A\n', 0)).toBe('flowchart TD\n  A\n')
})

test('a split half stays inside its subgraph', () => {
  const source = 'flowchart TD\n  subgraph Box\n    A --> B\n  end\n'
  expect(deleteEdge(source, 0)).toBe('flowchart TD\n  subgraph Box\n    A\n    B\n  end\n')
})

test('an out-of-range edge index leaves the source untouched', () => {
  expect(deleteEdge(HUB, 9)).toBe(HUB)
})

test('deleting an edge label takes the pipes and leaves the edge', () => {
  const source = 'flowchart TD\n  A[Christmas] -->|Get money| B(Go shopping)\n'
  const next = deleteEdgeLabel(source, 0)
  expect(next).toBe('flowchart TD\n  A[Christmas] --> B(Go shopping)\n')
  expect(edgeCount(next)).toBe(1)
  expect(edgeLabelCount(next)).toBe(0)
})

// Clearing the text is a rename, and mermaid has no empty label, so that leaves a blank box
// riding on the edge. Deleting is the only way to get the edge back to bare.
test('deleting a label is not the same as renaming it to nothing', () => {
  const source = 'flowchart TD\n  A -->|Get money| B\n'
  expect(renameEdgeLabel(source, 0, '')).toBe('flowchart TD\n  A -->|" "| B\n')
  expect(deleteEdgeLabel(source, 0)).toBe('flowchart TD\n  A --> B\n')
})

test('deleting one label leaves the others in place', () => {
  const next = deleteEdgeLabel(LABELLED, 1)
  expect(edgeLabelCount(next)).toBe(2)
  expect([0, 1].map((i) => edgeLabelOf(next, i))).toEqual(['Get money', 'Three'])
})

test('deleting a label that had to be quoted takes the quotes with it', () => {
  expect(deleteEdgeLabel('flowchart TD\n  A -->|"yes|no"| B\n', 0)).toBe(
    'flowchart TD\n  A --> B\n',
  )
})

test('an out-of-range label index leaves the source untouched', () => {
  expect(deleteEdgeLabel(LABELLED, 9)).toBe(LABELLED)
})

test('what deleting an edge writes is readable back by the scanner', () => {
  const next = deleteEdge(HUB, 0)
  expect(labelOf(next, 'A')).toBe('Christmas')
  expect(labelOf(next, 'B')).toBe('Go shopping')
  expect(edgeCount(next)).toBe(3)
  expect(edgeLabelCount(next)).toBe(2)
})
