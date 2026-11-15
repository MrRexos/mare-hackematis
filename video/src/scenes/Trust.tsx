import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../components/Stage";
import { C, MARGIN, mono, sans } from "../theme";

const out = Easing.bezier(0.16, 1, 0.3, 1);
const rise = (frame: number, at: number) => ({
  opacity: interpolate(frame, [at, at + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  translate: interpolate(frame, [at, at + 12], ["0px 12px", "0px 0px"], { easing: out, extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
});

/**
 * The check, as a number on black. Source: web/public/data/validation.json
 * (largest difference 0.0016 arcmin for the Earth, 0.00004 for the Sun;
 * 6 series of 121 samples). The app shows the same figure as "≤ 0.002′".
 */
export const Trust: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <div style={{ position: "absolute", left: MARGIN, top: 214, fontFamily: mono, fontSize: 22, letterSpacing: "0.18em", color: C.ink3, ...rise(frame, 2) }}>
        CHECKED AGAINST JPL HORIZONS
      </div>
      <div style={{ position: "absolute", left: MARGIN - 8, top: 262, display: "flex", alignItems: "baseline", gap: 30, ...rise(frame, 2) }}>
        <span style={{ fontFamily: sans, fontSize: 300, lineHeight: "300px", fontWeight: 600, letterSpacing: "-0.05em", color: C.ink, fontVariantNumeric: "tabular-nums" }}>0.002</span>
        <span style={{ fontFamily: sans, fontSize: 64, fontWeight: 500, letterSpacing: "-0.02em", color: C.ink2 }}>arcminutes, at most</span>
      </div>
      <div style={{ position: "absolute", left: MARGIN, top: 608, fontFamily: sans, fontSize: 44, lineHeight: "54px", fontWeight: 500, letterSpacing: "-0.02em", color: C.ink, ...rise(frame, 12) }}>
        Sun and Earth, azimuth and elevation.
        <span style={{ color: C.ink2 }}> 726 comparisons at 3 sites.</span>
      </div>
      <div style={{ position: "absolute", left: MARGIN, top: 868, display: "flex", gap: 22, alignItems: "center", fontFamily: sans, fontSize: 30, color: C.ink2, ...rise(frame, 22) }}>
        <span style={{ fontFamily: mono, fontSize: 20, letterSpacing: "0.18em", color: C.ink3 }}>DATA</span>
        <span>NASA LOLA</span>
        <span style={{ color: C.ink3 }}>·</span>
        <span>NASA/JPL SPICE DE440</span>
        <span style={{ color: C.ink3 }}>·</span>
        <span>LRO Diviner</span>
      </div>
    </Stage>
  );
};
