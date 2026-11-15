# Brief: launch film for Mare Hackematis (Remotion)

You are making the demo film for our NASA Space Apps 2026 entry, challenge "Lunar Landing Site Navigator". The film is built in code with Remotion. It is the first thing the judges see, and for most of them the only thing, so it decides whether they open the app at all.

Read `README.md`, `docs/ARCHITECTURE.md`, `docs/ASTRONAUT_MODE.md` and `data/PROJECT BASIS.txt` (the challenge statement) before you plan anything. Then run the web app and use it for ten minutes. You cannot sell what you have not seen.

## The product

Mare Hackematis is a static web app, made by the team Hackemate. You tell it where you want to land (South Pole, North Pole or Whole Moon), when, and what your mission cares about. It scores the terrain hour by hour against the positions of the Sun and the Earth over the real LOLA horizon, in the browser, and shows a heat map, a ranking of the best places, the best landing window for each one, a side by side comparison, a 3D view, and a first person walk on the real terrain (Astronaut Mode).

## Who watches and what they must think afterwards

NASA engineers and Space Apps judges. They score Impact, Creativity, Validity, Relevance and Presentation. After the film they should think three things:

1. This answers the exact question of the challenge: compare sites and dates quickly, with the Sun and the Earth against the horizon.
2. The numbers can be trusted. They come from NASA data and were checked against JPL Horizons.
3. A mission team could use this tomorrow when a launch date slips, and it already reaches past the south pole.

These people distrust hype. A measured number on a black screen convinces them more than any adjective.

## Two cuts, in this order

1. Submission cut: 30.0 s or less, hard limit (900 frames at 30 fps, music tail included). This is the one that matters. Finish it completely before starting the other.
2. Extended cut: 75 to 90 s, for the project page and for a later round. Same scenes, more of them.

Both: 1920x1080, 30 fps, H.264, AAC audio, English text only. No voiceover. All text is burned in, and you also export an `.srt` with the same lines.

## Rules that do not bend

- Every image of the product is the real app, captured from the dev server. No mock-ups, no redrawn UI, no invented screens or numbers. Do not edit anything under `web/` to make a shot look better.
- Every claim on screen comes from the "Facts you may use" list below. If you want another one, find it in the repo and cite the file in `video/CREDITS.md`. If you cannot find it, it does not go in.
- Never imply that NASA endorses, uses or built this. Do not use the NASA insignia or any NASA logo. Naming the datasets as sources is fine.
- Music and any sound must come with a licence that allows this use. Record track, author, source URL and licence in `video/CREDITS.md`. No film scores, no trailer music taken from the internet.
- No stock footage, no AI generated images or video, no emoji.

## Look

The film must look like the web app, because it is the web app with a camera on it. The tokens are in `web/public/design-system/tokens.css` and `web/src/styles.css`. Read them; these are the ones you will use most:

- Background `#0b0b0c`. Surfaces `#1c1c1e`. Text `#f5f5f7`, secondary `#a1a1a6`. Hairlines `#2c2c30`.
- Two accents and no others: Sun `#f2c14e`, Earth `#6cb4ff`. Gold only when the frame is about sunlight or power, blue only for Earth or communications.
- Type: Geist for everything, Geist Mono for numbers, coordinates and small caps labels. Headlines weight 600 with letter-spacing -0.045em, like the Home title. Labels uppercase at 0.14em.
- Radius 22 px on any frame that holds UI, with the app's overlay shadow (`0 12px 40px rgba(0,0,0,.55)`).
- The app writes its section titles with a trailing slash: "Explore/", "Ranking/", "Compare/". Use that as the chapter marker of the film.
- The hero photograph of the Moon's limb (`web/public/img/moon-landing.png`) opens and closes the film.

Motion, in the manner of an Apple product film: one idea per shot. Slow, steady camera pushes on the UI. Text arrives with a short fade, a few pixels of rise and a little blur that clears, and holds still while it is read. Springs without overshoot. Numbers count up in Geist Mono. Cuts are hard cuts on the beat; keep dissolves for the first and last shot. Leave a lot of black around things. No glitch effects, no typewriter text, no lens flares, no particles, no gradients that are not in the app.

## Footage

Start the app with `npm --prefix web run dev -- --port 5173 --strictPort` and capture with Playwright into `video/public/captures/`. Keep the capture scripts in `video/capture/` so any shot can be redone.

The app has no routes. Every script starts at Home and clicks its way in. The path, to be confirmed against `web/src/screens/*.jsx` and `web/src/ui/*.jsx`: Home, "Where" step, choose "South Pole", "Next". "When" step: tab "Find best dates", slider "Time on the surface" to 14 d, "Next". "How" step: profile "Balanced", then "Explore". From Explore: tabs 2D and 3D, region tabs South Pole, North Pole, Whole Moon, the "Open site" button for the Mare page (tabs Overview, Sky & Time, Terrain, Lander's View, Astronaut Mode), the left rail for Compare and Export, the mission chip for the settings drawer (Dates, Weights, Rules).

How to get clean pictures:

- Stills at 1920x1080 with `deviceScaleFactor: 2`, so you can push in on a card or a number without it going soft. Most UI shots should be a still with a camera move added in Remotion.
- For anything where time passes (shadows crossing the 3D relief, the globe turning, the sky in Astronaut Mode), do not screen record. Step the app's own clock and take one screenshot per step, then play the sequence as frames. The TimeBar slider moves one day per Arrow key; Astronaut Mode has "-1 h" and "+1 h" in its pause panel. This gives a perfectly smooth time-lapse at any frame rate.
- Screen record (Playwright `recordVideo`) only for what cannot be stepped: the "Scoring NN%" progress filling the map, and walking in Astronaut Mode.
- Headless Chromium often has no GPU. Check that the WebGL views are not black before you build on them; if they are, launch with SwiftShader flags. If walking in Astronaut Mode comes out choppy, say so in your report and use the stepped time-lapse of the sky from a fixed standpoint for now.
- If the team has put its own recordings in `video/public/captures/team/`, prefer them to yours for the same shot.
- In Astronaut Mode use "Explore NASA 5 m demo" (Connecting ridge) and "Find sunlight" so the ground is lit. Hide the mouse cursor in captures unless the shot is about a click.

Look at every capture before using it. Loading states, empty panels and half drawn maps do not go in the film, except the scoring progress, which is a shot in its own right.

## Music and sync

The music is orchestral or hybrid cinematic, in the register of a space documentary: a quiet pulse at the start, a rise, one big arrival, a final hit with a tail. It should feel large and calm, not like an action trailer.

1. If `video/public/music/track.*` exists, use it. Otherwise find a track with a clear licence (CC0 or an attribution licence the team can meet) and write down where it came from. If you cannot reach any music source from your environment, build the whole film on a click track at 120 BPM, say so at the top of your report, and leave one constant to change so the real track drops in.
2. Analyse the track before you edit a single frame. Detect tempo, beats, downbeats and the loudest onsets with a script (`video/scripts/beats.*`) and write `video/src/beats.json` with frame numbers at 30 fps. Open the waveform and check that the detected downbeats are right; correct by hand if the detector drifts.
3. Every scene boundary is read from `beats.json`. No cut is typed in as a bare frame number. The seconds in the storyboard are targets: move each cut to the nearest downbeat.
4. You may edit the track to fit: cut on bar lines, short crossfades, so that the first big arrival lands on scene 3 and the peak on scene 6. The last hit lands on the first frame of the end card and rings out inside the 30 s.
5. Inside a scene, text and number reveals land on beats too. Nothing important appears between beats.
6. Add a debug composition that draws the waveform, the beat grid and the cut markers over the picture, and use it to check the sync. A cut that is more than one frame off its beat is a bug.

## Storyboard, 30 s cut

Text in quotes is final copy. Do not rewrite it and do not add lines.

1. 0 to 3 s. Black. The limb of the Moon rises from the bottom of the frame. Small mono label: "HACKEMATE · NASA SPACE APPS 2026". Then "Where on the Moon would you land?" and, one bar later, "And when?"
2. 3 to 6 s. The real Home screen, "Plan your landing". Three quick cuts on consecutive beats: 01 Where with South Pole chosen, 02 When with the slider at 14 d, 03 How with the Balanced profile. No added text; the interface says it.
3. 6 to 11 s. First big arrival. The 2D map of the south pole while "Scoring NN%" runs and the score layer fills it, then the hotspots appear. "160,000 km² around the south pole." Then "Scored hour by hour. In your browser."
4. 11 to 15 s. "Explore/" in 3D. The relief with the Sun and the Earth, shadows moving in time-lapse. "Sun for power." in gold, "Earth for contact." in blue.
5. 15 to 19 s. The Mare page of the best hotspot: the "Best landing window" card, then the Sky & Time lanes. On the next downbeat, "Compare/" with its side by side table. "The best window for every site." Then "Up to four, side by side."
6. 19 to 24 s. The peak. Astronaut Mode. Its own entry card, "Walk the Moon.", then first person on the surface with the Earth over the horizon and the light changing. "Real NASA terrain. 1:1 scale."
7. 24 to 27 s. Black. "0.002′" counts up in Geist Mono, large. Under it: "Largest difference against JPL Horizons." Small line at the bottom: "Data: NASA LOLA · LRO Diviner · JPL SPICE".
8. 27 to 30 s. The limb of the Moon again. "Mare Hackematis". "Plan your landing." The public URL of the app, from the constant `PUBLIC_URL` in `video/src/config.ts`. The team has to give you that URL; if you do not have it, leave the line out and say so in your report.

## Extended cut

Keep the eight scenes in the same order, give each one more room, and insert these. Same rule for the copy.

- After 1, the problem: the Sun layer of the 2D map on two dates a week apart. "At the poles the Sun never climbs far above the horizon." "Move one kilometre, or one week, and the mission changes."
- After 3, profiles: switch Balanced, Ice prospecting, Safe landing, one per bar, and let the map and the ranking change each time. "Six mission profiles. Or set your own weights."
- Then rules: the Rules tab of the settings drawer, with Battery autonomy, Maximum slope and Require Earth contact. "Your limits decide what counts as a site."
- Then ice: the "Ice observations" toggle, with the M³ detections and the LCROSS impact. "Ice, where instruments have found it."
- Then the ranking chip "Artemis III references". "Scored next to NASA's Artemis III candidate regions."
- After 5, Sky & Time in detail: the cards for the next night and for Earth setting. "When the Sun goes down. When Earth drops out of view."
- Then the three regions on consecutive bars: South Pole, North Pole, and the Whole Moon globe turning with the Apollo references. "Both poles. Then the whole Moon." "With the six Apollo landings for reference."
- Then Export. "Take the numbers with you. CSV and JSON."
- In 7, add a second number after the first: "1.6" with "Mean difference in sunlight, in points out of 100, against NASA's LOLA illumination map."
- Before the end card, what comes next: "A new date or a new site, scored again in a few seconds." "No server. No install. A link." "New datasets plug in as layers."

## Facts you may use

- Polar grids: 400 x 400 cells of 1 km, about 160,000 per pole, out to about 83.5° latitude. Whole Moon: 0.5° cells.
- Sun and Earth come from JPL SPICE DE440, hourly, 2026 to 2030. The horizon of each cell is traced over LOLA relief in 72 directions.
- The scoring runs in the browser, on web workers, with no server.
- Check against JPL Horizons: largest difference 0.002 arcminutes or less (three sites, January 2027). Check against the LOLA mean illumination map: 1.6 points mean difference for the Sun and 2.0 for the Earth, 2,000 points, south pole.
- Sources: LOLA, LRO Diviner, JPL SPICE, LROC WAC mosaic, Lunar Prospector, M³, LCROSS.
- Six scoring factors, six profiles, up to four sites compared.
- Astronaut Mode: 1 km x 1 km walkable at 1:1 scale, lunar gravity 1.62 m/s², Sun and Earth placed for the chosen instant.

Do not say or suggest: "5 m accuracy" (5 m is the sample spacing of two demo sites), any frame rate, that the rocks and small craters are measured (they are generated from lunar statistics), that the hotspots are NASA sites, that any mission or agency uses the tool, or "open source" (the repo has no licence file).

## Build, check, deliver

Create the Remotion project in `video/` as its own package. Do not touch `web/package.json`. Use the current Remotion documentation and the official Remotion agent skill (`remotion-dev/skills`) instead of your memory of the API. One composition per cut, sharing scene components; scene lengths are computed from `beats.json`.

Before you call it done:

- Render a still from the middle of every scene and look at it. Text inside the safe area, nothing clipped, nothing soft, no black WebGL frames, every on-screen line readable for at least a second and a half.
- Render both cuts in full and watch them through the debug overlay for sync.
- Confirm the 30 s cut is 900 frames or fewer.
- Compare every on-screen claim with the facts list.

Deliver `video/out/mare-hackematis-30s.mp4`, `video/out/mare-hackematis-extended.mp4`, the two `.srt` files, a contact sheet with one frame per scene, `video/CREDITS.md` (music, data sources, fonts), and a short `video/README.md` on how to recapture and render. Commit the source, the capture scripts and the small assets. Do not commit `node_modules`, raw captures or the renders; hand the renders to the team directly.

In your report, list what is still missing or weaker than you wanted (music placeholder, choppy footage, no URL), so the team knows what to fix before submitting.
