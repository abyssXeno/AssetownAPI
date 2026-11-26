import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    target: "chrome120",
    assetsInlineLimit: 0,
  },
  server: {
    port: 5183,
    strictPort: true,
    host: "127.0.0.1",
  },
});
