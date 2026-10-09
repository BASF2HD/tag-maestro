import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") }, dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 5175, strictPort: true, fs: { allow: [process.cwd(), "/private/tmp/tagmaestro-preview-fixtures"] } },
});
