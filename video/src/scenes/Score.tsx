import React from "react";
import { Sequence, interpolate, useCurrentFrame } from "remotion";
import { AppLayer, AppWindow, Stage, camera, view } from "../components/Stage";
import { Clip, Still } from "../components/Shot";
import { FULL } from "../theme";

/** Frame at which the heat map appears in scoring.mp4 (set by capture/04-scoring.mjs). */
export const ARRIVAL = 75;
const SWAP = ARRIVAL + 12;
/** Where the camera rests at the end of this scene; the next scene starts from it. */
export const SCORE_END = view(110, 62, 1700);

/**
 * The real computation as a time-lapse, then the scored map. When the map is
 * up, the sequence gives way to a 4K still of the same screen so the push-in
 * stays sharp.
 */
export const Score: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = camera(frame, [{ at: SWAP, view: FULL }, { at: 150, view: SCORE_END }]);
  return (
    <Stage>
      <AppWindow>
        <Sequence name="Scoring time-lapse" durationInFrames={SWAP + 8} layout="none">
          <AppLayer view={FULL}><Clip name="scoring" /></AppLayer>
        </Sequence>
        <Sequence name="Scored map" from={SWAP} layout="none">
          <AppLayer view={cam} opacity={interpolate(frame, [SWAP, SWAP + 7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}>
            <Still name="explore-score" />
          </AppLayer>
        </Sequence>
      </AppWindow>
    </Stage>
  );
};
