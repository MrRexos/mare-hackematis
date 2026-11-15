import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { AppLayer, AppWindow, Stage, camera, view } from "../components/Stage";
import { Still } from "../components/Shot";
import { FULL } from "../theme";

// The planner's title and editor column: .setup__title and .setup__editor in captured.json.
const EDITOR = view(0, 150, 1160);

/** The three questions of the planner, as the app asks them. */
export const Plan: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = (start: number) => camera(frame, [{ at: start, view: EDITOR }, { at: start + 30, view: view(8, 156, 1132) }]);
  return (
    <Stage>
      <AppWindow>
        <Sequence name="Home" durationInFrames={30} layout="none">
          <AppLayer view={camera(frame, [{ at: 0, view: FULL }, { at: 30, view: view(30, 17, 1860) }])}><Still name="home-empty" /></AppLayer>
        </Sequence>
        <Sequence name="Where" from={30} durationInFrames={30} layout="none">
          <AppLayer view={drift(30)}><Still name="plan-where" /></AppLayer>
        </Sequence>
        <Sequence name="When" from={60} durationInFrames={30} layout="none">
          <AppLayer view={drift(60)}><Still name="plan-when" /></AppLayer>
        </Sequence>
        <Sequence name="How" from={90} durationInFrames={30} layout="none">
          <AppLayer view={drift(90)}><Still name="plan-how" /></AppLayer>
        </Sequence>
      </AppWindow>
    </Stage>
  );
};
