import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import type { MediaItem, Run } from '../core/app';
import { mediaStore } from '../camera/mediaStore';

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Index of the camera files in a recording: when, which camera, what, why. */
export function mediaCsv(run: Run): string {
  const label = (id: string) => run.devices.find((d) => d.id === id)?.label ?? id;
  const rows = [...run.media].sort((a, b) => a.t - b.t);
  return [
    'time_iso,elapsed_s,end_elapsed_s,camera,kind,file,bytes,reason',
    ...rows.map((m) =>
      [
        new Date(m.t).toISOString(),
        ((m.t - run.startedAt) / 1000).toFixed(1),
        m.end === undefined ? '' : ((m.end - run.startedAt) / 1000).toFixed(1),
        esc(label(m.cameraId)),
        m.kind,
        m.file,
        m.bytes,
        esc(m.reason ?? ''),
      ].join(','),
    ),
  ].join('\n');
}

/** One zip: text files plus every media file (stored, not recompressed: JPEG and WebM are already compressed). */
export async function mediaZip(folder: string, texts: [string, string][], media: MediaItem[]): Promise<Blob> {
  const parts: Uint8Array[] = [];
  let fail: Error | undefined;
  const zip = new Zip((err, chunk) => {
    if (err) fail = err;
    else parts.push(chunk);
  });
  const add = (name: string, data: Uint8Array) => {
    const f = new ZipPassThrough(`${folder}/${name}`);
    zip.add(f);
    f.push(data, true);
  };
  for (const [name, text] of texts) add(name, strToU8(text));
  for (const m of media) {
    const blob = await mediaStore.get(m.file);
    if (blob) add(m.file, new Uint8Array(await blob.arrayBuffer()));
  }
  zip.end();
  if (fail) throw fail;
  return new Blob(parts as BlobPart[], { type: 'application/zip' });
}
