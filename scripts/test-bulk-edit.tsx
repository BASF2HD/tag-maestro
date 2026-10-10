// UI-only fixture: no disk handles, libraries or real music files.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BulkFieldEditDialog } from "../src/components/BulkFieldEditDialog";
import { emptyTags, emptyMeta, type Mp3File } from "../src/lib/mp3";
import "../src/styles.css";
document.documentElement.classList.add("dark");
const files: Mp3File[] = ["One", "Two"].map((title, index) => ({
  id: String(index),
  file: new File([], `Old ${title}.wav`),
  format: "wav",
  tags: { ...emptyTags(), title: `Old ${title}`, comment: "Old comment" },
  original: emptyTags(),
  meta: emptyMeta(),
  dirty: false,
  folderName: "Old Album",
  editedFolderName: "Old Album",
  folderPath: "Music/Old Album",
}));
function Fixture() {
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState("");
  return (
    <main>
      <p role="status">{result || "No edits applied"}</p>
      <button onClick={() => setOpen(true)}>Open bulk editor</button>
      <BulkFieldEditDialog
        open={open}
        onOpenChange={setOpen}
        files={files}
        onApply={(field, changes) => setResult(JSON.stringify({ field, changes: [...changes] }))}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
