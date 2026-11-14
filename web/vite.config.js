import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` relativo: la web funciona tanto en local como en GitHub Pages
// (https://<usuario>.github.io/NASA-Space-Apps-2026/) sin cambiar nada.
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  server: {
    proxy: {
      // Only this public NASA host is reachable; preserves HTTP Range for GeoTIFF windows.
      "/__nasa-dem/data/": {
        target: "https://pgda.gsfc.nasa.gov", changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__nasa-dem/, ""),
      },
    },
  },
});
