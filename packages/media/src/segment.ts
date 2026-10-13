import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";
import { probe } from "./probe";
import { ffmpegBin, runFfmpeg } from "./run";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SEGMENT_HELPER_DEFAULT = path.resolve(HERE, "../../../tools/segment-helper/.build/release/segment-helper");
export const segmentHelperPath = () => process.env.SEGMENT_HELPER_PATH || SEGMENT_HELPER_DEFAULT;
export const segmentHelperAvailable = () => existsSync(segmentHelperPath());

export class SegmentHelperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SegmentHelperError";
  }
}

/**
 * The matte model/cache id. BUMP THE VERSION SUFFIX whenever the Swift output changes (tools/segment-helper/.../main.swift):
 * the matte cache key carries only this id plus MATTE_REFINE, so an unbumped change reuses stale mattes.
 */
export const MATTE_MODEL = "vision/person-segmentation-accurate-v1";

/**
 * Matte settings from the plan-3 spike. The helper blends each frame with its previous output (smooth = the previous
 * frame's weight: less flicker, a little lag on fast moves). Then ffmpeg:
 * - erodes 2 px, which drops wall chunks at the hair edge
 * - stretches low…high to 0…255, for firmer edges and less haze
 * - blurs lightly
 * Part of the matte cache key.
 */
export const MATTE_REFINE = { smooth: 0.5, erodePasses: 2, low: 64, high: 191, blurSigma: 0.8 } as const;

export function matteRefineFilter(r: typeof MATTE_REFINE = MATTE_REFINE): string {
  const stretch = `lut=c0='clip((val-${r.low})*255/${r.high - r.low},0,255)'`;
  return [...Array.from({ length: r.erodePasses }, () => "erosion"), stretch, `gblur=sigma=${r.blurSigma}`, "format=yuv420p"].join(",");
}

const MATTE_H264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
const MATTE_TIMEOUT_MS = 40 * 60_000;

/**
 * Runs `segment-helper matte` and encodes its grey frames (white = the speaker) as an H.264 matte with the video's
 * size, frame rate and frame count, with MATTE_REFINE applied. `faces`: the smoothed face-track JSON, so only the region
 * connected to the face is kept.
 */
export function makeMatte(video: string, out: string, opts: { faces?: string; timeoutMs?: number } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["matte", video, "--smooth", String(MATTE_REFINE.smooth), ...(opts.faces ? ["--faces", opts.faces] : [])];
    const helper = spawn(segmentHelperPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let encoder: ChildProcess | null = null;
    let helperErr = "";
    let encoderErr = "";
    let helperCode: number | null | undefined;
    let encoderCode: number | null | undefined;
    let settled = false;
    const timeoutMs = opts.timeoutMs ?? MATTE_TIMEOUT_MS;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        helper.kill("SIGKILL");
        encoder?.kill("SIGKILL");
        reject(err);
      } else resolve();
    };
    const timer = setTimeout(() => finish(new SegmentHelperError(`segment-helper timed out after ${Math.round(timeoutMs / 60_000)} min`)), timeoutMs);
    const settle = () => {
      if (helperCode === undefined || (encoder && encoderCode === undefined)) return;
      const lastLine = (s: string) => s.trim().split("\n").filter((l) => !l.startsWith("STATS")).at(-1);
      if (helperCode !== 0) return finish(new SegmentHelperError(lastLine(helperErr) || `segment-helper exited with code ${helperCode}`));
      if (!encoder) return finish(new SegmentHelperError("segment-helper printed no frame size"));
      if (encoderCode !== 0) return finish(new SegmentHelperError(`encoding the cut-out failed: ${encoderErr.trim().split("\n").slice(-3).join(" ")}`));
      finish();
    };
    helper.on("error", (e) => finish(new SegmentHelperError(`segment-helper failed to start (${e.message}). Run "npm run build:segment-helper" on the worker Mac.`)));
    helper.stderr.on("data", (chunk: Buffer) => {
      helperErr = (helperErr + chunk).slice(-4000);
      if (encoder) return;
      // The helper's first stderr line is "WxH fps"; its frames wait in the pipe until ffmpeg reads them.
      const m = /^(\d+)x(\d+) ([\d.]+)\n/.exec(helperErr);
      if (!m) return;
      const enc = spawn(ffmpegBin(), ["-hide_banner", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${m[1]}x${m[2]}`, "-r", m[3], "-i", "pipe:0", "-vf", matteRefineFilter(), ...MATTE_H264, out], { stdio: ["pipe", "ignore", "pipe"] });
      encoder = enc;
      enc.stderr!.on("data", (d: Buffer) => (encoderErr = (encoderErr + d).slice(-4000)));
      enc.stdin!.on("error", () => {}); // EPIPE when ffmpeg stops early: reported through its exit code
      enc.on("error", (e) => finish(new SegmentHelperError(`ffmpeg failed to start: ${e.message}`)));
      enc.on("close", (code) => {
        encoderCode = code;
        settle();
      });
      helper.stdout.pipe(enc.stdin!);
    });
    helper.on("close", (code) => {
      helperCode = code;
      settle();
    });
  });
}

/** The fake worker's cut-out: a still head-and-shoulders shape in the lower middle, as long as the video. Free and quick. */
export async function makeEllipseMatte(video: string, out: string): Promise<void> {
  const info = await probe(video);
  if (!info.video) throw new SegmentHelperError("there is no picture to cut out");
  const { width: w, height: h, fps, durationSec } = info.video;
  const frames = Math.max(1, Math.round(durationSec * fps));
  const head = "lte(pow((X-W*0.5)/(W*0.17),2)+pow((Y-H*0.40)/(H*0.12),2),1)";
  const shoulders = "lte(pow((X-W*0.5)/(W*0.44),2)+pow((Y-H*0.86)/(H*0.30),2),1)";
  const dir = await mkdtemp(join(tmpdir(), "ellipse-"));
  try {
    const shape = join(dir, "shape.png");
    await runFfmpeg(["-f", "lavfi", "-i", `color=c=black:s=${w}x${h}`, "-vf", `format=gray,geq=lum='255*max(${head},${shoulders})',gblur=sigma=2`, "-frames:v", "1", shape]);
    await runFfmpeg(["-loop", "1", "-framerate", String(fps), "-i", shape, "-frames:v", String(frames), "-vf", "format=yuv420p", ...MATTE_H264, out]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Share of the frame the matte covers (0–1), averaged over every frame: each frame shrunk to 16×16 grey, then averaged. */
export async function matteCoverage(matte: string): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "coverage-"));
  try {
    const raw = join(dir, "means.gray");
    await runFfmpeg(["-i", matte, "-vf", "scale=16:16:flags=area,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", raw]);
    const bytes = await readFile(raw);
    return bytes.length ? bytes.reduce((s, b) => s + b, 0) / bytes.length / 255 : 0;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
