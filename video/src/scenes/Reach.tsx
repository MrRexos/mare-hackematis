import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { AppLayer, AppWindow, Stage, camera, view } from "../components/Stage";
import { Still } from "../components/Shot";
import { FULL } from "../theme";

/** The same plan on the North Pole map, then the whole-Moon globe. */
export const Reach: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <AppWindow>
        <Sequence name="North Pole" durationInFrames={37} layout="none">
          <AppLayer view={camera(frame, [{ at: 0, view: FULL }, { at: 37, view: view(28, 16, 1864) }])}><Still name="north-score" /></AppLayer>
        </Sequence>
        <Sequence name="Whole Moon" from={37} durationInFrames={38} layout="none">
          <AppLayer view={camera(frame, [{ at: 37, view: FULL }, { at: 75, view: view(28, 16, 1864) }])}><Still name="moon-globe" /></AppLayer>
        </Sequence>
      </AppWindow>
    </Stage>
  );
};
