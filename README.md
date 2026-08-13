# ACC DJ PWA v7 — Engine v1 Rebuild

Core rebuild, bukan patch sync lama.

## Sync Engine
- Explicit MASTER A/B.
- Live beat-anchor analysis dari low-frequency transient/kick melalui Web Audio analyser.
- GRID indicator: ANALYZE → GRID ✓ setelah anchor makin yakin.
- Follower dapat ditekan PLAY terlambat; engine masuk CHASE agresif, lalu fine chase, lalu LOCK.
- Phase dihitung dari beat anchor hasil audio, bukan lagi dari posisi 0:00 track.
- Continuous drift correction setelah LOCK.
- NUDGE tetap tersedia sebagai koreksi manual.

## PWA / Branding
- Monochrome ACC DJ icon family: 48/72/96/128/144/152/180/192/384/512.
- Dedicated maskable icons 192/512.
- favicon.ico + SVG + Apple Touch icon.
- Manifest id/scope, fullscreen override, landscape, shortcuts.
- Network-first shell service worker v7 agar update tidak mudah tertahan cache lama.

## Music
- Audius streaming, pagination / MORE TRACKS, filters, search drawer.
- Audio streams tidak dicache sebagai koleksi lokal.

Catatan: live transient analysis jauh lebih baik daripada BPM-only, tetapi streaming browser tetap bukan Rekordbox offline analysis. Track dengan kick/transient lemah dapat membutuhkan beberapa detik hingga GRID stabil.