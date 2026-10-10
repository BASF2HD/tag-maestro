// Disposable UI fixture: no library, file picker, disk writes or IndexedDB.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TagFieldCombo, KEEP_TAG_VALUE } from "../src/components/TagFieldCombo";
import "../src/styles.css";

function Test() {
  const [comments, setComments] = useState([
    "First comment",
    "Second comment\nSecond line",
    "Unselected comment",
  ]);
  const [changed, setChanged] = useState(false);
  const same = comments[0] === comments[1];
  return (
    <main className="p-8">
      <h1>Tag Maestro · Comment controls test</h1>
      <p>Two selected songs, one unselected song. No music files are loaded.</p>
      <section className="mt-4 w-[340px]">
        <label>Comment</label>
        <TagFieldCombo
          fieldLabel="Comment"
          multiline
          value={same ? comments[0] : KEEP_TAG_VALUE}
          options={[...new Set(comments.slice(0, 2).filter(Boolean))]}
          onChange={(value) => {
            if (value === KEEP_TAG_VALUE) return;
            setChanged(true);
            setComments(([a, b, other]) => [value, value, other]);
          }}
        />
      </section>
      <pre role="status" className="mt-8">
        {JSON.stringify({ comments, changed })}
      </pre>
      <section className="mt-8 w-[340px]">
        <TagFieldCombo
          fieldLabel="Disabled comment"
          multiline
          disabled
          value=""
          options={[]}
          onChange={() => {
            throw Error("Disabled editor changed");
          }}
        />
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Test />);
