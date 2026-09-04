import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { mermaidLanguage } from './mermaidLanguage'

export interface Range {
  from: number
  to: number
}

interface CodePaneProps {
  source: string
  onChange: (source: string) => void
  reveal: Range | null
}

export default function CodePane({ source, onChange, reveal }: CodePaneProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latestOnChange = useRef(onChange)
  latestOnChange.current = onChange

  // Built once. Recreating the view whenever `source` changes would destroy the cursor and
  // undo history on every keystroke, so the initial doc is read here and never again.
  useEffect(() => {
    if (host.current === null) return

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: source,
        extensions: [
          lineNumbers(),
          // Without this the selection is the native one, which is invisible unless the
          // editor holds focus -- and the canvas is where the user is working.
          drawSelection(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          syntaxHighlighting(defaultHighlightStyle),
          mermaidLanguage,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latestOnChange.current(update.state.doc.toString())
          }),
        ],
      }),
    })

    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
  }, [])

  // Only fires for edits that did not come from typing here -- a canvas-driven rewrite in a
  // later milestone. Typing round-trips to an identical string and is skipped.
  useEffect(() => {
    const editor = view.current
    if (editor === null) return

    const current = editor.state.doc.toString()
    if (current === source) return

    editor.dispatch({ changes: { from: 0, to: current.length, insert: source } })
  }, [source])

  // Selecting the range is the highlight: it uses CodeMirror's own selection rendering rather
  // than a decoration layer. Deliberately does not focus the editor -- the selection comes
  // from clicking the canvas, and stealing focus there kills the rename overlay.
  useEffect(() => {
    const editor = view.current
    if (editor === null || reveal === null) return

    const end = editor.state.doc.length
    if (reveal.from > end || reveal.to > end) return

    editor.dispatch({ selection: { anchor: reveal.from, head: reveal.to }, scrollIntoView: true })
  }, [reveal])

  return <div className="code" ref={host} />
}
