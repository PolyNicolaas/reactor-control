/** One encoded video frame. `t` is wall-clock time (epoch ms) when the frame was captured. */
export interface EncodedFrame {
  t: number;
  key: boolean;
  data: Uint8Array;
}

/** A finished clip: frames from a keyframe at or before `from` up to `to`. */
export interface Clip {
  from: number;          // first frame time (epoch ms)
  to: number;            // last frame time
  triggers: { t: number; reason: string }[];
  frames: EncodedFrame[];
}

/**
 * Rolling buffer for "clips around changes" (DESIGN D25): keeps the last `preMs` of encoded frames
 * (starting at a keyframe, so a clip can always be decoded), and on a trigger captures from
 * `preMs` before it to `postMs` after it. A trigger during a capture extends it, up to `maxMs`.
 * Pure logic, no browser APIs, so it is unit-tested.
 */
export class ClipBuffer {
  private ring: EncodedFrame[] = [];
  private active?: { end: number; hardEnd: number; clip: Clip };

  constructor(
    readonly preMs = 60_000,
    readonly postMs = 60_000,
    readonly maxMs = 5 * 60_000,
  ) {}

  /** Add a frame. Returns clips that finished with it. */
  push(f: EncodedFrame): Clip[] {
    this.ring.push(f);
    // Drop frames older than the pre-window, but always keep the window starting at a keyframe.
    const cutoff = f.t - this.preMs;
    let keep = -1;
    for (let i = 0; i < this.ring.length && this.ring[i].t <= cutoff; i++) if (this.ring[i].key) keep = i;
    if (keep > 0) this.ring.splice(0, keep);

    const a = this.active;
    if (!a) return [];
    a.clip.frames.push(f);
    a.clip.to = f.t;
    if (f.t >= a.end || f.t >= a.hardEnd) {
      this.active = undefined;
      return [a.clip];
    }
    return [];
  }

  /** Start a clip around time `at`, or extend the clip being captured. */
  trigger(at: number, reason: string): void {
    const a = this.active;
    if (a) {
      a.clip.triggers.push({ t: at, reason });
      a.end = Math.min(Math.max(a.end, at + this.postMs), a.hardEnd);
      return;
    }
    const startAt = at - this.preMs;
    // Last keyframe at or before the start of the window, else the first keyframe we have.
    let i = -1;
    for (let k = 0; k < this.ring.length; k++) if (this.ring[k].key && (this.ring[k].t <= startAt || i < 0)) i = k;
    const frames = i >= 0 ? this.ring.slice(i) : [];
    const from = frames[0]?.t ?? at;
    this.active = {
      end: at + this.postMs,
      hardEnd: from + this.maxMs,
      clip: { from, to: frames.at(-1)?.t ?? at, triggers: [{ t: at, reason }], frames },
    };
  }

  get capturing(): { until: number; triggers: number } | undefined {
    return this.active && { until: this.active.end, triggers: this.active.clip.triggers.length };
  }

  /** End any capture now (camera stopped, recording stopped). */
  flush(): Clip[] {
    const a = this.active;
    this.active = undefined;
    return a && a.clip.frames.length ? [a.clip] : [];
  }

  clear(): void {
    this.ring = [];
    this.active = undefined;
  }
}
