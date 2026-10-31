# Riptide — 72 Hours (film exports)

| file | spec |
|---|---|
| `../Riptide-72-Hours.mp4` (workspace root) | master — 1920x1080, 30 fps, H.264 High + AAC 48 kHz, -16 LUFS, 7:22, 68 MB |
| `riptide-72-hours-720p.mp4` | share copy — 1280x720, 30 fps, 21 MB |

Both are git-ignored; the film is a build artifact, not source.
Rebuild: `cd /home/user/vidtool && ONLY=<scene ids> node render_seg.cjs && python3 concat.py && python3 assemble.py /home/user/Riptide-72-Hours.mp4`
