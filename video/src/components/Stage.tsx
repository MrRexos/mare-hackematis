import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { C, FULL, Rect, WINDOW } from "../theme";

/** Black stage every scene sits on. */
export const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ backgroundColor: C.canvas }}>{children}</AbsoluteFill>
);

/**
 * The window the app is shown in. Its content is always a real capture; the
 * film only decides which part of the page is in view.
 */
export const AppWindow: React.FC<{ rect?: Rect; radius?: number; children: React.ReactNode }> = ({ rect = WINDOW, radius = 22, children }) => (
  <div
    style={{
      position: "absolute",
      left: rect.x,
      top: rect.y,
      width: rect.w,
      height: rect.h,
      borderRadius: radius,
      overflow: "hidden",
      backgroundColor: C.canvas,
      boxShadow: radius > 0 ? "0 0 0 1px rgba(255,255,255,0.10), 0 40px 120px rgba(0,0,0,0.65)" : "none",
    }}
  >
    {children}
  </div>
);

/** Places a 1920 × 1080 capture so that `view` fills a window `win` wide. */
export const AppLayer: React.FC<{ view: Rect; win?: Rect; opacity?: number; children: React.ReactNode }> = ({ view, win = WINDOW, opacity = 1, children }) => {
  const s = win.w / view.w;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: FULL.w,
        height: FULL.h,
        transformOrigin: "0 0",
        translate: `${-view.x * s}px ${-view.y * s}px`,
        scale: String(s),
        opacity,
      }}
    >
      {children}
    </div>
  );
};

/** A 16:9 view of the page, `w` CSS pixels wide, from its top-left corner. */
export const view = (x: number, y: number, w: number): Rect => ({ x, y, w, h: (w * 9) / 16 });

const inOut = Easing.bezier(0.65, 0, 0.35, 1);

/**
 * Camera over a capture: eased moves between views. Width is interpolated on a
 * log scale so a zoom has an even speed.
 */
export function camera(frame: number, keys: { at: number; view: Rect }[]): Rect {
  if (frame <= keys[0].at) return keys[0].view;
  const last = keys[keys.length - 1];
  if (frame >= last.at) return last.view;
  const i = keys.findIndex((k) => k.at > frame) - 1;
  const a = keys[i], b = keys[i + 1];
  const t = interpolate(frame, [a.at, b.at], [0, 1], { easing: inOut });
  const w = Math.exp(Math.log(a.view.w) + (Math.log(b.view.w) - Math.log(a.view.w)) * t);
  const cx = a.view.x + a.view.w / 2 + (b.view.x + b.view.w / 2 - a.view.x - a.view.w / 2) * t;
  const cy = a.view.y + a.view.h / 2 + (b.view.y + b.view.h / 2 - a.view.y - a.view.h / 2) * t;
  const h = (w * 9) / 16;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Mixes two rectangles (used when the window grows to the full frame). */
export const mixRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t,
});
