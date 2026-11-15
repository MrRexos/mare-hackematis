// Writes the .srt from the same caption list the film burns in (src/captions.json).
//
//   node capture/export-srt.mjs [out/mare-hackematis-30s.srt]

import fs from "node:fs";
import path from "node:path";
import { ROOT, ensureDir, readJson } from "./lib.mjs";

const { fps, captions } = readJson(path.join(ROOT, "video", "src", "captions.json"));
const out = process.argv[2] || path.join(ROOT, "video", "out", "mare-hackematis-30s.srt");
const stamp = (frame) => {
  const ms = Math.round((frame / fps) * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
const blocks = captions.map((c, i) => `${i + 1}\n${stamp(c.from)} --> ${stamp(c.to)}\n${c.text}${c.sub ? `\n${c.sub}` : ""}\n`);
ensureDir(path.dirname(out));
fs.writeFileSync(out, `${blocks.join("\n")}`);
console.log(`${out}: ${captions.length} cues, last ends at ${stamp(captions.at(-1).to)}`);
