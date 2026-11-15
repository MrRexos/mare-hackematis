// Turns the capture masters into the files the film loads from video/public/app.
//
//   stills     masters/<name>.png          ->  public/app/<name>.webp
//   sequences  masters/<name>/0000.png ... ->  public/app/<name>.mp4
//
// Masters are large PNGs and stay out of git; these outputs are what is committed.
// Nothing is retouched here: the only operations are re-encoding and, for the
// scoring sequence, laying real-time frames on an even 30 fps timeline.
//
//   node capture/build-assets.mjs [name ...]     (no names: everything)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MASTERS, OUT, ensureDir, readJson } from "./lib.mjs";

const only = process.argv.slice(2);
const wanted = (name) => only.length === 0 || only.includes(name);
const ffmpeg = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const size = (file) => `${(fs.statSync(file).size / 1024).toFixed(0)} KB`;

ensureDir(OUT);
if (!fs.existsSync(MASTERS)) throw new Error(`No masters at ${MASTERS}. Run the capture scripts first.`);

for (const entry of fs.readdirSync(MASTERS, { withFileTypes: true })) {
  const name = entry.name.replace(/\.png$/, "");
  if (!wanted(name) || name.endsWith("-preview")) continue;

  if (entry.isFile() && entry.name.endsWith(".png")) {
    const src = path.join(MASTERS, entry.name);
    const dst = path.join(OUT, `${name}.webp`);
    // Flat interface screens compress well without loss; map and terrain screens
    // would be several megabytes, so those use lossy WebP at a quality where the
    // 4K still shows no artefacts when the film zooms in.
    const flat = fs.statSync(src).size < 1_300_000;
    ffmpeg(["-i", src, "-c:v", "libwebp", ...(flat ? ["-lossless", "1", "-compression_level", "6"] : ["-quality", "96", "-preset", "picture", "-compression_level", "6"]), dst]);
    console.log(`still     ${name}.webp  ${size(dst)}  ${flat ? "lossless" : "q96"}`);
    continue;
  }

  if (entry.isDirectory()) {
    const dir = path.join(MASTERS, entry.name);
    const frames = fs.readdirSync(dir).filter((f) => /^\d+\.png$/.test(f)).sort();
    if (!frames.length) continue;
    const dst = path.join(OUT, `${name}.mp4`);
    const timing = readJson(path.join(dir, "frames.json"), null);
    const encode = ["-c:v", "libx264", "-preset", "slow", "-crf", "12", "-pix_fmt", "yuv420p", "-g", "15", "-bf", "0",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-movflags", "+faststart", "-an"];
    if (timing?.frames) {
      // Frames taken in real time at uneven intervals (the scoring run). Each
      // one is held for its real share of the run, compressed by `speed`.
      const list = path.join(dir, "concat.txt");
      const lines = [];
      timing.frames.forEach((f, i) => {
        const next = timing.frames[i + 1];
        // The last frame is the finished screen: it is held for `tail` seconds of film.
        const hold = next ? Math.max(1 / 30, (next.t - f.t) / 1000 / timing.speed) : (timing.tail ?? 1);
        lines.push(`file '${path.join(dir, f.file)}'`, `duration ${hold.toFixed(5)}`);
      });
      lines.push(`file '${path.join(dir, timing.frames.at(-1).file)}'`);
      fs.writeFileSync(list, `${lines.join("\n")}\n`);
      ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=30,format=yuv420p", ...encode, dst]);
    } else {
      // Frames that are already one per film frame (stepped clock).
      const first = Number(frames[0].replace(".png", ""));
      const gap = frames.length > 1 ? Number(frames[1].replace(".png", "")) - first : 1;
      if (gap !== 1) throw new Error(`${name}: frames are not consecutive (step ${gap}); this looks like a preview`);
      ffmpeg(["-framerate", "30", "-start_number", String(first), "-i", path.join(dir, "%04d.png"), "-vf", "format=yuv420p", ...encode, dst]);
    }
    const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames,width,height,r_frame_rate", "-of", "csv=p=0", dst]).toString().trim();
    console.log(`sequence  ${name}.mp4  ${size(dst)}  ${probe}`);
  }
}
