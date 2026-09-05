# mermaid-webui

A drag-and-drop WYSIWYG editor for [mermaid](https://mermaid.js.org) diagrams. Code pane on
the left, live diagram on the right, tool picker on top. Runs entirely in the browser with no
backend.

**Status: it edits.** Click a node and the editor selects the text that declared it;
double-click a node to rename it and the source is rewritten with the smallest possible edit.
Both directions of the correlation the whole project depends on are real and covered by
tests. What is missing is dragging — changing a diagram's *structure* from the canvas. See
[Roadmap](#roadmap).

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

## Roadmap

Milestone 4 is the one that decides whether this project is viable. Everything before it is
chrome — pleasant to build, and it will feel like progress whether or not the hard part works.
Worth reaching early rather than late.

- [x] **1. Two-pane live preview.** `<textarea>` plus debounced `mermaid.render`. Invalid
      syntax shows a parse error and keeps the last good diagram on screen.
- [x] **2. Real code pane.** CodeMirror 6 replaces the textarea: line numbers, mermaid
      syntax highlighting, undo/redo, and a controlled two-way binding so a later milestone
      can rewrite the source from the canvas. No selection wiring yet — that is milestone 4.
- [x] **3. Canvas and chrome.** Dotted grid that pans and scales with the view, drag to pan,
      cursor-anchored wheel zoom, and a floating toolbar island with zoom, fit, and reset.
      The island holds only controls that work — a shape/text tool picker would be dead
      buttons until milestones 5 and 6, so it lands with them.
- [x] **4. Selection — the viability gate, and it holds.** Click a rendered node and the
      editor selects the text that declared it. Mermaid's flowchart parser keeps no source
      positions, so `src/correlate.ts` recovers the spans by scanning the source directly.
      It is a scanner, not a parser: it locates node declarations and nothing else.
- [x] **5. First mutation.** Double-click a node to rename it in place. The edit replaces
      only the label's own span, so the rest of the line comes back byte-identical, and a
      label containing brackets or quotes is quoted and escaped so it round-trips exactly.
      Enter commits, Escape cancels.
- [x] **6a. Tools.** A tool picker in the floating island: select (`1` / `v`) and hand
      (`h`), with `Escape` returning to select. Select clicks and renames; hand only pans.
      The viewport moved out into `usePanZoom`.
- [ ] **6b. Connect two nodes by dragging.** With the arrow tool, hovering a node rings it;
      drag from one node to another and a single `A --> B` line is appended. Dropping on
      empty canvas cancels — an edge needs two endpoints.
- [ ] **7. The other structural drags.** Reorder siblings by dragging one past another, and
      reparent a node by dragging it into a subgraph. Both need spans the scanner does not
      produce yet: whole statements rather than nodes.

Scope for v1 is **flowcharts only**. Other diagram types render read-only. Flowchart is both
the type people actually want to drag around and the hardest parser case, so solving it first
de-risks the rest.

One thing the canvas will never offer: choosing which side of a node an arrow attaches to.
Mermaid has no port syntax, so `A --> B` is the entire vocabulary and dagre decides the
routing. This is why hovering a node with the arrow tool rings the whole shape rather than
offering connection points — four points would imply a choice that cannot be expressed.

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
