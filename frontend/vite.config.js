import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: false,            // <– सबसे important: Vite अब interfaces scan नहीं करेगा
    port: 5173,
    strictPort: true,
    hmr: false,
    open: false,
    fs: {
      strict: false
    }
  }
});
