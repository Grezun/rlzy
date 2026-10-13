import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { probe } from "./probe";
import { runFfmpeg } from "./run";

/** The backdrop look (EditStyle["background"], kept structural so @reel/media doesn't depend on @reel/core). */
export type BackdropLook = { zoom: number; driftPct: number; driftPeriodSec: number; driftPeriodYSec: number; blurSigma: number; dim: number; saturation: number; featherPx: number };

const even = (v: number) => Math.round(v / 2) * 2;

/** One background image, prepared once: it covers the frame × look.zoom and is blurred, desaturated and dimmed. */
export async function prepareBackdrop(image: string, out: string, size: { width: number; height: number }, look: BackdropLook): Promise<void> {
  const bw = even(size.width * look.zoom);
  const bh = even(size.height * look.zoom);
  const vf = [
    `scale=${bw}:${bh}:force_original_aspect_ratio=increase`, `crop=${bw}:${bh}`,
    ...(look.blurSigma > 0 ? [`gblur=sigma=${look.blurSigma}`] : []),
    `eq=saturation=${look.saturation}`, `lutyuv=y='val*${(1 - look.dim).toFixed(3)}'`, "format=rgb24",
  ].join(",");
  await runFfmpeg(["-i", image, "-vf", vf, "-frames:v", "1", out]);
}

/**
 * The speaker plate (spec §4.4 step 2). The working copy is cut out with its matte (edges feathered) and laid over the
 * prepared backdrops. Each backdrop shows from its fromMs (source time) and sways slowly (sine drift on x and y, different
 * periods), so the scene is never a frozen photo behind a moving speaker.
 *
 * The plate has the same size, frame rate and length as the working copy and no audio. Everything downstream (zooms,
 * punch-ins, split crops) uses it in place of the working copy.
 */
export async function compositeSpeakerPlate(opts: { video: string; matte: string; backgrounds: { image: string; fromMs: number }[]; out: string; look: BackdropLook; tmpDir: string }): Promise<void> {
  const { video, matte, backgrounds, out, look } = opts;
  if (!backgrounds.length) throw new RangeError("compositeSpeakerPlate needs at least one background");
  const info = await probe(video);
  if (!info.video) throw new Error("the speaker clip has no picture");
  const { width: w, height: h, fps } = info.video;
  await mkdir(opts.tmpDir, { recursive: true });
  const prepared: string[] = [];
  for (const [i, b] of backgrounds.entries()) {
    const file = join(opts.tmpDir, `backdrop-${i + 1}.png`);
    await prepareBackdrop(b.image, file, { width: w, height: h }, look);
    prepared.push(file);
  }
  const bw = even(w * look.zoom);
  const bh = even(h * look.zoom);
  // Clamped to the cover margin, so no frame edge ever shows.
  const ax = Math.min((look.driftPct / 100) * w, (bw - w) / 2).toFixed(2);
  const ay = Math.min((look.driftPct / 100) * h, (bh - h) / 2).toFixed(2);
  const px = look.driftPeriodSec.toFixed(2);
  const py = look.driftPeriodYSec.toFixed(2);
  const drift = `crop=${w}:${h}:x='(iw-ow)/2+${ax}*sin(2*PI*t/${px})':y='(ih-oh)/2+${ay}*sin(2*PI*t/${py})'`;
  const graph = prepared.map((_, i) => `[${i + 2}:v]${drift},setsar=1,format=yuv420p[bg${i}]`);
  let bg = "bg0";
  backgrounds.slice(1).forEach((b, k) => {
    graph.push(`[${bg}][bg${k + 1}]overlay=enable='gte(t,${(b.fromMs / 1000).toFixed(3)})'[bgm${k + 1}]`);
    bg = `bgm${k + 1}`;
  });
  const feather = look.featherPx > 0 ? `,gblur=sigma=${(look.featherPx / 2).toFixed(2)}` : "";
  graph.push(
    `[1:v]format=gray${feather}[mask]`,
    "[0:v]format=yuva420p[fg]",
    "[fg][mask]alphamerge[cut]",
    `[${bg}][cut]overlay=shortest=1:format=auto,format=yuv420p[v]`,
  );
  await runFfmpeg([
    "-i", video, "-i", matte,
    ...prepared.flatMap((f) => ["-loop", "1", "-framerate", String(fps), "-i", f]),
    "-filter_complex", graph.join(";"), "-map", "[v]", "-an",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(fps), "-movflags", "+faststart", out,
  ]);
}
