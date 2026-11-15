import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { C, MARGIN, W, mono, sans } from "../theme";

export type Caption = { from: number; to: number; text: string; sub?: string; place?: string };

const out = Easing.bezier(0.16, 1, 0.3, 1);

/** The line above the app window. One caption at a time, read top-left first. */
export const Headline: React.FC<{ captions: Caption[] }> = ({ captions }) => {
  const frame = useCurrentFrame();
  const cue = captions.find((c) => c.place !== "scene" && frame >= c.from && frame < c.to);
  const brandOn = captions.some((c) => c.place !== "scene" && frame >= c.from - 6 && frame < c.to);
  return (
    <>
      {cue ? (
        <div
          style={{
            position: "absolute",
            left: MARGIN,
            top: 0,
            height: 150,
            width: W - 2 * MARGIN - 260,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 10,
            opacity: interpolate(frame, [cue.from, cue.from + 7, cue.to - 4, cue.to], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            translate: interpolate(frame, [cue.from, cue.from + 10], ["0px 10px", "0px 0px"], { easing: out, extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          <div style={{ fontFamily: sans, fontSize: 50, lineHeight: "56px", fontWeight: 600, letterSpacing: "-0.03em", color: C.ink, whiteSpace: "nowrap" }}>{cue.text}</div>
          {cue.sub ? <div style={{ fontFamily: sans, fontSize: 25, lineHeight: "30px", fontWeight: 400, color: C.ink3, whiteSpace: "nowrap" }}>{cue.sub}</div> : null}
        </div>
      ) : null}
      {brandOn ? (
        <div style={{ position: "absolute", right: MARGIN, top: 0, height: 150, display: "flex", alignItems: "center", fontFamily: mono, fontSize: 20, letterSpacing: "0.18em", color: C.ink3 }}>
          MARE HACKEMATIS
        </div>
      ) : null}
    </>
  );
};
