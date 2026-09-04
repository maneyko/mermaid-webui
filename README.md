# mermaid-webui

A drag-and-drop WYSIWYG editor for [mermaid](https://mermaid.js.org) diagrams. Code pane on
the left, live diagram on the right, tool picker on top. Runs entirely in the browser with no
backend.

**Status: early.** Milestones 1 and 2 work — a real code editor on the left, live diagram on
the right. None of the direct-manipulation editing exists yet. See [Roadmap](#roadmap).

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
bun run typecheck  # tsc --noEmit
bun run build      # typecheck, then production build into dist/
bun run preview    # serve the production build
```

## Roadmap

Milestone 4 is the one that decides whether this project is viable. Everything before it is
chrome — pleasant to build, and it will feel like progress whether or not the hard part works.
Worth reaching early rather than late.

- [x] **1. Two-pane live preview.** `<textarea>` plus debounced `mermaid.render`. Invalid
      syntax shows a parse error and keeps the last good diagram on screen.
- [x] **2. Real code pane.** CodeMirror 6 replaces the textarea: line numbers, mermaid
      syntax highlighting, undo/redo, and a controlled two-way binding so a later milestone
      can rewrite the source from the canvas. No selection wiring yet — that is milestone 4.
- [ ] **3. Canvas and chrome.** Excalidraw-style floating toolbar islands, dotted grid,
      pan and zoom.
- [ ] **4. Selection — the viability gate.** Click a rendered node, resolve it to a range in
      the source, highlight that range in the editor. Mapping the SVG element back to a
      mermaid entity is already confirmed to work; mapping that entity to a *text span* is
      the open problem, because mermaid's flowchart parser keeps no position information.
- [ ] **5. First mutation.** Rename a node label on the canvas and write a minimal edit back
      to the source, preserving all surrounding syntax.
- [ ] **6. Drag as a structural edit.** Reorder siblings, reparent into a subgraph,
      reconnect an edge.

Scope for v1 is **flowcharts only**. Other diagram types render read-only. Flowchart is both
the type people actually want to drag around and the hardest parser case, so solving it first
de-risks the rest.

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
