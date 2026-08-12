# ACC DJ PWA v5

Perubahan utama:
- SMART SYNC: BPM + continuous phase lock sederhana (PLL-style) dan hard align saat Play.
- NUDGE kiri/kanan untuk koreksi phase manual kecil.
- Music Browser pagination dengan MORE TRACKS; Audius SDK offset/limit dipakai.
- Drawer tetap auto-close setelah LOAD A/B dan punya backdrop supaya tidak gampang salah tekan mixer.
- DJ MODE fullscreen + landscape request untuk menghilangkan browser bar sebanyak yang didukung Android/Chrome.
- Tombol INSTALL PWA dan launcher icon monokrom ACC DJ.
- Waveform dibuat monokrom agar konsisten dengan branding.
- Cache service worker v5.

Catatan: SMART SYNC masih berbasis metadata BPM dan fase beat modulo, belum memiliki beatgrid/downbeat analysis seperti Rekordbox/Serato.
