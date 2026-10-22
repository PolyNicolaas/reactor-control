import { Muxer, ArrayBufferTarget } from 'webm-muxer';
import { Emitter } from '../core/emitter';
import { ClipBuffer, type Clip } from './clipBuffer';

// A USB camera (UVC webcam) attached through the browser's camera API (getUserMedia) — not Web
// Serial. Video policy is fixed for now (DESIGN D25): 720p, a time-lapse frame every 10 s and
// clips from 60 s before to 60 s after each change while recording; no continuous video.
export const VIDEO = {
  width: 1280,
  height: 720,
  timelapseMs: 10_000,
  clipPreMs: 60_000,
  clipPostMs: 60_000,
  clipMaxMs: 5 * 60_000,
  encodeFps: 10,
  keyframeMs: 2_000,
  bitrate: 1_500_000,
  jpegQuality: 0.85,
};

export type MediaKind = 'timelapse' | 'clip' | 'snapshot';

export interface MediaOut {
  kind: MediaKind;
  t: number;             // capture time (clip: first frame)
  end?: number;          // clip: last frame
  reason?: string;       // clip: what triggered it
  blob: Blob;
  ext: 'jpg' | 'webm';
}

export type CameraStatus = 'Starting' | 'Live' | 'Recording' | 'Not available';

// Chromium-only stream reader for raw camera frames (not yet in TypeScript's DOM types).
declare const MediaStreamTrackProcessor: {
  new (init: { track: MediaStreamTrack }): { readable: ReadableStream<VideoFrame> };
};

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** Clips need WebCodecs (encoder) and the frame reader; time-lapse and snapshots do not. */
export function clipsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof MediaStreamTrackProcessor !== 'undefined';
}

/** Ask once for permission (so camera names are visible), then list cameras. */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  let devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  if (devs.length && devs.every((d) => !d.label)) {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    s.getTracks().forEach((t) => t.stop());
    devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  }
  return devs;
}

export class CameraModule {
  readonly changed = new Emitter<CameraModule>();
  readonly media = new Emitter<MediaOut>();
  readonly video: HTMLVideoElement;

  status: CameraStatus = 'Starting';
  error = '';
  deviceLabel = '';
  /** Resolution the camera actually delivers. */
  size = { width: 0, height: 0 };
  /** Measured encoder rate while recording (frames/s), for the Pi load test. */
  encodeFps = 0;
  locked = false;
  counts = { timelapse: 0, clip: 0, snapshot: 0 };
  clipNote = '';

  private stream?: MediaStream;
  private recording = false;
  private timelapseTimer?: number;
  private encoder?: VideoEncoder;
  private codec?: { webcodecs: string; webm: string };
  private encSize = { width: 0, height: 0 };
  private reader?: ReadableStreamDefaultReader<VideoFrame>;
  private buffer = new ClipBuffer(VIDEO.clipPreMs, VIDEO.clipPostMs, VIDEO.clipMaxMs);
  private frameTimes = new Map<number, number>();
  private lastEncoded = 0;
  private lastKey = 0;
  private encodedInLastSecond: number[] = [];

  constructor(
    readonly id: string,
    public label: string,
    public deviceId: string,
  ) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
  }

  get track(): MediaStreamTrack | undefined {
    return this.stream?.getVideoTracks()[0] as MediaStreamTrack | undefined;
  }

  async start(): Promise<void> {
    this.status = 'Starting';
    this.error = '';
    this.changed.emit(this);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
          width: { ideal: VIDEO.width },
          height: { ideal: VIDEO.height },
          frameRate: { ideal: 15 },
        },
      });
      const track = this.track!;
      this.deviceLabel = track.label;
      const s = track.getSettings();
      this.size = { width: s.width ?? 0, height: s.height ?? 0 };
      track.addEventListener('ended', () => {
        this.status = 'Not available';
        this.error = 'Camera unplugged or taken by another app';
        this.stopPipeline();
        this.changed.emit(this);
      });
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
      this.status = this.recording ? 'Recording' : 'Live';
      // The clip encoder runs whenever the camera is live, so a clip can include the 60 s before
      // a change even when that change is what starts the recording.
      this.startEncoding();
      if (this.recording) this.startTimelapse();
    } catch (e) {
      this.status = 'Not available';
      this.error = (e as Error).name === 'NotAllowedError' ? 'Camera permission was refused in the browser' : (e as Error).message;
    }
    this.changed.emit(this);
  }

  stop(): void {
    this.stopPipeline();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.video.srcObject = null;
    this.status = 'Not available';
    this.changed.emit(this);
  }

  // ----- focus / exposure lock (only where the camera supports manual modes) -----

  get canLock(): boolean {
    const caps = (this.track?.getCapabilities?.() ?? {}) as Record<string, unknown>;
    const modes = (k: string) => (caps[k] as string[] | undefined) ?? [];
    return modes('focusMode').includes('manual') || modes('exposureMode').includes('manual');
  }

  async setLocked(lock: boolean): Promise<void> {
    const track = this.track;
    if (!track) return;
    const caps = track.getCapabilities() as Record<string, unknown>;
    const c: Record<string, string> = {};
    for (const k of ['focusMode', 'exposureMode', 'whiteBalanceMode']) {
      const modes = (caps[k] as string[] | undefined) ?? [];
      const want = lock ? 'manual' : 'continuous';
      if (modes.includes(want)) c[k] = want;
    }
    await track.applyConstraints({ advanced: [c as MediaTrackConstraintSet] });
    this.locked = lock;
    this.changed.emit(this);
  }

  // ----- recording: time-lapse + clips -----

  startRecording(): void {
    this.recording = true;
    this.counts = { timelapse: 0, clip: 0, snapshot: 0 };
    if (this.stream) {
      this.status = 'Recording';
      this.startTimelapse();
    }
    this.changed.emit(this);
  }

  async stopRecording(): Promise<void> {
    this.recording = false;
    for (const clip of this.buffer.flush()) await this.saveClip(clip);
    this.stopTimelapse();
    if (this.stream) this.status = 'Live';
    this.changed.emit(this);
  }

  /** A change happened (setpoint, switch, note, Stop): capture a clip around it. */
  trigger(reason: string): void {
    if (!this.recording || !this.encoder) return;
    this.buffer.trigger(Date.now(), reason);
    this.updateClipNote();
  }

  async snapshot(): Promise<MediaOut | undefined> {
    const blob = await this.grab();
    if (!blob) return;
    const m: MediaOut = { kind: 'snapshot', t: Date.now(), blob, ext: 'jpg' };
    this.counts.snapshot++;
    this.media.emit(m);
    this.changed.emit(this);
    return m;
  }

  private startTimelapse(): void {
    window.clearInterval(this.timelapseTimer);
    this.timelapseTimer = window.setInterval(() => void this.timelapseFrame(), VIDEO.timelapseMs);
    void this.timelapseFrame();
  }

  private stopTimelapse(): void {
    window.clearInterval(this.timelapseTimer);
    this.timelapseTimer = undefined;
  }

  private startEncoding(): void {
    if (clipsSupported()) void this.startEncoder();
    else this.clipNote = 'Clips need a newer Chromium (WebCodecs); time-lapse only';
  }

  private stopPipeline(): void {
    this.stopTimelapse();
    void this.reader?.cancel().catch(() => {});
    this.reader = undefined;
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    this.encoder = undefined;
    this.buffer.clear();
    this.frameTimes.clear();
    this.encodeFps = 0;
  }

  private async timelapseFrame(): Promise<void> {
    if (!this.recording) return;
    const blob = await this.grab();
    if (!blob) return;
    this.counts.timelapse++;
    this.media.emit({ kind: 'timelapse', t: Date.now(), blob, ext: 'jpg' });
    this.changed.emit(this);
  }

  /** Current frame as a 720p JPEG. */
  private async grab(): Promise<Blob | undefined> {
    const v = this.video;
    if (!v.videoWidth) return;
    const scale = Math.min(1, VIDEO.width / v.videoWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob((b) => r(b ?? undefined), 'image/jpeg', VIDEO.jpegQuality));
  }

  private async pickCodec(width: number, height: number): Promise<{ webcodecs: string; webm: string } | undefined> {
    for (const c of [{ webcodecs: 'vp8', webm: 'V_VP8' }, { webcodecs: 'vp09.00.10.08', webm: 'V_VP9' }]) {
      try {
        const r = await VideoEncoder.isConfigSupported({ codec: c.webcodecs, width, height, bitrate: VIDEO.bitrate, framerate: VIDEO.encodeFps });
        if (r.supported) return c;
      } catch {
        /* try the next */
      }
    }
    return undefined;
  }

  private async startEncoder(): Promise<void> {
    const track = this.track;
    if (!track || this.reader) return;
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    this.reader = reader;
    try {
      for (;;) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        const now = Date.now();
        if (!this.encoder) {
          const width = frame.displayWidth;
          const height = frame.displayHeight;
          this.codec = await this.pickCodec(width, height);
          if (!this.codec) {
            frame.close();
            this.clipNote = 'This browser cannot encode video; time-lapse only';
            this.changed.emit(this);
            break;
          }
          this.encoder = new VideoEncoder({
            output: (chunk) => this.onChunk(chunk),
            error: (e) => {
              this.clipNote = `Clip encoder stopped: ${e.message}`;
              this.changed.emit(this);
            },
          });
          this.encSize = { width, height };
          this.encoder.configure({ codec: this.codec.webcodecs, width, height, bitrate: VIDEO.bitrate, framerate: VIDEO.encodeFps, latencyMode: 'realtime' });
          this.clipNote = '';
        }
        // Throttle to the encode rate and drop frames when the encoder falls behind (slow Pi).
        if (now - this.lastEncoded < 1000 / VIDEO.encodeFps - 5 || this.encoder.encodeQueueSize > 3) {
          frame.close();
          continue;
        }
        const keyFrame = now - this.lastKey >= VIDEO.keyframeMs;
        if (keyFrame) this.lastKey = now;
        this.lastEncoded = now;
        this.frameTimes.set(frame.timestamp, now);
        this.encoder.encode(frame, { keyFrame });
        frame.close();
      }
    } catch {
      /* reader cancelled */
    }
  }

  private onChunk(chunk: EncodedVideoChunk): void {
    const t = this.frameTimes.get(chunk.timestamp) ?? Date.now();
    this.frameTimes.delete(chunk.timestamp);
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.encodedInLastSecond.push(t);
    while (this.encodedInLastSecond.length && this.encodedInLastSecond[0] < t - 1000) this.encodedInLastSecond.shift();
    this.encodeFps = this.encodedInLastSecond.length;
    for (const clip of this.buffer.push({ t, key: chunk.type === 'key', data })) void this.saveClip(clip);
    this.updateClipNote();
  }

  private updateClipNote(): void {
    const c = this.buffer.capturing;
    const note = c ? `Capturing a clip until ${new Date(c.until).toLocaleTimeString()}` : '';
    if (note !== this.clipNote && !this.clipNote.startsWith('Clip encoder') && !this.clipNote.includes('time-lapse only')) {
      this.clipNote = note;
      this.changed.emit(this);
    }
  }

  private async saveClip(clip: Clip): Promise<void> {
    if (!clip.frames.length || !this.codec) return;
    const first = clip.frames[0];
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: this.codec.webm, width: this.encSize.width, height: this.encSize.height, frameRate: VIDEO.encodeFps },
    });
    for (const f of clip.frames) muxer.addVideoChunkRaw(f.data, f.key ? 'key' : 'delta', (f.t - first.t) * 1000);
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/webm' });
    this.counts.clip++;
    this.media.emit({ kind: 'clip', t: clip.from, end: clip.to, reason: clip.triggers.map((x) => x.reason).join('; '), blob, ext: 'webm' });
    this.changed.emit(this);
  }
}
