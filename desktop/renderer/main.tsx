import React from "react";
import { createRoot } from "react-dom/client";
import { TagMaestro } from "../../src/routes/index";
import "../../src/styles.css";

try {
  document.documentElement.classList.add(
    localStorage.getItem("theme") === "dark" ? "dark" : "light",
  );
} catch {
  document.documentElement.classList.add("light");
}
createRoot(document.getElementById("root")!).render(<TagMaestro />);
if (new URL(location.href).searchParams.has("selftest")) {
  import("./self-test")
    .then((test) => test.runDesktopSelfTest())
    .catch((error) => {
      document.documentElement.dataset.desktopTest = JSON.stringify({
        ok: false,
        error: String(error),
      });
    });
}
