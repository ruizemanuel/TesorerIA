import { defineConfig } from "vite";

// A fixed origin: the stored passkey lives in this origin's localStorage, and a different port would hide it.
export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
