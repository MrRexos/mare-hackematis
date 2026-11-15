import React from "react";
import { useCurrentFrame } from "remotion";
import { AppLayer, AppWindow, Stage, camera, view } from "../components/Stage";
import { Still } from "../components/Shot";

// Left: sites 01 and 02 and "Why HS1?". Right: sites 03 and 04 and the side-by-side table.
const LEFT = view(96, 6, 1140);
const RIGHT = view(772, 6, 1140);

/** Compare: the best calculated candidate against three Artemis III regions. */
export const Compare: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <AppWindow>
        <AppLayer view={camera(frame, [{ at: 0, view: LEFT }, { at: 30, view: LEFT }, { at: 62, view: RIGHT }, { at: 90, view: RIGHT }])}>
          <Still name="compare" />
        </AppLayer>
      </AppWindow>
    </Stage>
  );
};
