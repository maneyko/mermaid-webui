# mermaid-webui

A drag-and-drop WYSIWYG editor for [mermaid](https://mermaid.js.org) diagrams. Code pane on
the left, live diagram on the right, tool picker on top. Runs entirely in the browser with no
backend.

**Status: it edits.** Click a node, an edge or an edge label to select it, double-click to
rename it in place; drag between nodes to connect them; drag out from one to add a new node;
pick a shape to restyle what is selected; delete a node or an edge; undo from anywhere with
cmd+Z. Every change rewrites the source with the smallest possible edit. What is missing is
saving your work. See [Work items](#work-items).

## Why this is not a whiteboard

Mermaid has no coordinate syntax. There is no way to say "this node goes at x=340, y=120";
`style X x:100,y:200` positions nothing. Geometry is owned entirely by the layout engine
(dagre or ELK). That single fact forces a choice, and it is the most important thing to
understand about this project:

|  | Text canonical (**this project**) | Canvas canonical |
| --- | --- | --- |
| Dragging a node means | reorder, reparent, reconnect | move it to x, y |
| Geometry comes from | dagre, recomputed every render | your document |
| The `.mmd` file is | the source of truth | generated output |
| Positions are stored | nowhere; there are none | sidecar file or `%%` comments |

We are text canonical. The mermaid source is the single source of truth, and a drag is a
*structural* edit that rewrites that text — move a node under a different parent, flip an
edge, pull a node into a subgraph. The layout is then recomputed. You cannot place a node
somewhere by hand, by design.

The tradeoff is deliberate. It keeps `.mmd` clean, hand-editable, and diffable in git, which
is the entire reason to use mermaid instead of a drawing tool. If you want free positioning,
[Excalidraw](https://excalidraw.com) is excellent and already exports mermaid.

For reference: mermaid.ai's `Auto-Layout` toggle is precisely the switch between these two
models. This project is the always-on half of that switch.

## Getting started

Requires [bun](https://bun.sh).

```sh
bun install
bun run dev        # http://localhost:5173
```

Other scripts:

```sh
bun run test       # unit tests for the source-scanning logic
bun run typecheck  # tsc --noEmit
bun run build      # typecheck, then production build into dist/
bun run preview    # serve the production build
```

## Work items

Done, in the order they were built. Item 4 was the one that decided whether the project was
viable at all; everything before it was chrome.

- [x] **1. Two-pane live preview.** `<textarea>` plus debounced `mermaid.render`. Invalid
      syntax shows a parse error and keeps the last good diagram on screen.
- [x] **2. Real code pane.** CodeMirror 6 replaces the textarea: line numbers, mermaid
      syntax highlighting, undo/redo, and a controlled two-way binding so a later item
      can rewrite the source from the canvas. No selection wiring yet — that is item 4.
- [x] **3. Canvas and chrome.** Dotted grid that pans and scales with the view, drag to pan,
      cursor-anchored wheel zoom, and a floating toolbar island with zoom, fit, and reset.
      The island holds only controls that work — a shape/text tool picker would be dead
      buttons until items 5 and 6, so it lands with them.
- [x] **4. Selection — the viability gate, and it holds.** Click a rendered node and the
      editor selects the text that declared it. Mermaid's flowchart parser keeps no source
      positions, so `src/correlate.ts` recovers the spans by scanning the source directly.
      It is a scanner, not a parser: it locates node declarations and nothing else.
- [x] **5. First mutation.** Double-click a node **or an edge label** to rename it in place.
      The edit replaces only that label's own span, so the rest of the line comes back
      byte-identical, and a label containing brackets, pipes or quotes is quoted and escaped
      so it round-trips exactly. Enter commits, Escape cancels.
- [x] **6a. Tools.** A tool picker in the floating island: select (`1` / `v`) and hand
      (`h`), with `Escape` returning to select. Select clicks and renames; hand only pans.
      The viewport moved out into `usePanZoom`.
- [x] **6b. Connect two nodes by dragging.** With the arrow tool (`2` / `a`), hovering a node
      rings it; drag from one node to another and a single `A --> B` line is appended,
      indented to match. A dashed rubber band follows the cursor. Dropping on empty canvas —
      or back on the node you started from — cancels.
- [x] **7. Shapes.** Rectangle, rounded, diamond and circle (`3`–`6`). With a node selected
      the buttons change its shape, preserving the label. With nothing selected they arm a
      tool: drag out from an existing node to empty canvas and a new connected node of that
      shape appears, with the rename box already open on it. It is created *connected* so
      dagre places it near where you released — a disconnected node would be parked
      somewhere else entirely, since position is never ours to choose.
- [x] **8. Click to edit, and standalone shapes.** A single click opened the rename box
      directly, on the reasoning that dragging was the only other thing a click could mean.
      That held until delete existed — see item 10, which took it back. In a shape mode,
      clicking blank canvas creates a standalone node of that shape. Hovering rings whatever
      a click would act on, under every tool except the hand.

- [x] **9. Delete a node.** With a node selected, the trash button in the island — or the
      Delete key — removes it along with every edge that mentioned it, and nothing else. A
      neighbour whose only declaration was on one of those lines is re-emitted where the line
      stood, keeping its shape, its label and its subgraph, so deleting one node never
      silently takes another with it. `style`, `class` and `click` lines naming the node go
      too: mermaid compiles `style X` into a vertex, so leaving one behind would bring the
      node back as a blank box. This is also what gave the scanner statement spans, which the
      structural drags below need.

- [x] **10. Select, then act.** A single click now *only* selects — a node or an edge label —
      and renaming moved to double-click. Item 8 had merged the two, which was right until
      delete arrived: clicking a node put a text input under the cursor, and that input
      swallowed the Delete key. Hovering rings edge labels the way it already ringed nodes,
      and selecting one reveals the text between its pipes in the code pane.
- [x] **11. Undo from anywhere.** cmd+Z and cmd+shift+Z reach CodeMirror's history from the
      canvas, so a misjudged delete or drag takes one keystroke to take back. Canvas edits
      were always in the history; only the keymap's scope was in the way.

- [x] **12. Delete an edge.** Edges are selectable in their own right now: each one gets a
      wide transparent twin behind it to be the hit target, because a 1px stroke is not
      something anyone can click. Deleting one *splits* the statement that carried it rather
      than removing the statement, so `A --> B --> C` losing its first edge leaves `B --> C`
      standing. A half that is only a bare reference to a node mentioned elsewhere is dropped;
      one that would take a node or its label with it is kept.

Not done yet, roughly in the order I would take them:

- [ ] **The other structural drags.** Reorder siblings by dragging one past another, and
      reparent a node by dragging it into a subgraph. Reparenting needs subgraph hit-testing,
      since subgraphs render as `g.cluster` and nothing selects those. The statement spans
      both wanted now exist, from item 9.

## Scope

Scope for v1 is **flowcharts only**. Other diagram types render read-only. Flowchart is both
the type people actually want to drag around and the hardest parser case, so solving it first
de-risks the rest.

One thing the canvas will never offer: choosing which side of a node an arrow attaches to.
Mermaid has no port syntax, so `A --> B` is the entire vocabulary and dagre decides the
routing. This is why hovering a node with the arrow tool rings the whole shape rather than
offering connection points — four points would imply a choice that cannot be expressed.

## Known issues

- **Opening and closing delimiters are coloured differently in the code pane.** In
  `G("hello")` the `(` is punctuation-black while the `)` comes out string-red; same for `{}`
  and `[]`. `|` pairs are fine. The tokenizer in `src/mermaidLanguage.ts` returns the opener
  as `punctuation` and then consumes the label *and* its closing delimiter in one run that it
  reports as `string`. The closer needs emitting as its own token.
- **A standalone node does not appear where you clicked.** It has no edges, so dagre lays it
  out as a separate component and places it wherever it likes. Nothing can be done about the
  position without abandoning auto-layout; the rename box does at least follow the node to
  wherever it actually landed. Nodes left behind by a delete land the same way, for the same
  reason — they really have no edges any more.
- **Deleting a node listed in a shared `class` line takes the whole line.** `class A,B big`
  names two nodes; deleting A removes the statement, so B quietly loses its class. Splitting
  the id list would fix it. Not reachable from the canvas, since nothing writes `class`.
- **Deleting an edge does not renumber `linkStyle`.** `linkStyle` addresses edges by index,
  so removing one shifts every later index and the styling lands on the wrong edge. Nothing
  in the canvas writes `linkStyle`, so this only bites a hand-written document.
- **Selecting and deleting are declined on `A & B --> C`.** The scanner reads edges as the
  links between consecutive node references, which is not what the `&` list form means, so it
  reports a count mermaid disagrees with and every edge in the document stops responding to
  clicks. Declining beats deleting the wrong edge; the same is true of the
  `A -- text --> B` inline label form.

## Prior art

This was built after concluding no open-source project covers this, which is *nearly* right —
the pieces exist, but not assembled into a self-hostable app.

- [inkeep/visimer](https://github.com/inkeep/visimer) (MIT) is the closest and worth reading.
  Bidirectional, text canonical, maps SVG back to a concrete syntax tree. It is a library
  with no application UI, and structural edits only. We are solving the same problem
  independently rather than depending on it, because that round-trip *is* this project.
- [saketkattu/mermaid-visual-editor](https://github.com/saketkattu/mermaid-visual-editor)
  (MIT) is canvas canonical and one-way: draw, then export. It cannot import mermaid at all.
- [CatFoxVoyager/MermaidStudio](https://github.com/CatFoxVoyager/mermaidstudio) (MIT) is a
  self-hosted live editor with AI assistance; the visual editing is thin.
- [excalidraw/mermaid-to-excalidraw](https://github.com/excalidraw/mermaid-to-excalidraw)
  (MIT) is a one-way importer.
- Mermaid NG (VS Code) and obsidian-mermaid-flow do round-trip edits, but are locked to
  their host editor.

Upstream has no plans here:
[mermaid-live-editor#1284](https://github.com/mermaid-js/mermaid-live-editor/issues/1284)
asked for a drag-and-drop visual editor and was closed as not planned.

## Design references

Layout is modeled on [mermaid.ai](https://mermaid.ai) — code left, canvas right, floating
toolbar groups on top. Visual style is modeled on [Excalidraw](https://excalidraw.com):
floating rounded "island" panels over an open canvas, restrained palette, keyboard shortcuts
on the tool picker.

## Stack

TypeScript, bun, Vite, React 19, mermaid, and CodeMirror 6. No backend, deployable as static
files.

React owns the shell — panels, toolbar, dialogs. It deliberately does **not** own the canvas:
mermaid emits its own SVG and that subtree is handed over wholesale, so selection state
inside the diagram will never be a React render tree.
