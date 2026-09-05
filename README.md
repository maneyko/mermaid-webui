# mermaid-webui

A drag-and-drop WYSIWYG editor for [mermaid](https://mermaid.js.org) diagrams. Code pane on
the left, live diagram on the right, tool picker on top. Runs entirely in the browser with no
backend.

**Status: it edits, and it saves.** Click a node, an edge or an edge label to select it,
double-click or press Enter to rename it in place — including labelling an edge that has
none — and Delete to remove it. Drag between nodes to connect them. Arm one of mermaid's 53
shapes and click a node to hang a new one off it, or blank canvas for a node of its own; with
something selected those same buttons restyle it, and a row of swatches recolours it. Undo
from anywhere with cmd+Z. Every change rewrites the source with the smallest possible edit,
so the `.mmd` stays yours: hand-edited formatting, comments and all come back untouched. Your
work survives a refresh, and cmd+S writes it back to a real file — that last part needs Chrome
or Edge. See [Work items](#work-items).

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
- [x] **13. Delete an edge label.** Everything you can select, you can now delete. Deleting a
      label takes the pipes with it, leaving `A --> B` — which is not what renaming it to
      nothing does, because mermaid has no empty label and stores a cleared one as a quoted
      blank that still renders an empty box on the edge.

- [x] **14. Autosave and real files.** The source is written to `localStorage` on every
      change and read back on startup, so a refresh no longer costs you the diagram. That is
      only crash protection: browser storage is cleared by "clear browsing data", tied to one
      profile on one machine, and invisible to git. So the file island also opens and saves
      real `.mmd` files through the File System Access API — cmd+S writes back to the file
      you opened, in place, and the diagram lives in a git repo rather than in a browser.
      **This half is Chrome and Edge only**; elsewhere the island is hidden and the shortcuts
      do nothing, because there is no equivalent API to fall back to. Autosave works
      everywhere.

- [x] **15. Colour a node.** A row of swatches in the island recolours the selected node,
      writing `style A fill:...,stroke:...`. Fill and stroke together, never fill alone:
      mermaid's default node stroke is purple and stays purple over a red fill. Anything else
      the statement said about the node is carried across, so a hand-written `stroke-width`
      survives a recolour, and clearing the colour removes the statement only if nothing else
      is left in it. This is the one edit that keeps its selection, so you can try a colour
      and then another.

- [x] **16. The full shape library.** All 53 flowchart shapes mermaid 11.17.2 draws, behind a
      button in the island that expands into a menu grouped Basic / Process / Technical, the
      way mermaid.ai's is. Only four of them have delimiters; the rest are written as
      `A@{ shape: cyl, label: "..." }`, which the scanner had to learn to read without taking
      `shape` and `cyl` for node ids. The shape goes in the declaration rather than on a line
      of its own — mermaid.ai splits them across two statements, but one declaration per node
      is what everything else here already assumes, and it makes the shape reversible by
      replacing the same span. A separate `A@{ shape: ... }` in a file you opened is read
      correctly and folded back into the declaration the first time you change that node's
      shape, because mermaid lets one outrank the delimiters and it would otherwise silently
      win over the shape you picked.

- [x] **17. Say what a click will add, not where.** With a shape armed, a dashed ghost of it
      follows the cursor; pass over a node and the ghost snaps below it with the rubber band
      joining the two, so you can see it would be a child of that node before you commit. Over
      empty canvas there is no band, which is what standalone looks like. Clicking is all it
      takes — dragging out from the node still works and does the same thing, because it *is*
      the same gesture: the release point contributes nothing, so a press and release with no
      travel is just the short version of it. The position is never previewed. The new node
      pulses once it arrives, which is the honest half of that: it reports where dagre put it
      rather than guessing beforehand.

- [x] **18. Label an edge that has none, and rename from the keyboard.** Double-clicking an
      edge opens a text box on the middle of the line and writes `A -->|Text| B`; Enter on
      anything selected opens the same box, so renaming no longer needs the mouse. Both fell
      out of giving an edge and its label one index instead of two. They used to be counted
      separately — labels among labels, edges among edges — which meant an edge with no label
      had no index at all and nothing to double-click, since mermaid renders its label element
      at zero size and parks it away from the line.

Not done yet, roughly in the order I would take them:

- [ ] **Import and export for browsers without the File System Access API.** A download link
      and a file input, so Firefox and Safari can at least get a diagram in and out. Named
      Import/Export rather than Open/Save on purpose: there is no writing back to the file you
      opened, so every export is a fresh copy in the downloads folder. Deliberately a separate,
      plainer pair of controls rather than a fallback wired behind the same buttons — the two
      have different semantics, and hiding that behind one label is how the untested half
      ends up lying to you.

- [ ] **A library of past diagrams, if it is still wanted afterwards.** A panel listing
      what you have worked on. Deliberately last, because once files work the filesystem is
      already the library, with names, folders, backups and history. If it is built: name
      entries from the first node's label rather than a timestamp — `2026-09-04 21:51` tells
      you nothing about which diagram it is, and `findNodes` already knows the answer — and
      settle when a new entry is created, which is the question that makes such lists
      annoying. Snapshotting every edit buries you; only saving on demand leaves it empty.
- [ ] **The other structural drags.** Reorder siblings by dragging one past another, and
      reparent a node by dragging it into a subgraph. Reparenting needs subgraph hit-testing,
      since subgraphs render as `g.cluster` and nothing selects those. The statement spans
      both wanted now exist, from item 9.

- [ ] **A truthful preview of where the layout will land, if it is ever worth the machinery.**
      Item 17 deliberately previews *attachment* rather than position, because the position
      cannot be known without running dagre and because adding a node reflows everything
      already on screen. The honest version is therefore not a ghost under the cursor but a
      ghost of the *whole next layout*: render the prospective source into a hidden container,
      diff it against what is showing, and draw that. It is buildable — a second render
      pipeline, one speculative render per hover target, debounced the way the real one is —
      but it is a lot of apparatus for a hint, and it should not be started without deciding
      that the hint is worth it. Written down here so the option is not rediscovered from
      scratch, not because it is queued.

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
- **No new node appears where you clicked, and a standalone one is not even close.** The
  release point never reaches the source, so dagre gets the same graph whichever way you
  dragged: a new child lands past its parent's last sibling, and a standalone lands on the top
  row to the right of everything. Adding either one also reflows the diagram. Nothing can be
  done about that without abandoning auto-layout, so the interface does not try to predict it
  — the ghost shows what the node will be *attached to*, and the new node pulses once it has
  landed. Nodes left behind by a delete move for the same reason.
- **Deleting a node listed in a shared `class` line takes the whole line.** `class A,B big`
  names two nodes; deleting A removes the statement, so B quietly loses its class. Splitting
  the id list would fix it. Not reachable from the canvas, since nothing writes `class`.
- **A coloured node's selection ring is its own colour, not the usual purple.** `style` is
  compiled to an inline `stroke:... !important`, and an inline important declaration outranks
  any stylesheet, so the ring cannot recolour it. Selecting still thickens the stroke to 3px,
  which is the signal that survives.
- **Undo restores text, never the file you were in.** The document lives in CodeMirror's
  history; which file it came from is React state and is not in that history. So cmd+Z after
  New brings the diagram back but leaves you on `Untitled`, and Save will ask where to put it.
  Undo also reaches back past an Open, and Save writes whatever is on screen — which is
  consistent, but means undoing blindly after opening a file can put the previous document
  into it. The name and the `*` marker are always showing what would be written.
- **The file you opened is forgotten on reload.** Handles are not persisted, so after a
  refresh you have your text back from autosave but Save asks for a location again.
  `FileSystemFileHandle` can be stored in IndexedDB and re-permissioned, which is the fix if
  this becomes annoying.
- **Mermaid's shape aliases are not recognised.** Every shape has two or three of them —
  `db` and `database` for `cyl`, `subroutine` for `fr-rect` — and only the canonical short
  name is in the list here. A hand-written `A@{ shape: db }` still renders as a cylinder; the
  picker just shows nothing as current until you pick a shape, which rewrites it to `cyl`.
- **Deleting an edge does not renumber `linkStyle`.** `linkStyle` addresses edges by index,
  so removing one shifts every later index and the styling lands on the wrong edge. Nothing
  in the canvas writes `linkStyle`, so this only bites a hand-written document.
- **Everything on an edge is declined on `A & B --> C`.** The scanner reads edges as the
  links between consecutive node references, which is not what the `&` list form means, so it
  reports a count mermaid disagrees with and every edge in the document — and now every edge
  label too, since they share the index — stops responding to clicks. Nodes are unaffected.
  Declining beats editing the wrong edge; the same is true of the `A -- text --> B` inline
  label form.

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
