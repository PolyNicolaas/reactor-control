# USB camera (UVC webcam) — notes

**Manual:** none needed — any USB Video Class (UVC) webcam. Model not chosen yet (see [DESIGN §9](../../DESIGN.md#9-camera-and-video)).
**Driver:** [`src/camera/camera.ts`](../../../src/camera/camera.ts) (with [`clipBuffer.ts`](../../../src/camera/clipBuffer.ts))

## Key facts

| Topic | Fact |
| --- | --- |
| Interface | Browser camera API (`getUserMedia`), **not Web Serial**. Needs camera permission for the site, asked once by the browser |
| Resolution | Requests 1280×720 (D25); the card shows what the camera actually delivers |
| Time-lapse | One JPEG every 10 s while recording (canvas grab from the live video, quality 0.85) |
| Clips | WebCodecs `VideoEncoder` (VP8, VP9 fallback) at 10 frames/s, keyframe every 2 s, 1.5 Mbit/s; rolling buffer; WebM written with `webm-muxer`. Needs Chromium (`MediaStreamTrackProcessor`) |
| Focus / exposure lock | Uses `focusMode`, `exposureMode`, `whiteBalanceMode` = `manual` where the camera reports support; button hidden otherwise |
| Storage | Browser IndexedDB until **Download recording**; cleared when a new recording starts |

## Tests

| What | Result |
| --- | --- |
| Chromium 141 with a fake camera (automated) | Live view, time-lapse every 10 s, a 65 s VP8 clip (1280×720, 649 frames) around a setpoint change, zip download — OK (2026-10-22) |
| Chromium 141, fake camera: stirrer motor switched on with nothing recording | Recording started by itself; clip from 11 s before the run (all the buffer had) to 60 s after, triggers "motor on; stirring started" — OK (2026-10-22) |
| Real webcam on a laptop | To do |
| Raspberry Pi 5 / Pi 4 with VNC connected: encode rate shown on the card | To do — decides the final defaults |

## Questions

- [ ] Which camera model and mount?
- [ ] Encode rate on the station Pi while VNC is connected (card shows "encoding N fps"; target 10).
- [ ] Does the chosen camera support manual focus/exposure from the browser?
