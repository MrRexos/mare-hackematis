import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../components/Stage";
import { C, MARGIN, sans } from "../theme";

const out = Easing.bezier(0.16, 1, 0.3, 1);
const line: React.CSSProperties = { fontFamily: sans, fontSize: 96, lineHeight: "100px", fontWeight: 600, letterSpacing: "-0.04em", whiteSpace: "nowrap", color: C.ink };

/** The situation the challenge describes, in two lines on black. */
export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <div style={{ position: "absolute", left: MARGIN, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 18 }}>
        <div
          style={{
            ...line,
            opacity: interpolate(frame, [4, 14, 38, 50], [0, 1, 1, 0.42], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            translate: interpolate(frame, [4, 18], ["0px 14px", "0px 0px"], { easing: out, extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          The launch date just slipped.
        </div>
        <div
          style={{
            ...line,
            opacity: interpolate(frame, [38, 48], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            translate: interpolate(frame, [38, 52], ["0px 14px", "0px 0px"], { easing: out, extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          Where on the Moon do you land now?
        </div>
      </div>
    </Stage>
  );
};
