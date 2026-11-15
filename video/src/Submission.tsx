import React from "react";
import { AbsoluteFill, Series, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import captions from "./captions.json";
import { Headline } from "./components/Headline";
import { Answer } from "./scenes/Answer";
import { Astronaut } from "./scenes/Astronaut";
import { Compare } from "./scenes/Compare";
import { End } from "./scenes/End";
import { Hook } from "./scenes/Hook";
import { Plan } from "./scenes/Plan";
import { Reach } from "./scenes/Reach";
import { Score } from "./scenes/Score";
import { Trust } from "./scenes/Trust";
import { C } from "./theme";

export type SubmissionProps = { url: string; music: boolean };

/** Submission cut: 900 frames at 30 fps, 30.0 s, music tail included. */
export const Submission: React.FC<SubmissionProps> = ({ url, music }) => (
  <AbsoluteFill style={{ backgroundColor: C.canvas }}>
    <Series>
      <Series.Sequence name="01 Hook" durationInFrames={90}><Hook /></Series.Sequence>
      <Series.Sequence name="02 Plan" durationInFrames={120}><Plan /></Series.Sequence>
      <Series.Sequence name="03 Score" durationInFrames={150}><Score /></Series.Sequence>
      <Series.Sequence name="04 Answer" durationInFrames={120}><Answer /></Series.Sequence>
      <Series.Sequence name="05 Compare" durationInFrames={90}><Compare /></Series.Sequence>
      <Series.Sequence name="06 Astronaut" durationInFrames={120}><Astronaut /></Series.Sequence>
      <Series.Sequence name="07 Reach" durationInFrames={75}><Reach /></Series.Sequence>
      <Series.Sequence name="08 Trust" durationInFrames={75}><Trust /></Series.Sequence>
      <Series.Sequence name="09 End" durationInFrames={60}><End url={url} /></Series.Sequence>
    </Series>
    <Headline captions={captions.captions} />
    {music ? <Audio src={staticFile("audio/score-30s.wav")} /> : null}
  </AbsoluteFill>
);
