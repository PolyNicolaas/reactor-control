import { describe, expect, it } from 'vitest';
import { ClipBuffer, type Clip } from '../camera/clipBuffer';

// 10 frames/s, keyframe every 2 s, from t=0 to `until` ms.
function feed(b: ClipBuffer, from: number, until: number, out: Clip[], onFrame?: (t: number) => void) {
  for (let t = from; t <= until; t += 100) {
    onFrame?.(t);
    out.push(...b.push({ t, key: t % 2000 === 0, data: new Uint8Array(1) }));
  }
}

describe('ClipBuffer (clips around changes, D25)', () => {
  it('captures 60 s before and 60 s after a trigger, starting at a keyframe', () => {
    const b = new ClipBuffer();
    const clips: Clip[] = [];
    feed(b, 0, 200_000, clips, (t) => t === 100_500 && b.trigger(100_500, 'speed set'));
    expect(clips).toHaveLength(1);
    const c = clips[0];
    expect(c.frames[0].key).toBe(true);
    expect(c.from).toBeLessThanOrEqual(40_500);
    expect(c.from).toBeGreaterThan(38_000);
    expect(c.to).toBeGreaterThanOrEqual(160_500);
    expect(c.to).toBeLessThan(160_700);
    expect(c.triggers.map((x) => x.reason)).toEqual(['speed set']);
  });

  it('extends one clip when changes come close together', () => {
    const b = new ClipBuffer();
    const clips: Clip[] = [];
    feed(b, 0, 300_000, clips, (t) => {
      if (t === 100_000) b.trigger(t, 'a');
      if (t === 130_000) b.trigger(t, 'b');
    });
    expect(clips).toHaveLength(1);
    expect(clips[0].to).toBeGreaterThanOrEqual(190_000);
    expect(clips[0].triggers).toHaveLength(2);
  });

  it('caps a clip at the maximum length', () => {
    const b = new ClipBuffer(60_000, 60_000, 150_000);
    const clips: Clip[] = [];
    feed(b, 0, 400_000, clips, (t) => t >= 100_000 && t <= 300_000 && t % 20_000 === 0 && b.trigger(t, 'x'));
    expect(clips[0].to - clips[0].from).toBeLessThanOrEqual(150_000);
  });

  it('starts from what it has when the trigger comes early, and flushes on stop', () => {
    const b = new ClipBuffer();
    const clips: Clip[] = [];
    feed(b, 0, 10_000, clips);
    b.trigger(10_000, 'early');
    feed(b, 10_100, 20_000, clips);
    expect(clips).toHaveLength(0);
    const flushed = b.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].from).toBe(0);
    expect(flushed[0].to).toBe(20_000);
  });
});
