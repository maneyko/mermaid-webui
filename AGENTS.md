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
src/Canvas.tsx          mermaid render, selection, renaming, gesture policy
src/usePanZoom.ts       the viewport: pan drag, wheel zoom, fit
src/Toolbar.tsx         the floating islands and the Tool type
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

Known gaps, none currently reachable from the UI: mermaid 11's `A@{ shape: rect }` syntax is
not understood and leaves stray identifiers in the map, and subgraph ids get collected even
though subgraphs render as `g.cluster` and so cannot be clicked.

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

### Shapes

- `SHAPES` in `edit.ts` is the whole vocabulary: rectangle `[]`, rounded `()`, diamond `{}`,
  circle `(())`. Adding one means adding a delimiter pair there and an icon in `Toolbar.tsx`.
- The buttons do two jobs. With a node selected they restyle it in place, preserving the
  label verbatim (an already-quoted `"a|b"` is carried across, not re-quoted). With nothing
  selected they arm the shape tool, and dragging out from a node to empty canvas creates a
  new connected node.
- **Dragging out creates a connected node; clicking blank canvas creates a standalone one.**
  Connected nodes land near the release point because their parent anchors them. A standalone
  node is its own dagre component and will render wherever the layout puts it, which is
  usually nowhere near the click. That is a known and accepted cost of asking for a node
  before you know what it attaches to, not something to try to fix with positioning.
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

- **A click selects; a double-click renames.** These were briefly the same gesture, on the
  reasoning that dragging was the only other thing a click could mean. Delete disproved it:
  a click that opens a text input means the selection can never be acted on by a keystroke,
  because the input has the keyboard. Anything that adds a shortcut acting on the selection
  runs into the same wall, so the two gestures stay apart.
- **Both work on an edge label as well as a node.** `EditTarget` is the union, and it is what
  selection, hover and the rename overlay are all keyed on. A node selection additionally
  drives the shape buttons and delete, which is why `Canvas` narrows it to `selectedNode`;
  an edge label is selectable but is not a node and must not reach those.
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
- **Edge labels are addressed by position, because they have no identity.** A rendered
  `g.edgeLabel` carries no id and no data attribute of any kind. What saves us is that
  `g.edgeLabels` children and `g.edgePaths` children are both emitted in declaration order,
  so the k-th non-empty rendered label is the k-th `|...|` in the source. Do not try to use
  the number in an edge path's `data-id`: a second `B --> C` came out as `L_B_C_2`, so it is
  an internal counter, not a per-pair index.
- That positional mapping is only sound while both sequences have the same length, so
  `edgeLabelCount` is compared against the rendered count and the edit is declined on a
  mismatch. The known trigger is the `A -- text --> B` inline label form, which the scanner
  does not understand; declining beats renaming a different edge.
- Only labelled edges are reachable: an unlabelled edge still renders a `g.edgeLabel`, but an
  empty one has no area to double-click.

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
