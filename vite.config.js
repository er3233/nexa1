import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: projectRoot,
  envDir: projectRoot,
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
});
