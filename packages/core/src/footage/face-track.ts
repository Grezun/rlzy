import type { FaceBox, FaceTrack, RawFaceTrack } from "../schema/footage";

const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
const lerpBox = (a: FaceBox, b: FaceBox, t: number): FaceBox => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t,
});
const avgBox = (boxes: FaceBox[]): FaceBox => {
  const n = boxes.length;
  const sum = boxes.reduce((s, b) => ({ x: s.x + b.x, y: s.y + b.y, w: s.w + b.w, h: s.h + b.h }), { x: 0, y: 0, w: 0, h: 0 });
  return { x: r4(sum.x / n), y: r4(sum.y / n), w: r4(sum.w / n), h: r4(sum.h / n) };
};

/** Fills gaps of up to maxGapMs between detections, then averages each detection with its neighbours in the same run. */
export function smoothFaceTrack(raw: RawFaceTrack, opts: { window?: number; maxGapMs?: number } = {}): FaceTrack {
  const window = opts.window ?? 5;
  const maxGapMs = opts.maxGapMs ?? 1000;
  const intervalMs = (raw.sampleEvery * 1000) / raw.fps;
  const filled = raw.samples.map((s) => ({ tMs: s.tMs, box: s.box ? { ...s.box } : null }));
  let prev = -1;
  for (let i = 0; i < filled.length; i++) {
    if (!filled[i].box) continue;
    if (prev >= 0 && i - prev > 1 && filled[i].tMs - filled[prev].tMs <= maxGapMs) {
      const a = filled[prev].box!;
      const b = filled[i].box!;
      const span = filled[i].tMs - filled[prev].tMs;
      for (let k = prev + 1; k < i; k++) filled[k].box = lerpBox(a, b, (filled[k].tMs - filled[prev].tMs) / span);
    }
    prev = i;
  }
  const half = Math.floor(window / 2);
  const samples = filled.map((s, i) => {
    if (!s.box) return { tMs: s.tMs, box: null };
    const near: FaceBox[] = [s.box];
    for (let k = i - 1; k >= Math.max(0, i - half) && filled[k].box; k--) near.push(filled[k].box!);
    for (let k = i + 1; k <= Math.min(filled.length - 1, i + half) && filled[k].box; k++) near.push(filled[k].box!);
    return { tMs: s.tMs, box: avgBox(near) };
  });
  return { intervalMs, samples };
}

/** The face nearest to tMs, if a sample lies within one sampling interval; otherwise null (no face). */
export function faceAt(track: FaceTrack, tMs: number): FaceBox | null {
  const s = track.samples;
  if (!s.length) return null;
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].tMs < tMs) lo = mid + 1;
    else hi = mid;
  }
  const best = lo > 0 && Math.abs(s[lo - 1].tMs - tMs) <= Math.abs(s[lo].tMs - tMs) ? s[lo - 1] : s[lo];
  return Math.abs(best.tMs - tMs) <= track.intervalMs ? best.box : null;
}
