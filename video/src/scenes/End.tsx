import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../components/Stage";
import { C, MARGIN, mono, sans } from "../theme";

const out = Easing.bezier(0.16, 1, 0.3, 1);
const rise = (frame: number, at: number) => ({
  opacity: interpolate(frame, [at, at + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  translate: interpolate(frame, [at, at + 12], ["0px 12px", "0px 0px"], { easing: out, extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
});

/** Name, team, event. No logo of any agency: the datasets are named as sources only. */
export const End: React.FC<{ url: string }> = ({ url }) => {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <div style={{ position: "absolute", left: MARGIN - 6, top: 300, fontFamily: sans, fontSize: 176, lineHeight: "176px", fontWeight: 600, letterSpacing: "-0.045em", color: C.ink, ...rise(frame, 0) }}>
        Mare Hackematis
      </div>
      <div style={{ position: "absolute", left: MARGIN, top: 506, fontFamily: sans, fontSize: 52, fontWeight: 500, letterSpacing: "-0.02em", color: C.ink2, ...rise(frame, 4) }}>
        by Hackemate
      </div>
      <div style={{ position: "absolute", left: MARGIN, top: 640, fontFamily: sans, fontSize: 34, color: C.ink, ...rise(frame, 8) }}>
        NASA Space Apps Challenge 2026
        <span style={{ color: C.ink3 }}> · </span>
        <span style={{ color: C.ink2 }}>Lunar Landing Site Navigator</span>
      </div>
      {url ? (
        <div style={{ position: "absolute", left: MARGIN, top: 708, fontFamily: mono, fontSize: 32, color: C.ink, ...rise(frame, 8) }}>{url}</div>
      ) : null}
      <div style={{ position: "absolute", left: MARGIN, top: 926, fontFamily: sans, fontSize: 28, color: C.ink2, ...rise(frame, 6) }}>
        Student project. Not affiliated with or endorsed by NASA. Data sources are named for attribution only.
      </div>
    </Stage>
  );
};
