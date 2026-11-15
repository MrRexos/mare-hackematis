import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { AppLayer, AppWindow, Stage, camera, view } from "../components/Stage";
import { Still } from "../components/Shot";
import { SCORE_END } from "./Score";

// Hotspot labels on the map and the best-site card (.rank__best in captured.json).
const BEST = view(1040, 66, 880);
// Sky & Time: the cards Sunlight, Next night and Earth sets, and the two-week bars.
const SKY_WIDE = view(96, 60, 1812);
const SKY = view(96, 148, 1372);

/** What the planner gets back: the best site and window, then its sky over time. */
export const Answer: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage>
      <AppWindow>
        <Sequence name="Best site" durationInFrames={54} layout="none">
          <AppLayer view={camera(frame, [{ at: 0, view: SCORE_END }, { at: 22, view: BEST }, { at: 54, view: view(1052, 72, 860) }])}>
            <Still name="explore-score" />
          </AppLayer>
        </Sequence>
        <Sequence name="Sky and time" from={54} durationInFrames={66} layout="none">
          <AppLayer view={camera(frame, [{ at: 54, view: SKY_WIDE }, { at: 62, view: SKY_WIDE }, { at: 86, view: SKY }, { at: 120, view: view(100, 152, 1352) }])}>
            <Still name="mare-sky" />
          </AppLayer>
        </Sequence>
      </AppWindow>
    </Stage>
  );
};
