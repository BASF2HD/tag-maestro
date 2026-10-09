// A disposable UI fixture: no IndexedDB, library handles or music files.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EditableTableCell } from "../src/components/EditableTableCell";
import "../src/styles.css";
function Test() {
  const [selected, setSelected] = useState(false);
  const [value, setValue] = useState("Test song title");
  return (
    <main className="p-8">
      <h1>Tag Maestro · Row selection and editing test</h1>
      <p>Single-click selects. Double-click edits. This fixture cannot change music.</p>
      <p role="status">
        {selected ? "Row selected" : "No row selected"} · Current title: {value}
      </p>
      <table className="mt-4 border">
        <tbody>
          <tr
            data-selected={selected}
            onClick={() => setSelected(true)}
            className={selected ? "bg-blue-50" : ""}
          >
            <EditableTableCell value={value} onChange={setValue} style={{ width: 420 }} />
          </tr>
        </tbody>
      </table>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Test />);
