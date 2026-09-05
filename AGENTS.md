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

## Layout

```
index.html
src/main.tsx            React root
src/App.tsx             owns the source string, nothing else
src/CodePane.tsx        CodeMirror 6 editor, controlled
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

This is milestone 4's foundation. Half of it is solved:

- **Nodes** are `g.node` elements with
  `id="<renderId>-flowchart-<nodeId>-<n>"`, e.g. `mermaid-2-flowchart-A-0`.
  `<renderId>` is the first argument passed to `mermaid.render`, so we control that prefix.
  `<n>` is an internal entity counter that also advances for edges, so it is **not** a node
  index — in a six-node chart the nodes came out `-0, -1, -3, -5, -7, -9`. Parse the id
  segment; never trust the counter.
- **Edges** are `path.flowchart-link` elements carrying `data-id="L_A_B_0"`. Source and
  target node ids are right there in the attribute.
- Nodes carry no `data-id` or `data-node-id`. The `id` attribute is the only handle.

Going from an entity id to a *source text span* is solved in `src/correlate.ts`. The
flowchart parser keeps no position information, so `flowDb` cannot supply it; `findNodes`
scans the source instead and returns a span per node id, preferring the occurrence that
carries a label. It is a scanner, not a parser — it locates node declarations and nothing
else. Do not grow it into a parser without deciding that is what you want.

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
  builds no parse tree and has no source spans, so it is not a stepping stone to milestone 4.
  Do not grow it into a parser; write the real one separately.
- `codemirror-lang-mermaid` was evaluated and rejected. It is a real Lezer grammar, which is
  tempting because a Lezer tree *would* carry the positions milestone 4 needs, but it was
  last published 2023-09-14 and predates mermaid 11 entirely. A grammar that silently
  mis-parses current flowchart syntax is worse than no grammar.
- The CM6 core is installed as four explicit packages rather than the `codemirror`
  meta-package, so the extension list in `CodePane.tsx` is the complete truth about what is
  enabled. `basicSetup` would have added a search panel, autocomplete, and lint gutter that
  do nothing for mermaid.
- `CodePane` is a controlled component with the usual CodeMirror caveat: the view is created
  once and the `source` prop is read only for the initial document. The prop-sync effect
  compares against the current doc and no-ops when they match, so typing does not echo. The
  external-write path is what milestone 5 will use, and it is currently unexercised because
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
  `contenteditable` -- CodeMirror's editable surface is the last of those.

### Shapes

- `SHAPES` in `edit.ts` is the whole vocabulary: rectangle `[]`, rounded `()`, diamond `{}`,
  circle `(())`. Adding one means adding a delimiter pair there and an icon in `Toolbar.tsx`.
- The buttons do two jobs. With a node selected they restyle it in place, preserving the
  label verbatim (an already-quoted `"a|b"` is carried across, not re-quoted). With nothing
  selected they arm the shape tool, and dragging out from a node to empty canvas creates a
  new connected node.
- **New nodes are created connected, never free-standing.** A disconnected node is its own
  dagre component and gets parked away from wherever the user gestured, which reads as a bug.
  Connected, it lands near the release point because its parent anchors it.
- A doubled delimiter is one shape, not nesting -- see the label rules above. This matters
  most for circles: get it wrong and renaming `A((x))` silently emits `A(x)`.

### Connecting

- The arrow tool starts a connect drag only when pointer-down lands on a node; on empty
  canvas it falls through to panning. Dropping on empty space, or back on the source node,
  cancels. Requiring two *different* nodes means a stray click cannot silently add a
  self-loop -- `A --> A` is valid mermaid, but not something to create by accident.
- The drop target is hit-tested by coordinate, because the connect drag holds pointer
  capture. For the same reason `.rubber-band` must keep `pointer-events: none`: an overlay
  spanning the canvas would answer every `elementFromPoint` query itself.
- **`.rubber-band` needs explicit `width` and `height`, not just `inset: 0`.** An `svg` is a
  replaced element, so `inset: 0` with `width: auto` resolves to its 300x150 intrinsic size
  and `overflow: hidden` clips the rest of the line away. The DOM looks perfect while nothing
  is drawn.
- Duplicate connections are allowed. Mermaid renders `B --> C` twice as two arrows, which
  looks odd but is the user's to undo; detecting duplicates would need edge scanning that
  `connectNodes` otherwise does not require.

### Renaming

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
