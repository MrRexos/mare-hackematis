import React from "react";
import { Img, OffthreadVideo, staticFile } from "remotion";
import { FULL } from "../theme";

const fill: React.CSSProperties = { position: "absolute", left: 0, top: 0, width: FULL.w, height: FULL.h, display: "block" };

/** A still of the app, captured at 3840 × 2160 and shown in a 1920 × 1080 box. */
export const Still: React.FC<{ name: string }> = ({ name }) => <Img src={staticFile(`app/${name}.webp`)} style={fill} />;

/** A sequence of the app, captured at 1920 × 1080. */
export const Clip: React.FC<{ name: string; startFrom?: number }> = ({ name, startFrom = 0 }) => (
  <OffthreadVideo src={staticFile(`app/${name}.mp4`)} trimBefore={startFrom} muted style={fill} />
);
