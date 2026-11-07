// UI fixture only: synthetic rows without disk handles or a user library.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TagConverterDialog } from "../src/components/TagConverterDialog";
import { emptyTags, emptyMeta, type Mp3File } from "../src/lib/mp3";
import "../src/styles.css";
document.documentElement.classList.add("dark");
const files: Mp3File[] = [
  "Aayusu Nooru - 02 - Brahmadevan.mp3",
  "Other Album - 03 - Next Song.mp3",
  "Unmatched.mp3",
].map((name, index) => ({
  id: String(index),
  file: new File([], name),
  format: "mp3",
  tags: { ...emptyTags(), album: "Keep existing album" },
  original: emptyTags(),
  meta: emptyMeta(),
  dirty: false,
  folderName: "Fixture",
  editedFolderName: "Fixture",
  folderPath: "Fixture",
}));
function Fixture() {
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState("");
  return (
    <main>
      <p role="status">{result || "No changes applied"}</p>
      <button onClick={() => setOpen(true)}>Open converter</button>
      <TagConverterDialog
        open={open}
        onOpenChange={setOpen}
        files={files}
        onApply={(changes) => setResult(JSON.stringify([...changes]))}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
