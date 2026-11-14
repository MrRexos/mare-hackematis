import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// Los componentes del design system (bundle.js) usan `window.React`, así que
// compartimos la misma copia de React antes de cargarlo.
window.React = React;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

const root = createRoot(document.getElementById("root"));
loadScript(`${import.meta.env.BASE_URL}design-system/bundle.js`)
  .then(() => root.render(<App />))
  .catch((e) => {
    root.render(<p style={{ padding: 24, color: "var(--danger)" }}>{e.message}</p>);
  });
