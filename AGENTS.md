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
src/App.tsx             source state, debounced render, error panel
src/CodePane.tsx        CodeMirror 6 editor, controlled
src/mermaidLanguage.ts  syntax highlighting tokenizer
src/styles.css          all styling
```

Flat on purpose. Planned split as milestone 4 approaches: a `src/mermaid/` directory for the
pure functions (source -> entities plus text spans, SVG element -> entity, minimal text
rewrites) separate from `src/ui/`. That half should be pure and unit-testable with
`bun test`, because that is where the bugs will live. Do not do the split before there is
something to put in it.

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

What is **not** solved: going from a mermaid entity id to a *source text span*. The flowchart
parser keeps no position information, so `flowDb` cannot supply it. That needs either our own
lexer or a scan for the id token in the source. Node ids are unique tokens, so a scan is
tractable, but it needs designing rather than guessing.

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
