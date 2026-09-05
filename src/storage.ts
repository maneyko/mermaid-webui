// Getting the document out of the tab and somewhere it survives. Two unrelated durabilities:
// localStorage so a refresh does not cost you the diagram, and a real file so the .mmd can
// live in a git repo, which is the whole reason this project keeps the text canonical.

const AUTOSAVE_KEY = 'mermaid-webui:source'

// Safari's private mode throws on both of these, and this write runs on every keystroke --
// an exception out of that effect would take the app down. Losing autosave is the better half.
export function readAutosave(): string | null {
  try {
    return localStorage.getItem(AUTOSAVE_KEY)
  } catch {
    return null
  }
}

export function writeAutosave(source: string): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, source)
  } catch {
    return
  }
}

interface PickerOptions {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}

// TypeScript's DOM lib has FileSystemFileHandle but not the two pickers that hand one out.
// Optional rather than required, because they are the whole of what makes this Chrome-only.
declare global {
  interface Window {
    showOpenFilePicker?: (options?: PickerOptions) => Promise<FileSystemFileHandle[]>
    showSaveFilePicker?: (options?: PickerOptions) => Promise<FileSystemFileHandle>
  }
}

const TYPES = [{ description: 'Mermaid diagram', accept: { 'text/plain': ['.mmd', '.mermaid'] } }]

export const filesSupported = 'showSaveFilePicker' in window

// Closing the picker rejects with AbortError. That is how you say no, not a failure.
function declined(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError'
}

export async function pickToOpen(): Promise<{ handle: FileSystemFileHandle; text: string } | null> {
  try {
    const handle = (await window.showOpenFilePicker?.({ types: TYPES }))?.[0]
    if (handle === undefined) return null
    return { handle, text: await (await handle.getFile()).text() }
  } catch (cause) {
    if (declined(cause)) return null
    throw cause
  }
}

export async function pickToSave(suggestedName: string): Promise<FileSystemFileHandle | null> {
  try {
    return (await window.showSaveFilePicker?.({ suggestedName, types: TYPES })) ?? null
  } catch (cause) {
    if (declined(cause)) return null
    throw cause
  }
}

export async function writeFile(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(text)
  await writable.close()
}
