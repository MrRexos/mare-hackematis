import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` relativo: la web funciona tanto en local como en GitHub Pages
// (https://<usuario>.github.io/NASA-Space-Apps-2026/) sin cambiar nada.
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  // Dependencies that only Astronaut Mode imports (some from its worker). Without this, the dev
  // server finds them the first time the mode opens, re-optimises and reloads the page, which
  // throws the user back to Home.
  optimizeDeps: { include: ["geotiff", "@dimforge/rapier3d-compat"] },
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
