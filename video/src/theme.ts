import { continueRender, delayRender, staticFile } from "remotion";

// Same typefaces as the app (web/index.html loads Geist and Geist Mono from
// Google Fonts). The film ships the latin variable files in public/fonts so
// that rendering does not depend on the network. Licence: SIL Open Font
// License 1.1.
const loadFont = (family: string, file: string) => {
  if (typeof document === "undefined") return family;
  const handle = delayRender(`Loading font ${family}`);
  const face = new FontFace(family, `url(${staticFile(file)}) format("woff2")`, { weight: "100 900", style: "normal" });
  face
    .load()
    .then(() => {
      document.fonts.add(face);
      continueRender(handle);
    })
    .catch((err) => {
      throw new Error(`Font ${family} failed to load: ${err}`);
    });
  return family;
};

export const sans = `"${loadFont("Geist", "fonts/Geist-latin.woff2")}", sans-serif`;
export const mono = `"${loadFont("Geist Mono", "fonts/GeistMono-latin.woff2")}", monospace`;

// Colours of the app's design system (web/public/design-system/tokens.css, dark theme).
export const C = {
  canvas: "#0b0b0c",
  surface: "#1c1c1e",
  ink: "#f5f5f7",
  ink2: "#a1a1a6",
  ink3: "#98989e",
  line: "#2c2c30",
  sun: "#f2c14e",
  earth: "#6cb4ff",
};

export const FPS = 30;
export const W = 1920;
export const H = 1080;

export type Rect = { x: number; y: number; w: number; h: number };
/** The whole app page, in the CSS pixels it was captured at. */
export const FULL: Rect = { x: 0, y: 0, w: 1920, h: 1080 };
/** Where the app sits on the film frame: a 16:9 window under the headline. */
export const WINDOW: Rect = { x: 160, y: 150, w: 1600, h: 900 };
/** Left edge shared by the window and all film text. */
export const MARGIN = 160;
