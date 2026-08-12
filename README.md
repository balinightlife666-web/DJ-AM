# ACC DJ PWA — Prototype v1

Mobile-first, installable 2-deck DJ prototype using Audius as a streaming catalogue.

## Included
- Audius search + trending (SDK API-key mode, with public REST fallback)
- Load to Deck A / Deck B
- Streaming playback (no permanent music download)
- Live analyser visualization
- Seek, play/pause, restart, full-track loop
- 3-band EQ per deck
- ±8% playback-rate pitch control (v1; not key-lock/time-stretch)
- Equal-power crossfader
- Master volume
- Pre-fader CUE buttons
- Split Cue mode: LEFT = Master mono, RIGHT = Cue mono
- PWA manifest + service worker (app shell only; audio/API responses are not cached)

## Audius API key
Current Audius docs provide a free API plan. The frontend API key can be used client-side; do not expose a bearer token in frontend code.

Open **API** in the app and paste the Audius API key. The key is stored only in browser localStorage.

## Run locally
Because PWA/service-worker features require HTTP(S), don't open index.html directly from `file://`.

Example:
```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080`.

For Android testing, deploy the folder to GitHub Pages, Cloudflare Pages, Netlify, Vercel, etc. over HTTPS.

## Split Cue hardware
A phone normally exposes one stereo output. This prototype can encode two mono buses into that stereo pair:
- Left channel: master mono
- Right channel: headphone cue mono

To physically separate them, use a USB-C audio DAC plus a DJ split-cue cable / stereo L-R breakout. A normal headphone splitter duplicates both channels and will not separate master/cue.

## v1 limitations
- No beat-grid / automatic beat sync yet.
- BPM/key display depends on provider metadata.
- Pitch control changes playback rate; true key-lock needs time-stretch DSP (future version).
- Browser/mobile audio behavior varies by Android device and DAC.
- Audius stream/API availability and CORS behavior are controlled by Audius and may evolve.

## v2 update
- MUSIC button opens a floating music browser over the mixer.
- Trending loads automatically the first time MUSIC is opened.
- Quick genre chips for discovery without knowing track titles.
- LOAD A / LOAD B buttons stay inside each result card.
- SYNC on either deck matches that deck's tempo to the other deck when both tracks expose BPM metadata (±8% range).
- Current SYNC is tempo/BPM sync; beat-phase sync requires beat-grid analysis and is planned for the next engine revision.


## v3 playback reliability fix
- Uses current `api.audius.co` playback base and Audius SDK `getTrackStreamUrl()` when an API key is configured.
- Filters `isStreamable=false`, stream-gated tracks, and API-key restricted tracks before showing LOAD buttons.
- One automatic legacy-provider fallback is attempted on media error.
- Bumps service worker shell cache to v3.
