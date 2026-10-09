import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileTable } from "../src/routes/index";
import { AudioPreview, type PreviewState } from "../src/lib/audio-preview";
import { readMp3, writeTagsToBlob, type Mp3File } from "../src/lib/mp3";
import "../src/styles.css";

function Demo() {
  const [files, setFiles] = useState<Mp3File[]>([]);
  const [selected, setSelected] = useState(new Set<string>());
  const [preview, setPreview] = useState<PreviewState>({ id: null, playing: false, loading: false });
  const [report, setReport] = useState("Loading generated fixtures only…");
  const player = useRef<AudioPreview | null>(null);
  useEffect(() => {
    const controller = new AudioPreview(new Audio(), setPreview, setReport);
    player.current = controller;
    let mounted = true;
    void Promise.all(["wav", "mp3", "flac", "m4a", "aac", "ogg", "opus", "aiff", "wma", "wv", "tta"].map(async (extension) => {
      const response = await fetch(`/@fs/private/tmp/tagmaestro-preview-fixtures/preview.${extension}`);
      if (!response.ok) throw new Error(`Fixture ${extension} could not be loaded`);
      return readMp3(new File([await response.blob()], `preview.${extension}`), `Synthetic/Disposable Fixtures/preview.${extension}`, true, false);
    })).then((rows) => {
      if (!mounted) return;
      setFiles(rows); setReport(`Loaded ${rows.length} formats. All files are disposable test audio; no real songs are accessed.`);
    }).catch((error) => setReport(`FAIL loading fixtures: ${error.message}`));
    return () => { mounted = false; controller.destroy(); };
  }, []);
  async function checkTags() {
    const results: string[] = [];
    for (const row of files) {
      if (row.format === "aac") continue;
      try {
        const output = await writeTagsToBlob({ ...row, tags: { ...row.tags, title: "Verified test title", artist: "Test artist" } });
        const verified = await readMp3(new File([output], row.file.name), undefined, true, false);
        results.push(`${row.format}: ${verified.tags.title === "Verified test title" && verified.tags.artist === "Test artist" ? "PASS" : "FAIL"}`);
      } catch (error) { results.push(`${row.format}: FAIL ${String(error)}`); }
    }
    setReport(results.join("\n"));
  }
  return <div className="flex h-screen flex-col bg-background text-foreground">
    <header className="flex items-center gap-4 border-b p-3"><strong>Tag Maestro — song actions test</strong><button onClick={() => document.documentElement.classList.toggle("dark")}>Toggle test theme</button><button onClick={() => void checkTags()}>Verify format tags in memory</button><button onClick={() => {
      player.current?.stop();
      const original = files.find((file) => file.format === "wav");
      if (!original) return;
      setSelected(new Set());
      setFiles(Array.from({ length: 120 }, (_, index) => ({ ...original, id: `fixture-${index}`, file: new File([original.file], `track-${String(index + 1).padStart(3, "0")}.wav`), tags: { ...original.tags, title: `Test song ${index + 1}` } })));
      setReport("120 generated rows for scrolling and pagination; originals are never accessed.");
    }}>Expand to 120 test songs</button></header>
    <FileTable files={files} allTracks={files} selected={selected} filter="" onToggle={() => {}} onSelectAll={setSelected} onEdit={(id, key, value) => setFiles((rows) => rows.map((row) => row.id === id ? { ...row, tags: { ...row.tags, [key]: value } } : row))} onEditFolder={() => {}} onEditFilename={() => {}} onRemoveSelected={() => {}} onRemoveAll={() => {}} preview={preview} previewPlayer={player.current} activePreviewTrack={files.find((file) => file.id === preview.id)} onPreview={(file) => void player.current?.toggle(file)} onDelete={async (ids) => {
      if (ids.includes(player.current?.state.id || "")) player.current?.stop();
      setFiles((rows) => rows.filter((row) => !ids.includes(row.id)));
      setSelected((previous) => new Set([...previous].filter((id) => !ids.includes(id))));
      setReport(`Simulated deletion of ${ids.length} fixture row(s); no files deleted from disk.`);
      return ids;
    }} actionsDisabled={false}/>
    <div className="border-t p-3 text-xs"><p role="status">Selected rows: {selected.size}; Preview: {preview.id ? files.find((file) => file.id === preview.id)?.file.name : "none"}; {preview.playing ? "playing" : preview.loading ? "loading" : "paused"}</p><pre className="mt-2 whitespace-pre-wrap">{report}</pre></div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Demo/>);
