import React from "react";
import { Composition, Folder } from "remotion";
import { Submission } from "./Submission";
import { Answer } from "./scenes/Answer";
import { Astronaut } from "./scenes/Astronaut";
import { Compare } from "./scenes/Compare";
import { End } from "./scenes/End";
import { Hook } from "./scenes/Hook";
import { Plan } from "./scenes/Plan";
import { Reach } from "./scenes/Reach";
import { Score } from "./scenes/Score";
import { Trust } from "./scenes/Trust";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Submission"
      component={Submission}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={900}
      defaultProps={{ url: "nasa-space-apps-2026-swart.vercel.app", music: true }}
    />
    <Folder name="Submission-Scenes">
      <Composition id="Hook" component={Hook} width={1920} height={1080} fps={30} durationInFrames={90} />
      <Composition id="Plan" component={Plan} width={1920} height={1080} fps={30} durationInFrames={120} />
      <Composition id="Score" component={Score} width={1920} height={1080} fps={30} durationInFrames={150} />
      <Composition id="Answer" component={Answer} width={1920} height={1080} fps={30} durationInFrames={120} />
      <Composition id="Compare" component={Compare} width={1920} height={1080} fps={30} durationInFrames={90} />
      <Composition id="Astronaut" component={Astronaut} width={1920} height={1080} fps={30} durationInFrames={120} />
      <Composition id="Reach" component={Reach} width={1920} height={1080} fps={30} durationInFrames={75} />
      <Composition id="Trust" component={Trust} width={1920} height={1080} fps={30} durationInFrames={75} />
      <Composition id="End" component={End} width={1920} height={1080} fps={30} durationInFrames={60} defaultProps={{ url: "nasa-space-apps-2026-swart.vercel.app" }} />
    </Folder>
  </>
);
