# Footage Editor, Plan 3: Background Replacement (cut-out + AI scene per reel): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the speaker in front of an AI-generated scene that fits the topic: they are cut out for free on the Mac (Apple Vision), Claude proposes the scene, the user can edit it or keep the real background on the review page, and one Higgsfield still (about $0.04 per reel) becomes a slowly drifting, slightly blurred and dimmed backdrop behind a sharp speaker. Brand backdrops and per-section backgrounds stay possible in the schema but are not offered yet.

**Architecture:**
- `tools/segment-helper` (Swift, adopted from the spike): Vision `.accurate` person segmentation, keeps only the region connected to the face, blends with the previous frame, streams grey frames. `@reel/media` encodes them as a grey H.264 matte the size, frame rate and length of the working copy, after an erode, contrast stretch and light blur (Task 1).
- `@reel/core`: `source.matteAssetId`, the plan-3 background rules, `backgroundCost` / `musicCost`, `backgroundStarts`, and `EditStyle.background` (the backdrop look) (Task 2).
- `@reel/media`: `compositeSpeakerPlate` uses FFmpeg to merge the working copy and its matte over the prepared backdrop and writes a **speaker plate** video (Task 3).
- `@reel/engine` + worker:
  - Ingest makes the matte right after transcription. A missing helper or a bad matte becomes a plan warning, never a failure (Task 4).
  - The planner proposes the scene (Task 5).
  - Generation pays for the one still within the approved estimate, composites the plate and uses it **in place of the working copy**. Every crop, zoom, punch-in, zoom blur and split crop therefore applies to the speaker and the backdrop together, with no change to the compiler or Remotion (Task 6).
- `apps/web`: background choice and scene prompt on the review page, the price in the estimate, and progress steps (Task 7).
- `npm run preview:background`: free stills of the composite on any clip, plus the look sample over it (Task 8).

**Tech Stack:** unchanged from plans 1–2b: TypeScript 7, zod 4, Vitest 5, Next.js 16, Remotion 4.0.531, FFmpeg 8, and Swift 5.9 tools with Apple Vision (macOS 14+) for the helper. No new npm dependencies. No migration: `matteAssetId` and the background live in the edit-plan JSON, and the new progress steps live in the job progress JSON.

**Spec:** `docs/superpowers/specs/2026-10-12-footage-editor-design.md`. Its §12 amendment (2026-10-13, "background replacement, plan 3") is what this plan implements, together with the amended §2 row 3, §3 (`background`, `source.matteAssetId`), §4.2 step 6, §4.4 step 2, §6 (brand backdrops deferred), §7 (cut-out rows) and §8. Plans 1, 2 and 2b are implemented on this branch (HEAD 7d14cb4 / 8e6bea9 when this plan was written, about 750 tests). This plan edits their code. Later look fixes on the branch (for example the headline placement that adds `EditStyle.headline`) sit beside the parts this plan touches: insert the new fields where the steps say and keep whatever else is there.

## Global Constraints

- **Scope (spec §12 rulings):**
  - One AI background per reel: one section, from the first beat.
  - The schema keeps the spec's `sections` and `brand` shapes. `parseEditPlan` refuses a second section and brand sources with plain "not yet" messages.
  - Brand backdrops are deferred: no `brand_backdrops` table, no settings page, no migration.
  - No light wrap.
  - No paid API call in any task.
- **Cut-out (matte), made at ingest after transcription:**
  - Vision `VNGeneratePersonSegmentationRequest` at `.accurate`, one request object reused across frames.
  - Only the region connected to the face box is kept: a flood fill on a 4 px grid of cells at ≥ 128, plus a one-cell ring. With no face at that time, the frame is kept as it is.
  - Temporal blend: previous output weight 0.5.
  - Refine (`MATTE_REFINE`): erode 2 passes, stretch 64…191 to 0…255, blur σ 0.8.
  - Encoded as H.264 `yuv420p` CRF 18 (preset veryfast), the same size, fps and frame count as the working copy.
  - Cache key `footageHashes.matte(model, workingHash, facesHash)`, which includes `MATTE_REFINE`.
  - Refused (plan warning, background stays original) when:
    - the mean coverage is under 3 % (`MIN_MATTE_COVERAGE = 0.03`)
    - its length differs from the working copy's by more than 100 ms
    - the helper is missing or fails
- **Background still:** the B-roll still model and price: `higgsfield-ai/soul/v2/standard`, `aspect_ratio 9:16`, `resolution 1080p`, $0.04 (`DEFAULT_MODELS.image`). One per AI section. The prompt is the user's or Claude's sentence plus, verbatim: `, an empty place with no people, vertical 9:16 photo, photorealistic, eye-level view, open space in the centre for a person standing in front, soft natural light, shallow depth of field, no text, no captions, no logos, no watermark`.
- **Backdrop look (`houseStyle.edit.background`, spec §12):**
  - The still covers the frame × 1.08.
  - It is blurred σ 5, at saturation 0.9, with luma × 0.90.
  - It drifts in a sine sway: 2.5 % of the frame on x over a 24 s period, and on y over a 38.4 s period. The drift is clamped so no edge ever shows.
  - Matte edges are feathered 3 px (gblur σ 1.5).
  - The speaker stays sharp.
- **Speaker plate:**
  - H.264 `yuv420p` CRF 16, preset medium.
  - No audio.
  - The same size, fps and length as the working copy.
  - It replaces the working copy as the `videoSrc` of every speaker clip. The voice is still cut from the working copy's audio.
- **Default:** Claude proposes `replace` with a topic scene whenever the video has a cut-out. It proposes `original` when the real setting is part of the message or the user's notes ask for it. A re-plan keeps the previous choice unless the instruction asks otherwise.
- **Failure copy (verbatim):**
  - Ingest: `Background replacement is off for this video: <reason>.`, with reasons:
    - `the cut-out tool isn't built on this worker. Run "npm run build:segment-helper" on the worker Mac, then upload the video again`
    - `cutting you out failed (<first line>)`
    - `the cut-out couldn't find you in the picture`
    - `the cut-out doesn't match the video's length`
  - Generation notes, each ending `…, so the reel uses your real background.` (exact strings in Task 6). One paid attempt, never resubmitted.
- **Existing behaviour:**
  - Faceless, Custom and style reels render byte for byte as before.
  - Footage plans with `background: original` compile exactly as before.
  - Plans saved before this change parse (`matteAssetId` is optional) and keep their real background.
- **Safety:**
  - No paid API calls (Claude, Scribe, ElevenLabs, Higgsfield). All tests use fakes and lavfi fixtures.
  - Never read `.env.local`.
  - Don't touch the scratchpad.
  - `tools/segment-helper` is adopted only by Task 1.
- **Copy:** UI copy is English. Claude's scene prompt is English; the user may type any language.
- **Commits:** every commit message ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the files the task lists.

## Review Focus

1. **A video the cut-out can't handle.** This covers:
   - a speaker who walks out of frame or turns away
   - an all-black matte
   - a matte a few frames short
   - a worker without the helper

   Ingest must still produce a plan, with the background `original` and one plain warning. Approval must cost nothing for the background, and generation must never pay for a still it can't use (a missing matte is checked before the paid call).

   Pinned in Task 4 (cut-out warnings), Task 5 (forced original) and Task 6 (missing matte, no paid call).
2. **Spend at the exact estimate.** A reel with AI music, the AI background and an AI cutaway, approved at exactly its estimate, must make all three. Before this plan, music reserved `estimateFootageCost(plan)`, which now includes the background and would starve it. With an estimate of $0, nothing is paid and the notes say why.

   Pinned in Task 2 (`musicCost`) and Task 6.
3. **A paid failure.** A moderation block or download failure of the background still is one attempt and one note, and the reel renders on the real background. A failure while compositing after paying is also a note; the still stays cached, so a retry is free.

   Pinned in Task 6.
4. **Frame alignment under every transform.** The plate must have the working copy's exact size, fps and length. The split pieces, zoom hits, punch-ins and zoom blurs must all show the plate, and none of them shows the old background.

   Pinned in Task 3 (plate size and length, a pixel inside and outside the matte) and Task 6 (every speaker clip's `src`, including split pieces, plus a render).
5. **Plans from a crafted client or from before plan 3.** Each of these is refused with a plain message on save and approve:
   - `replace` without a cut-out
   - an empty scene description
   - a brand backdrop
   - two sections
   - a section that doesn't start at the first beat

   Old plans still open, and their editor offers "Original" only.

   Pinned in Task 2 and Task 7.

## File map

| Area | Files |
|---|---|
| Tools | `tools/segment-helper/Package.swift`, `tools/segment-helper/Sources/segment-helper/main.swift` (adopted), `.gitignore`, `package.json` (`build:segment-helper`) |
| Media | `src/run.ts` (export `ffmpegBin`), `src/segment.ts` (new), `src/plate.ts` (new), `src/index.ts` |
| Core | `schema/footage.ts`, `schema/edit-plan.ts`, `cost.ts`, `footage/style.ts`, `footage/background.ts` (new), `events.ts`, `testing/fixtures.ts`, `index.ts` |
| Video | `house-style.ts` (`edit.background`) |
| DB | `packages/db/src/index.ts` (progress steps `cutout`, `background`) |
| Engine | `segmenter.ts` (new), `footage-ingest.ts`, `footage-planner.ts`, `providers/fake.ts`, `footage-background.ts` (new), `footage-generate.ts`, `index.ts`, `scripts/preview-background.ts` (new) |
| Worker | `src/main.ts`, `src/handlers/index.ts`, `src/handlers/footage.ts` |
| Web | `lib/edit-plan-edit.ts`, `lib/progress-view.ts`, `components/FootagePlanEditor.tsx` |
| Docs | `docs/RUNNING.md` |

Tasks run in order. Tasks 2, 4, 5 and 6 build on each other's names (listed under **Interfaces**).

---

### Task 1: Adopt the segment helper; make, check and fake a matte

**Files:**
- Adopt (rewrite) `tools/segment-helper/Sources/segment-helper/main.swift`. Keep `tools/segment-helper/Package.swift` as is.
- Modify:
  - `.gitignore`
  - root `package.json` (script `build:segment-helper`)
  - `packages/media/src/run.ts` (export `ffmpegBin`)
  - `packages/media/src/index.ts`
- Create: `packages/media/src/segment.ts`
- Test: `packages/media/src/segment.test.ts`

**Interfaces:**
- Consumes: `probe`, `runFfmpeg`, `makeTestVideo`, `faceHelperAvailable`, `runFaceHelper`, `FIXTURE_TALKING_HEAD` (all existing in `@reel/media`).
- Produces, all in `@reel/media`:
  - `segmentHelperPath(): string`, `segmentHelperAvailable(): boolean`, `class SegmentHelperError`
  - `MATTE_REFINE: { smooth: 0.5; erodePasses: 2; low: 64; high: 191; blurSigma: 0.8 }`, `matteRefineFilter(): string`
  - `makeMatte(video: string, out: string, opts?: { faces?: string; timeoutMs?: number }): Promise<void>`. `faces` is a path to a smoothed face-track JSON `{ intervalMs, samples: [{ tMs, box | null }] }`.
  - `makeEllipseMatte(video: string, out: string): Promise<void>`, the fake worker's matte
  - `matteCoverage(matte: string): Promise<number>`, a share 0–1 averaged over every frame
  - `ffmpegBin(): string`

- [ ] **Step 1: Write the failing tests.** Create `packages/media/src/segment.test.ts`:
```ts
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { faceHelperAvailable, FIXTURE_TALKING_HEAD, runFaceHelper } from "./face";
import { probe } from "./probe";
import { runFfmpeg } from "./run";
import { makeEllipseMatte, makeMatte, matteCoverage, matteRefineFilter, segmentHelperAvailable } from "./segment";
import { makeTestVideo } from "./testing";

const HELPER = segmentHelperAvailable();
type Box = { x: number; y: number; w: number; h: number };

/** Average grey level (0–255) of a box of the frame at `sec` (box in fractions of the frame). */
async function boxLuma(video: string, dir: string, sec: number, b: Box): Promise<number> {
  const out = join(dir, `box-${sec}-${b.x}-${b.y}-${b.w}.gray`);
  await runFfmpeg(["-ss", String(sec), "-i", video, "-vf", `crop=iw*${b.w}:ih*${b.h}:iw*${b.x}:ih*${b.y},scale=1:1:flags=area,format=gray`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", out]);
  return (await readFile(out))[0];
}

describe("mattes", () => {
  it("builds the refine filter from MATTE_REFINE (erode 2 px, stretch 64…191, light blur)", () => {
    expect(matteRefineFilter()).toBe("erosion,erosion,lut=c0='clip((val-64)*255/127,0,255)',gblur=sigma=0.8,format=yuv420p");
  });

  it("makes the fake head-and-shoulders matte, as long as the video", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ellipse-"));
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 216, height: 384 });
    await makeEllipseMatte(join(dir, "v.mp4"), join(dir, "m.mp4"));
    const info = await probe(join(dir, "m.mp4"));
    expect(info.video).toMatchObject({ width: 216, height: 384 });
    expect(Math.abs(info.video!.durationSec - 2)).toBeLessThan(0.05);
    const coverage = await matteCoverage(join(dir, "m.mp4"));
    expect(coverage).toBeGreaterThan(0.15);
    expect(coverage).toBeLessThan(0.6);
    expect(await boxLuma(join(dir, "m.mp4"), dir, 1, { x: 0.45, y: 0.37, w: 0.1, h: 0.05 })).toBeGreaterThan(200);
    expect(await boxLuma(join(dir, "m.mp4"), dir, 1, { x: 0, y: 0, w: 0.1, h: 0.05 })).toBeLessThan(20);
  }, 120_000);

  it.skipIf(!HELPER)("matte on a synthetic clip: one frame per video frame, nobody found (skipped: run npm run build:segment-helper)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matte-"));
    await makeTestVideo(join(dir, "t.mp4"), { durationSec: 1, width: 360, height: 640 });
    await makeMatte(join(dir, "t.mp4"), join(dir, "m.mp4"));
    const info = await probe(join(dir, "m.mp4"));
    expect(info.video).toMatchObject({ width: 360, height: 640 });
    expect(Math.abs(info.video!.durationSec - 1)).toBeLessThan(0.05);
    expect(await matteCoverage(join(dir, "m.mp4"))).toBeLessThan(0.1);
  }, 300_000);

  it.skipIf(!HELPER)("fails clearly for a missing file", async () => {
    await expect(makeMatte("/no/such/video.mp4", join(tmpdir(), "never.mp4"))).rejects.toThrow(/no such file/);
  });

  it.skipIf(!HELPER || !faceHelperAvailable() || !existsSync(FIXTURE_TALKING_HEAD))(
    "keeps the speaker on the fixture: the face is white, the top corners dark (skipped: needs both helpers and packages/media/fixtures/talking-head-he.mp4)",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "matte-fixture-"));
      const raw = (await runFaceHelper(FIXTURE_TALKING_HEAD)) as { fps: number; sampleEvery: number; samples: { tMs: number; box: Box | null }[] };
      const faces = join(dir, "faces.json");
      await writeFile(faces, JSON.stringify({ intervalMs: (raw.sampleEvery * 1000) / raw.fps, samples: raw.samples }));
      await makeMatte(FIXTURE_TALKING_HEAD, join(dir, "m.mp4"), { faces });
      const at = raw.samples.find((s) => s.box && s.tMs >= 1000)!;
      const b = at.box!;
      // The middle half of the face box, at that sample's time.
      const inner = { x: b.x + b.w / 4, y: b.y + b.h / 4, w: b.w / 2, h: b.h / 2 };
      expect(await boxLuma(join(dir, "m.mp4"), dir, at.tMs / 1000, inner)).toBeGreaterThan(180);
      expect(await boxLuma(join(dir, "m.mp4"), dir, at.tMs / 1000, { x: 0, y: 0, w: 0.12, h: 0.06 })).toBeLessThan(60);
      expect(await matteCoverage(join(dir, "m.mp4"))).toBeGreaterThan(0.1);
    },
    600_000,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run packages/media/src/segment.test.ts`.

  Expected: FAIL (`./segment` does not exist).

- [ ] **Step 3: Export the ffmpeg binary path.** In `packages/media/src/run.ts`, change `const ffmpegBin = () => process.env.FFMPEG_PATH || "ffmpeg";` to:
```ts
/** The ffmpeg binary (FFMPEG_PATH or "ffmpeg" on PATH); exported for pipes that runFfmpeg can't express. */
export const ffmpegBin = () => process.env.FFMPEG_PATH || "ffmpeg";
```

- [ ] **Step 4: Write `packages/media/src/segment.ts`.**
```ts
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
```
In `packages/media/src/index.ts` add `export * from "./segment";`.

- [ ] **Step 5: Adopt the helper.** Replace `tools/segment-helper/Sources/segment-helper/main.swift` entirely with:
```swift
// segment-helper: a person matte from a video with Apple Vision (footage editor plan 3, spec §4.2 step 6).
//
//   segment-helper matte <video> [--faces <face-track.json>] [--smooth A]
//
// Writes one raw 8-bit grey frame per video frame, at the video's size, to stdout (white = the speaker), for ffmpeg:
//   … | ffmpeg -f rawvideo -pix_fmt gray -s WxH -r FPS -i pipe:0 …
// The first stderr line is "WxH fps"; the last is a STATS line. On any error: a message on stderr and exit code 1.
//
// Per frame:
//   1. VNGeneratePersonSegmentationRequest at .accurate. One request object is reused, so Vision keeps its own temporal
//      consistency. (.balanced halos and the person-instance mask ghosts the background: both failed the spike.)
//   2. The matte is scaled to the frame.
//   3. --faces: the smoothed face track ingest stores ({intervalMs, samples: [{tMs, box | null}]}; boxes normalised,
//      origin top-left). Only the matte region connected to the face is kept, so a bottle on the table or a chunk of wall
//      drops out. With no face at this time, the frame is kept as it is.
//   4. --smooth A: blended with the previous output frame (A = the previous frame's weight).
import AVFoundation
import CoreImage
import Foundation
import Vision

struct Box: Decodable { let x: Double; let y: Double; let w: Double; let h: Double }
struct FaceSample: Decodable { let tMs: Double; let box: Box? }
struct FaceTrack: Decodable { let intervalMs: Double; let samples: [FaceSample] }

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}
func note(_ message: String) { FileHandle.standardError.write(Data((message + "\n").utf8)) }

let args = CommandLine.arguments
guard args.count >= 3, args[1] == "matte" else { fail("usage: segment-helper matte <video> [--faces <face-track.json>] [--smooth A]") }
let url = URL(fileURLWithPath: args[2])
func opt(_ name: String) -> String? {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}
guard FileManager.default.fileExists(atPath: url.path) else { fail("no such file: \(url.path)") }
let smooth = Float(opt("--smooth") ?? "0") ?? -1
guard smooth >= 0, smooth < 1 else { fail("--smooth must be a number from 0 to below 1") }
let track: FaceTrack? = {
  guard let path = opt("--faces") else { return nil }
  guard let data = FileManager.default.contents(atPath: path) else { fail("no such file: \(path)") }
  do { return try JSONDecoder().decode(FaceTrack.self, from: data) } catch { fail("--faces is not a face track: \(error.localizedDescription)") }
}()

/// The face box nearest to tMs within one sampling interval, or nil. Frames arrive in order, so `cursor` only moves forward.
func faceBox(_ track: FaceTrack?, at tMs: Double, cursor: inout Int) -> Box? {
  guard let t = track, !t.samples.isEmpty else { return nil }
  let s = t.samples
  while cursor + 1 < s.count && s[cursor + 1].tMs <= tMs { cursor += 1 }
  var best = s[cursor]
  if cursor + 1 < s.count && abs(s[cursor + 1].tMs - tMs) < abs(best.tMs - tMs) { best = s[cursor + 1] }
  return abs(best.tMs - tMs) <= t.intervalMs ? best.box : nil
}

/// Keeps the matte region connected to the face: a flood fill over a 4 px grid of cells whose centre is ≥ 128, seeded
/// from every such cell inside the face box, plus a one-cell ring for the soft edge. Everything else is zeroed.
/// A face box with no matte inside leaves the frame as it is.
func keepFaceRegion(_ frame: inout [UInt8], width w: Int, height h: Int, face: Box) {
  let step = 4
  let gw = (w + step - 1) / step
  let gh = (h + step - 1) / step
  var on = [Bool](repeating: false, count: gw * gh)
  for gy in 0..<gh {
    let y = min(h - 1, gy * step + step / 2)
    for gx in 0..<gw {
      let x = min(w - 1, gx * step + step / 2)
      on[gy * gw + gx] = frame[y * w + x] >= 128
    }
  }
  let cellX = { (v: Double) -> Int in min(gw - 1, max(0, Int(v * Double(w)) / step)) }
  let cellY = { (v: Double) -> Int in min(gh - 1, max(0, Int(v * Double(h)) / step)) }
  let x0 = cellX(face.x), x1 = cellX(face.x + face.w), y0 = cellY(face.y), y1 = cellY(face.y + face.h)
  var reached = [Bool](repeating: false, count: gw * gh)
  var queue: [Int] = []
  for gy in y0...y1 {
    for gx in x0...x1 {
      let i = gy * gw + gx
      if on[i] && !reached[i] { reached[i] = true; queue.append(i) }
    }
  }
  if queue.isEmpty { return }
  var head = 0
  while head < queue.count {
    let i = queue[head]
    head += 1
    let gx = i % gw, gy = i / gw
    for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
      let nx = gx + dx, ny = gy + dy
      guard nx >= 0, ny >= 0, nx < gw, ny < gh else { continue }
      let j = ny * gw + nx
      if on[j] && !reached[j] { reached[j] = true; queue.append(j) }
    }
  }
  for gy in 0..<gh {
    for gx in 0..<gw {
      var keep = false
      for dy in -1...1 where !keep {
        for dx in -1...1 where !keep {
          let nx = gx + dx, ny = gy + dy
          if nx >= 0, ny >= 0, nx < gw, ny < gh, reached[ny * gw + nx] { keep = true }
        }
      }
      if keep { continue }
      for y in (gy * step)..<min(h, (gy + 1) * step) {
        for x in (gx * step)..<min(w, (gx + 1) * step) { frame[y * w + x] = 0 }
      }
    }
  }
}

do {
  let asset = AVURLAsset(url: url)
  guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else { fail("no video track in \(url.path)") }
  let size = try await videoTrack.load(.naturalSize)
  let fps = Double(try await videoTrack.load(.nominalFrameRate))
  let w = Int(size.width), h = Int(size.height)
  note("\(w)x\(h) \(fps)")

  let reader = try AVAssetReader(asset: asset)
  let output = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  output.alwaysCopiesSampleData = false
  reader.add(output)
  guard reader.startReading() else { fail("cannot read \(url.path): \(reader.error?.localizedDescription ?? "unknown error")") }

  let request = VNGeneratePersonSegmentationRequest()
  request.qualityLevel = .accurate
  request.outputPixelFormat = kCVPixelFormatType_OneComponent8
  let sequence = VNSequenceRequestHandler()
  let ci = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])
  var frame = [UInt8](repeating: 0, count: w * h)
  var prev = [Float](repeating: 0, count: w * h)
  var havePrev = false
  var count = 0
  var cursor = 0
  let started = Date()
  let stdout = FileHandle.standardOutput

  while let buffer = output.copyNextSampleBuffer() {
    guard let pixels = CMSampleBufferGetImageBuffer(buffer) else { continue }
    let tMs = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer)) * 1000
    try sequence.perform([request], on: pixels, orientation: .up)
    guard let mask = request.results?.first?.pixelBuffer else { fail("no matte for frame \(count)") }
    let image = CIImage(cvPixelBuffer: mask)
    let scaled = image.transformed(by: CGAffineTransform(scaleX: Double(w) / image.extent.width, y: Double(h) / image.extent.height))
    frame.withUnsafeMutableBytes { raw in
      ci.render(scaled, toBitmap: raw.baseAddress!, rowBytes: w, bounds: CGRect(x: 0, y: 0, width: w, height: h), format: .L8, colorSpace: nil)
    }
    if let face = faceBox(track, at: tMs, cursor: &cursor) { keepFaceRegion(&frame, width: w, height: h, face: face) }
    if smooth > 0 {
      for i in 0..<frame.count {
        let v = havePrev ? smooth * prev[i] + (1 - smooth) * Float(frame[i]) : Float(frame[i])
        prev[i] = v
        frame[i] = UInt8(min(255, max(0, v.rounded())))
      }
      havePrev = true
    }
    stdout.write(Data(frame))
    count += 1
  }
  if reader.status == .failed { fail("reading \(url.path) failed: \(reader.error?.localizedDescription ?? "unknown error")") }
  let seconds = Date().timeIntervalSince(started)
  note(String(format: "STATS frames=%d seconds=%.1f fps=%.1f", count, seconds, Double(count) / max(seconds, 0.001)))
} catch {
  fail("segment-helper: \(error.localizedDescription)")
}
```
Add the build script to the root `package.json`, after `"build:face-helper"`: `"build:segment-helper": "swift build -c release --package-path tools/segment-helper",`. Add `tools/segment-helper/.build/` to `.gitignore` after `tools/face-helper/.build/`.

- [ ] **Step 6: Build the helper and run the tests.** Run `npm run build:segment-helper && npx vitest run packages/media/src/segment.test.ts`.

  Expected: the build succeeds, and the tests pass: 4 run, plus the fixture test when `packages/media/fixtures/talking-head-he.mp4` exists.

  If the fixture test fails because the white area sits mirrored top to bottom from the face, `CIContext.render` wrote the rows bottom-up on this macOS. Flip the image before rendering:
  ```swift
  .transformed(by: CGAffineTransform(scaleX: 1, y: -1).translatedBy(x: 0, y: -Double(h)))
  ```
  Then rebuild.

- [ ] **Step 7: Run the whole suite and the typecheck.** Run `npm test && npm run typecheck`.

  Expected: PASS.

- [ ] **Step 8: Commit.**
```bash
git add tools/segment-helper/Package.swift tools/segment-helper/Sources/segment-helper/main.swift .gitignore package.json packages/media/src/run.ts packages/media/src/segment.ts packages/media/src/segment.test.ts packages/media/src/index.ts
git commit -m "feat(media): segment-helper (Apple Vision person matte kept to the face region) and matte encoding, coverage and a fake matte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Core: cut-out on the source, background rules, prices, section starts, backdrop look

**Files:**
- Modify:
  - `packages/core/src/schema/footage.ts`
  - `packages/core/src/schema/edit-plan.ts`
  - `packages/core/src/cost.ts`
  - `packages/core/src/footage/style.ts`
  - `packages/core/src/testing/fixtures.ts`
  - `packages/core/src/index.ts`
  - `packages/video/src/house-style.ts`
- Create: `packages/core/src/footage/background.ts`, `packages/core/src/footage/background.test.ts`
- Test:
  - `packages/core/src/schema/edit-plan.test.ts`
  - `packages/core/src/cost.test.ts`
  - `packages/core/src/footage/compile.test.ts`
  - `apps/web/lib/edit-plan-edit.test.ts` (its old "arrives in a later update" expectation)

**Interfaces:**
- Consumes: `EditPlanSchema`, `parseEditPlan`, `notYetIssues`, `estimateFootageCost`, `withFootageEstimate`, `EditStyleSchema` (existing).
- Produces:
  - `FootageSource.matteAssetId?: string` (an asset hash)
  - `BackgroundSchema`, `type Background = EditPlan["background"]`
  - `NOT_YET: { brand: string; sections: string }`, which replaces `NOT_YET.background`
  - `musicCost(plan: Pick<EditPlan, "music">, durationSec: number, table?): number`
  - `backgroundCost(background: Background | undefined, table?): number`
  - `estimateFootageCost(plan: Pick<EditPlan, "music"> & Partial<Pick<EditPlan, "background">>, durationSec, table?, placed?)`, now including the background
  - `backgroundStarts(plan: Pick<EditPlan, "background" | "beats">, words: Word[], padMs: number): number[]`
  - `EditStyle.background: { zoom; driftPct; driftPeriodSec; blurSigma; dim; saturation; featherPx }`
  - Fixture `MATTE_HASH`

- [ ] **Step 1: Write the failing tests.**

  In `packages/core/src/schema/edit-plan.test.ts`:
  - change the fixtures import to `import { CHARACTER_ID, EXTRA_IMG, fixtureExtras, MATTE_HASH, validEditPlan } from "../testing/fixtures";`
  - delete the test `"still rejects background replacement (plan 3)"`
  - append:
```ts
describe("background replacement (plan 3)", () => {
  const scene = (prompt = "a bright home office") => ({ mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt } }] });
  const withMatte = (background: unknown) => ({ ...validEditPlan(), source: { ...validEditPlan().source, matteAssetId: MATTE_HASH }, background });
  it("accepts one AI scene from the first beat when the video has a cut-out (prompt trimmed)", () => {
    expect(parseEditPlan(withMatte(scene(" a bright home office "))).background).toEqual(scene());
  });
  it("needs the cut-out, a scene description and sections that start at the first beat, in beat order", () => {
    expect(message({ ...validEditPlan(), background: scene() })).toContain("Background replacement needs the cut-out of you, and this video has none. Keep the original background.");
    expect(message(withMatte(scene("  ")))).toContain("Describe the AI background scene, or keep the original background.");
    expect(message(withMatte({ mode: "replace", sections: [{ fromBeatId: "b2", source: { kind: "ai", prompt: "x" } }] }))).toContain("the first background starts at the first beat (b1)");
    expect(message(withMatte({ mode: "replace", sections: [{ fromBeatId: "b9", source: { kind: "ai", prompt: "x" } }] }))).toContain("there is no beat b9");
    const twice = { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "x" } }, { fromBeatId: "b1", source: { kind: "ai", prompt: "y" } }] };
    expect(message(withMatte(twice))).toContain("background sections follow the beats in order, at most one per beat");
  });
  it("refuses brand backdrops and a second section for now, with plain messages (the schema itself allows both, spec §3)", () => {
    const brand = { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "brand", assetId: "x" } }] };
    expect(message(withMatte(brand))).toContain("Brand backdrops arrive in a later update: use an AI scene or the original background.");
    const two = { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "office" } }, { fromBeatId: "b2", source: { kind: "ai", prompt: "beach" } }] };
    expect(message(withMatte(two))).toContain("One background per reel for now: remove the extra background sections.");
    expect(EditPlanSchema.safeParse(withMatte(two)).success).toBe(true);
  });
  it("parses plans made before plan 3 (no cut-out) unchanged", () => {
    expect(parseEditPlan(validEditPlan()).source.matteAssetId).toBeUndefined();
    expect(parseEditPlan(validEditPlan()).background).toEqual({ mode: "original" });
  });
});
```

  In `packages/core/src/cost.test.ts`:
  - add `backgroundCost, musicCost` to the `./cost` import
  - append inside `describe("footage cost", …)`:
```ts
  it("prices one Higgsfield still per AI background section and nothing for the original background", () => {
    const scene = { mode: "replace" as const, sections: [{ fromBeatId: "b1", source: { kind: "ai" as const, prompt: "office" } }] };
    expect(backgroundCost({ mode: "original" })).toBe(0);
    expect(backgroundCost(undefined)).toBe(0);
    expect(backgroundCost(scene)).toBeCloseTo(0.04, 9);
    expect(backgroundCost({ mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "brand", assetId: "x" } }] })).toBe(0);
    expect(estimateFootageCost({ music: { kind: "ai", prompt: "x" }, background: scene }, 7.3)).toBeCloseTo(0.12, 9);
    // Generation reserves music on its own price: never the whole estimate, or the background would find nothing left.
    expect(musicCost({ music: { kind: "ai", prompt: "x" } }, 7.3)).toBeCloseTo(0.08, 9);
    expect(musicCost({ music: { kind: "none" } }, 7.3)).toBe(0);
  });
```

  In `packages/core/src/footage/compile.test.ts`:
  - change the fixtures import to add `MATTE_HASH`
  - append inside the `describe` that holds `"matches the compiled length and prices AI music per second"`:
```ts
  it("adds the AI background still to the estimate, and nothing else changes in the compiled reel", () => {
    const scene = plan({ source: { ...validEditPlan().source, matteAssetId: MATTE_HASH }, background: { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "office" } }] } });
    expect(withFootageEstimate(scene, transcript.words, style).estimate).toEqual({ durationSec: 7.3, credits: 0.04 });
    expect(compile(scene).timeline).toEqual(compile().timeline);
  });
```

  Create `packages/core/src/footage/background.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseEditPlan, EditPlanSchema } from "../schema/edit-plan";
import { footageTranscript, MATTE_HASH, validEditPlan } from "../testing/fixtures";
import { backgroundStarts } from "./background";

const words = footageTranscript().words;
const withMatte = (background: unknown) => ({ ...validEditPlan(), source: { ...validEditPlan().source, matteAssetId: MATTE_HASH }, background });

describe("backgroundStarts", () => {
  it("is empty for the original background and starts the one scene at 0", () => {
    expect(backgroundStarts(parseEditPlan(validEditPlan()), words, 50)).toEqual([]);
    const one = parseEditPlan(withMatte({ mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "office" } }] }));
    expect(backgroundStarts(one, words, 50)).toEqual([0]);
  });
  it("starts a later section padMs before its beat's first word (source time)", () => {
    const two = EditPlanSchema.parse(withMatte({ mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "office" } }, { fromBeatId: "b2", source: { kind: "ai", prompt: "beach" } }] }));
    expect(backgroundStarts(two, words, 50)).toEqual([0, 4150]);
  });
});
```

  In `apps/web/lib/edit-plan-edit.test.ts`, in the test `"refuses plan-2/3 fields a crafted client might send"`, change the expected pattern to `/Background replacement needs the cut-out of you/`.

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run packages/core apps/web/lib/edit-plan-edit.test.ts`.

  Expected: FAIL (`MATTE_HASH`, `backgroundCost`, `musicCost` and `./background` are missing; the old message is still returned).

- [ ] **Step 3: Source and fixtures.**

  In `packages/core/src/schema/footage.ts`, add to `FootageSourceSchema`, after `faceTrackAssetId`:
```ts
  /** Plan 3: the speaker's matte (grey H.264, frame-aligned with the working copy), made at ingest. Absent: no cut-out, so the background stays original. */
  matteAssetId: AssetHashSchema.optional(),
```

  In `packages/core/src/testing/fixtures.ts`, after `HASH_C`, add `export const MATTE_HASH = "9".repeat(64);`.

  Add `background` to `testEditStyle()` after `callouts`:
```ts
  background: { zoom: 1.08, driftPct: 2.5, driftPeriodSec: 24, blurSigma: 5, dim: 0.1, saturation: 0.9, featherPx: 3 },
```

- [ ] **Step 4: Background rules.** In `packages/core/src/schema/edit-plan.ts`:

  1. After `const Prompt = …`, add:
```ts
const BackgroundPrompt = z.string().trim().min(1, "Describe the AI background scene, or keep the original background.").max(1500);
/** Spec §3 / §12: per-section backgrounds; plan 3 accepts one AI section (notYetIssues refuses brand backdrops and more sections). */
export const BackgroundSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("original") }),
  z.object({
    mode: z.literal("replace"),
    sections: z.array(z.object({
      fromBeatId: BeatId,
      source: z.discriminatedUnion("kind", [z.object({ kind: z.literal("ai"), prompt: BackgroundPrompt }), z.object({ kind: z.literal("brand"), assetId: z.string().min(1) })]),
    })).min(1),
  }),
]);
export type Background = z.infer<typeof BackgroundSchema>;
```
  2. In `EditPlanSchema`, replace the whole `background: z.discriminatedUnion("mode", [ … ]),` entry with `background: BackgroundSchema,`.
  3. In the `superRefine`, before the `patternBreak === "broll"` check, add:
```ts
    if (plan.background.mode === "replace") {
      if (!plan.source.matteAssetId) {
        ctx.addIssue({ code: "custom", path: ["background"], message: "Background replacement needs the cut-out of you, and this video has none. Keep the original background." });
      }
      const order = new Map(plan.beats.map((b, i) => [b.id, i]));
      let last = -1;
      plan.background.sections.forEach((s, i) => {
        const path = ["background", "sections", i, "fromBeatId"];
        const at = order.get(s.fromBeatId);
        if (at === undefined) return ctx.addIssue({ code: "custom", path, message: `there is no beat ${s.fromBeatId}` });
        if (i === 0 && at !== 0) ctx.addIssue({ code: "custom", path, message: `the first background starts at the first beat (${plan.beats[0].id})` });
        else if (i > 0 && at <= last) ctx.addIssue({ code: "custom", path, message: "background sections follow the beats in order, at most one per beat" });
        last = at;
      });
    }
```
  4. Replace `NOT_YET` and `notYetIssues` with:
```ts
export const NOT_YET = {
  brand: "Brand backdrops arrive in a later update: use an AI scene or the original background.",
  sections: "One background per reel for now: remove the extra background sections.",
};

/** What the schema describes but plan 3 doesn't render yet (spec §12): brand backdrops and more than one background section. */
export function notYetIssues(plan: EditPlan): string[] {
  if (plan.background.mode !== "replace") return [];
  const sections = plan.background.sections;
  return [...(sections.length > 1 ? [NOT_YET.sections] : []), ...(sections.some((s) => s.source.kind === "brand") ? [NOT_YET.brand] : [])];
}
```

- [ ] **Step 5: Prices.** In `packages/core/src/cost.ts`, replace `estimateFootageCost` with:
```ts
/** AI music fitted to the reel, in USD (generation reserves exactly this before composing). */
export function musicCost(plan: Pick<EditPlan, "music">, durationSec: number, table: CostTable = DEFAULT_COST_TABLE): number {
  return plan.music.kind === "ai" ? musicBillSeconds(durationSec) * unitPrice(table, "elevenlabs/music", "perSecond") : 0;
}

/** Plan 3: one Higgsfield still per AI background section, on the B-roll still's model and price. */
export function backgroundCost(background: EditPlan["background"] | undefined, table: CostTable = DEFAULT_COST_TABLE): number {
  if (!background || background.mode !== "replace") return 0;
  const ai = background.sections.filter((s) => s.source.kind === "ai").length;
  return ai ? ai * unitPrice(table, DEFAULT_MODELS.image, "perImage") : 0;
}

/** Generation spend of an approved footage plan, in USD: AI music, the AI background and every placed AI cutaway. */
export function estimateFootageCost(
  plan: Pick<EditPlan, "music"> & Partial<Pick<EditPlan, "background">>,
  durationSec: number,
  table: CostTable = DEFAULT_COST_TABLE,
  placed: PlacedCutaway[] = [],
): number {
  return musicCost(plan, durationSec, table) + backgroundCost(plan.background, table) + placed.reduce((sum, c) => sum + cutawayCost(c.source, (c.durationInFrames * 1000) / 30, table), 0);
}
```

- [ ] **Step 6: Section starts.** Create `packages/core/src/footage/background.ts`:
```ts
import type { EditPlan } from "../schema/edit-plan";
import type { Word } from "../schema/timeline";

/**
 * Source time (ms) at which each background section starts: the first at 0, the others padMs before their beat's first
 * word. The speaker plate is composited in source time, so a cold open or a dropped beat never shifts a section.
 * Plan 3 plans have one section.
 */
export function backgroundStarts(plan: Pick<EditPlan, "background" | "beats">, words: Word[], padMs: number): number[] {
  if (plan.background.mode !== "replace") return [];
  const beats = new Map(plan.beats.map((b) => [b.id, b]));
  return plan.background.sections.map((s, i) => {
    if (i === 0) return 0;
    const beat = beats.get(s.fromBeatId);
    const w = beat ? words[beat.startWordIdx] : undefined;
    return w ? Math.max(0, Math.round(w.startMs - padMs)) : 0;
  });
}
```
In `packages/core/src/index.ts`, add `export * from "./footage/background";` after `./footage/callouts`.

- [ ] **Step 7: Backdrop look.** In `packages/core/src/footage/style.ts`, add to `EditStyleSchema`, after `callouts`:
```ts
  /**
   * Plan 3 backdrop behind the cut-out speaker. The still covers the frame × zoom, so the sine drift never shows an
   * edge. It is blurred, desaturated and dimmed, so the sharp speaker and the white captions stand out. The matte edge is
   * feathered by featherPx.
   */
  background: z.object({
    zoom: z.number().min(1).max(1.5),
    driftPct: z.number().min(0).max(10),
    driftPeriodSec: z.number().positive(),
    blurSigma: z.number().min(0).max(30),
    dim: z.number().min(0).max(0.9),
    saturation: z.number().min(0).max(2),
    featherPx: z.number().min(0).max(20),
  }),
```
In `packages/video/src/house-style.ts`, add to `edit` after `callouts`:
```ts
    // Plan 3: a soft, slightly dark scene so the sharp speaker and the white captions win; a slow sway instead of a frozen photo.
    // 2.5 % drift fits inside the 1.08 cover margin (4 % each side). 3 px feather (spec §4.4).
    background: { zoom: 1.08, driftPct: 2.5, driftPeriodSec: 24, blurSigma: 5, dim: 0.1, saturation: 0.9, featherPx: 3 },
```

- [ ] **Step 8: Run the tests.** Run `npx vitest run packages/core packages/video/src/house-style.test.ts apps/web/lib/edit-plan-edit.test.ts && npm run typecheck`.

  Expected: PASS.

- [ ] **Step 9: Run the whole suite.** Run `npm test`.

  Expected: PASS.

- [ ] **Step 10: Commit.**
```bash
git add packages/core/src/schema/footage.ts packages/core/src/schema/edit-plan.ts packages/core/src/schema/edit-plan.test.ts packages/core/src/cost.ts packages/core/src/cost.test.ts packages/core/src/footage/style.ts packages/core/src/footage/background.ts packages/core/src/footage/background.test.ts packages/core/src/footage/compile.test.ts packages/core/src/testing/fixtures.ts packages/core/src/index.ts packages/video/src/house-style.ts apps/web/lib/edit-plan-edit.test.ts
git commit -m "feat(core): background replacement rules (cut-out required, one AI scene for now), background and music prices, section starts, backdrop look

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Media: the speaker plate (cut-out over a drifting, blurred backdrop)

**Files:**
- Create: `packages/media/src/plate.ts`, `packages/media/src/plate.test.ts`
- Modify: `packages/media/src/index.ts`

**Interfaces:**
- Consumes: `probe`, `runFfmpeg`, `makeEllipseMatte` (Task 1).
- Produces:
  - `type BackdropLook = { zoom: number; driftPct: number; driftPeriodSec: number; blurSigma: number; dim: number; saturation: number; featherPx: number }`. It is structurally equal to `EditStyle["background"]`.
  - `prepareBackdrop(image: string, out: string, size: { width: number; height: number }, look: BackdropLook): Promise<void>`
  - `compositeSpeakerPlate(opts: { video: string; matte: string; backgrounds: { image: string; fromMs: number }[]; out: string; look: BackdropLook; tmpDir: string }): Promise<void>`

- [ ] **Step 1: Write the failing tests.** Create `packages/media/src/plate.test.ts`:
```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compositeSpeakerPlate } from "./plate";
import { probe } from "./probe";
import { runFfmpeg } from "./run";
import { makeTestImage } from "./testing";

const LOOK = { zoom: 1.08, driftPct: 2.5, driftPeriodSec: 24, blurSigma: 5, dim: 0.1, saturation: 0.9, featherPx: 3 };
const S = "216x384";

async function rgbAt(video: string, dir: string, sec: number, fx: number, fy: number): Promise<number[]> {
  const out = join(dir, `px-${sec}-${fx}-${fy}.rgb`);
  await runFfmpeg(["-ss", String(sec), "-i", video, "-vf", `crop=8:8:iw*${fx}:ih*${fy},scale=1:1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", out]);
  return [...(await readFile(out))];
}

/** A red speaker clip and a matte that keeps its left half. */
async function inputs(dir: string) {
  await runFfmpeg(["-f", "lavfi", "-i", `color=c=red:s=${S}:r=30:d=2`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", join(dir, "speaker.mp4")]);
  await runFfmpeg(["-f", "lavfi", "-i", `color=c=black:s=${S}:r=30:d=2`, "-vf", "format=gray,geq=lum='if(lt(X,W/2),255,0)',format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", join(dir, "matte.mp4")]);
  await makeTestImage(join(dir, "blue.png"), { width: 600, height: 1000, color: "blue" });
  await makeTestImage(join(dir, "green.png"), { width: 600, height: 1000, color: "green" });
}

describe("compositeSpeakerPlate", () => {
  it("keeps the speaker where the matte is white and shows the dimmed backdrop elsewhere, frame-aligned with the speaker clip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plate-"));
    await inputs(dir);
    await compositeSpeakerPlate({ video: join(dir, "speaker.mp4"), matte: join(dir, "matte.mp4"), backgrounds: [{ image: join(dir, "blue.png"), fromMs: 0 }], out: join(dir, "plate.mp4"), look: LOOK, tmpDir: join(dir, "t") });
    const info = await probe(join(dir, "plate.mp4"));
    const src = await probe(join(dir, "speaker.mp4"));
    expect(info.video).toMatchObject({ width: 216, height: 384 });
    expect(info.video!.fps).toBeCloseTo(30, 3);
    expect(Math.abs(info.video!.durationSec - src.video!.durationSec)).toBeLessThan(0.04);
    expect(info.audio).toBeUndefined();
    const [r1, g1, b1] = await rgbAt(join(dir, "plate.mp4"), dir, 1, 0.1, 0.5);
    expect(r1).toBeGreaterThan(200);
    expect(b1).toBeLessThan(60);
    expect(g1).toBeLessThan(60);
    const [r2, , b2] = await rgbAt(join(dir, "plate.mp4"), dir, 1, 0.85, 0.5);
    expect(b2).toBeGreaterThan(150);
    expect(b2).toBeLessThan(235); // dimmed
    expect(r2).toBeLessThan(60);
  }, 120_000);

  it("switches to the next section's backdrop at its start (source time)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plate2-"));
    await inputs(dir);
    await compositeSpeakerPlate({
      video: join(dir, "speaker.mp4"), matte: join(dir, "matte.mp4"), out: join(dir, "plate.mp4"), look: LOOK, tmpDir: join(dir, "t"),
      backgrounds: [{ image: join(dir, "blue.png"), fromMs: 0 }, { image: join(dir, "green.png"), fromMs: 1000 }],
    });
    const before = await rgbAt(join(dir, "plate.mp4"), dir, 0.5, 0.85, 0.5);
    const after = await rgbAt(join(dir, "plate.mp4"), dir, 1.5, 0.85, 0.5);
    expect(before[2]).toBeGreaterThan(before[1]);
    expect(after[1]).toBeGreaterThan(after[2]);
  }, 120_000);

  it("refuses an empty background list", async () => {
    await expect(compositeSpeakerPlate({ video: "v", matte: "m", backgrounds: [], out: "o", look: LOOK, tmpDir: tmpdir() })).rejects.toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run packages/media/src/plate.test.ts`.

  Expected: FAIL (`./plate` does not exist).

- [ ] **Step 3: Write `packages/media/src/plate.ts`.**
```ts
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { probe } from "./probe";
import { runFfmpeg } from "./run";

/** The backdrop look (EditStyle["background"], kept structural so @reel/media doesn't depend on @reel/core). */
export type BackdropLook = { zoom: number; driftPct: number; driftPeriodSec: number; blurSigma: number; dim: number; saturation: number; featherPx: number };

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
  const py = (look.driftPeriodSec * 1.6).toFixed(2);
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
```
In `packages/media/src/index.ts`, add `export * from "./plate";`.

- [ ] **Step 4: Run the tests.** Run `npx vitest run packages/media/src/plate.test.ts`.

  Expected: PASS.

- [ ] **Step 5: Run everything.** Run `npm test && npm run typecheck`.

  Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/media/src/plate.ts packages/media/src/plate.test.ts packages/media/src/index.ts
git commit -m "feat(media): speaker plate: the cut-out speaker over a blurred, dimmed, slowly drifting backdrop, frame-aligned with the working copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ingest makes the cut-out (free); missing or bad cut-outs become plan warnings; the worker wires it

**Files:**
- Create: `packages/engine/src/segmenter.ts`, `packages/engine/src/segmenter.test.ts`
- Modify:
  - `packages/engine/src/footage-ingest.ts`
  - `packages/engine/src/index.ts`
  - `packages/core/src/events.ts`
  - `packages/db/src/index.ts`
  - `apps/worker/src/main.ts`
  - `apps/worker/src/handlers/index.ts`
  - `apps/worker/src/handlers/footage.ts`
- Test:
  - `packages/engine/src/footage-ingest.test.ts`
  - `packages/db/src/index.test.ts`
  - `apps/worker/src/handlers/index.test.ts`
  - `apps/worker/src/handlers/footage.test.ts`

**Interfaces:**
- Consumes: `makeMatte`, `makeEllipseMatte`, `matteCoverage`, `segmentHelperAvailable`, `MATTE_REFINE` (Task 1), and `FootageSource.matteAssetId` (Task 2).
- Produces:
  - `type Segmenter = { readonly model: string; matte(videoPath: string, faceTrackPath: string, out: string): Promise<void> }`
  - `visionSegmenter(): Segmenter`, with model `"vision/person-segmentation-accurate-v1"`
  - `fakeSegmenter: Segmenter`, with model `"fake/matte-ellipse"`
  - `createSegmenter(mode: "real" | "fake", helperAvailable?: boolean): Segmenter`
  - `class SegmenterMissingError`
  - `MIN_MATTE_COVERAGE = 0.03`
  - `cutoutProblem(coverage: number, matteMs: number, videoMs: number): string | null`
  - `IngestDeps.segmenter?: Segmenter`. Absent means no cut-out step and no warning; tests and old callers use this.
  - `footageHashes.matte(model, workingHash, facesHash)`
  - `PipelineStep` gains `"cutout" | "background"`; `JobProgressSchema` accepts both.
  - Worker: `BuildHandlersDeps.segmenter: Segmenter` (required) and `FootageHandlerDeps.segmenter?: Segmenter`.

- [ ] **Step 1: Write the failing tests.** Create `packages/engine/src/segmenter.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createSegmenter, cutoutProblem, fakeSegmenter, SegmenterMissingError } from "./segmenter";

describe("segmenter", () => {
  it("uses Apple Vision when the helper is built, the fake ellipse on a fake worker without it, and a plain error on a real one", async () => {
    expect(createSegmenter("real", true).model).toBe("vision/person-segmentation-accurate-v1");
    expect(createSegmenter("fake", false)).toBe(fakeSegmenter);
    const missing = createSegmenter("real", false);
    expect(missing.model).toBe("vision/person-segmentation-accurate-v1");
    await expect(missing.matte("v", "f", "o")).rejects.toThrow(SegmenterMissingError);
    await expect(missing.matte("v", "f", "o")).rejects.toThrow('the cut-out tool isn\'t built on this worker. Run "npm run build:segment-helper" on the worker Mac, then upload the video again');
  });
  it("refuses a matte that covers almost nothing or doesn't match the video's length", () => {
    expect(cutoutProblem(0.25, 6000, 6033)).toBeNull();
    expect(cutoutProblem(0.02, 6000, 6000)).toBe("the cut-out couldn't find you in the picture");
    expect(cutoutProblem(0.25, 5000, 6000)).toBe("the cut-out doesn't match the video's length");
  });
});
```
In `packages/engine/src/footage-ingest.test.ts`:
- add `import { createSegmenter, fakeSegmenter, type Segmenter } from "./segmenter";`
- add `matteCoverage` to the `@reel/media` import
- append:
```ts
describe("ingestFootage: the cut-out (plan 3)", () => {
  const counting = (inner: Segmenter) => {
    const calls: string[] = [];
    return { calls, segmenter: { model: inner.model, matte: async (v: string, f: string, o: string) => { calls.push(v); await inner.matte(v, f, o); } } };
  };

  it("cuts the speaker out after transcribing: a matte the size and length of the working copy, cached, with its steps", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    const spy = counting(fakeSegmenter);
    const steps: string[] = [];
    const run = () => ingestFootage(join(dir, "v.mp4"), { ...deps, segmenter: spy.segmenter, onEvent: (e) => e.type === "step" && steps.push(`${e.step}:${e.status}`) });
    const { source, warnings } = await run();
    expect(warnings).toEqual([]);
    const matte = await deps.store.get(source.matteAssetId!);
    const info = await probe(matte!.path);
    expect(info.video).toMatchObject({ width: 1080, height: 1920 });
    expect(Math.abs(info.video!.durationSec * 1000 - source.durationMs)).toBeLessThan(100);
    expect(await matteCoverage(matte!.path)).toBeGreaterThan(0.15);
    expect(matte!.meta).toMatchObject({ kind: "video", model: "fake/matte-ellipse" });
    expect(steps).toEqual(["conform:running", "conform:done", "faces:running", "faces:done", "transcribe:running", "transcribe:done", "cutout:running", "cutout:done"]);
    expect((await probe(spy.calls[0])).video).toMatchObject({ width: 1080, height: 1920 });
    await run();
    expect(spy.calls).toHaveLength(1);
  }, 300_000);

  it("turns a missing helper into a plan warning, never a failure, and leaves the video without a cut-out", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    const { source, warnings } = await ingestFootage(join(dir, "v.mp4"), { ...deps, segmenter: createSegmenter("real", false) });
    expect(source.matteAssetId).toBeUndefined();
    expect(warnings).toEqual(['Background replacement is off for this video: the cut-out tool isn\'t built on this worker. Run "npm run build:segment-helper" on the worker Mac, then upload the video again.']);
  }, 300_000);

  it.each([
    ["finds nobody", "color=c=black:s=1080x1920:r=30:d=2", "the cut-out couldn't find you in the picture"],
    ["is too short", "color=c=white:s=1080x1920:r=30:d=1", "the cut-out doesn't match the video's length"],
  ])("warns when the cut-out %s", async (_name, lavfi, reason) => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    const bad: Segmenter = { model: `fake/bad-${reason.length}`, matte: async (_v, _f, out) => { await runFfmpeg(["-f", "lavfi", "-i", lavfi, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", out]); } };
    const { source, warnings } = await ingestFootage(join(dir, "v.mp4"), { ...deps, segmenter: bad });
    expect(source.matteAssetId).toBeUndefined();
    expect(warnings).toEqual([`Background replacement is off for this video: ${reason}.`]);
  }, 300_000);

  it("reports a failing helper as a warning with its first line", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    const broken: Segmenter = { model: "fake/broken", matte: async () => { throw new Error("Vision gave up\nstack…"); } };
    expect((await ingestFootage(join(dir, "v.mp4"), { ...deps, segmenter: broken })).warnings).toEqual(["Background replacement is off for this video: cutting you out failed (Vision gave up)."]);
  }, 300_000);

  it("never cuts out a video without speech (it fails first)", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    const spy = counting(fakeSegmenter);
    const quiet = { model: "fake/quiet", transcribe: async () => ({ transcript: { languageCode: "heb", languageProbability: 0.5, words: [{ text: "אה", startMs: 0, endMs: 300 }], events: [] } }) };
    await expect(ingestFootage(join(dir, "v.mp4"), { ...deps, transcriber: quiet, segmenter: spy.segmenter })).rejects.toThrow(/No speech found/);
    expect(spy.calls).toEqual([]);
  }, 300_000);
});
```
In `packages/db/src/index.test.ts`, inside `"accepts footage steps and appends notes"`, add:
```ts
    expect(JobProgressSchema.parse({ steps: { cutout: "done", background: "running" } }).steps).toEqual({ cutout: "done", background: "running" });
```
In `apps/worker/src/handlers/index.test.ts`:
- change the engine import to add `fakeSegmenter`
- add `segmenter: fakeSegmenter,` after `faceTracker: noFaceTracker,` in the `buildHandlers` call

In `apps/worker/src/handlers/footage.test.ts`:
- add `fakeSegmenter` to the `@reel/engine` import
- append inside the first `describe` that uses `setup()` (the one with `"passes transcript warnings…"`):
```ts
  it("cuts the speaker out at ingest when the worker has a segmenter, and reports the step", async () => {
    const s = await setup();
    const reports: JobProgress[] = [];
    await createIngestFootageHandler({ ...s.deps, segmenter: fakeSegmenter })(ingestJob(), { report: (p) => reports.push(p), log: () => {} });
    expect((s.db.storyboards[0].json as EditPlan).source.matteAssetId).toMatch(/^[0-9a-f]{64}$/);
    expect(reports.at(-1)?.steps).toMatchObject({ cutout: "done", plan: "done" });
  }, 300_000);
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run packages/engine/src/segmenter.test.ts packages/engine/src/footage-ingest.test.ts packages/db apps/worker/src/handlers`.

  Expected: FAIL (`./segmenter` is missing, `cutout` is not a step, `segmenter` is unknown).

- [ ] **Step 3: Progress steps.**
  - In `packages/core/src/events.ts`, change `PipelineStep` to `"voice" | "visuals" | "render" | "export" | "conform" | "transcribe" | "faces" | "plan" | "music" | "cutout" | "background"`.
  - In `packages/db/src/index.ts`, add `"cutout", "background"` to the end of the `JobProgressSchema.steps` enum list.

- [ ] **Step 4: The segmenter.** Create `packages/engine/src/segmenter.ts`:
```ts
import { makeEllipseMatte, makeMatte, segmentHelperAvailable } from "@reel/media";

/** Makes the speaker's matte from the working copy. `model` is part of the matte cache key (fake and real never mix). */
export type Segmenter = { readonly model: string; matte(videoPath: string, faceTrackPath: string, out: string): Promise<void> };
const VISION = "vision/person-segmentation-accurate-v1";

/** Mean coverage below this means Vision found nobody, or almost nobody (spec §7: segmentation fails). */
export const MIN_MATTE_COVERAGE = 0.03;
const LENGTH_TOLERANCE_MS = 100;

export class SegmenterMissingError extends Error {
  constructor() {
    super('the cut-out tool isn\'t built on this worker. Run "npm run build:segment-helper" on the worker Mac, then upload the video again');
    this.name = "SegmenterMissingError";
  }
}

export const visionSegmenter = (): Segmenter => ({ model: VISION, matte: (video, faces, out) => makeMatte(video, out, { faces }) });

/** Fake worker without the Swift binary: a still head-and-shoulders shape, so the whole background flow is free to try. */
export const fakeSegmenter: Segmenter = { model: "fake/matte-ellipse", matte: (video, _faces, out) => makeEllipseMatte(video, out) };

export function createSegmenter(mode: "real" | "fake", helperAvailable = segmentHelperAvailable()): Segmenter {
  if (helperAvailable) return visionSegmenter();
  if (mode === "fake") return fakeSegmenter;
  return { model: VISION, matte: async () => { throw new SegmenterMissingError(); } };
}

/** Why a made matte can't be used (completing "Background replacement is off for this video: …"), or null. */
export function cutoutProblem(coverage: number, matteMs: number, videoMs: number): string | null {
  if (Math.abs(matteMs - videoMs) > LENGTH_TOLERANCE_MS) return "the cut-out doesn't match the video's length";
  if (coverage < MIN_MATTE_COVERAGE) return "the cut-out couldn't find you in the picture";
  return null;
}
```
In `packages/engine/src/index.ts`, add `export * from "./segmenter";`.

- [ ] **Step 5: Ingest.** In `packages/engine/src/footage-ingest.ts`:

  1. Change the media import to `import { conformClip, conformPhoto, conformVideo, extractAudio, MATTE_REFINE, matteCoverage, probe, sha256File } from "@reel/media";`.
  2. Add `import { cutoutProblem, SegmenterMissingError, type Segmenter } from "./segmenter";`.
  3. Add to `footageHashes`:
```ts
  matte: (model: string, workingHash: string, facesHash: string) => inputHash({ step: "matte", v: 1, model, workingHash, facesHash, refine: MATTE_REFINE }),
```
  4. Change `IngestDeps` to:
```ts
export type IngestDeps = {
  store: AssetStore; transcriber: Transcriber; faceTracker: FaceTracker; tmpDir: string; log: (m: string) => void; onEvent?: (e: PipelineEvent) => void;
  /** Plan 3: the speaker's matte. Absent: no cut-out step (the reel keeps its real background), no warning. */
  segmenter?: Segmenter;
};
```
  5. Replace the end of `ingestFootage`, from `emit({ type: "step", step: "transcribe", status: "done" });` to the `return`, with:
```ts
  emit({ type: "step", step: "transcribe", status: "done" });
  // After transcription, so a video without speech fails before minutes of (free) segmentation.
  const cutout = deps.segmenter ? await cutOut(deps.segmenter, working, faces, durationMs, deps) : { warnings: [] as string[] };
  // After transcription: extras are free, and an upload without speech should fail before any work on them.
  const { extras, warnings } = await ingestExtras(extraFiles, deps);
  return {
    source: {
      assetId: working.hash, durationMs, transcriptAssetId: transcriptAsset.hash, faceTrackAssetId: faces.hash,
      ...(cutout.matteAssetId ? { matteAssetId: cutout.matteAssetId } : {}),
      extras,
    },
    transcript,
    warnings: [...cutout.warnings, ...warnings],
  };
}

const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0];

/**
 * Spec §4.2 step 6 (plan 3): the speaker's matte, made once per working copy and face track. It never fails ingest: a
 * problem becomes a plan warning, and the reel keeps its real background.
 */
async function cutOut(segmenter: Segmenter, working: StoredAsset, faces: StoredAsset, durationMs: number, deps: IngestDeps): Promise<{ matteAssetId?: string; warnings: string[] }> {
  const emit = (e: PipelineEvent) => deps.onEvent?.(e);
  const off = (reason: string) => ({ warnings: [`Background replacement is off for this video: ${reason}.`] });
  emit({ type: "step", step: "cutout", status: "running" });
  try {
    // Not `reproducible`: generation never re-makes a matte, so a failed mirror becomes this warning instead of a matte on one machine only.
    const matte = await cached(deps.store, footageHashes.matte(segmenter.model, working.hash, faces.hash), async () => {
      deps.log("ingest: cutting you out (about 3 minutes per minute of video)");
      const out = join(deps.tmpDir, "matte.mp4");
      await segmenter.matte(working.path, faces.path, out);
      return { path: out, ext: "mp4", meta: { kind: "video", provider: segmenter.model.split("/")[0], model: segmenter.model } };
    });
    const info = await probe(matte.path);
    const problem = cutoutProblem(await matteCoverage(matte.path), Math.round((info.video?.durationSec ?? 0) * 1000), durationMs);
    return problem ? off(problem) : { matteAssetId: matte.hash, warnings: [] };
  } catch (err) {
    deps.log(`ingest: the cut-out failed: ${firstLine(err)}`);
    return off(err instanceof SegmenterMissingError ? err.message : `cutting you out failed (${firstLine(err)})`);
  } finally {
    emit({ type: "step", step: "cutout", status: "done" });
  }
}
```
  The old `const { extras, warnings } = …` line and old `return` must be gone. Keep `ingestExtras` and everything below it unchanged.

- [ ] **Step 6: Worker wiring.**
  - In `apps/worker/src/handlers/footage.ts`:
    - add `type Segmenter` to the `@reel/engine` import
    - change `FootageHandlerDeps` to `export type FootageHandlerDeps = { store: AssetStore; blobs: BlobStore; db: ReelDb; transcriber: Transcriber; faceTracker: FaceTracker; footagePlanner: FootagePlanner; segmenter?: Segmenter };`
    - in the `ingestFootage(…)` call, add `segmenter: deps.segmenter,` after `faceTracker: deps.faceTracker,`
  - In `apps/worker/src/handlers/index.ts`:
    - add `segmenter: NonNullable<FootageHandlerDeps["segmenter"]>;` with the comment `/** Plan 3 cut-out at ingest: Apple Vision, or the fake ellipse on a fake worker without the helper. */` after `footagePlanner` in `BuildHandlersDeps`
    - add `segmenter: deps.segmenter,` to the `footage` object
  - In `apps/worker/src/main.ts`:
    - add `createSegmenter` to the `@reel/engine` import
    - add `segmenter: createSegmenter(fake ? "fake" : "real"),` after `faceTracker: …` in `buildHandlers({…})`

- [ ] **Step 7: Run the tests.** Run `npx vitest run packages/engine/src/segmenter.test.ts packages/engine/src/footage-ingest.test.ts packages/db apps/worker/src/handlers`.

  Expected: PASS.

- [ ] **Step 8: Run everything.** Run `npm test && npm run typecheck`.

  Expected: PASS.

- [ ] **Step 9: Commit.**
```bash
git add packages/engine/src/segmenter.ts packages/engine/src/segmenter.test.ts packages/engine/src/footage-ingest.ts packages/engine/src/footage-ingest.test.ts packages/engine/src/index.ts packages/core/src/events.ts packages/db/src/index.ts packages/db/src/index.test.ts apps/worker/src/main.ts apps/worker/src/handlers/index.ts apps/worker/src/handlers/index.test.ts apps/worker/src/handlers/footage.ts apps/worker/src/handlers/footage.test.ts
git commit -m "feat(engine): cut the speaker out at ingest (Apple Vision, or a fake ellipse); a missing or bad cut-out is a plan warning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Claude proposes the scene; code keeps the real background when there is no cut-out

**Files:**
- Modify:
  - `packages/core/src/schema/edit-plan.ts` (`EditPlanDraftSchema`)
  - `packages/engine/src/footage-planner.ts`
  - `packages/engine/src/providers/fake.ts`
- Test: `packages/core/src/schema/edit-plan.test.ts`, `packages/engine/src/footage-planner.test.ts`

**Interfaces:**
- Consumes: `FootageSource.matteAssetId`, `BackgroundSchema` and `backgroundCost` (Task 2, through `withFootageEstimate`).
- Produces:
  - `EditPlanDraft.background: { mode: "original" | "replace"; prompt: string }`
  - `buildEditPlan` emits `{ mode: "replace", sections: [{ fromBeatId: <first beat>, source: { kind: "ai", prompt } }] }` only when the source has a cut-out and the prompt is non-empty.
  - The fake planner plans `replace` with `"a bright modern studio with plants and soft daylight"` whenever the source has a cut-out.

- [ ] **Step 1: Write the failing tests.**

  In `packages/core/src/schema/edit-plan.test.ts`, replace the test `"offers cutaways and the B-roll break but never background replacement"` with:
```ts
  it("offers cutaways, the B-roll break and a background choice (never brand backdrops)", () => {
    const json = JSON.stringify(EditPlanDraftSchema.toJSONSchema());
    expect(json).toMatch(/cutaway/);
    expect(json).toMatch(/broll/);
    expect(json).toMatch(/"background"/);
    expect(json).toMatch(/"replace"/);
    expect(json).not.toMatch(/brand/);
  });
```

  In `packages/engine/src/footage-planner.test.ts`:
  - change the fixtures import to add `MATTE_HASH`
  - add `import { tmpdir } from "node:os";` and `import { createFakeProviders } from "./providers/fake";`
  - in `draft()`, add `background: { mode: "original", prompt: "" },` before `...over`
  - replace both lines `expect(u).toContain("Background replacement is not available in this version: never mention it.");` and `expect(user).toContain("Background replacement is not available in this version: never mention it.");` with:
```ts
    expect(u).toContain('Background: keep "original" (this video has no cut-out of the speaker).');
```
    (use `user` in place of `u` in the second test)
  - append:
```ts
describe("background from Claude's draft (plan 3)", () => {
  const beats = splitBeats(REQ.transcript.words);
  const CUT: FootagePlanRequest = { ...REQ, source: { ...REQ.source, matteAssetId: MATTE_HASH } };
  const scene = { mode: "replace" as const, prompt: " a bright home office with plants " };
  it("puts one AI scene behind the speaker from the first beat, priced at $0.04", () => {
    const plan = buildEditPlan(draft({ background: scene }), CUT, beats, style);
    expect(plan.background).toEqual({ mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "a bright home office with plants" } }] });
    expect(plan.estimate.credits).toBe(0.04);
    expect(plan.warnings).toEqual([]);
  });
  it("keeps the real background without a cut-out (no warning: ingest already said why), and warns about an empty scene", () => {
    expect(buildEditPlan(draft({ background: scene }), REQ, beats, style).background).toEqual({ mode: "original" });
    expect(buildEditPlan(draft({ background: scene }), REQ, beats, style).warnings).toEqual([]);
    const empty = buildEditPlan(draft({ background: { mode: "replace", prompt: "  " } }), CUT, beats, style);
    expect(empty.background).toEqual({ mode: "original" });
    expect(empty.warnings).toEqual(["The AI background had no scene description, so the reel keeps your real background."]);
  });
  it("tells Claude whether the speaker is cut out, what a good scene is, and to keep the choice on a re-plan", () => {
    expect(footageUserPrompt(CUT, beats)).toContain('Background: the speaker is cut out, so you can put an AI scene behind them (background "replace" with a prompt) or keep their real background ("original").');
    expect(footageUserPrompt(REQ, beats)).toContain('Background: keep "original" (this video has no cut-out of the speaker).');
    expect(footageSystemPrompt()).toContain("one English sentence describing an empty place");
    expect(footageSystemPrompt()).toContain("On a re-plan, keep the previous background unless the user's change asks otherwise.");
    const previous = buildEditPlan(draft({ background: scene }), CUT, beats, style);
    expect(footageUserPrompt({ ...CUT, previous, instruction: "shorter" }, beats)).toContain('Background: AI scene "a bright home office with plants".');
  });
  it("the fake planner proposes an AI scene when the video has a cut-out, and the original background otherwise", async () => {
    const fake = createFakeProviders({ workDir: tmpdir() }).footagePlanner;
    expect((await fake.plan(CUT)).background).toEqual({ mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "a bright modern studio with plants and soft daylight" } }] });
    expect((await fake.plan(REQ)).background).toEqual({ mode: "original" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run packages/core/src/schema/edit-plan.test.ts packages/engine/src/footage-planner.test.ts`.

  Expected: FAIL (the draft has no `background`, and the old prompt line is still there).

- [ ] **Step 3: Draft field.** In `packages/core/src/schema/edit-plan.ts`:
  - in `EditPlanDraftSchema`, add after `music: …`: `background: z.object({ mode: z.enum(["original", "replace"]), prompt: z.string() }),`
  - extend its doc comment with: `background.prompt is the AI scene for "replace" ("" for "original"); code keeps "original" when the video has no cut-out.`

- [ ] **Step 4: Planner.** In `packages/engine/src/footage-planner.ts`:

  1. In `footageSystemPrompt()`, add after the `'- sfx: …'` line:
```ts
    '- background: "replace" when the user prompt says the speaker is cut out: they then stand in front of one AI-generated scene that fits the topic, softly blurred behind them for the whole reel. prompt: one English sentence describing an empty place with depth (setting, light, mood), e.g. "a bright minimalist home office with plants and a large window, morning light"; never people, text, screens with words or logos. Use "original" (prompt empty) when the real setting is part of the message (the speaker shows a product, a place or a person around them), when the user\'s notes ask for it, or when no cut-out is available. On a re-plan, keep the previous background unless the user\'s change asks otherwise.',
```
  2. Add, after `uploadLines`:
```ts
function backgroundLine(req: FootagePlanRequest): string {
  return req.source.matteAssetId
    ? 'Background: the speaker is cut out, so you can put an AI scene behind them (background "replace" with a prompt) or keep their real background ("original").'
    : 'Background: keep "original" (this video has no cut-out of the speaker).';
}

const describeBackground = (b: EditPlan["background"]) =>
  b.mode === "replace" && b.sections[0]?.source.kind === "ai" ? `AI scene "${b.sections[0].source.prompt}"` : "original";
```
  3. In `footageUserPrompt`, replace the line `"Background replacement is not available in this version: never mention it.",` with `backgroundLine(req),`.
  4. In the `if (req.previous)` block, change the pushed line to:
```ts
    lines.push("", `Your previous plan: kept ${kept}; dropped ${dropped}. Hook: ${p.hook.reason || p.hook.patternBreak}. Background: ${describeBackground(p.background)}.`);
```
  5. In `buildEditPlan`, before `const plan = {`, add:
```ts
  // Code owns whether a scene is possible: without a cut-out the reel keeps its real background (ingest already warned why).
  const scene = draft.background.prompt.trim().slice(0, 1500);
  const wantsScene = draft.background.mode === "replace" && !!req.source.matteAssetId;
  const background = wantsScene && scene
    ? { mode: "replace", sections: [{ fromBeatId: beats[0].id, source: { kind: "ai", prompt: scene } }] }
    : { mode: "original" };
  const backgroundWarnings = wantsScene && !scene ? ["The AI background had no scene description, so the reel keeps your real background."] : [];
```
     Then:
     - replace `background: { mode: "original" },` with `background,`
     - append `...backgroundWarnings,` at the end of the `warnings` array (after the `brollLost` entry)

- [ ] **Step 5: Fake planner.** In `packages/engine/src/providers/fake.ts`, in the `footagePlanner` draft, add after `sfx: "subtle",`:
```ts
        // Plan 3: the user prompt says when the speaker is cut out; then the fake planner picks a scene (a flat fake still at generation).
        background: /background "replace"/.test(user) ? { mode: "replace", prompt: "a bright modern studio with plants and soft daylight" } : { mode: "original", prompt: "" },
```

- [ ] **Step 6: Run the tests.** Run `npx vitest run packages/core/src/schema/edit-plan.test.ts packages/engine/src/footage-planner.test.ts`.

  Expected: PASS.

- [ ] **Step 7: Run everything.** Run `npm test && npm run typecheck`.

  Expected: PASS. The worker and generation tests ingest without a segmenter, so their plans keep the original background.

- [ ] **Step 8: Commit.**
```bash
git add packages/core/src/schema/edit-plan.ts packages/core/src/schema/edit-plan.test.ts packages/engine/src/footage-planner.ts packages/engine/src/footage-planner.test.ts packages/engine/src/providers/fake.ts
git commit -m "feat(engine): Claude proposes an AI scene behind the cut-out speaker; the real background without a cut-out

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Generation pays for one still within the estimate, composites the plate, and every speaker clip uses it

**Files:**
- Create: `packages/engine/src/footage-background.ts`, `packages/engine/src/footage-background.test.ts`
- Modify:
  - `packages/engine/src/footage-generate.ts`
  - `packages/engine/src/footage-ingest.ts` (two cache keys)
  - `packages/engine/src/index.ts`
- Test: `packages/engine/src/footage-background.test.ts`

**Interfaces:**
- Consumes:
  - `backgroundStarts`, `backgroundCost`, `musicCost`, `EditStyle.background` (Task 2)
  - `compositeSpeakerPlate` (Task 3)
  - `fakeSegmenter` (Task 4), and the fake planner's scene (Task 5)
  - `takeBudget`, `SpendBudget`, `cached`, `estUsd`, `downloadTo`, `extFromUrl` (existing)
- Produces:
  - `backgroundPrompt(prompt: string): string`
  - `makeSpeakerPlate(plan: EditPlan, inputs: FootageInputs, deps: BackgroundDeps): Promise<{ plate?: StoredAsset; notes: string[] }>`
  - `type BackgroundDeps = { image: ImageGen; store: AssetStore; tmpDir: string; log: (m: string) => void; budget: SpendBudget; style: EditStyle }`
  - `footageHashes.background(model, prompt)` and `footageHashes.plate(workingHash, matteHash, backgrounds, look)`
  - `FootageGenerated.plate?: StoredAsset`. When it is set, `buildFootageTimeline` uses the plate as every speaker clip's `videoSrc`.

- [ ] **Step 1: Write the failing tests.** Create `packages/engine/src/footage-background.test.ts`:
```ts
import { parseEditPlan, SFX_NAMES, withFootageEstimate, type EditPlan } from "@reel/core";
import { makeSfxPlaceholders, makeTestVideo, prepareBackdrop, probe, runFfmpeg } from "@reel/media";
import { houseStyle } from "@reel/video/house-style";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAssetStore } from "./asset-store";
import { noFaceTracker } from "./face-tracker";
import { backgroundPrompt } from "./footage-background";
import { buildFootageTimeline, generateFootageAssets, renderFootage } from "./footage-generate";
import { footageHashes, ingestFootage, loadFootageInputs } from "./footage-ingest";
import { createFakeProviders } from "./providers/fake";
import { fakeSegmenter } from "./segmenter";

const style = houseStyle.edit;
const KEEP = "so the reel uses your real background";

/** A 6 s upload ingested with the fake cut-out and planned by the fake planner: an AI scene, plus a split diagram on b1. */
async function prepared(music: EditPlan["music"] = { kind: "none" }) {
  const dir = await mkdtemp(join(tmpdir(), "footage-bg-"));
  const providers = createFakeProviders({ workDir: dir });
  const store = new FileAssetStore(join(dir, "cache"));
  await makeTestVideo(join(dir, "up.mp4"), { durationSec: 6, width: 720, height: 1280, withAudio: true });
  const { source, transcript } = await ingestFootage(join(dir, "up.mp4"), { store, transcriber: providers.transcriber, faceTracker: noFaceTracker, segmenter: fakeSegmenter, tmpDir: join(dir, "t"), log: () => {} });
  const planned = await providers.footagePlanner.plan({ settings: { language: "he", targetDurationSec: 15, ctaKeyword: "AI" }, source, transcript, library: [], warnings: [] });
  const plan = withFootageEstimate(parseEditPlan({ ...planned, music }), transcript.words, style);
  await makeSfxPlaceholders(join(dir, "sfx"), SFX_NAMES);
  const deps = { music: providers.music, image: providers.image, video: providers.video, uploader: providers.uploader, character: null, store, tmpDir: join(dir, "g"), log: () => {}, library: async () => null, sfxDir: join(dir, "sfx"), style };
  return { dir, providers, plan, deps, store };
}

async function rgbAt(video: string, dir: string, sec: number, fx: number, fy: number): Promise<number[]> {
  const out = join(dir, `px-${sec}-${fx}-${fy}-${Math.random().toString(36).slice(2)}.rgb`);
  await runFfmpeg(["-ss", String(sec), "-i", video, "-vf", `crop=8:8:iw*${fx}:ih*${fy},scale=1:1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", out]);
  return [...(await readFile(out))];
}
const dist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);

describe("background replacement at generation (fake still, fake cut-out, real ffmpeg + Remotion)", () => {
  it("makes one AI still, a plate frame-aligned with the working copy, and every speaker clip (split pieces too) shows it", async () => {
    const { dir, providers, plan, deps, store } = await prepared();
    expect(plan.background.mode).toBe("replace");
    expect(plan.estimate.credits).toBe(0.04);
    const gen = await generateFootageAssets(plan, deps);
    expect(gen.notes).toEqual([]);
    expect(providers.calls.image).toBe(1);
    const working = (await loadFootageInputs(store, plan.source)).working;
    const [p, w] = [await probe(gen.plate!.path), await probe(working.path)];
    expect(p.video).toMatchObject({ width: 1080, height: 1920 });
    expect(Math.abs(p.video!.durationSec - w.video!.durationSec)).toBeLessThan(0.04);
    // Inside the fake cut-out (shoulders) the plate is the speaker; outside it is the prepared backdrop.
    expect(dist(await rgbAt(gen.plate!.path, dir, 2, 0.5, 0.88), await rgbAt(working.path, dir, 2, 0.5, 0.88))).toBeLessThan(45);
    const still = await store.get(footageHashes.background(providers.image.model, backgroundPrompt("a bright modern studio with plants and soft daylight")));
    await prepareBackdrop(still!.path, join(dir, "backdrop.png"), { width: 1080, height: 1920 }, style.background);
    expect(dist(await rgbAt(gen.plate!.path, dir, 2, 0.03, 0.03), await rgbAt(join(dir, "backdrop.png"), dir, 0, 0.5, 0.5))).toBeLessThan(30);
    const timeline = buildFootageTimeline(plan, gen, (f) => `asset:${f}`, style);
    expect(timeline.clips.some((c) => c.layout === "split")).toBe(true);
    expect(timeline.clips.every((c) => c.src === `asset:${gen.plate!.fileName}`)).toBe(true);
    const out = await renderFootage(plan, gen, deps, join(dir, "out"));
    expect((await probe(out.reel)).video).toMatchObject({ width: 1080, height: 1920 });
    await generateFootageAssets(plan, deps);
    expect(providers.calls.image).toBe(1);
  }, 900_000);

  it("makes AI music and the background when approved at exactly their estimate", async () => {
    const { plan, deps, providers } = await prepared({ kind: "ai", prompt: "calm lo-fi" });
    expect(plan.estimate.credits).toBeGreaterThan(0.04);
    const gen = await generateFootageAssets(plan, deps);
    expect(gen.notes).toEqual([]);
    expect(gen.music).toBeDefined();
    expect(gen.plate).toBeDefined();
    expect([providers.calls.music, providers.calls.image]).toEqual([1, 1]);
  }, 300_000);

  it("skips the still the estimate can't cover, with a note, and never pays for it", async () => {
    const { plan, deps, providers } = await prepared();
    const gen = await generateFootageAssets(parseEditPlan({ ...plan, estimate: { ...plan.estimate, credits: 0 } }), deps);
    expect(gen.plate).toBeUndefined();
    expect(gen.notes).toEqual([`The AI background was skipped: it would cost more than the approved estimate, ${KEEP}. Use Edit as new version and approve again to update it.`]);
    expect(providers.calls.image).toBe(0);
  }, 300_000);

  it("makes one paid attempt: a failed still is a note and the reel renders on the real background", async () => {
    const { dir, plan, deps } = await prepared();
    let calls = 0;
    const broken = { model: "fake/broken", generate: async () => { calls++; throw new Error("blocked by content moderation"); } };
    const gen = await generateFootageAssets(plan, { ...deps, image: broken });
    expect(calls).toBe(1);
    expect(gen.plate).toBeUndefined();
    expect(gen.notes).toEqual([`The AI background failed (blocked by content moderation), ${KEEP}.`]);
    const out = await renderFootage(plan, gen, deps, join(dir, "out"));
    expect(out.timeline.clips.every((c) => c.src!.endsWith(`${plan.source.assetId}.mp4`))).toBe(true);
  }, 900_000);

  it("never pays for a still when the cut-out is missing", async () => {
    const { plan, deps, providers } = await prepared();
    const lost = parseEditPlan({ ...plan, source: { ...plan.source, matteAssetId: "7".repeat(64) } });
    const gen = await generateFootageAssets(lost, deps);
    expect(gen.notes).toEqual([`The cut-out of you is missing, ${KEEP}. Upload the video again to replace the background.`]);
    expect(providers.calls.image).toBe(0);
  }, 300_000);

  it("wraps the scene so the still is an empty place with room for the speaker", () => {
    expect(backgroundPrompt("  a bright home office ")).toBe(
      "a bright home office, an empty place with no people, vertical 9:16 photo, photorealistic, eye-level view, open space in the centre for a person standing in front, soft natural light, shallow depth of field, no text, no captions, no logos, no watermark",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run packages/engine/src/footage-background.test.ts`.

  Expected: FAIL (`./footage-background` does not exist).

- [ ] **Step 3: Cache keys.** In `packages/engine/src/footage-ingest.ts`, add to `footageHashes`:
```ts
  background: (model: string, prompt: string) => inputHash({ step: "background", v: 1, model, prompt }),
  plate: (workingHash: string, matteHash: string, backgrounds: { imageHash: string; fromMs: number }[], look: object) => inputHash({ step: "plate", v: 1, workingHash, matteHash, backgrounds, look }),
```

- [ ] **Step 4: Write `packages/engine/src/footage-background.ts`.**
```ts
import { backgroundCost, backgroundStarts, type EditPlan, type EditStyle } from "@reel/core";
import { compositeSpeakerPlate } from "@reel/media";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AssetStore, StoredAsset } from "./asset-store";
import { downloadTo, extFromUrl } from "./download";
import { takeBudget, type SpendBudget } from "./footage-cutaways";
import { footageHashes, type FootageInputs } from "./footage-ingest";
import { cached, estUsd } from "./pipeline";
import type { ImageGen } from "./providers/types";

export type BackgroundDeps = { image: ImageGen; store: AssetStore; tmpDir: string; log: (m: string) => void; budget: SpendBudget; style: EditStyle };

const KEEP = "so the reel uses your real background";
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The scene the user or Claude described, as an empty place with room for the speaker (spec §12). */
export function backgroundPrompt(prompt: string): string {
  return `${prompt.trim()}, an empty place with no people, vertical 9:16 photo, photorealistic, eye-level view, open space in the centre for a person standing in front, soft natural light, shallow depth of field, no text, no captions, no logos, no watermark`;
}

/**
 * Spec §4.4 step 2. For a "replace" plan: check the cut-out, reserve and make each AI still (one attempt, cached), then
 * composite the speaker plate. Any problem is a note and the reel keeps its real background.
 * - The cut-out is checked before anything is paid.
 * - A still that the approved estimate can't cover is skipped.
 * - A finished still stays cached, so a retry after a compositing failure is free.
 */
export async function makeSpeakerPlate(plan: EditPlan, inputs: FootageInputs, deps: BackgroundDeps): Promise<{ plate?: StoredAsset; notes: string[] }> {
  const bg = plan.background;
  if (bg.mode !== "replace") return { notes: [] };
  const matte = plan.source.matteAssetId ? await deps.store.get(plan.source.matteAssetId) : null;
  if (!matte) return { notes: [`The cut-out of you is missing, ${KEEP}. Upload the video again to replace the background.`] };
  await mkdir(deps.tmpDir, { recursive: true });
  const starts = backgroundStarts(plan, inputs.transcript.words, deps.style.padMs);
  const stills: { image: StoredAsset; fromMs: number }[] = [];
  for (const [i, section] of bg.sections.entries()) {
    const s = section.source;
    if (s.kind !== "ai") return { notes: [`Brand backdrops aren't available yet, ${KEEP}.`] };
    const prompt = backgroundPrompt(s.prompt);
    const hash = footageHashes.background(deps.image.model, prompt);
    const usd = (await deps.store.get(hash)) ? 0 : backgroundCost({ mode: "replace", sections: [section] });
    if (!takeBudget(deps.budget, usd)) {
      return { notes: [`The AI background was skipped: it would cost more than the approved estimate, ${KEEP}. Use Edit as new version and approve again to update it.`] };
    }
    try {
      const image = await cached(deps.store, hash, async () => {
        deps.log("background: generating the AI scene");
        const res = await deps.image.generate({ prompt, resumeKey: hash });
        const ext = extFromUrl(res.url, "png");
        const file = join(deps.tmpDir, `scene-${i + 1}.${ext}`);
        await downloadTo(res.url, file);
        return { path: file, ext, meta: { kind: "image", provider: deps.image.model.split("/")[0], model: deps.image.model, requestId: res.requestId, estUsd: estUsd(deps.image.model, "perImage", 1) } };
      });
      stills.push({ image, fromMs: starts[i] ?? 0 });
    } catch (err) {
      return { notes: [`The AI background failed (${message(err)}), ${KEEP}.`] };
    }
  }
  try {
    const key = footageHashes.plate(inputs.working.hash, matte.hash, stills.map((s) => ({ imageHash: s.image.hash, fromMs: s.fromMs })), deps.style.background);
    const plate = await cached(deps.store, key, async () => {
      deps.log("background: compositing you over the scene");
      const out = join(deps.tmpDir, "plate.mp4");
      await compositeSpeakerPlate({
        video: inputs.working.path, matte: matte.path, out, look: deps.style.background, tmpDir: join(deps.tmpDir, "backdrops"),
        backgrounds: stills.map((s) => ({ image: s.image.path, fromMs: s.fromMs })),
      });
      return { path: out, ext: "mp4", meta: { kind: "video", provider: "ffmpeg", reproducible: true } };
    });
    return { plate, notes: [] };
  } catch (err) {
    return { notes: [`Your background couldn't be replaced (${message(err).split("\n")[0]}), ${KEEP}.`] };
  }
}
```
In `packages/engine/src/index.ts`, add `export * from "./footage-background";`.

- [ ] **Step 5: Generation uses it.** In `packages/engine/src/footage-generate.ts`:
  1. In the `@reel/core` import, replace `estimateFootageCost` with `musicCost`.
  2. Add `import { makeSpeakerPlate } from "./footage-background";`.
  3. Change `FootageGenerated` to:
```ts
export type FootageGenerated = {
  inputs: FootageInputs; voice: StoredAsset; music?: StoredAsset; sfx: Partial<Record<SfxName, StoredAsset>>; cutaways: CutawayAssets; notes: string[];
  /** Plan 3: the speaker over the AI scene; every speaker clip plays it instead of the working copy. Absent: the real background. */
  plate?: StoredAsset;
};
```
  4. In the AI-music branch, change `if (!takeBudget(budget, estimateFootageCost(plan, billSec))) {` to `if (!takeBudget(budget, musicCost(plan, billSec))) {`. The estimate now also holds the background, so music reserves only its own price.
  5. After `emit({ type: "step", step: "music", status: "done" });`, add:
```ts
  emit({ type: "step", step: "background", status: "running" });
  const background = await makeSpeakerPlate(plan, inputs, { image: deps.image, store, tmpDir: join(deps.tmpDir, "background"), log, budget, style: deps.style });
  notes.push(...background.notes);
  emit({ type: "step", step: "background", status: "done" });
```
  6. Change the final `return` of `generateFootageAssets` to `return { inputs, voice, music, sfx, cutaways: cut.assets, notes, ...(background.plate ? { plate: background.plate } : {}) };`.
  7. In `buildFootageTimeline`, change `videoSrc: urlFor(gen.inputs.working.fileName),` to `videoSrc: urlFor((gen.plate ?? gen.inputs.working).fileName),`.

- [ ] **Step 6: Run the tests.** Run `npx vitest run packages/engine/src/footage-background.test.ts packages/engine/src/footage-generate.test.ts`.

  Expected: PASS. The old generation tests still pass: they ingest without a segmenter, so their plans keep the original background.

- [ ] **Step 7: Run everything.** Run `npm test && npm run typecheck`.

  Expected: PASS.

- [ ] **Step 8: Commit.**
```bash
git add packages/engine/src/footage-background.ts packages/engine/src/footage-background.test.ts packages/engine/src/footage-generate.ts packages/engine/src/footage-ingest.ts packages/engine/src/index.ts
git commit -m "feat(engine): AI background at generation: one still within the estimate, the speaker plate in place of the working copy, notes on every skip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Web: background choice and scene on the review page, its price, and the new progress steps

**Files:**
- Modify:
  - `apps/web/lib/edit-plan-edit.ts`
  - `apps/web/lib/progress-view.ts`
  - `apps/web/components/FootagePlanEditor.tsx`
- Test: `apps/web/lib/edit-plan-edit.test.ts`, `apps/web/lib/progress-view.test.ts`

**Interfaces:**
- Consumes: `backgroundCost`, `BackgroundSchema` rules, `source.matteAssetId` (Task 2); progress steps `cutout` and `background` (Task 4).
- Produces:
  - `PlanAction` `{ type: "setBackground"; prompt: string | null }`. `null` means the original background; a string means one AI section from the first beat.
  - `scenePrompt(background: EditPlan["background"]): string`
  - Ingest steps: "Prepare video", "Find face", "Transcribe", "Cut you out", "Plan the edit".
  - Generation steps: "Cut audio", "Music", "Background", "Cutaways", "Render", "Export".

- [ ] **Step 1: Write the failing tests.**

  In `apps/web/lib/edit-plan-edit.test.ts`:
  - change the fixtures import to `import { footageTranscript, MATTE_HASH, validEditPlan } from "../../../packages/core/src/testing/fixtures";`
  - add `scenePrompt` to the `./edit-plan-edit` import
  - append:
```ts
describe("background (plan 3)", () => {
  const cut = () => parseEditPlan({ ...validEditPlan(), source: { ...validEditPlan().source, matteAssetId: MATTE_HASH } });
  it("switches to an AI scene from the first beat and back; saving trims the scene", () => {
    const p = editPlan(cut(), { type: "setBackground", prompt: " a bright home office " });
    expect(p.background).toEqual({ mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: " a bright home office " } }] });
    expect(scenePrompt(normalizePlanForSave(p).background)).toBe("a bright home office");
    expect(checkEditPlan(p).ok).toBe(true);
    expect(editPlan(p, { type: "setBackground", prompt: null }).background).toEqual({ mode: "original" });
    expect(scenePrompt({ mode: "original" })).toBe("");
  });
  it("refuses an empty scene and a scene for a video without a cut-out, with plain messages", () => {
    const empty = checkEditPlan(editPlan(cut(), { type: "setBackground", prompt: "  " }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.join(" ")).toContain("Describe the AI background scene, or keep the original background.");
    const none = checkEditPlan(editPlan(plan(), { type: "setBackground", prompt: "office" }));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors.join(" ")).toContain("Background replacement needs the cut-out of you, and this video has none. Keep the original background.");
  });
  it("refuses a brand backdrop a crafted client might send", () => {
    const r = checkEditPlan({ ...cut(), background: { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "brand", assetId: "x" } }] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("Brand backdrops arrive in a later update");
  });
});
```

  In `apps/web/lib/progress-view.test.ts`:
  - change the expected ingest steps to `["Prepare video:done", "Find face:done", "Transcribe:running", "Cut you out:pending", "Plan the edit:pending"]`
  - change the expected generate-footage steps to:
```ts
      ["voice", "Cut audio", "done"], ["music", "Music", "done"], ["background", "Background", "pending"], ["visuals", "Cutaways", "running"], ["render", "Render", "pending"], ["export", "Export", "pending"],
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run apps/web/lib/edit-plan-edit.test.ts apps/web/lib/progress-view.test.ts`.

  Expected: FAIL.

- [ ] **Step 3: Plan edits.** In `apps/web/lib/edit-plan-edit.ts`:
  1. Add `| { type: "setBackground"; prompt: string | null }` to `PlanAction`.
  2. Add a case to `editPlan`:
```ts
    case "setBackground":
      return {
        ...plan,
        background: a.prompt === null ? { mode: "original" } : { mode: "replace", sections: [{ fromBeatId: plan.beats[0].id, source: { kind: "ai", prompt: a.prompt } }] },
      };
```
  3. Add after `trimCutaway`:
```ts
/** The first AI section's scene, or "" (plan 3 plans have one section). */
export const scenePrompt = (b: EditPlan["background"]): string =>
  b.mode === "replace" && b.sections[0]?.source.kind === "ai" ? b.sections[0].source.prompt : "";

const trimBackground = (b: EditPlan["background"]): EditPlan["background"] =>
  b.mode === "replace" ? { ...b, sections: b.sections.map((s) => (s.source.kind === "ai" ? { ...s, source: { ...s.source, prompt: s.source.prompt.trim() } } : s)) } : b;
```
  4. In `normalizePlanForSave`, add `background: trimBackground(plan.background),` after `hook: …,`.

- [ ] **Step 4: Progress steps.** In `apps/web/lib/progress-view.ts`, change `STEPS`:
```ts
  ingest_footage: [["conform", "Prepare video"], ["faces", "Find face"], ["transcribe", "Transcribe"], ["cutout", "Cut you out"], ["plan", "Plan the edit"]],
  generate_footage: [["voice", "Cut audio"], ["music", "Music"], ["background", "Background"], ["visuals", "Cutaways"], ["render", "Render"], ["export", "Export"]],
```
Change the `ingest_footage` running headline to `"Preparing your video: transcribing, cutting you out and planning the edit…"`. In `progress-view.test.ts`, change `expect(ingest!.headline).toBe("Preparing your video: transcribing and planning the edit…");` to expect the new headline.

- [ ] **Step 5: The editor.** In `apps/web/components/FootagePlanEditor.tsx`:
  1. Add `backgroundCost` to the `@reel/core` import, and `scenePrompt` to the `@/lib/edit-plan-edit` import.
  2. After the `keyword` state, add:
```tsx
  // Remembered so switching to the original background and back doesn't lose the scene.
  const [scene, setScene] = useState(scenePrompt(initial.background));
  const canReplace = !!plan.source.matteAssetId;
```
  3. Replace `<p className="muted" style={{ margin: 0 }}>Background: original</p>` with:
```tsx
          <div className="row">
            <label>Background
              <select
                value={plan.background.mode}
                disabled={!canReplace && plan.background.mode === "original"}
                onChange={(e) => dispatch({ type: "setBackground", prompt: e.target.value === "replace" ? scene : null })}
              >
                <option value="original">Original (your real background)</option>
                <option value="replace">AI scene behind you</option>
              </select>
            </label>
          </div>
          {!canReplace && <span className="muted">This video has no cut-out of you, so it keeps its real background.</span>}
          {plan.background.mode === "replace" && (
            <label>Background scene (one AI image, ${backgroundCost(plan.background).toFixed(2)})
              <textarea
                dir="auto"
                maxLength={400}
                value={scenePrompt(plan.background)}
                placeholder="e.g. a bright home office with plants, morning light"
                onChange={(e) => { setScene(e.target.value); dispatch({ type: "setBackground", prompt: e.target.value }); }}
              />
            </label>
          )}
```
  4. Change the approve note to: `Approving may spend Higgsfield credits for AI cutaways and the AI background, and ElevenLabs credits for AI music, up to the estimate above.`

- [ ] **Step 6: Run the tests and the web build.** Run `npx vitest run apps/web && npm run typecheck && npm run build -w @reel/web`.

  Expected: PASS, and the build succeeds.

- [ ] **Step 7: Commit.**
```bash
git add apps/web/lib/edit-plan-edit.ts apps/web/lib/edit-plan-edit.test.ts apps/web/lib/progress-view.ts apps/web/lib/progress-view.test.ts apps/web/components/FootagePlanEditor.tsx
git commit -m "feat(web): background choice and AI scene on the review page, priced in the estimate; cut-out and background progress steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Free preview of the composite (any clip, any image), and the docs

**Files:**
- Create: `packages/engine/scripts/preview-background.ts`
- Modify: root `package.json` (script `preview:background`), `docs/RUNNING.md`

**Interfaces:**
- Consumes:
  - `makeMatte`, `makeEllipseMatte`, `matteCoverage`, `segmentHelperAvailable` (Task 1)
  - `compositeSpeakerPlate` (Task 3)
  - `houseStyle.edit.background` (Task 2)
  - existing: `faceHelperAvailable`, `runFaceHelper`, `FIXTURE_TALKING_HEAD`, `smoothFaceTrack`, `RawFaceTrackSchema`, `sampleLookTimeline`, `LOOK_FRAMES`, `renderReelStill`, `serveDir`, `makeTestVideo`, `runFfmpeg`
- Produces: `npm run preview:background [-- <video> [<image>]]`. It writes the following to `work/stills/background/`:
  - `plate-01…04.png`, `matte-01…04.png` and `sheet.png` (plates on top, mattes below)
  - `look-01…08.png` and `look-sheet.png` (the Hebrew look sample with the plate as the speaker)

- [ ] **Step 1: Write the script.** Create `packages/engine/scripts/preview-background.ts`:
```ts
/**
 * Free local preview of background replacement: no API keys and no paid calls.
 *   npm run preview:background                          the fixture clip (or a test video) over a test scene
 *   npm run preview:background -- <video> [<image>]     your own clip (first 8 s) over your own image
 * It uses Apple Vision when npm run build:segment-helper (and build:face-helper) were run; otherwise the fake ellipse.
 * Writes work/stills/background/: plate-01…04.png, matte-01…04.png and sheet.png (plates on top, mattes below), then
 * look-01…08.png and look-sheet.png (the Hebrew look sample with the plate as the speaker).
 */
import { RawFaceTrackSchema, smoothFaceTrack } from "@reel/core";
import {
  compositeSpeakerPlate, faceHelperAvailable, FIXTURE_TALKING_HEAD, makeEllipseMatte, makeMatte, makeTestVideo, matteCoverage, runFaceHelper, runFfmpeg, segmentHelperAvailable,
} from "@reel/media";
import { houseStyle } from "@reel/video/house-style";
import { renderReelStill } from "@reel/video/render";
import { LOOK_FRAMES, sampleLookTimeline } from "@reel/video/sample-footage";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { serveDir } from "../src/serve";

const STILL_SECONDS = [0.5, 2, 3.5, 5];

async function main() {
  const [videoArg, imageArg] = process.argv.slice(2);
  const out = resolve("work/stills/background");
  await mkdir(out, { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), "bg-preview-"));
  try {
    let source = videoArg ? resolve(videoArg) : FIXTURE_TALKING_HEAD;
    if (!existsSync(source)) {
      source = join(dir, "test.mp4");
      await makeTestVideo(source, { durationSec: 7 });
    }
    // The working copy, as ingest makes it (first 8 s, 1080×1920, 30 fps).
    const working = join(dir, "working.mp4");
    await runFfmpeg(["-i", source, "-t", "8", "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", working]);
    let faces: string | undefined;
    if (faceHelperAvailable()) {
      faces = join(dir, "faces.json");
      await writeFile(faces, JSON.stringify(smoothFaceTrack(RawFaceTrackSchema.parse(await runFaceHelper(working)))));
    }
    const matte = join(dir, "matte.mp4");
    const vision = segmentHelperAvailable();
    const started = Date.now();
    if (vision) await makeMatte(working, matte, { faces });
    else await makeEllipseMatte(working, matte);
    console.log(`cut-out: ${vision ? `Apple Vision${faces ? " + face region" : " (no face helper: whole matte kept)"}` : "fake ellipse (run npm run build:segment-helper for the real one)"}, ${((Date.now() - started) / 1000).toFixed(1)} s, coverage ${((await matteCoverage(matte)) * 100).toFixed(0)} %`);
    const scene = join(dir, `scene${imageArg ? extname(imageArg) : ".png"}`);
    if (imageArg) await copyFile(resolve(imageArg), scene);
    else await runFfmpeg(["-f", "lavfi", "-i", "testsrc2=s=1080x1920", "-frames:v", "1", scene]);
    const plate = join(dir, "plate.mp4");
    await compositeSpeakerPlate({ video: working, matte, backgrounds: [{ image: scene, fromMs: 0 }], out: plate, look: houseStyle.edit.background, tmpDir: join(dir, "t") });
    for (const [i, sec] of STILL_SECONDS.entries()) {
      const n = String(i + 1).padStart(2, "0");
      await runFfmpeg(["-ss", String(sec), "-i", plate, "-frames:v", "1", join(out, `plate-${n}.png`)]);
      await runFfmpeg(["-ss", String(sec), "-i", matte, "-frames:v", "1", join(out, `matte-${n}.png`)]);
    }
    await runFfmpeg([
      "-framerate", "1", "-i", join(out, "plate-%02d.png"), "-framerate", "1", "-i", join(out, "matte-%02d.png"),
      "-filter_complex", "[0:v]scale=270:-1,tile=4x1[a];[1:v]scale=270:-1,tile=4x1[b];[a][b]vstack", "-frames:v", "1", join(out, "sheet.png"),
    ]);
    console.log(join(out, "sheet.png"));
    const server = await serveDir(dir);
    try {
      const timeline = sampleLookTimeline("he", { videoSrc: server.urlFor("plate.mp4"), imageSrc: server.urlFor(basename(scene)) });
      for (const [i, [name, frame]] of LOOK_FRAMES.entries()) {
        const file = join(out, `look-${String(i + 1).padStart(2, "0")}.png`);
        await renderReelStill(timeline, file, frame);
        console.log(`${file}  (${name}, frame ${frame})`);
      }
    } finally {
      await server.close();
    }
    await runFfmpeg(["-framerate", "1", "-i", join(out, "look-%02d.png"), "-vf", "scale=270:-1,tile=4x2", "-frames:v", "1", join(out, "look-sheet.png")]);
    console.log(join(out, "look-sheet.png"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```
In the root `package.json`, add after `"preview:look"`: `"preview:background": "tsx packages/engine/scripts/preview-background.ts",`.

- [ ] **Step 2: Document it.** In `docs/RUNNING.md`:
  1. After setup step 6, add:
```markdown
6b. `npm run build:segment-helper` builds the Swift cut-out tool (Apple Vision person segmentation; needs Xcode or its command line tools, macOS 14+). Without it, real workers keep every reel's real background and say so on the edit plan; the fake worker uses a still head-and-shoulders shape instead.
```
  2. In "Fake worker note", add: `It also cuts you out for free (the real cut-out when segment-helper is built, otherwise a still head-and-shoulders shape) and makes the AI background as a flat coloured still.`
  3. After the "Preview the footage look (free)" section, add:
```markdown
### Preview background replacement (free)

`npm run preview:background -- <your clip> [<an image>]` cuts you out of the first 8 s of the clip, puts you over the image (or a test pattern), and writes `work/stills/background/sheet.png`: four moments of the composite on top, the cut-out (white = you) below. It also writes `look-sheet.png`, the Hebrew look sample with the composite as the speaker. It needs no keys and makes no paid calls. Use a clip of at least 6 s. The cut-out takes about 3 s per second of video on the M4 Air. Tune the look in `houseStyle.edit.background` (blur, dim, drift, feather).
```

- [ ] **Step 3: Run it.** Run `npm test && npm run typecheck && npm run preview:background`.

  Expected: PASS. The script prints the cut-out line, `sheet.png`, 8 look paths and `look-sheet.png`.

  Open both sheets and check:
  1. Top row of `sheet.png`: the speaker sharp, the scene blurred, darker and shifting slightly between moments.
  2. Bottom row: the white cut-out matches the speaker.
  3. `look-sheet.png`: the pills, headline, callout and split card read clearly over the scene, and the split card's bottom half shows the scene too.

- [ ] **Step 4: Commit** (the stills under `work/` are git-ignored).
```bash
git add packages/engine/scripts/preview-background.ts package.json docs/RUNNING.md
git commit -m "feat(engine): npm run preview:background (free stills of the cut-out over a scene, and the look over it); docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the tasks (controller)

1. **Final whole-branch review** (most capable model), then one fix wave.
2. **Look check with the user (free):**
   1. Run `npm run build:segment-helper` and `npm run build:face-helper`.
   2. Run `npm run preview:background -- <the user's real clip> <an image they like>`. A still they save from anywhere is fine, so this costs nothing.
   3. Show `work/stills/background/sheet.png` and `look-sheet.png`.
   4. Check:
      - hair haze against a bright wall
      - wall chunks
      - held objects
      - hands (untested in the spike)
      - whether the drift reads as calm parallax or as wobble
   5. Tune only `houseStyle.edit.background` from the feedback (blur, dim, saturation, drift, feather), and update `testEditStyle()` to match. If haze needs more than tuning, `MATTE_REFINE` is the next knob. Changing it changes the matte cache key, so mattes are made again for free.
3. **Fake worker end to end in the browser:** run `npm run worker:fake` and `npm run web`.
   1. Upload a short clip. The progress shows "Cut you out". The plan's Settings show "AI scene behind you" with the fake scene, and the estimate includes $0.04.
   2. Edit the scene text, then clear it. Approving must be refused with "Describe the AI background scene, or keep the original background." Then switch to Original and back: the text comes back.
   3. Approve with the scene. The progress shows "Background". The reel shows you over a flat coloured, slightly dark backdrop, including in the split card's bottom half and through the zoom hits.
   4. Edit as new version, pick Original, and approve. The reel is on the real background, and no new still is made.
   5. Stop the worker. With the real worker running but segment-helper not built (move its `.build` aside), upload again. The plan warns "Background replacement is off for this video: the cut-out tool isn't built on this worker…", and the Background select is locked on Original.
4. **Paid smoke test (only with the user's explicit OK and the cost stated first):** one real 30 s reel on a user clip, with the real worker (`HF_CONCURRENCY=2`), the helpers built and Claude's proposed scene.
   - The background is one Higgsfield still: **$0.04**.
   - At the full cutaway budget the cutaways cost up to $1.68.
   - AI music, only if chosen, costs 30 s × $0.01 = $0.30. Scribe is about $0.02, plus Claude planning.
   - Worst case about **$2.04 plus Claude**, never more than the estimate the user approves.

   Check:
   - Claude's scene fits the topic.
   - The still has no people or text.
   - The cut-out holds up on the real wall.
   - The review-page estimate equals what the notes and the cost log show.
5. **Merge**, then restart the worker and web. Next: brand backdrops and per-section backgrounds, if the user wants them (§12).
