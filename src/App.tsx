import { useState } from 'react'
import './App.css'

type SelectedFile = {
  name: string
  size: number
  lastModified: number
}

function App() {
  const [file, setFile] = useState<SelectedFile | null>(null)

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile({ name: f.name, size: f.size, lastModified: f.lastModified })
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>XF MIDI Viewer</h1>
        <p className="muted">YAMAHA XF フォーマットの MIDI ファイルを解析・表示します</p>
      </header>

      <section className="file-picker">
        <label className="file-input">
          <input
            type="file"
            accept=".mid,.midi,.kar,.xih,.xkm,audio/midi"
            onChange={onChange}
          />
          <span>MIDI ファイルを選択</span>
        </label>
      </section>

      {file && (
        <section className="file-info">
          <dl>
            <dt>File name</dt>
            <dd>{file.name}</dd>
            <dt>Size</dt>
            <dd>{file.size.toLocaleString()} bytes</dd>
            <dt>Last modified</dt>
            <dd>{new Date(file.lastModified).toLocaleString()}</dd>
          </dl>
        </section>
      )}
    </main>
  )
}

export default App
