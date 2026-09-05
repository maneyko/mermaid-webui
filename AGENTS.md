# AGENTS.md

Working notes for agents editing this repo. Read `README.md` first for what the project is
and where it is going; this file is the part that is easy to get wrong.

## Invariants

Violating any of these is a design regression, not a bug to fix later.

1. **The mermaid source is the single source of truth.** Every canvas interaction must
   resolve to an edit of that text. There is no parallel document model.
2. **Never store a node position.** No sidecar JSON, no `%%` position comments, no `x`/`y`
   in state. Geometry belongs to dagre and is recomputed on every render. A drag is a
   *structural* edit (reorder, reparent, reconnect), never a move.
3. **Edits must be minimal and preserve surrounding syntax.** Rewriting a node label must
   not reformat the rest of the file, drop comments, or normalize whitespace. Users hand-edit
   this text and keep it in git.
4. **React does not own the canvas subtree.** Mermaid produces SVG and we hand that DOM over
   whole. Do not try to render diagram contents as React elements or track in-diagram
   selection in React state keyed to elements.
5. **Flowcharts only.** Other diagram types render read-only. Do not add editing for a second
   diagram type until flowchart editing is actually finished.

Corollary: do not reach for [React Flow](https://reactflow.dev). It is a good library that
owns node positions, which is exactly the wrong model here.

## Commands

```sh
bun install
bun run dev        # http://localhost:5173
bun run typecheck  # tsc --noEmit
bun run build      # typecheck, then production build
```

Vite never invokes `tsc` — it strips types in its own pipeline. So a type error will **not**
fail `bun run dev`. Run `bun run typecheck` explicitly.

## Browser support

Everything works in any modern browser except opening and saving files, which needs the File
System Access API and so is Chrome and Edge only. That was a deliberate choice over shipping a
download/upload fallback beside it: two code paths for one job, and the fallback would be the
half nobody exercises. Autosave covers the rest of the world.

## Layout

```
index.html
src/main.tsx            React root
src/App.tsx             owns the source string and which file it came from
src/CodePane.tsx        CodeMirror 6 editor, controlled
src/storage.ts          autosave, and opening and saving real .mmd files
src/Canvas.tsx          mermaid render, selection, gesture policy
src/RenameOverlay.tsx   the in-place rename box: its text, and how the edit ends
src/usePanZoom.ts       the viewport: pan drag, wheel zoom, fit
src/Toolbar.tsx         the floating islands and the Tool type
src/ShapeMenu.tsx       the full shape library: its icons, and whether it is open
src/correlate.ts        source -> node spans, and rendered SVG id -> node id
src/correlate.test.ts   bun test
src/edit.ts             minimal rewrites back into the source
src/edit.test.ts        bun test
src/mermaidLanguage.ts  syntax highlighting tokenizer
src/styles.css          all styling
```

Flat on purpose. `correlate.ts` (read) and `edit.ts` (write) are the pure half and the only
parts with tests, which is deliberate: it is where the bugs will live. Keep new pure logic
there, free of DOM and React, so it stays testable with `bun test`.

## Vocabulary

**Edge** always means a connection between two nodes, as in graph theory. The boundary of a
shape is its **side**. Getting these confused in a graph editor is genuinely expensive, so
keep them straight in code, comments, and commit messages.

## Mermaid facts worth not rediscovering

Verified against **mermaid 11.17.2**. Re-check before relying on any of it; mermaid's
internals are not a public API.

### Correlating rendered SVG back to source

This is what selection is built on.

- **Nodes** are `g.node` elements with
  `id="<renderId>-flowchart-<nodeId>-<n>"`, e.g. `mermaid-2-flowchart-A-0`.
  `<renderId>` is the first argument passed to `mermaid.render`, so we control that prefix.
  `<n>` is an internal entity counter that also advances for edges, so it is **not** a node
  index — in a six-node chart the nodes came out `-0, -1, -3, -5, -7, -9`. Parse the id
  segment; never trust the counter.
- Nodes carry no `data-id` or `data-node-id`. The `id` attribute is the only handle.
- **Edges** are `path.flowchart-link` inside `g.edgePaths`, emitted in declaration order.
  They are addressed by position for the same reason edge labels are: the number in
  `data-id="L_A_B_0"` counts entities, not pairs, so it is no more a per-edge index than the
  node counter is. The same count guard applies.

Going from an entity id to a *source text span* is solved in `src/correlate.ts`. The
flowchart parser keeps no position information, so `flowDb` cannot supply it; `findNodes`
scans the source instead and returns a span per node id, preferring the occurrence that
carries a label. It is a scanner, not a parser — it locates node declarations and nothing
else. Do not grow it into a parser without deciding that is what you want.

`findStatements` is the same single walk one level up: it splits the source on newlines and
semicolons — skipping quotes and shapes, so a `;` inside a label stays text — and hands back
each statement with its span, the node occurrences inside it, its leading keyword if it has
one, and its `scope`. `findNodes` is derived from it. Two things about the extra fields:

- **`keyword` is how a graph statement is told from a directive.** `A --> B` reports null;
  `style A fill:#f9f` reports `style`. Without it, `fill` and `#f9f` are just more
  identifiers, and an edit that rewrites statements will happily invent a node called `fill`.
- **`scope` is the index of the enclosing `subgraph` statement, or -1.** A node belongs to
  whichever subgraph mentions it, so two mentions of the same id are only interchangeable
  within one scope. Ignoring this silently moves nodes out of their box — see Deleting.

Things the scanner gets right, all covered by `src/correlate.test.ts`:

- `A-->B` ends the id at `A`. A hyphen only continues an id when a word character follows,
  so `node-1` survives while arrow dashes do not get eaten.
- Nested delimiters, so `A[[Subroutine]]` and `B((Circle))` match by depth.
- Edge labels (`|Get money|`), comments (`%%`), quoted strings, and keywords are skipped.
- An unterminated `A[Unclosed` falls back to the bare id rather than swallowing the file.

- Mermaid 11's `A@{ shape: cyl, label: "x" }` is read as a declaration like any other: the
  span covers the block, and `labelFrom` points at the `label:` value if it has one. `meta` on
  a `NodeSpan` says which form it is, and exists because a metadata declaration with no
  `label:` key looks exactly like a bare mention otherwise -- see Shapes.

Known gap, not currently reachable from the UI: subgraph ids get collected even though
subgraphs render as `g.cluster` and so cannot be clicked.

### The parser situation

`@mermaid-js/parser` is the Langium-based parser with a fully typed AST, and it does **not**
cover flowchart. Its grammars are architecture, cynefin, eventmodeling, gitGraph, info,
packet, pie, radar, railroad, treeView, treemap, and wardley.

Flowchart, sequence, class, state, and ER are still on the old jison grammars
(`packages/mermaid/src/diagrams/flowchart/parser/flow.jison` upstream). jison is unmaintained
and its lexer discards comments, so comments never reach the AST. The migration is tracked in
mermaid-js/mermaid#4401 and is not done.

Since flowchart is the only type we edit, **there is no official typed AST to build on.** Do
not reach for `@mermaid-js/parser` expecting flowchart support. Flowchart is the obvious next
target for the Langium migration though, so this may change.

### CodeMirror

- `src/mermaidLanguage.ts` is a `StreamLanguage` tokenizer and **only** does highlighting. It
  builds no parse tree and has no source spans, so it is not a stepping stone to a real parser.
  Do not grow it into a parser; write the real one separately.
- `codemirror-lang-mermaid` was evaluated and rejected. It is a real Lezer grammar, which is
  tempting because a Lezer tree *would* carry the source positions we need, but it was
  last published 2023-09-14 and predates mermaid 11 entirely. A grammar that silently
  mis-parses current flowchart syntax is worse than no grammar.
- The CM6 core is installed as four explicit packages rather than the `codemirror`
  meta-package, so the extension list in `CodePane.tsx` is the complete truth about what is
  enabled. `basicSetup` would have added a search panel, autocomplete, and lint gutter that
  do nothing for mermaid.
- `CodePane` is a controlled component with the usual CodeMirror caveat: the view is created
  once and the `source` prop is read only for the initial document. The prop-sync effect
  compares against the current doc and no-ops when they match, so typing does not echo. The
  external-write path is what canvas edits use, and it was unexercised at first because
  nothing writes to `source` except the editor itself.
- **That external write must not report itself back through `onChange`.** It used to, and the
  round trip -- App writes the source in, CodeMirror tells App the document changed, App
  handles it as if the user had typed -- is what made it impossible for any canvas edit to
  keep the node selected. The `echoing` ref covers exactly that one dispatch, which is safe
  because `dispatch` is synchronous. Undo and typing are user transactions and still report.
- Enter inherits the previous line's indentation because a `StreamLanguage` supplies no
  indent rules. Mermaid ignores leading whitespace, so this is cosmetic. If it becomes
  annoying, an `indentService` that outdents `end` and indents after `subgraph` is the fix.

### The canvas viewport

- The viewport is `{x, y, scale}` in `Canvas.tsx`, applied as one CSS transform. Identity is
  centred, because `.viewport` is a centring grid — which is why Reset needs no measurement.
- `transform-origin` is the frame centre, so pointer coordinates fed to `zoomAbout` must be
  relative to the centre, not the top-left. Getting this wrong makes zoom drift.
- `mermaid.initialize` sets `flowchart: { useMaxWidth: false }` so the SVG carries fixed
  natural dimensions. With `useMaxWidth` on, mermaid sizes the SVG to its container and
  fights a viewport doing its own scaling. `fit` reads `svg.width.baseVal.value`, which only
  means anything because of this.
- Wheel zoom is a native listener with `{ passive: false }`. React's `onWheel` is passive,
  so `preventDefault` there is ignored and the page scrolls instead of the diagram zooming.
- `fit` caps at 100%. Scaling a three-node flowchart up to fill a wide window looks absurd,
  and "fit" usefully means "make sure I can see all of it".
- The toolbar stops pointer-down propagation, otherwise every button click also starts a pan.
- `usePanZoom` owns the viewport and the pan drag, but not gesture *policy*. It exposes
  `begin`/`move`/`end` rather than ready-made handlers, because which tool pans and what a
  click means belongs to `Canvas`. `end` returns whether the pointer actually travelled, so
  the caller can tell a pan from a click.

### Selection

Three things here were each found by a failed attempt, not by reasoning, so they are worth
keeping:

- **Selection fires on `click`, not `pointerup`.** Pointer capture is needed for panning, and
  it retargets every pointer event at the capturing element, so `pointerup.target` is the
  `<section>` rather than the node under the cursor. A plain `click` still reports the real
  target. Panning sets a flag that the click handler consumes so a pan does not select.
- **`.canvas` sets `user-select: none` permanently**, not just while panning. Dragging
  otherwise sweeps a native text selection across the SVG labels, and because the editor's
  highlight *is* the document selection, panning would wipe it.
- **The selection ring needs `!important`.** Mermaid injects a stylesheet into every SVG it
  renders, scoped by render id, so `#mermaid-7 .node polygon` outranks any selector we can
  write against a class. This is the one place `!important` is correct.
- **An edge label is HTML, not SVG**, so it rings with a CSS `outline` on its `.labelBkg`
  rather than a stroke -- the structure is
  `g.edgeLabel > g.label > foreignObject > div.labelBkg`. The `foreignObject` is sized
  exactly to the label and clips to it, so the ring needs `overflow: visible` on it or it is
  drawn and then cropped away: every style computes correctly and nothing appears on screen.
- **Hover state is an object now, so it must be compared by value.** It is set on every
  pointer move, and returning a fresh `{kind, nodeId}` each time re-renders the canvas
  continuously. `sameTarget` in the state updater is what makes React bail out.

Re-rendering replaces the whole SVG, so the selection class is reapplied after every render.
`Canvas` reads the current selection through a ref to keep the render effect keyed on
`source` alone.

Spans are offsets into a specific version of the text, so `App` clears the selection whenever
the source changes. Any future feature that edits text while keeping a selection has to
recompute the spans, not carry them across.

### Tools

- A tool is a mode, Excalidraw-style. `select` clicks, double-clicks and pans; `hand` only
  pans. Both gates live in `Canvas`, checked at the top of `onClick` and `onDoubleClick`.
- **The floating chrome must stop click and double-click, not just pointer-down.** It
  originally stopped only pointer-down, so pressing a toolbar button reached the canvas as a
  click on empty space and silently cleared the node selection.
- Shortcuts are a `window` keydown listener, so they must ignore events from the editor and
  the rename overlay. `isTyping` checks for an enclosing `input`, `textarea` or
  `contenteditable` -- CodeMirror's editable surface is the last of those. That guard is
  correct and is also why the Delete shortcut needs a button beside it; see Deleting.
- The whole keyboard, so a new binding can be checked against it: `1`/`v`/`Escape` select,
  `h` hand, `2`/`a` arrow, `3`-`6` the quick shapes, `Delete`/`Backspace` delete the selection
  and `Enter` renames it, all in `Canvas`; `cmd+Z`/`cmd+shift+Z` in `CodePane`; `cmd+O` and
  `cmd+S` in `App`. Three listeners rather than one because each owns different state, and
  they are only safe apart because none of them handles the same key.

### Shapes

- `SHAPES` in `edit.ts` is mermaid 11.17.2's whole flowchart vocabulary, 53 of them, addressed
  by mermaid's own short name (`cyl`, `h-cyl`). `QUICK_SHAPES` is the four with delimiters,
  which is what sits on the toolbar and what the `3`-`6` shortcuts index. The rest live in
  `ShapeMenu.tsx`, which also holds one hand-drawn icon path per shape.
- **A shape is written into the declaration, never onto a line of its own.** Four of them have
  delimiters and the other forty-nine are `A@{ shape: cyl, label: "..." }`, so `declaration()`
  in `edit.ts` is the one place that knows which form a shape takes. mermaid.ai splits the two
  -- `n2["Cylinder"]` then `n2@{ shape: h-cyl }` -- and that was rejected: one declaration per
  node is what the rest of this code already assumes, and keeping it means a shape change
  replaces exactly one span and is reversible.
- **A separate `A@{ shape: ... }` outranks the delimiters on the declaration**, whichever order
  they are in. So `setNodeShape` reduces any other metadata occurrence of the id back to a bare
  mention. Without that, changing the shape of a node in an imported mermaid.ai file writes the
  right thing into the declaration and nothing visible happens.
- **The metadata block is YAML, so its label is always quoted.** An unquoted scalar stops at
  the first comma: `label: Hello, world` renders as `Hello`, silently. `quoteMeta` is that
  rule; `#quot;` is the escape in both forms, and a backslash is a parse error.
- **A metadata declaration with no `label:` key is not a bare mention**, and nothing but the
  `meta` flag distinguishes them -- both have a null `labelFrom`. Three places turn on it:
  renaming (the label goes inside the braces), the rescue in `deleteNode`, and the drop rule in
  `deleteEdge`. Getting it wrong loses the shape rather than erroring.
- The buttons do two jobs. With a node selected they restyle it in place and show which shape
  it currently is, from `shapeOf`. With nothing selected they arm the shape tool, and dragging
  out from a node to empty canvas creates a new connected node.
- **A shape change re-quotes the label rather than carrying it across as text.** The two forms
  do not quote the same characters, so a verbatim copy is wrong in both directions. This also
  fixed a latent bug in the delimiter-only version: `A[a (b) c]` became `A(a (b) c)`.
- The 53 names are mermaid's own, read out of its bundle rather than the docs:

  ```sh
  grep -o 'semanticName:"[^"]*",name:"[^"]*",shortName:"[^"]*"' \
    node_modules/mermaid/dist/chunks/mermaid.esm.min/chunk-*.mjs
  ```

  That also lists the aliases, which are deliberately not carried here -- see the README's
  known issues. Every one of the 53 was then rendered in the browser to check mermaid accepts
  it and to draw the icon from what it actually looks like. Re-do both if mermaid is upgraded.
- **Clicking a node creates a connected node; clicking blank canvas creates a standalone one.**
- **There is no separate drag gesture, only the same one with travel.** A press on a node
  starts a connect drag whichever of the two tools is armed, so a press and release on the node
  itself already arrives at the shape tool's `pointerup` branch with zero travel -- which is
  what a click is. All that branch does is refuse to care where the release landed. Do not add
  a click handler beside it; the second path would be the bug.
- **The release point contributes nothing to where the node lands.** Releasing bottom-left of
  `C` and releasing top-right of it produce the same three words of source, so dagre returns
  the same layout. Measured on a six-node chart: a new child of `C` lands past its last
  sibling and shifts `A`, `B` and `C` 73px right; a new child of a leaf lands directly below
  it; a standalone lands on the top row to the right of everything. The drag is a *pointing*
  gesture -- its only content is which node becomes the parent.
- **So there is nothing honest to preview about position, and two things follow.** Adding a
  node also resizes the SVG, and `.viewport` centres it, so *every* node on screen moves even
  when nothing moved inside the diagram. Any preview drawn at the cursor would be promising a
  spot that exists in neither the old layout nor the new one.
- **What the ghost previews instead is attachment.** With the shape tool armed, a dashed
  outline of the picked shape follows the cursor. Over a node it snaps to just below that node
  and the rubber band joins the two -- drawn where the cursor is would put both ends of the
  band in the same place and say nothing. Over empty canvas there is no band, and that absence
  is the message: no band means standalone. Below rather than beside is the one approximation
  in it, and it is only wrong-looking in an `LR` chart; reading the direction out of the source
  would fix it if that ever grates.
- **During a shape drag the ring stays on the node the drag started from**, not on whatever the
  cursor passes over. The arrow tool rings what it would connect *to*; the shape tool has no
  such thing, and ringing a node with no part in the edit is the kind of small lie that teaches
  someone the wrong model.
- **The pulse is the other half.** A node created by either gesture gets a `landed` class in
  the same place the rename box is opened, and glows twice. It reports rather than predicts,
  which is the only kind of feedback available here. It has to be a glow and not a ring: the
  rename box opens at exactly the node's own bounds, so anything drawn on the outline would sit
  under the box's border.
- A doubled delimiter is one shape, not nesting -- see the label rules above. This matters
  most for circles: get it wrong and renaming `A((x))` silently emits `A(x)`.

### Connecting

- The arrow tool starts a connect drag only when pointer-down lands on a node; on empty
  canvas it falls through to panning. Dropping on empty space, or back on the source node,
  cancels. Requiring two *different* nodes means a stray click cannot silently add a
  self-loop -- `A --> A` is valid mermaid, but not something to create by accident.
- Every hit test in `Canvas` goes through `document.elementFromPoint`, never `event.target`.
  Panning captures the pointer on every press, and capture retargets the compatibility mouse
  events -- `click` included -- at the capturing element.
- Because everything is hit-tested by coordinate, `.rubber-band` must keep
  `pointer-events: none`: an overlay spanning the canvas would answer every
  `elementFromPoint` query itself.
- **`.rubber-band` needs explicit `width` and `height`, not just `inset: 0`.** An `svg` is a
  replaced element, so `inset: 0` with `width: auto` resolves to its 300x150 intrinsic size
  and `overflow: hidden` clips the rest of the line away. The DOM looks perfect while nothing
  is drawn.
- Duplicate connections are allowed. Mermaid renders `B --> C` twice as two arrows, which
  looks odd but is the user's to undo; detecting duplicates would need edge scanning that
  `connectNodes` otherwise does not require.

### Renaming

- **A click selects; a double-click, or Enter on the selection, renames.** Click and rename
  were briefly the same gesture, on the reasoning that dragging was the only other thing a
  click could mean. Delete disproved it: a click that opens a text input means the selection
  can never be acted on by a keystroke, because the input has the keyboard. Enter is the
  keyboard half of the double-click, and works only because `isTyping` already excludes the
  box itself -- otherwise the Enter that commits a rename would reopen it on the spot.
- **Everything selectable is renameable, including an edge**, which has no text of its own and
  so renames the label it carries. `renameable` is that one mapping, `openRename` the one way
  in, and both are reached by a double-click, by Enter, and by a freshly created node.
- **All three of a node, an edge and an edge label are selectable.** `EditTarget` is the union,
  and it is what selection, hover and the rename overlay are all keyed on. A node selection
  additionally drives the shape buttons and delete, which is why `Canvas` narrows it to
  `selectedNode`; an edge label is selectable but is not a node and must not reach those.
- **The overlay lives in `src/RenameOverlay.tsx` and owns the edit, not just the box.** It
  holds the text being typed and decides how the edit ends; `Canvas` supplies only what is
  being renamed, the rectangle to sit over, and the two ways out. The split is worth keeping
  in that direction -- the value churn, the width measuring and the commit rules are the
  fiddly parts, and none of them are gesture policy.
- **Mounting it opens the box and unmounting takes it away.** There is no close method:
  `Canvas` clearing `editing` is the close, which is why `onClose` fires before `onCommit`.
- **It is keyed on the target.** Without that, reopening on something else while the box is
  still mounted would keep the previous label in its internal state. The unmount usually
  happens anyway, between the blur and the second click; the key is what makes that not
  matter.
- The overlay stops `click` as well as `pointerdown`. Without that, clicking inside the box
  reaches the canvas as a click on whatever sits behind it and reopens the editor.
- **`CLICK_SLOP` is 10px, and it is not arbitrary.** Every press begins a pan, so a press
  that travels further than the slop is a pan and its click is suppressed. At 4px an ordinary
  human click -- which drifts a few pixels, more on a trackpad -- nudged the canvas and was
  then swallowed, so clicking a node appeared to do nothing at all. Do not tighten it without
  clicking around with a real mouse afterwards.

### Deleting

`deleteNode` removes every statement naming the node and nothing else, which is the standard
graph-editor rule but not the standard *text* rule, because mermaid declares most nodes
inside an edge statement. Five things it turns on:

- **A neighbour whose only declaration was on a removed line is re-emitted in its place**,
  from `findNodes`, so it keeps its shape and label. In place rather than appended, because
  appending would move it out of its subgraph and to the bottom of the file.
- **Presence of the id is not the test for that; presence of its declaration is.** Rescuing
  only when the id disappears entirely stripped labels off nodes nobody had touched: deleting
  C from `A[Christmas] --> C` plus `A --> B` left A bare, because A was still mentioned on
  the second line. A labelled occurrence has to come back even when the id survives.
- **Survival is keyed by `(scope, id)`, not by id.** This was found by a failing test, not by
  reasoning: deleting `A` from `subgraph Box / A --> B / end` with a later `B --> C` outside
  left the box empty and B outside it. B still existed, so a global check said "survives" —
  but its only mention *inside the box* had just been deleted, which is what membership is.
- **`style X` compiles to an `addVertex`.** A style line outliving its node does not error,
  it brings the node back as an unlabelled box — verified by rendering
  `flowchart TD / A / style B fill:#f9f`, which draws two nodes. So `style`, `class` and
  `click` statements naming the node are removed with it. `classDef` and `linkStyle` are
  left alone; they name no node.
- **A node orphaned by several statements is rescued once**, at the first of them. The edits
  are worked out front to back for that reason and applied back to front so earlier offsets
  stay valid.

`deleteEdge` is a different shape, because an edge is not a statement. Deleting one *splits*
the statement that carried it: the halves either side of the link are still chains, and
`A --> B --> C` losing its first edge has to leave `B --> C` behind. A half of a single node
is dropped only when it is a bare reference to a node mentioned elsewhere in the same scope --
keeping it otherwise is what stops the node, or its label, going with the edge.

- **`findEdges` reads an edge as the link between consecutive node references**, which is
  right for chains and wrong for `A & B --> C`, where mermaid makes two edges into C rather
  than a chain of two. The `isLink` check rejects the `&` and drops the whole statement, so
  the count disagrees and the caller declines. Verified against mermaid 11.17.2, along with
  the `A -- text --> B` inline form, which over-counts instead and declines the same way.
- **`x` and `o` are arrowheads and node ids both.** `A --x B` used to scan `x` as a node,
  which put a phantom in `findNodes` and made the edge count wrong. What tells them apart is
  sitting hard against the link: `A --> x` is a node.
- **`statement` on an `EdgeSpan` comes from the scan inside `findEdges`**, so code that scans
  again cannot compare statements by identity. Compare `from` offsets.

The UI half has two traps worth keeping:

- **A 1px stroke is not clickable.** Each edge gets a wide transparent twin (`path.edge-handle`)
  inserted behind it to be the hit target, rebuilt with the SVG on every render, and the
  visible link is set `pointer-events: none` so the topmost thing under the cursor is always
  the handle rather than sometimes the line.
- **Deleting an edge label is not renaming it to nothing.** `deleteEdgeLabel` removes the
  pipes as well, leaving `A --> B`; `renameEdgeLabel(source, i, '')` leaves `|" "|`, because
  mermaid has no empty label and `quoteLabel` stores a cleared one as a quoted blank. Both
  are wanted -- one clears the text, the other takes the label off the edge.

- **A click used to open the node's rename box, and that box swallowed Delete.** The keyboard
  binding looked right in review and was unreachable in the app: clicking the node to select
  it put an `input` under the cursor, so the keystroke edited the label instead. The fix was
  to split the gestures (see Renaming); the trash button in the island dates from before that
  and stays, because a destructive action wants a visible affordance.

### Undo

- **Undo is a `window` keydown listener in `CodePane`, not a CodeMirror keymap entry.** The
  keymap only sees keystrokes while the editor has focus, and after a canvas edit the focus
  is anywhere but there. Canvas edits were always in the history; only its reach was wrong.
- **The listener must call `preventDefault` even when it declines to act**, and this took a
  long time to find. Chrome's native undo reaches CodeMirror through its `beforeinput`
  `historyUndo` handling, so a cmd+Z the page leaves alone still rewrites the document. The
  symptom is baffling: the handler provably returns early -- log it and you will see the
  guard fire -- and the document is undone anyway, by the browser rather than by us. Anything
  added here that wants to *not* handle cmd+Z still has to suppress the default.
- The cost of that is the rename overlay losing its own native text undo, which is the right
  way round: Escape already cancels a rename, and the alternative is cmd+Z inside a small
  text box silently rewriting the whole diagram.
- While the editor *does* have focus the listener returns without preventing anything, so
  CodeMirror handles it once. Check this after touching it -- the failure is a double undo.

### Colour

- **`style X fill:...` compiles to an inline style with `!important` on the shape element.**
  That is why the palette sets `stroke` as well as `fill`: mermaid's default node stroke is
  purple and stays purple over a red fill, which looks like a bug. It is also why a coloured
  node's selection ring keeps the node's own colour -- an inline important declaration beats
  any stylesheet, `!important` or not. The 3px thickening still lands, and that is the signal.
- **A style statement is not only ours to write.** `setNodeColor` keeps every declaration it
  does not own, so a hand-written `stroke-width:4px` survives a recolour, and clearing the
  colour removes the statement only when nothing else is left in it.
- **Colouring an unknown id would draw a node.** `style X` is an `addVertex`, the same fact
  that makes deletion remove style lines, so `setNodeColor` declines an id it cannot find.
- **This is the one edit that keeps its selection**, because trying a colour and then another
  is the whole gesture. It recomputes the reveal span against the rewritten source rather
  than carrying the old one, which is the rule the Selection section sets out.

### Files and autosave

`src/storage.ts` is the only place that talks to anything durable. Two unrelated jobs live
there because they answer the same question badly apart: `localStorage` so a refresh does not
cost you the diagram, and the File System Access API so the `.mmd` can live in a git repo.

- **Autosave writes on every change, undebounced.** A few KB through `setItem` costs
  microseconds and a timer would be more machinery than the problem. It is wrapped in
  `try/catch` for one specific reason: Safari's private mode throws on `localStorage`, and an
  exception out of an effect that runs on every keystroke takes the whole app down. Losing
  autosave is the better half of that trade.
- **TypeScript's DOM lib has `FileSystemFileHandle` but not `showOpenFilePicker` or
  `showSaveFilePicker`.** They are declared in `storage.ts`, as optional members, so the
  optionality is what carries "this is Chrome-only" through the type system.
- **Where the API is missing the island is not rendered at all**, rather than shown disabled.
  Islands hold controls that work, and there is no half of Open/Save that does anything.
- **Closing a picker rejects with `AbortError`.** That is the user saying no, not a failure;
  every other rejection is rethrown.
- **A failed save is visible through the `*` marker, and that is the whole error handling.**
  `savedSource` is only updated after the write resolves, so a write that throws leaves the
  marker up rather than letting the save look like it worked. Do not add a toast for this.
- **Undo restores text, never file state.** The document is CodeMirror's and the handle is
  React's, and only the first is in the history — see the README's known issues. Resist tying
  them together; the history has no notion of anything but the document.
- The pickers open a native dialog, which browser automation cannot drive and which blocks
  the extension. Test this path by stubbing `window.showOpenFilePicker` and
  `showSaveFilePicker` in the page with fakes that return a handle object; everything below
  the picker is our code and gets exercised properly that way.

### Testing interactions

Synthetic `MouseEvent`s are useful but they are **not** the same as a real mouse, and twice
now they have hidden a bug that a person hit immediately:

- They travel 0px, so they never trip the pan slop above.
- They never establish pointer capture, so they do not reproduce the retargeting it causes.

Two habits that make synthetic testing honest here. Dispatch the event **on the canvas
section with `clientX`/`clientY` over the target**, rather than on the target element -- that
is what capture does to a real click, and code that reads `event.target` fails it. And after
any change to a gesture, drive it once with the real pointer (`left_click`, `left_click_drag`)
including a few pixels of drift, because that is the case that actually breaks.

- **The automation's Escape never reaches the page.** Pressing it through the browser tool
  produces no `keydown` at all, only a `focusout` on whatever had focus. So it looks like it
  cancels a rename when in fact it blurs it, and blurring *commits* -- which reads as
  "Escape is broken" the moment there is unsaved text in the box. Test the cancel path by
  dispatching `new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})` at the input.
  Setting a controlled input's value from outside React needs the native setter
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`) followed by an
  `input` event, or React will not see it.
- **`document.hasFocus()` is false in the driven tab, so `blur()` fires nothing.** Commit-on-
  blur therefore cannot be driven the way a person drives it: `input.focus()` sets
  `activeElement`, `blur()` clears it, and no focus event is dispatched at all, so the box just
  sits there looking broken. Dispatch `new FocusEvent('focusout', {bubbles: true})` at the
  input instead -- that is the native event React binds `onBlur` to. Losing focus between two
  tool calls is normal for the same reason, so anything involving focus has to happen inside a
  single `javascript_tool` call.
- **`setTimeout` is throttled to ~1s in the driven tab**, because it is backgrounded. A poll
  loop written as `setTimeout(40)` runs at 1Hz, which makes a 1.1s CSS animation look like it
  finishes in two frames. To inspect an animation, pause it and set `currentTime` rather than
  sampling it.
- **The first synthetic click after a navigate or reload is frequently dropped**, and so are
  clicks whose coordinates came from a screenshot taken before the window resized. Assert the
  intermediate state -- that the node really did get selected -- before concluding anything
  about what the next click did.
- **Double-click hit-tests coordinates, not `event.target`.** `dblclick` retargets to the
  common ancestor of its two clicks, which for a mermaid node is the canvas itself, so the
  handler uses `document.elementFromPoint` instead.
- **The reveal effect must not focus the editor.** It used to, which stole focus from the
  freshly mounted rename overlay and blurred it out of existence on the same tick. This is
  why `drawSelection()` is in the extension list: it renders the selection while the editor
  is unfocused, so the highlight survives without grabbing focus.
- **Enter and Escape both blur**, so committing has exactly one path in `onBlur`. Escape sets
  a ref first that the blur handler consumes. Commit-on-blur means incidental focus loss
  commits the edit, which is the same behaviour as Excalidraw and is intended.

### Editing the source

`edit.ts` holds every write path. The rule for all of them: replace the smallest span that
expresses the change, so every byte outside it comes back identical.

- **Labels are quoted when they have to be, and only then.** A label containing
  `" [ ] { } ( ) | < >`, or with leading or trailing spaces, or empty, is wrapped in double
  quotes with any `"` escaped as `#quot;`. `quoteLabel` and `unquoteLabel` are inverses and
  there is a round-trip test over the awkward cases; keep it that way.
- **We must be able to re-read what we write.** This is the most productive check in the
  codebase. It has caught three separate bugs, each time because quoting introduced a
  delimiter that some reader then counted:
  - `A["Buy [things"]` — `skipShape` counted the unbalanced `[` and never closed the shape,
    so the node degraded to a bare id and a second rename appended a second shape.
  - `|"yes|no"|` — `findEdgeLabels` ended the span at the pipe inside the quotes.
  - the same `|"yes|no"|` — the CodeMirror tokenizer closed the edge label early and
    mis-coloured every line after it.

  All three are fixed by skipping quoted stretches. A fourth had the same shape without
  quoting: `skipShape` counted `((` as nested parens, so a circle's label included the inner
  pair and renaming `A((x))` emitted `A(x)`, quietly demoting it to a rounded rectangle.

  A fifth was the same `|"yes|no"|` a third time, and it is the reason to fix these in
  *every* reader rather than the one that reported the bug. `findEdgeLabels` got the
  quote-aware `closingPipe`; the node walk kept a plain `indexOf`, took `no` for a node id,
  then ran the unpaired quote to the end of the file — so every node after such an edge
  became unselectable. Both readers share `closingPipe` now.

  Any new emitter or reader needs the same check: **write a value, read it back, write
  again** — and look at the highlighting, not just the data.

- **Also check that mermaid accepts what we emit.** Passing our own scanner is not enough.
  `A[""]` survived a round trip and a unit test while being a *parse error in every shape* —
  it only surfaced when a new node rendered as a broken diagram. An empty label has no
  representation in mermaid, so `quoteLabel` emits a quoted blank space instead.

  The scanner tests cannot catch this, because mermaid needs a DOM. Check it in the browser
  against the running app:

  ```js
  const m = (await import('/node_modules/.vite/deps/mermaid.js')).default
  await m.parse('flowchart TD\n  A[""]\n')   // throws
  ```

  Every combination of `SHAPES` against every output `quoteLabel` can produce was verified
  this way against mermaid 11.17.2. Re-run it whenever either of those two changes.
- **Renaming a bare node gives it a shape** (`B` becomes `B[Label]`) at the declaration only,
  leaving every other mention of the id alone.
- **An edge and its label are one index.** Neither has any identity -- a rendered `g.edgeLabel`
  carries no id or data attribute, and the number in a path's `data-id` counts entities, not
  pairs, so a second `B --> C` came out as `L_B_C_2`. What saves us is that mermaid emits
  exactly one `g.edgePaths > path.flowchart-link` and exactly one `g.edgeLabels > g.edgeLabel`
  per edge, both in declaration order, *including for edges with no label*. Verified on
  mermaid 11.17.2. So the k-th path, the k-th label element and the k-th `findEdges` span are
  the same edge, and `edgeLabelSpan` finds the `|...|` inside that edge's own link range rather
  than counting pipes across the file.
- **That is what lets an unlabelled edge be given a label**, which is the whole reason to
  address it this way: `edgeLabelOf` reads a missing label as empty, and `renameEdgeLabel`
  writes one in hard against the arrow. There used to be a second, label-only index; two ways
  to name the same thing is what made an unlabelled edge unreachable.
- The mapping is only sound while the rendered count and `edgeCount` agree, so `edgeIndexOf`
  compares them and declines on a mismatch. The known trigger is the `A -- text --> B` inline
  label form; declining beats editing a different edge.
- **An empty `g.edgeLabel` is not a usable anchor.** It measures 0x0 *and* mermaid parks it
  away from its own edge -- in the sample chart the element sat 300px from the line it belongs
  to. So the rename box for an edge with no label goes on the middle of the path instead, via
  `getPointAtLength` through `getScreenCTM`. Do not trust the element's position until
  something has been drawn in it.

### Rendering

- `mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true })`, then
  `mermaid.render(id, source)`. It throws on a parse error; catch it, show the message, and
  leave the previous SVG on screen. Do not clear the canvas on invalid input.
- Pass a **unique** `id` per render call. Mermaid renders into a DOM id it expects to be
  unused, and a slow render can still be in flight when the next keystroke starts another.
- Renders are async and debounced, so guard against a stale render overwriting a newer one.
- Mermaid code-splits its diagram types, so the production build emits roughly twenty chunks
  and Vite warns about a few over 500 kB (cytoscape, katex). Expected; the flowchart path does
  not load most of them.

## Conventions

- **Ask before adding a dependency.** Five runtime deps is a feature. Prefer a few lines of
  our own code over a package.
- **Plain CSS**, with the palette as custom properties on `:root`. No Tailwind, no CSS-in-JS.
  Modern browsers only, so no PostCSS or autoprefixer.
- **No state library.** There is one piece of real state (the source string) plus selection.
  `useState` and `useReducer` cover it. No Zustand, no Redux.
- **Exact version pins** in `package.json`, no carets.
- **ASCII in source files.** Comments, string literals, and anything the program prints.
  Markdown files like this one are prose and exempt.
- **Comments explain why, never what.** If the code needs a comment to say what it does,
  rename something instead.
