import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { AppLayer, AppWindow, Stage, camera, view } from "../components/Stage";
import { Still } from "../components/Shot";

// The planner's title and editor column: .setup__title and .setup__editor in captured.json.
const EDITOR = view(0, 150, 1160);

/** The three questions of the planner, as the app asks them. */
export const Plan: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = (start: number) => camera(frame, [{ at: start, view: EDITOR }, { at: start + 40, view: view(8, 156, 1132) }]);
  return (
    <Stage>
      <AppWindow>
        <Sequence name="Where" durationInFrames={40} layout="none">
          <AppLayer view={camera(frame, [{ at: 0, view: view(0, 96, 1320) }, { at: 16, view: EDITOR }, { at: 40, view: view(6, 154, 1140) }])}><Still name="plan-where" /></AppLayer>
        </Sequence>
        <Sequence name="When" from={40} durationInFrames={40} layout="none">
          <AppLayer view={drift(40)}><Still name="plan-when" /></AppLayer>
        </Sequence>
        <Sequence name="How" from={80} durationInFrames={40} layout="none">
          <AppLayer view={drift(80)}><Still name="plan-how" /></AppLayer>
        </Sequence>
      </AppWindow>
    </Stage>
  );
};
