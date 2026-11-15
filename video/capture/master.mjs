// Final step: turns the Remotion render into the file that is handed in, and
// checks it against the limits of the brief.
//
// The AAC encoder pads the audio, which would make the container a few
// milliseconds longer than the 900 frames of picture. The score is silent in
// its last 150 ms, so the audio is trimmed to 29.9 s and the picture alone sets
// the length: 30.000 s.
//
//   node capture/master.mjs [out/render.mp4] [deliverables/mare-hackematis-30s.mp4]

import { execFileSync } from "node:child_process";
import path from "node:path";
import { ROOT, ensureDir } from "./lib.mjs";

const src = process.argv[2] || path.join(ROOT, "video", "out", "render.mp4");
const dst = process.argv[3] || path.join(ROOT, "video", "deliverables", "mare-hackematis-30s.mp4");
ensureDir(path.dirname(dst));
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
  "-af", "atrim=0:29.9,asetpts=N/SR/TB", "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-movflags", "+faststart", dst], { stdio: "inherit" });

const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries",
  "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,duration,pix_fmt,sample_rate,channels", "-of", "json", dst]).toString());
const video = probe.streams.find((s) => s.codec_type === "video");
const audio = probe.streams.find((s) => s.codec_type === "audio");
const checks = [
  ["container duration <= 30.000 s", Number(probe.format.duration) <= 30.0005, `${Number(probe.format.duration).toFixed(3)} s`],
  ["picture: 900 frames or fewer", Number(video.nb_read_frames) <= 900, video.nb_read_frames],
  ["1920 x 1080", video.width === 1920 && video.height === 1080, `${video.width} x ${video.height}`],
  ["30 fps", video.r_frame_rate === "30/1", video.r_frame_rate],
  ["H.264, yuv420p", video.codec_name === "h264" && video.pix_fmt === "yuv420p", `${video.codec_name}, ${video.pix_fmt}`],
  ["AAC audio, ends before the picture", audio?.codec_name === "aac" && Number(audio.duration) <= 30.0005, `${audio?.codec_name}, ${Number(audio?.duration).toFixed(3)} s, ${audio?.sample_rate} Hz, ${audio?.channels} ch`],
];
let ok = true;
for (const [name, pass, value] of checks) {
  console.log(`${pass ? "ok  " : "FAIL"}  ${name}: ${value}`);
  ok = ok && pass;
}
console.log(`${dst}  ${(Number(probe.format.size) / 1e6).toFixed(1)} MB`);
if (!ok) process.exit(1);
