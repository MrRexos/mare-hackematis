import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` relativo: la web funciona tanto en local como en GitHub Pages
// (https://<usuario>.github.io/NASA-Space-Apps-2026/) sin cambiar nada.
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
});
