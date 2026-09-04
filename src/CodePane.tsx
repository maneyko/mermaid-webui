import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { mermaidLanguage } from './mermaidLanguage'

interface CodePaneProps {
  source: string
  onChange: (source: string) => void
}

export default function CodePane({ source, onChange }: CodePaneProps) {
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

  return <div className="code" ref={host} />
}
