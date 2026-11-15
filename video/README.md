# Mare Hackematis, the film

The demo film for our NASA Space Apps 2026 entry, built in code with [Remotion](https://www.remotion.dev).

- `deliverables/mare-hackematis-30s.mp4`: submission cut, 30.0 s, 1920 x 1080, 30 fps, H.264 and AAC.
- `deliverables/mare-hackematis-30s.srt`: the lines burned into the picture, with the same timing.
- `CREDITS.md`: where each line on screen comes from, how the app was filmed, music and third-party material.

## How it is made

Every image of the product is the real app. The scripts in `capture/` start the app's dev server, drive it with Playwright and save what the browser shows. They never edit `web/`.

```bash
npm install
npm run capture   # films the app (needs Playwright with Chromium; Astronaut Mode takes about half an hour without a GPU)
npm run assets    # re-encodes the masters into public/app
npm run music     # synthesises the score into public/audio (python3 with numpy)
npm run render    # renders, trims the audio to 29.9 s and checks deliverables/mare-hackematis-30s.mp4
npm run srt       # writes deliverables/mare-hackematis-30s.srt
```

`npm run dev` opens Remotion Studio. The composition is `Submission`; each scene is also registered on its own under `Submission-Scenes`.

## Where things are

| Path | What it holds |
|---|---|
| `src/Submission.tsx` | The cut: nine scenes in order, the headline and the music. |
| `src/scenes/` | One file per scene. |
| `src/captions.json` | Text and timing of every line. The headline and the `.srt` both read it. |
| `src/captured.json` | Numbers read off the app during capture (scoring time, best site, readouts). |
| `capture/` | Capture scripts and `build-assets.mjs`. |
| `audio/score.py` | The score, synthesised from scratch. |
| `public/app/` | Stills (WebP) and sequences (MP4) of the app. |

## Changing a line

Edit `src/captions.json` (or the scene file, for the lines set as part of a scene), check the claim against `CREDITS.md`, then run `npm run render` and `npm run srt`. The film must stay at 900 frames or under.

The render needs a Chrome Headless Shell. If Remotion cannot download one, pass your own with `--browser-executable=<path>`.
