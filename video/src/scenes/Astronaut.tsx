import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { AppLayer, AppWindow, Stage, mixRect } from "../components/Stage";
import { Clip } from "../components/Shot";
import { C, FULL, H, W, WINDOW, sans } from "../theme";

const out = Easing.bezier(0.16, 1, 0.3, 1);
const SCREEN = { x: 0, y: 0, w: W, h: H };

/**
 * Astronaut Mode at the best calculated site. The window opens to the full
 * frame, so the capture is seen pixel for pixel; the caption sits in the sky.
 */
export const Astronaut: React.FC = () => {
  const frame = useCurrentFrame();
  const grow = interpolate(frame, [0, 16], [0, 1], { easing: out, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const win = mixRect(WINDOW, SCREEN, grow);
  return (
    <Stage>
      <AppWindow rect={win} radius={22 * (1 - grow)}>
        <AppLayer view={FULL} win={win}><Clip name="astronaut" /></AppLayer>
      </AppWindow>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 196,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          // Gone before the telephoto: the Earth then crosses this part of the sky.
          opacity: interpolate(frame, [2, 10, 70, 78], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: interpolate(frame, [2, 16], ["0px 10px", "0px 0px"], { easing: out, extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div style={{ fontFamily: sans, fontSize: 50, lineHeight: "56px", fontWeight: 600, letterSpacing: "-0.03em", color: C.ink }}>Walk a 1:1 model of the site.</div>
        <div style={{ fontFamily: sans, fontSize: 25, lineHeight: "30px", color: C.ink2 }}>LOLA 240 m relief. Smaller craters and rocks are generated.</div>
      </div>
    </Stage>
  );
};
