# Footage Editor, Plan 2: Cutaways and Look Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First, fix what the user saw in their first real reel (pill captions colliding with the hook headline, pills across the eyes, too little motion). Then add cutaways to footage reels: Higgsfield B-roll (stills and short clips), AI shots of the user from the team's Soul ID character, the user's own extra photos and clips, a split-screen layout, and three line-art diagram cards. Everything is planned by Claude, reviewed and edited by the user, priced in the estimate, and paid for only after approval.

**Architecture:**
- `@reel/core` (pure): face-aware caption placement, recurring pattern breaks and punch-in snaps (Task 1); extra-upload checks (Task 2); the cutaway, extras and character fields of `EditPlan` with plan-1 rejections lifted (Task 3); `placeCutaways` (spec §5.4–5.5 rules), the cutaway budget and cutaway prices (Task 4); `compileFootage` emitting `timeline.cutaways` and split speaker clips (Task 5).
- `@reel/video`: caption/motion upgrades (Task 1), `Cutaways` (full and split), split mode in `SpeakerShot`, `DiagramCard` with inline Lucide icons (Task 6).
- `@reel/media` + `@reel/engine`: Soul ID reference on Higgsfield image generation, extras conforming (Task 7); extras ingest and cutaway generation with a spend budget and skip notes (Task 8); the planner's cutaway draft, budget enforcement and prompt (Task 9).
- `apps/worker`: extras download, character lookup, new generate deps (Task 10).
- `apps/web`: extra files and character on "Edit my video", a Characters settings page (Task 11); cutaway cards, character and placement warnings on the review page (Task 12).

**Tech Stack:** unchanged from plan 1: TypeScript 7, zod 4, Vitest 5, Next.js 16, Supabase, Remotion 4.0.531, FFmpeg 8, Higgsfield platform API (`higgsfield-ai/soul/v2/standard`, `bytedance/seedance-2.5/image-to-video`) through the existing `HiggsfieldGateway` (submit / wait / resume). No new dependencies (Lucide icon paths are inlined, ISC licence noted in the file).

**Spec:** `docs/superpowers/specs/2026-10-12-footage-editor-design.md` (§2 row "2. Cutaways", and every part tagged plan 2: §3 `cutaway`, §4.3 cutaway budget, §4.4 generation, §5.4 placement, §5.5 hard rules, §5.7 `broll`, §6 `SplitLayout` / `Cutaway` / `DiagramCard`, §7, §9). Reference numbers *(ref)* come from `docs/superpowers/specs/2026-10-12-footage-editor/reference-style-report.md`. Plan 1 (`docs/superpowers/plans/2026-10-12-footage-editor-core.md`) is implemented on this branch; this plan edits its code.

## Global Constraints

- **Scope:** plan 2. `background.mode: "replace"` stays rejected by `parseEditPlan` with the plan-1 message `Background replacement arrives in a later update: keep the original background.` (plan 3). The cutaway and `patternBreak: "broll"` rejections are removed.
- **Cutaways (spec §3):** one per beat; `atMs` ≥ 0 measured from the beat's first reel frame (after cuts); `durationMs` 1000–3000; `layout` `full` (replaces the picture, the speaker's audio continues) or `split` (cutaway in the top half, speaker cropped 9:8 around the face in the bottom half, seam at y = 0.50 (ref), captions on the seam). Sources: `ai_broll` and `ai_self` (each `media: "image" | "video"`), `upload` (an extra file of this video), `diagram` (`compare` exactly 2 items, `list` 2–4, `flow` 2–3; items ≤ 40 characters).
- **Hard rules (spec §5.5), applied in reel order:** clipped to its beat; never overlaps the previous cutaway; never under the CTA card; full cutaways together cover at most 60 % of the reel (≥ 40 % shows the speaker; split counts as speaker). A cutaway shortened below 1000 ms is dropped. Every trim or drop adds a warning shown on the review page and as a generation note.
- **`broll` pattern break (spec §5.7):** the first cutaway in reel order moves to frame 0, full screen, 1000 ms long.
- **Cutaway budget (spec §4.3), per reel target T seconds:** at most `round(T/5)` cutaways, `floor(T/15)` of them video, and `ai_self` only with a character, at most `max(1, floor(T/20))`. Code enforces it after Claude (drops extras in beat order, turns surplus videos into stills) and warns.
- **Money:** prices from `DEFAULT_COST_TABLE`: AI still `higgsfield-ai/soul/v2/standard` $0.04; AI clip = still + `bytedance/seedance-2.5/image-to-video` billed `videoBillSeconds(sec)` (minimum 4 s) × $0.08 = $0.36; uploads and diagrams free. `ai_self` uses the same Soul model with the character's reference, priced the same (checked in the paid smoke test). The estimate = AI music + placed cutaways, rounded up to the cent. Generation reserves each paid element against the approved estimate before paying; one that doesn't fit is skipped with a note. Cached elements cost nothing. Nothing is generated before approval.
- **No repeat paid calls:** a failed Higgsfield generation is not resubmitted inside the job (the gateway's own submit retries cover transient errors before a job exists); the element is skipped with a note. "Edit as new version" + approve retries it, and finished elements come from the cache.
- **Cache keys include the provider model id:** stills `hashes.image(model, prompt)`; Soul ID stills `footageHashes.selfImage(model, prompt, referenceId, strength)`; clips `hashes.video(model, resolution, prompt, imageHash, billSec)`; fitted clips `footageHashes.cutawayFit(rawHash, durationMs)`; extras `footageHashes.extra(sha, kind)`. Fake providers report `fake/...` model ids.
- **Soul ID:** the character is trained once outside the app with the existing `higgsfield-soul-id` flow (paid, controller only, user's OK first). Its reference id is stored in the new `soul_characters` table and sent as `custom_reference_id` with `custom_reference_strength: 1` (the field names `@higgsfield/client` uses for Soul).
- **Extra uploads:** at most 6 files; photos JPG/JPEG/PNG/WEBP ≤ 25 MB, clips MP4/MOV ≤ 500 MB; stored at `footage/<projectId>/extra-<n>.<ext>` (n = 1–6) by the same TUS upload; clips are conformed to fit inside 1080×1920 (no crop, no audio, first 10 s only); photos are stored unchanged (Chrome applies EXIF rotation when rendering).
- **Look (houseStyle) — Task 1 numbers:** pill captions hidden while the hook headline or the CTA card is on screen (pages that would show < 8 frames are dropped); pill centre = on-screen chin + 3 % + 2.8 %, clamped to 55–72 % of the height, rounded to 0.5 %, constant within a page, kept from the previous page when it moves < 3 %; no face → previous page's position (60 % when the reel has no face at all); split pages at 50 %. Pattern breaks recur every 10 s (window 8–12 s) at cuts, cycling `zoom_blur, zoom_hit, zoom_blur, flash`, each with a whoosh; punch-in cuts snap 1.06 → 1 over 4 frames; zoom-blur entries 1.22 → 1 with 16 px → 0 blur over 6 frames; the active caption word pops 1.12 → 1 over 3 frames on a `#FEE80A` marker; pages pop 80 % → 100 % with a slight overshoot over 6 frames; emoji pop 0 → 1.35 → 1 over 8 frames when the page's last word is spoken.
- **Existing formats** (faceless, Custom, styles, voice SRT) render byte for byte as before: all `Timeline` additions are optional and only footage timelines set them. Plan-1 edit plans still parse (`source.extras` defaults to `[]`).
- **Migration:** `supabase/migrations/20261013120000_footage_cutaways.sql` (Task 2), applied to the hosted project only by the controller after the user approves. Tasks hand-edit `packages/db/src/database.types.ts`.
- **Safety:** no paid API calls in any task (Claude, Scribe, ElevenLabs, Higgsfield, Soul ID training); all tests use fakes. Never read `.env.local`.
- **Copy:** UI copy is English, in-video copy follows the reel language (Hebrew RTL or English LTR). Diagram cards follow the reel's direction (compare boxes and list rows run right to left in Hebrew); flow steps stack top to bottom with down arrows so 40-character Hebrew steps fit the width.
- **Commits:** every commit message ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Spend after an edit.** The user changes a cutaway prompt or media after approval, or a cached still expires from this machine: generation must reserve every uncached paid element against the approved estimate and skip (with a note) whatever doesn't fit, never pay past it. Pinned in Task 8.
2. **Uploads that don't fit the slot.** A landscape screen recording or a portrait phone photo placed in a 9:8 split slot, a clip shorter than its cutaway, a HEIC photo: the reel must show the whole picture on a blurred fill (never a strip of it), freeze nothing past the clip, and the browser must refuse HEIC with a plain message. Pinned in Tasks 2, 5 and 8.
3. **A character that disappears.** A plan with AI shots of the user whose character was deleted (or never picked): review must refuse to approve with a plain message, and generation must skip those shots with a note rather than send a reference-less prompt. Pinned in Tasks 3, 8 and 12.
4. **Cutaways colliding.** Two cutaways overlapping, one under the CTA card, a cold open reordering beats, cutaways covering most of a short reel: placement must trim or drop deterministically, the review page must show why, and the estimate must price only what will be generated. Pinned in Task 4.
5. **An interrupted multi-file upload.** The main video finished but extra 3 of 4 dropped: "Resume upload" must continue the unfinished files and never re-send finished ones (tus forgets finished uploads). Pinned in Task 11.

## Prerequisites (the user, before or during execution)

- Plan 1's prerequisites stay (2 GB storage limit, `npm run build:face-helper`).
- **Higgsfield concurrency:** the Starter plan allows about 2 concurrent jobs. RUNNING.md (Task 12) tells the user to set `HF_CONCURRENCY=2` in `.env.local`; the controller never edits or reads that file.

## File map

| Area | Files |
|---|---|
| DB | `supabase/migrations/20261013120000_footage_cutaways.sql`, `packages/db/src/database.types.ts`, `packages/db/src/index.ts` |
| Core | `footage-form.ts`, `schema/footage.ts`, `schema/edit-plan.ts`, `schema/timeline.ts`, `footage/style.ts`, `footage/caption-place.ts` (new), `footage/breaks.ts` (new), `footage/cutaways.ts` (new), `footage/compile.ts`, `cost.ts`, `timeline-sources.ts`, `testing/fixtures.ts`, `index.ts` |
| Video | `house-style.ts`, `footage/motion.ts`, `footage/PillCaptions.tsx`, `footage/PatternBreak.tsx`, `footage/SpeakerShot.tsx`, `footage/Cutaways.tsx` (new), `footage/DiagramCard.tsx` (new), `footage/icons.tsx` (new), `Reel.tsx`, `sample-footage.ts`, `footage-render.test.ts` |
| Media | `ops.ts` (`conformClip`) |
| Engine | `providers/types.ts`, `providers/higgsfield.ts`, `providers/fake.ts`, `footage-ingest.ts`, `footage-cutaways.ts` (new), `footage-generate.ts`, `footage-planner.ts`, `index.ts` |
| Worker | `handlers/footage.ts`, `handlers/generate-footage.ts`, `handlers/index.ts`, `reel-db.ts`, `testing/fakes.ts`, `main.ts` |
| Web | `lib/create-footage.ts`, `lib/footage-form.ts`, `lib/footage-send.ts`, `lib/character-form.ts` (new), `lib/edit-plan-edit.ts`, `lib/approve-plan.ts`, `app/new/footage/*`, `app/settings/characters/*` (new), `app/projects/[id]/*`, `components/FootagePlanEditor.tsx`, `components/CutawayEditor.tsx` (new), `app/layout.tsx` |
| Docs | `docs/RUNNING.md` |

---

### Task 1: Look fixes from the first real reel

The first real render (30 s Hebrew talking head, camera slightly below the face) showed three problems. What spec §5/§6 promise versus what plan 1 renders:

| Promise | Rendered today | Change here |
|---|---|---|
| Headline over 0–2 s (§5.7); pills "above every other layer" (§6) | Both on screen 0–2 s; the pill (y 45 %) and the headline (y 58 %) collide | Pills yield to the headline and the CTA card |
| Pills at y = 45 % (ref 43–50 %, measured on creators whose eyes sit at y 0.21–0.28) | With the camera below the face, the face sits lower and the pill crosses the eyes | Face-aware position per page from the smoothed face track and each shot's zoom |
| Pattern break at frame 0 only (§5.7); zooms 1.0/1.15/1.25 as hard cuts; pages pop 90 → 100 % over 4 frames | One break per reel; zoom steps barely read as motion; no other animation | Recurring breaks every ≈ 10 s, punch-in snaps, zoom-blur entries, active-word pop, bouncier pages, emoji pops |

The reference report measured no active-word highlight and almost no transitions (ref §4, §7); the user asked for visibly more motion, and spec §10 says to tune `houseStyle` after the first real reels. All new numbers live in `houseStyle` and in the core `EditStyle`; voice reels are untouched.

**Files:**
- Create: `packages/core/src/footage/caption-place.ts`, `packages/core/src/footage/breaks.ts`
- Modify: `packages/core/src/footage/style.ts`, `packages/core/src/schema/timeline.ts`, `packages/core/src/footage/compile.ts`, `packages/core/src/testing/fixtures.ts`, `packages/core/src/index.ts`, `packages/video/src/house-style.ts`, `packages/video/src/footage/motion.ts`, `packages/video/src/footage/PillCaptions.tsx`, `packages/video/src/footage/PatternBreak.tsx`, `packages/video/src/footage/SpeakerShot.tsx`, `packages/video/src/sample-footage.ts`, `packages/engine/src/footage-planner.ts`
- Test: `packages/core/src/footage/caption-place.test.ts` (new), `packages/core/src/footage/breaks.test.ts` (new), `packages/core/src/footage/compile.test.ts`, `packages/video/src/footage/motion.test.ts`, `packages/video/src/house-style.test.ts`, `packages/video/src/footage-render.test.ts`

**Interfaces:**
- Produces (core):
  - `EditStyle` gains `captionPlacement: { minTopPct; maxTopPct; chinGapPct; pillHalfPct; holdPct; noFaceTopPct; seamTopPct }`, `breaks: { everyMs; minMs; maxMs; minShotFrames; kinds: BreakKind[]; hitFactor; zoomBlurFrames }`, `snapFrames: number`.
  - `type FaceSpan = { fromFrame: number; endFrame: number; chinY: number | null; split?: boolean }`; `screenChinY(face: FaceBox | null, crop: TimelineCrop): number | null`; `placeCaptionPages(pages: { fromFrame: number; durationInFrames: number }[], spans: FaceSpan[], p: EditStyle["captionPlacement"]): number[]`.
  - `type BreakKind = "zoom_hit" | "flash" | "zoom_blur"`; `type PickedBreak = { index: number; frame: number; kind: BreakKind }`; `pickBreaks(shots: { fromFrame: number; frames: number }[], b: EditStyle["breaks"], blocked: [number, number][], resets: number[]): PickedBreak[]`; `applyBreaks(clips: TimelineClip[], picked: PickedBreak[], faces: (FaceBox | null)[], style: EditStyle): { frame: number; kind: BreakKind }[]` (mutates clips); `addSnaps(clips: TimelineClip[], style: EditStyle): void`.
  - Timeline: `CaptionPage.topPct?: number`, `CaptionPage.words[].startFrame?: number` (absolute reel frame), `TimelineClip.enter?: { kind: "snap" | "zoom_blur"; frames: number }`, `Timeline.patternBreaks?: { frame: number; kind: BreakKind }[]`.
  - Fixtures: `testEditStyle()` gains the three fields; `lowFaceTrackFixture(): FaceTrack` (face at y 0.5–0.7).
- Produces (video): `houseStyle.captions` gains `minVisibleFrames`, `activeWord`, `emoji`; `houseStyle.motion = { snapScale, zoomBlurScale, zoomBlurPx }`; `footage/motion.ts` gains `popBounce`, `enterEffect`, `visiblePages`, `captionHideRanges`, `activeWordIndex`, `wordPop`, `emojiScale`, and `speakerTransform(crop, frame, durationInFrames, mult = 1)`.

#### 1a. Captions: hidden under the headline and CTA, placed below the face

- [ ] **Step 1: Extend the edit style.** In `packages/core/src/footage/style.ts` add to `EditStyleSchema` (after `noisyLogprob`):
```ts
  /** Pill caption placement (Task 1 of plan 2): centre = on-screen chin + chinGapPct + pillHalfPct, clamped. */
  captionPlacement: z.object({
    minTopPct: z.number().min(0).max(100),
    maxTopPct: z.number().min(0).max(100),
    chinGapPct: z.number().min(0).max(100),
    pillHalfPct: z.number().min(0).max(100),
    holdPct: z.number().min(0).max(100),
    noFaceTopPct: z.number().min(0).max(100),
    seamTopPct: z.number().min(0).max(100),
  }),
  /** Recurring pattern breaks after the hook: one every everyMs (window minMs–maxMs), at cuts. */
  breaks: z.object({
    everyMs: z.number().positive(),
    minMs: z.number().positive(),
    maxMs: z.number().positive(),
    minShotFrames: z.number().int().positive(),
    kinds: z.array(z.enum(["zoom_hit", "flash", "zoom_blur"])).min(1),
    hitFactor: z.number().min(1).max(2),
    zoomBlurFrames: z.number().int().positive(),
  }),
  /** Punch-in cuts (to a larger zoom step) enter with a short scale snap. */
  snapFrames: z.number().int().positive(),
```
In `packages/video/src/house-style.ts` add to `edit` (after `noisyLogprob`), with the reasons as comments:
```ts
    // Pill ≈ 66 px × 1.25 + 2 × 10 px padding ≈ 103 px = 5.4 % of 1920 → half 2.8 %. 3 % (≈ 58 px) clears chin and beard.
    // 55 %: always below mid-frame, so the pill never crosses a face in the upper half. 72 %: the pill's bottom
    // (74.8 %) stays above Instagram's caption/username/audio rows (the lowest ≈ 22 %). 50 %: the split seam (ref).
    captionPlacement: { minTopPct: 55, maxTopPct: 72, chinGapPct: 3, pillHalfPct: 2.8, holdPct: 3, noFaceTopPct: 60, seamTopPct: 50 },
    // One visible break every ≈ 10 s (8–12 s): the first reel had a single break at 0 s and read as static.
    breaks: { everyMs: 10_000, minMs: 8000, maxMs: 12_000, minShotFrames: 12, kinds: ["zoom_blur", "zoom_hit", "zoom_blur", "flash"], hitFactor: 1.2, zoomBlurFrames: 6 },
    snapFrames: 4,
```
and the same values (without comments) to `testEditStyle()` in `packages/core/src/testing/fixtures.ts`:
```ts
  captionPlacement: { minTopPct: 55, maxTopPct: 72, chinGapPct: 3, pillHalfPct: 2.8, holdPct: 3, noFaceTopPct: 60, seamTopPct: 50 },
  breaks: { everyMs: 10_000, minMs: 8000, maxMs: 12_000, minShotFrames: 12, kinds: ["zoom_blur", "zoom_hit", "zoom_blur", "flash"], hitFactor: 1.2, zoomBlurFrames: 6 },
  snapFrames: 4,
```
Also add to fixtures:
```ts
/** The first real reel's framing (camera below the face): the face sits low, chin at y 0.7. */
export const lowFaceTrackFixture = (): FaceTrack => ({
  intervalMs: 100,
  samples: Array.from({ length: 91 }, (_, i) => ({ tMs: i * 100, box: { x: 0.35, y: 0.5, w: 0.3, h: 0.2 } })),
});
```

- [ ] **Step 2: Extend the timeline schema** in `packages/core/src/schema/timeline.ts`:
  - `CaptionPageSchema`: `words: z.array(z.object({ text: z.string().min(1), emphasis: z.boolean(), startFrame: z.number().int().nonnegative().optional() })).min(1)` and add `topPct: z.number().min(0).max(100).optional(),` (absent: the component's default 45 %).
  - `TimelineClipSchema`: add `enter: z.object({ kind: z.enum(["snap", "zoom_blur"]), frames: z.number().int().positive() }).optional(),`.
  - `TimelineSchema`: add after `sfx`: `patternBreaks: z.array(z.object({ frame: z.number().int().nonnegative(), kind: z.enum(["zoom_hit", "flash", "zoom_blur"]) })).optional(),`.

- [ ] **Step 3: Write the failing placement test** `packages/core/src/footage/caption-place.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { testEditStyle } from "../testing/fixtures";
import { placeCaptionPages, screenChinY } from "./caption-place";

const P = testEditStyle().captionPlacement;
const page = (fromFrame: number) => ({ fromFrame, durationInFrames: 30 });

describe("screenChinY", () => {
  it("takes the lowest chin over the crop's zoom range, with the centre clamped as the renderer does", () => {
    const face = { x: 0.35, y: 0.45, w: 0.3, h: 0.2 };
    expect(screenChinY(face, { cx: 0.5, cy: 0.55, scaleFrom: 1, scaleTo: 1.15 })).toBe(0.65);
    expect(screenChinY({ x: 0.35, y: 0.2, w: 0.3, h: 0.17 }, { cx: 0.5, cy: 0.4, scaleFrom: 1.25, scaleTo: 1.25 })).toBe(0.4625);
    expect(screenChinY(null, { cx: 0.5, cy: 0.5, scaleFrom: 1, scaleTo: 1 })).toBeNull();
  });
});

describe("placeCaptionPages", () => {
  it("puts each page under the chin, clamps to 55–72 %, holds small moves, keeps no-face pages where they were, and uses the seam for split", () => {
    const spans = [
      { fromFrame: 0, endFrame: 30, chinY: 0.65 },
      { fromFrame: 30, endFrame: 60, chinY: 0.62 },
      { fromFrame: 60, endFrame: 90, chinY: 0.63 },
      { fromFrame: 90, endFrame: 120, chinY: null },
      { fromFrame: 120, endFrame: 150, chinY: 0.5, split: true },
      { fromFrame: 150, endFrame: 180, chinY: 0.3 },
    ];
    expect(placeCaptionPages([0, 30, 60, 90, 120, 150].map(page), spans, P)).toEqual([71, 68, 68, 68, 50, 55]);
  });
  it("uses the lowest chin of every clip a page overlaps, and clamps at 72 %", () => {
    const spans = [{ fromFrame: 0, endFrame: 15, chinY: 0.4 }, { fromFrame: 15, endFrame: 40, chinY: 0.8 }];
    expect(placeCaptionPages([page(0)], spans, P)).toEqual([72]);
  });
  it("gives leading no-face pages the first known position, and 60 % when there is no face at all", () => {
    expect(placeCaptionPages([page(0), page(30)], [{ fromFrame: 30, endFrame: 60, chinY: 0.65 }], P)).toEqual([71, 71]);
    expect(placeCaptionPages([page(0), page(30)], [], P)).toEqual([60, 60]);
  });
});
```
Run `npx vitest run packages/core/src/footage/caption-place.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement** `packages/core/src/footage/caption-place.ts`:
```ts
import type { FaceBox } from "../schema/footage";
import type { TimelineCrop } from "../schema/timeline";
import type { EditStyle } from "./style";

/** One clip's stretch of the reel and where the chin shows on screen (normalised), or null with no face. Split clips use the seam. */
export type FaceSpan = { fromFrame: number; endFrame: number; chinY: number | null; split?: boolean };

const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
const toHalf = (v: number) => Math.round(v * 2) / 2;

/**
 * The lowest on-screen point of the face over the crop's zoom range. Same maths as speakerTransform: zoom by s about
 * the frame centre after moving the clamped centre c there, so a source y shows at 0.5 + (y − c) · s.
 */
export function screenChinY(face: FaceBox | null, crop: TimelineCrop): number | null {
  if (!face) return null;
  let lowest = -Infinity;
  for (const raw of [crop.scaleFrom, crop.scaleTo]) {
    const s = Math.max(1, raw);
    const half = 0.5 / s;
    const c = Math.min(1 - half, Math.max(half, crop.cy));
    lowest = Math.max(lowest, 0.5 + (face.y + face.h - c) * s);
  }
  return r4(lowest);
}

/**
 * Pill centre per page, in % of the height (spec §6 PillCaptions, tuned by plan 2 Task 1). One value per page, so a
 * page never moves while it shows. Split pages sit on the seam. Small moves (< holdPct) keep the previous position;
 * pages with no face keep the previous page's position (the first known one for leading pages).
 */
export function placeCaptionPages(pages: { fromFrame: number; durationInFrames: number }[], spans: FaceSpan[], p: EditStyle["captionPlacement"]): number[] {
  const raw = pages.map((page): { top: number; seam: boolean } | null => {
    const end = page.fromFrame + page.durationInFrames;
    const over = spans.filter((s) => s.fromFrame < end && s.endFrame > page.fromFrame);
    if (over.some((s) => s.split)) return { top: p.seamTopPct, seam: true };
    const chins = over.flatMap((s) => (s.chinY === null ? [] : [s.chinY]));
    if (!chins.length) return null;
    const top = Math.max(...chins) * 100 + p.chinGapPct + p.pillHalfPct;
    return { top: toHalf(Math.min(p.maxTopPct, Math.max(p.minTopPct, top))), seam: false };
  });
  const firstKnown = raw.find((r) => r && !r.seam)?.top ?? p.noFaceTopPct;
  const out: number[] = [];
  let prev: number | null = null;
  for (const r of raw) {
    if (r?.seam) {
      out.push(r.top);
      continue;
    }
    let top = r ? r.top : (prev ?? firstKnown);
    if (prev !== null && Math.abs(top - prev) < p.holdPct) top = prev;
    out.push(top);
    prev = top;
  }
  return out;
}
```
Append `export * from "./footage/caption-place";` and `export * from "./footage/breaks";` to `packages/core/src/index.ts` (breaks arrives in step 9; add both lines now and create an empty `breaks.ts` with `export {};` so the index compiles).

Run the test. Expected: PASS.

- [ ] **Step 5: Wire placement and word start frames into `compileFootage`.** In `packages/core/src/footage/compile.ts`:
  - import `placeCaptionPages, screenChinY, type FaceSpan` from `./caption-place` and `FaceBox` type from `../schema/footage`;
  - in the `shots.forEach` loop keep the face: declare `const faces: (FaceBox | null)[] = [];` before the loop and `faces.push(face);` right after computing `face`;
  - build pages with start frames, then place them after the clips are final (step 11 adds breaks before this point):
```ts
  const pages = groups.map((g, i) => {
    const next = groups[i + 1];
    const fromFrame = msToFrames(g[0].startMs);
    const endFrame = next ? msToFrames(next[0].startMs) : speechEndFrame;
    const beat = beats.get(g[0].beatId)!;
    const lastOfBeat = !next || next[0].beatId !== g[0].beatId;
    return {
      fromFrame,
      durationInFrames: Math.max(1, endFrame - fromFrame),
      words: g.map((w) => ({ text: w.text, emphasis: w.idx === beat.emphasisWordIdx, startFrame: msToFrames(w.startMs) })),
      ...(lastOfBeat && beat.emoji ? { emoji: beat.emoji } : {}),
    };
  });
```
  - just before building the timeline:
```ts
  const spans: FaceSpan[] = clips.map((c, i) => ({ fromFrame: c.fromFrame, endFrame: c.fromFrame + c.durationInFrames, chinY: screenChinY(faces[i], c.crop!) }));
  const tops = placeCaptionPages(pages, spans, style.captionPlacement);
  const placedPages = pages.map((p, i) => ({ ...p, topPct: tops[i] }));
```
  and use `pages: placedPages` in `captions`.

- [ ] **Step 6: Write the failing compile tests.** Add to `packages/core/src/footage/compile.test.ts` (import `lowFaceTrackFixture` from the fixtures):
```ts
describe("pill caption placement and word timing", () => {
  it("keeps the pill at 55 % when the face is high (the reference framing)", () => {
    expect(compile().timeline.captions.pages!.every((p) => p.topPct === 55)).toBe(true);
  });
  it("moves the pill below a low face (camera below the face), within 55–72 %", () => {
    const pages = compile(plan(), lowFaceTrackFixture()).timeline.captions.pages!;
    expect(pages[0].topPct).toBe(72);
    for (const p of pages) {
      expect(p.topPct).toBeGreaterThanOrEqual(55);
      expect(p.topPct).toBeLessThanOrEqual(72);
    }
  });
  it("uses 60 % without a face track", () => {
    expect(compileFootage(plan(), transcript, null, assets, style).timeline.captions.pages!.every((p) => p.topPct === 60)).toBe(true);
  });
  it("gives every caption word its reel start frame", () => {
    expect(compile().timeline.captions.pages![1].words.map((w) => w.startFrame)).toEqual([27, 41, 50]);
  });
});
```
Run `npx vitest run packages/core/src/footage/compile.test.ts`. Expected: PASS for these and every existing test (no-face pages now carry `topPct: 60`; the existing tests only read text, emphasis, emoji and frames).

- [ ] **Step 7: Video helpers, failing tests first.** Add to `packages/video/src/footage/motion.test.ts`:
```ts
import { activeWordIndex, emojiScale, enterEffect, popBounce, visiblePages, wordPop } from "./motion";

describe("caption visibility under the headline and the CTA card", () => {
  it("cuts the hidden ranges out of each page and drops what is left under 8 frames", () => {
    const pages = [{ fromFrame: 0, durationInFrames: 30 }, { fromFrame: 50, durationInFrames: 30 }, { fromFrame: 58, durationInFrames: 6 }, { fromFrame: 80, durationInFrames: 20 }, { fromFrame: 100, durationInFrames: 40 }];
    expect(visiblePages(pages, [[0, 60], [120, 140]], 8).map((p) => [p.fromFrame, p.durationInFrames])).toEqual([[60, 20], [80, 20], [100, 20]]);
  });
});

describe("word, page and emoji pops", () => {
  it("finds the word being spoken", () => {
    const words = [{ startFrame: 10 }, { startFrame: 20 }, { startFrame: 30 }];
    expect([5, 10, 25, 99].map((f) => activeWordIndex(words, f))).toEqual([-1, 0, 1, 2]);
    expect(activeWordIndex([{}, {}], 50)).toBe(-1);
  });
  it("pops the active word from 1.12 back to 1 over 3 frames", () => {
    expect(wordPop(0, 3, 1.12)).toBeCloseTo(1.12);
    expect(wordPop(3, 3, 1.12)).toBeCloseTo(1);
  });
  it("bounces pages in from 80 % with a small overshoot", () => {
    expect(popBounce(0, 6, 0.8)).toBeCloseTo(0.8);
    expect(Math.max(...[1, 2, 3, 4, 5].map((f) => popBounce(f, 6, 0.8)))).toBeGreaterThan(1);
    expect(popBounce(6, 6, 0.8)).toBeCloseTo(1);
  });
  it("pops emoji 0 → 1.35 → 1 over 8 frames", () => {
    expect(emojiScale(-1, 8, 1.35)).toBe(0);
    expect(emojiScale(0, 8, 1.35)).toBe(0);
    expect(emojiScale(5, 8, 1.35)).toBeGreaterThan(1.25);
    expect(emojiScale(8, 8, 1.35)).toBe(1);
  });
});

describe("clip entries", () => {
  const m = { snapScale: 1.06, zoomBlurScale: 1.22, zoomBlurPx: 16 };
  it("snaps 1.06 → 1 and zoom-blurs 1.22 / 16 px → 1 / 0", () => {
    expect(enterEffect({ kind: "snap", frames: 4 }, 0, m)).toEqual({ scale: 1.06, blurPx: 0 });
    expect(enterEffect({ kind: "snap", frames: 4 }, 4, m)).toEqual({ scale: 1, blurPx: 0 });
    const mid = enterEffect({ kind: "zoom_blur", frames: 6 }, 3, m);
    expect(mid.scale).toBeCloseTo(1.0275, 4);
    expect(mid.blurPx).toBeCloseTo(2, 4);
    expect(enterEffect(undefined, 0, m)).toEqual({ scale: 1, blurPx: 0 });
  });
  it("speakerTransform multiplies the zoom and still never shows a frame edge", () => {
    expect(speakerTransform({ cx: 0.5, cy: 0.4, scaleFrom: 1, scaleTo: 1 }, 0, 30, 1.06)).toBe("scale(1.0600) translate(0.000%, 2.830%)");
  });
});
```
Run `npx vitest run packages/video/src/footage/motion.test.ts`. Expected: FAIL.

- [ ] **Step 8: Implement the helpers** in `packages/video/src/footage/motion.ts`:
```ts
import type { Timeline, TimelineClip, TimelineCrop } from "@reel/core";

const easeOutBack = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

/** Page pop with a small overshoot (≈ 2 % past full size at from = 0.8). */
export const popBounce = (frame: number, frames: number, from: number) => from + (1 - from) * easeOutBack(clamp01(frame / frames));

/** Starts at `peak` and settles to 1: the spoken word "hits". */
export const wordPop = (frame: number, frames: number, peak: number) => 1 + (peak - 1) * (1 - easeOutCubic(clamp01(frame / frames)));

/** Emoji: 0 → overshoot over the first 60 %, then back to 1. */
export function emojiScale(frame: number, frames: number, overshoot: number): number {
  if (frame <= 0) return 0;
  const p = frame / frames;
  if (p >= 1) return 1;
  return p < 0.6 ? overshoot * easeOutCubic(p / 0.6) : overshoot + (1 - overshoot) * easeOutCubic((p - 0.6) / 0.4);
}

/** Index of the last word whose start frame has passed (absolute reel frames), or -1. */
export function activeWordIndex(words: { startFrame?: number }[], frame: number): number {
  let idx = -1;
  words.forEach((w, i) => {
    if (w.startFrame !== undefined && w.startFrame <= frame) idx = i;
  });
  return idx;
}

/** A clip's entry: extra zoom multiplier and blur, both easing back to none. */
export function enterEffect(enter: TimelineClip["enter"], frame: number, m: { snapScale: number; zoomBlurScale: number; zoomBlurPx: number }): { scale: number; blurPx: number } {
  if (!enter || frame >= enter.frames) return { scale: 1, blurPx: 0 };
  const rest = 1 - easeOutCubic(clamp01(frame / enter.frames));
  return enter.kind === "snap"
    ? { scale: 1 + (m.snapScale - 1) * rest, blurPx: 0 }
    : { scale: 1 + (m.zoomBlurScale - 1) * rest, blurPx: m.zoomBlurPx * rest };
}

/** Frames where pills give way to bigger text: the hook headline and the CTA card. */
export function captionHideRanges(t: Timeline): [number, number][] {
  const out: [number, number][] = [];
  const h = t.hook?.headline;
  if (h) out.push([h.fromFrame, h.fromFrame + h.durationInFrames]);
  if (t.ending?.kind === "cta") out.push([t.ending.fromFrame, t.ending.fromFrame + t.ending.durationInFrames]);
  return out;
}

/** Each page minus the hidden ranges (its longest visible part); pages left with fewer than minFrames are dropped. */
export function visiblePages<P extends { fromFrame: number; durationInFrames: number }>(pages: P[], hide: [number, number][], minFrames: number): P[] {
  const out: P[] = [];
  for (const p of pages) {
    let parts: [number, number][] = [[p.fromFrame, p.fromFrame + p.durationInFrames]];
    for (const [a, b] of hide) {
      parts = parts.flatMap(([s, e]): [number, number][] => (b <= s || a >= e ? [[s, e]] : [...(a > s ? [[s, a] as [number, number]] : []), ...(b < e ? [[b, e] as [number, number]] : [])]));
    }
    const best = parts.reduce<[number, number] | null>((m, x) => (!m || x[1] - x[0] > m[1] - m[0] ? x : m), null);
    if (best && best[1] - best[0] >= minFrames) out.push({ ...p, fromFrame: best[0], durationInFrames: best[1] - best[0] });
  }
  return out;
}
```
Change `speakerTransform` to take an optional multiplier (default output unchanged):
```ts
export function speakerTransform(crop: TimelineCrop, frame: number, durationInFrames: number, mult = 1): string {
  const s = Math.max(1, speakerScale(crop, frame, durationInFrames)) * mult;
```
(the rest of the function is unchanged). `clamp01` and `easeOutCubic` already exist in the file; `TimelineClip`/`Timeline` are new type imports.

Run the motion tests. Expected: PASS (including the existing `speakerTransform` cases).

- [ ] **Step 9: houseStyle and components.** In `packages/video/src/house-style.ts` change `captions` to:
```ts
  captions: {
    topPct: 45, fontSize: 66, textColor: "#000000", pillColor: "#FFFFFF", emphasisColor: "#E5262A", radius: 24, padX: 30, padY: 10, maxWidthPct: 86,
    // Bouncier than plan 1's 0.9 → 1 over 4 frames, which read as no animation in the first real reel.
    popFrames: 6, popFrom: 0.8,
    minVisibleFrames: 8,
    activeWord: { peak: 1.12, popFrames: 3, highlight: "#FEE80A", padX: 8, radius: 12 },
    emoji: { popFrames: 8, overshoot: 1.35 },
  },
  motion: { snapScale: 1.06, zoomBlurScale: 1.22, zoomBlurPx: 16 },
```
Update `house-style.test.ts`'s caption expectation to `{ topPct: 45, emphasisColor: "#E5262A", textColor: "#000000", pillColor: "#FFFFFF", popFrames: 6, popFrom: 0.8 }`.

Replace `packages/video/src/footage/PillCaptions.tsx`:
```tsx
import type { CaptionPage, Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { activeWordIndex, captionHideRanges, emojiScale, popBounce, visiblePages, wordPop } from "./motion";

const c = houseStyle.captions;

const PillPage: React.FC<{ page: CaptionPage; startAt: number; direction: Timeline["direction"] }> = ({ page, startAt, direction }) => {
  const frame = useCurrentFrame();
  const abs = startAt + frame;
  const active = activeWordIndex(page.words, abs);
  const emojiAt = page.words.at(-1)?.startFrame ?? startAt;
  return (
    <div style={{ position: "absolute", top: `${page.topPct ?? c.topPct}%`, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div
        dir={direction}
        style={{
          transform: `translateY(-50%) scale(${popBounce(frame, c.popFrames, c.popFrom).toFixed(4)})`,
          maxWidth: `${c.maxWidthPct}%`, background: c.pillColor, color: c.textColor, borderRadius: c.radius,
          padding: `${c.padY}px ${c.padX}px`, fontFamily: HEEBO, fontWeight: 800, fontSize: c.fontSize, lineHeight: 1.25, textAlign: "center", direction,
        }}
      >
        {page.words.map((w, i) => {
          const on = i === active;
          const pop = on ? wordPop(abs - (w.startFrame ?? startAt), c.activeWord.popFrames, c.activeWord.peak) : 1;
          return (
            <React.Fragment key={i}>
              {i > 0 ? " " : null}
              <span
                style={{
                  color: w.emphasis ? c.emphasisColor : undefined, unicodeBidi: "isolate", display: "inline-block",
                  transform: `scale(${pop.toFixed(4)})`,
                  ...(on ? { background: c.activeWord.highlight, borderRadius: c.activeWord.radius, padding: `0 ${c.activeWord.padX}px`, margin: `0 -${c.activeWord.padX}px` } : {}),
                }}
              >
                {w.text}
              </span>
            </React.Fragment>
          );
        })}
        {page.emoji ? (
          <span style={{ unicodeBidi: "isolate", display: "inline-block", marginInlineStart: "0.25em", transform: `scale(${emojiScale(abs - emojiAt, c.emoji.popFrames, c.emoji.overshoot).toFixed(4)})` }}>
            {page.emoji}
          </span>
        ) : null}
      </div>
    </div>
  );
};

/**
 * The footage caption preset "pill": rendered last in Reel, so it survives cuts. It gives way to the hook headline and
 * the CTA card (those show bigger text); the SRT keeps every page.
 */
export const PillCaptions: React.FC<{ timeline: Timeline }> = ({ timeline }) => (
  <AbsoluteFill>
    {visiblePages(timeline.captions.pages ?? [], captionHideRanges(timeline), c.minVisibleFrames).map((page, i) => (
      <Sequence key={i} from={page.fromFrame} durationInFrames={page.durationInFrames} layout="none">
        <PillPage page={page} startAt={page.fromFrame} direction={timeline.direction} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
```

- [ ] **Step 10: Commit 1a** with message `fix(footage): pill captions give way to the headline and CTA, sit below the face per page, and pop the spoken word and emoji` (plus the trailer). Run `npx vitest run packages/core packages/video/src/footage packages/video/src/house-style.test.ts && npm run typecheck` first. Expected: PASS.

#### 1b. Motion: recurring pattern breaks, punch-in snaps, zoom-blur entries

- [ ] **Step 11: Write the failing break tests** `packages/core/src/footage/breaks.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { testEditStyle } from "../testing/fixtures";
import { pickBreaks } from "./breaks";

const B = testEditStyle().breaks;
/** 15 shots of 2 s (60 frames) each: cuts at 0, 60, …, 840. */
const shots = (over: Record<number, number> = {}) => Array.from({ length: 15 }, (_, i) => ({ fromFrame: i * 60, frames: over[i] ?? 60 }));

describe("pickBreaks", () => {
  it("picks the cut closest to every 10 s inside the 8–12 s window, cycling the kinds, and skips blocked frames", () => {
    expect(pickBreaks(shots(), B, [[825, 900]], [])).toEqual([
      { index: 5, frame: 300, kind: "zoom_blur" },
      { index: 10, frame: 600, kind: "zoom_hit" },
    ]);
  });
  it("restarts the count at a cutaway (it is a break of its own); ties go to the earlier cut", () => {
    expect(pickBreaks(shots(), B, [], [450])).toEqual([
      { index: 5, frame: 300, kind: "zoom_blur" },
      { index: 12, frame: 720, kind: "zoom_hit" },
    ]);
  });
  it("skips shots shorter than minShotFrames", () => {
    expect(pickBreaks(shots({ 5: 10 }), B, [[600, 900]], [])[0]).toEqual({ index: 4, frame: 240, kind: "zoom_blur" });
  });
  it("never breaks at frame 0 (the hook owns it) and returns nothing for a short reel", () => {
    expect(pickBreaks(shots().slice(0, 4), B, [], [])).toEqual([]);
  });
});
```
Run `npx vitest run packages/core/src/footage/breaks.test.ts`. Expected: FAIL.

- [ ] **Step 12: Implement** `packages/core/src/footage/breaks.ts` (replace the placeholder):
```ts
import type { FaceBox } from "../schema/footage";
import type { TimelineClip } from "../schema/timeline";
import { centerFor, maxScaleFor, msToFrames } from "./shots";
import type { EditStyle } from "./style";

export type BreakKind = "zoom_hit" | "flash" | "zoom_blur";
export type PickedBreak = { index: number; frame: number; kind: BreakKind };

const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

/**
 * Pattern breaks after the hook: from the last break (or cutaway start, or frame 0), the eligible cut closest to
 * everyMs inside [minMs, maxMs]; when the window has none, the first eligible cut after it. Eligible: not the first
 * shot, at least minShotFrames long, not starting in a blocked range (CTA card, cutaways).
 */
export function pickBreaks(shots: { fromFrame: number; frames: number }[], b: EditStyle["breaks"], blocked: [number, number][], resets: number[]): PickedBreak[] {
  const every = msToFrames(b.everyMs);
  const min = msToFrames(b.minMs);
  const max = msToFrames(b.maxMs);
  const isBlocked = (f: number) => blocked.some(([from, to]) => f >= from && f < to);
  const eligible = shots
    .map((s, index) => ({ ...s, index }))
    .filter((s) => s.index > 0 && s.frames >= b.minShotFrames && !isBlocked(s.fromFrame));
  const sortedResets = [...resets].sort((x, y) => x - y);
  const out: PickedBreak[] = [];
  let last = 0;
  for (;;) {
    const nextReset = sortedResets.find((r) => r > last);
    if (nextReset !== undefined && nextReset <= last + max) {
      last = nextReset;
      continue;
    }
    const inWindow = eligible.filter((s) => s.fromFrame >= last + min && s.fromFrame <= last + max);
    const target = last + every;
    const pick =
      inWindow.reduce<(typeof eligible)[number] | undefined>((best, s) => (!best || Math.abs(s.fromFrame - target) < Math.abs(best.fromFrame - target) ? s : best), undefined) ??
      eligible.find((s) => s.fromFrame > last + max);
    if (!pick) break;
    if (nextReset !== undefined && nextReset <= pick.fromFrame) {
      last = nextReset;
      continue;
    }
    out.push({ index: pick.index, frame: pick.fromFrame, kind: b.kinds[out.length % b.kinds.length] });
    last = pick.fromFrame;
  }
  return out;
}

/**
 * Applies picked breaks to the clips: zoom_hit punches the clip in by hitFactor over zoomHitFrames (a face too big to
 * zoom turns it into zoom_blur); zoom_blur sets the clip's entry; flash is drawn by PatternBreak. Returns the timeline list.
 */
export function applyBreaks(clips: TimelineClip[], picked: PickedBreak[], faces: (FaceBox | null)[], style: EditStyle): { frame: number; kind: BreakKind }[] {
  return picked.map(({ index, frame, kind }) => {
    const clip = clips[index];
    let k = kind;
    if (k === "zoom_hit") {
      const base = clip.crop!.scaleFrom;
      const to = r4(Math.min(maxScaleFor(faces[index], style), base * style.breaks.hitFactor));
      if (to - base >= 0.05) clip.crop = { ...centerFor(faces[index], to), scaleFrom: base, scaleTo: to, punchFrames: style.zoomHitFrames };
      else k = "zoom_blur";
    }
    if (k === "zoom_blur") clip.enter = { kind: "zoom_blur", frames: style.breaks.zoomBlurFrames };
    return { frame, kind: k };
  });
}

/** A cut to a larger zoom step snaps in (unless the clip already punches or has an entry). */
export function addSnaps(clips: TimelineClip[], style: EditStyle): void {
  for (let i = 1; i < clips.length; i++) {
    const c = clips[i];
    const prev = clips[i - 1];
    if (c.enter || c.crop?.punchFrames || !c.crop || !prev.crop) continue;
    if (c.crop.scaleFrom > prev.crop.scaleFrom + 1e-6) c.enter = { kind: "snap", frames: style.snapFrames };
  }
}
```
Run the break tests. Expected: PASS.

- [ ] **Step 13: Wire breaks, snaps and their sound into `compileFootage`.** In `packages/core/src/footage/compile.ts` after the `shots.forEach` loop (before `lastShot`):
```ts
  const ctaFrames = Math.min(total, msToFrames(style.ctaMs));
  const ctaStart = plan.ending.kind === "cta" ? total - ctaFrames : total;
  const picked = pickBreaks(clips.map((c) => ({ fromFrame: c.fromFrame, frames: c.durationInFrames })), style.breaks, [[ctaStart, total]], []);
  const patternBreaks = applyBreaks(clips, picked, faces, style);
  addSnaps(clips, style);
```
(remove the later duplicate `const ctaFrames = …` line and reuse this one for `ending`). In the sound-effect block, right after the hook whoosh/pops and before the CTA pop:
```ts
    patternBreaks.forEach((b, i) => cues.push({ name: whooshes[(i + 1) % 2], frame: b.frame, volumeDb: style.sfxVolumeDb.whoosh }));
```
In `TimelineSchema.parse({...})` add `...(patternBreaks.length ? { patternBreaks } : {}),`. Import `addSnaps, applyBreaks, pickBreaks` from `./breaks`.

- [ ] **Step 14: Write the compile tests for motion.** Add to `compile.test.ts`:
```ts
/** 60 words of 400 ms with 100 ms gaps (no cut inside a beat), 6 beats of 10 words: shots start every 5 s. */
const longTalk = () => ({
  languageCode: "heb", languageProbability: 0.98, events: [],
  words: Array.from({ length: 60 }, (_, i) => ({ text: `מילה${i}`, startMs: i * 500, endMs: i * 500 + 400 })),
});
const longPlan = (over: Partial<EditPlan> = {}) => parseEditPlan({
  ...validEditPlan(),
  source: { ...validEditPlan().source, durationMs: 30_000 },
  beats: Array.from({ length: 6 }, (_, i) => ({ id: `b${i + 1}`, startWordIdx: i * 10, endWordIdx: i * 10 + 9, keep: true })),
  hook: { patternBreak: "none", reason: "" },
  ending: { kind: "none" },
  ...over,
});

describe("motion", () => {
  it("snaps punch-in cuts, never punch-outs or the first shot", () => {
    expect(compile().timeline.clips.map((c) => c.enter?.kind)).toEqual([undefined, "snap", "snap", undefined]);
  });
  it("adds a pattern break about every 10 s with a whoosh each: zoom blur, then zoom hit", () => {
    const { timeline } = compileFootage(longPlan(), longTalk(), null, assets, style);
    expect(timeline.clips.map((c) => c.fromFrame)).toEqual([0, 149, 299, 449, 599, 749]);
    expect(timeline.patternBreaks).toEqual([{ frame: 299, kind: "zoom_blur" }, { frame: 599, kind: "zoom_hit" }]);
    expect(timeline.clips[2].enter).toEqual({ kind: "zoom_blur", frames: 6 });
    expect(timeline.clips[4].crop).toMatchObject({ scaleFrom: 1.15, scaleTo: 1.38, punchFrames: 6 });
    expect(timeline.clips.map((c) => c.enter?.kind)).toEqual([undefined, "snap", "zoom_blur", undefined, undefined, "snap"]);
    expect(timeline.sfx?.map((c) => `${c.name}@${c.frame}`)).toEqual(["whoosh2@299", "whoosh1@599"]);
  });
  it("never breaks under the CTA card, and a short reel has no breaks", () => {
    const cta = compileFootage(longPlan({ ending: { kind: "cta", keyword: "AI" } }), longTalk(), null, assets, style).timeline;
    const ctaFrom = cta.ending!.kind === "cta" ? cta.ending.fromFrame : 0;
    expect((cta.patternBreaks ?? []).every((b) => b.frame < ctaFrom)).toBe(true);
    expect(compile().timeline.patternBreaks).toBeUndefined();
  });
});
```
Run `npx vitest run packages/core`. Expected: PASS; the existing sfx expectations are unchanged (the 7.3 s fixture has no break).

- [ ] **Step 15: Draw the breaks.** Replace `packages/video/src/footage/PatternBreak.tsx`:
```tsx
import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { houseStyle } from "../house-style";

/** White flash frames: the hook's (frame 0) and every recurring "flash" break. Zoom hits and zoom blurs live on the clips. */
export const PatternBreak: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const frames = [
    ...(timeline.hook?.patternBreak === "flash" ? [0] : []),
    ...(timeline.patternBreaks ?? []).filter((b) => b.kind === "flash").map((b) => b.frame),
  ];
  return (
    <>
      {frames.map((f) => (
        <Sequence key={f} from={f} durationInFrames={houseStyle.edit.flashFrames} layout="none">
          <AbsoluteFill style={{ backgroundColor: houseStyle.flash.color }} />
        </Sequence>
      ))}
    </>
  );
};
```
In `SpeakerShot.tsx` apply the entry:
```tsx
  const fx = enterEffect(clip.enter, frame, houseStyle.motion);
  ...
      <AbsoluteFill style={{ transform: speakerTransform(clip.crop, frame, clip.durationInFrames, fx.scale), ...(fx.blurPx > 0 ? { filter: `blur(${fx.blurPx.toFixed(2)}px)` } : {}) }}>
```
(import `enterEffect` from `./motion` and `houseStyle` from `../house-style`).

- [ ] **Step 16: Emoji more often.** In `footageSystemPrompt()` (`packages/engine/src/footage-planner.ts`) replace the emoji line with:
```ts
    "- emoji: in about one beat in four: 👆 or 👇 when the speaker points, or one emoji that fits the line (it pops in when the line ends). Empty otherwise.",
```
If a planner test pins the old wording, update it to the new line.

- [ ] **Step 17: Stills.** Replace `packages/video/src/sample-footage.ts` with a 210-frame sample that exercises every Task 1 change:
```ts
import type { CaptionPage, Timeline, TimelineClip } from "@reel/core";

/**
 * A 7 s footage timeline: headline 0–60 (pills hidden), three pill pages with word start frames, a low pill (62 %),
 * a flash break at 100 and a CTA card from 135. Graphic clips unless videoSrc is given.
 */
export function sampleFootageTimeline(lang: "he" | "en", videoSrc?: string): Timeline {
  const he = lang === "he";
  const texts = he ? [["היי", "חברים,"], ["היום", "אני", "אראה"], ["לכם", "טריק."]] : [["Hey", "friends,"], ["today", "I'll", "show"], ["you", "a trick."]];
  const spans = [[0, 30, [0, 15]], [30, 45, [30, 40, 52]], [75, 60, [75, 95]]] as const;
  const pages: CaptionPage[] = texts.map((ws, i) => ({
    fromFrame: spans[i][0],
    durationInFrames: spans[i][1],
    topPct: [58, 58, 62][i],
    words: ws.map((text, j) => ({ text, emphasis: i === 2 && j === ws.length - 1, startFrame: spans[i][2][j] })),
    ...(i === 2 ? { emoji: "👇" } : {}),
  }));
  const words = texts.flat().map((text, i) => ({ text, startMs: i * 400, endMs: i * 400 + 300 }));
  const clips: TimelineClip[] = videoSrc
    ? [
        { sceneId: "b1-1", kind: "speaker", src: videoSrc, fromFrame: 0, durationInFrames: 75, motion: "none", transitionIn: "cut", source: { inMs: 0, outMs: 2500 }, crop: { cx: 0.5, cy: 0.4, scaleFrom: 1, scaleTo: 1.3, punchFrames: 6 } },
        { sceneId: "b1-2", kind: "speaker", src: videoSrc, fromFrame: 75, durationInFrames: 135, motion: "none", transitionIn: "cut", source: { inMs: 2800, outMs: 7300 }, crop: { cx: 0.5, cy: 0.42, scaleFrom: 1.15, scaleTo: 1.242 }, enter: { kind: "zoom_blur", frames: 6 } },
      ]
    : [
        { sceneId: "g1", kind: "graphic", fromFrame: 0, durationInFrames: 75, motion: "none", transitionIn: "cut" },
        { sceneId: "g2", kind: "graphic", fromFrame: 75, durationInFrames: 135, motion: "zoom_in", transitionIn: "cut" },
      ];
  return {
    fps: 30, width: 1080, height: 1920, durationInFrames: 210, language: lang, direction: he ? "rtl" : "ltr",
    style: { captionPreset: "pill", font: "Heebo", palette: ["#3A2E5C", "#9F92C3"] },
    audio: { musicDuckingDb: -12 },
    clips,
    captions: { words, pages },
    overlays: [],
    hook: { patternBreak: "flash", headline: { small: he ? "הטריק ש" : "The trick that", big: he ? "חוסך שעות" : "saves hours", fromFrame: 0, durationInFrames: 60 } },
    patternBreaks: [{ frame: 100, kind: "flash" }],
    ending: { kind: "cta", keyword: "AI", fromFrame: 135, durationInFrames: 75 },
  };
}
```
In `footage-render.test.ts` replace the `it.each` table with `[["headline-only", 20], ["pill-active-word", 70], ["pill-emphasis-emoji", 110], ["cta-card", 160]]`. Run `npx vitest run packages/video/src/footage-render.test.ts`, then open `packages/video/work/stills/footage-*-he.png` and check: no pill at frame 20; at 70 the word "אראה" sits on a yellow marker at 58 %; at 110 the red "טריק." and 👇 sit at 62 %; at 160 only the CTA card. Expected: PASS and the stills look as described.

- [ ] **Step 18: Verify and commit 1b.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS. Commit with message `feat(footage): pattern breaks every ~10 s (zoom blur, zoom hit, flash) with whooshes, punch-in snaps, more emoji` (plus the trailer).

---
### Task 2: Migration, DB types, character setting and extra-upload checks

**Files:**
- Create: `supabase/migrations/20261013120000_footage_cutaways.sql`
- Modify: `packages/core/src/footage-form.ts`, `packages/db/src/index.ts`, `packages/db/src/database.types.ts`
- Test: `packages/core/src/footage-form.test.ts`, `packages/db/src/index.test.ts`

**Interfaces:**
- Produces (core):
  - `FootageSettingsSchema` gains `characterId?: string` (uuid, a `soul_characters.id`).
  - `EXTRA_MAX_FILES = 6`, `EXTRA_IMAGE_MAX_BYTES = 25 MiB`, `EXTRA_VIDEO_MAX_BYTES = 500 MiB`, `type ExtraExt = "mp4" | "mov" | "jpg" | "jpeg" | "png" | "webp"`, `extraExt(fileName): ExtraExt | null`, `extraKind(ext): "image" | "video"`, `extraStoragePath(projectId, n, ext): string`, `EXTRA_PATH_RE`, `extraLabel(fileName): string`, `checkExtraFiles(files: { name: string; size: number }[]): string[]`, `ExtraUploadSchema = { storagePath, label }`, `type ExtraUpload`.
- Produces (db): `IngestFootageJobPayloadSchema` gains `extras: ExtraUpload[]` (max 6, default `[]`); DB types gain table `soul_characters`.

- [ ] **Step 1: Write the failing core test.** Add to `packages/core/src/footage-form.test.ts`:
```ts
import { checkExtraFiles, EXTRA_PATH_RE, extraExt, extraKind, extraLabel, extraStoragePath, ExtraUploadSchema } from "./footage-form";

describe("extra uploads", () => {
  const id = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
  it("accepts up to 6 photos and clips under their limits", () => {
    expect(checkExtraFiles([{ name: "screen.PNG", size: 2_000_000 }, { name: "demo.mov", size: 300_000_000 }])).toEqual([]);
    expect(checkExtraFiles([])).toEqual([]);
  });
  it("rejects other types (with a HEIC hint), oversized and empty files, and a seventh file", () => {
    expect(checkExtraFiles([{ name: "IMG_1.HEIC", size: 1000 }])).toEqual(["IMG_1.HEIC: use a JPG, PNG or WEBP photo (convert HEIC to JPG first), or an MP4 or MOV clip."]);
    expect(checkExtraFiles([{ name: "big.jpg", size: 25 * 1024 ** 2 + 1 }])).toEqual(["big.jpg: photos can be at most 25 MB."]);
    expect(checkExtraFiles([{ name: "long.mp4", size: 500 * 1024 ** 2 + 1 }])).toEqual(["long.mp4: clips can be at most 500 MB."]);
    expect(checkExtraFiles([{ name: "x.png", size: 0 }])).toEqual(["x.png is empty."]);
    expect(checkExtraFiles(Array.from({ length: 7 }, (_, i) => ({ name: `${i}.jpg`, size: 10 })))).toEqual(["Add at most 6 extra files."]);
  });
  it("builds paths, kinds and labels", () => {
    expect(extraStoragePath(id, 3, "jpeg")).toBe(`footage/${id}/extra-3.jpeg`);
    expect(EXTRA_PATH_RE.test(`footage/${id}/extra-6.webp`)).toBe(true);
    expect(EXTRA_PATH_RE.test(`footage/${id}/extra-7.webp`)).toBe(false);
    expect(EXTRA_PATH_RE.test(`footage/${id}/source.mp4`)).toBe(false);
    expect(extraExt("A.JPG")).toBe("jpg");
    expect(extraKind("mov")).toBe("video");
    expect(extraKind("png")).toBe("image");
    expect(extraLabel("my screen recording.mov")).toBe("my screen recording");
    expect(extraLabel(".png")).toBe("Upload");
  });
  it("validates an extra upload and the optional character", () => {
    expect(ExtraUploadSchema.parse({ storagePath: `footage/${id}/extra-1.png`, label: " screenshot " }).label).toBe("screenshot");
    expect(() => ExtraUploadSchema.parse({ storagePath: `footage/${id}/extra-1.png`, label: "" })).toThrow();
    expect(FootageSettingsSchema.parse({ language: "he", targetDurationSec: 30, characterId: id }).characterId).toBe(id);
    expect(() => FootageSettingsSchema.parse({ language: "he", targetDurationSec: 30, characterId: "me" })).toThrow();
  });
});
```
Run `npx vitest run packages/core/src/footage-form.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** in `packages/core/src/footage-form.ts`. Add `characterId: z.uuid().optional(),` to `FootageSettingsSchema`, then append:
```ts
export const EXTRA_MAX_FILES = 6;
export const EXTRA_IMAGE_MAX_BYTES = 25 * 1024 ** 2;
export const EXTRA_VIDEO_MAX_BYTES = 500 * 1024 ** 2;
export type ExtraExt = "mp4" | "mov" | "jpg" | "jpeg" | "png" | "webp";
const EXTRA_EXTS: readonly ExtraExt[] = ["mp4", "mov", "jpg", "jpeg", "png", "webp"];
export const EXTRA_PATH_RE = /^footage\/[0-9a-f-]{36}\/extra-[1-6]\.(mp4|mov|jpg|jpeg|png|webp)$/;

export function extraExt(fileName: string): ExtraExt | null {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return (EXTRA_EXTS as readonly string[]).includes(ext) ? (ext as ExtraExt) : null;
}
export const extraKind = (ext: ExtraExt): "image" | "video" => (ext === "mp4" || ext === "mov" ? "video" : "image");
export const extraStoragePath = (projectId: string, n: number, ext: ExtraExt) => `footage/${projectId}/extra-${n}.${ext}`;
export function extraLabel(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, "").trim();
  return base ? Array.from(base).slice(0, 80).join("") : "Upload";
}

/** Browser and server checks for the optional extra photos and clips (used as cutaways). */
export function checkExtraFiles(files: { name: string; size: number }[]): string[] {
  if (files.length > EXTRA_MAX_FILES) return [`Add at most ${EXTRA_MAX_FILES} extra files.`];
  const errors: string[] = [];
  for (const f of files) {
    const ext = extraExt(f.name);
    if (!ext) {
      errors.push(`${f.name}: use a JPG, PNG or WEBP photo${/\.hei[cf]$/i.test(f.name) ? " (convert HEIC to JPG first)" : ""}, or an MP4 or MOV clip.`);
      continue;
    }
    if (f.size === 0) errors.push(`${f.name} is empty.`);
    else if (extraKind(ext) === "image" && f.size > EXTRA_IMAGE_MAX_BYTES) errors.push(`${f.name}: photos can be at most 25 MB.`);
    else if (extraKind(ext) === "video" && f.size > EXTRA_VIDEO_MAX_BYTES) errors.push(`${f.name}: clips can be at most 500 MB.`);
  }
  return errors;
}

export const ExtraUploadSchema = z.object({ storagePath: z.string().regex(EXTRA_PATH_RE), label: z.string().trim().min(1).max(80) });
export type ExtraUpload = z.infer<typeof ExtraUploadSchema>;
```
Run the test. Expected: PASS.

- [ ] **Step 3: Payload, failing db test first.** Add to `packages/db/src/index.test.ts`:
```ts
describe("ingest payload extras", () => {
  const id = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
  const base = { storagePath: `footage/${id}/source.mp4`, settings: { language: "he", targetDurationSec: 30 } };
  it("defaults to no extras and accepts up to 6", () => {
    expect(IngestFootageJobPayloadSchema.parse(base).extras).toEqual([]);
    const extras = Array.from({ length: 6 }, (_, i) => ({ storagePath: `footage/${id}/extra-${i + 1}.jpg`, label: `p${i}` }));
    expect(IngestFootageJobPayloadSchema.parse({ ...base, extras }).extras).toHaveLength(6);
    expect(() => IngestFootageJobPayloadSchema.parse({ ...base, extras: [...extras, extras[0]] })).toThrow();
  });
});
```
Run `npx vitest run packages/db`. Expected: FAIL. Then change the schema in `packages/db/src/index.ts` (import `ExtraUploadSchema` from `@reel/core`):
```ts
export const IngestFootageJobPayloadSchema = z.object({
  storagePath: z.string().regex(FOOTAGE_PATH_RE),
  settings: FootageSettingsSchema,
  /** Extra photos and clips the user uploaded with the video (cutaway material). */
  extras: z.array(ExtraUploadSchema).max(6).default([]),
});
```
Run again. Expected: PASS (plan 1's payloads without `extras` still parse).

- [ ] **Step 4: Write the migration** `supabase/migrations/20261013120000_footage_cutaways.sql`:
```sql
-- Footage editor, plan 2: extra photos and clips uploaded with the video, and the team's Soul ID characters.

-- The owner of an 'uploading' footage project may also upload up to six extra files next to the source video.
drop policy "owners upload footage" on storage.objects;
drop policy "owners replace footage" on storage.objects;
create policy "owners upload footage" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assets'
    and name ~ '^footage/[0-9a-f-]{36}/(source\.(mp4|mov)|extra-[1-6]\.(mp4|mov|jpg|jpeg|png|webp))$'
    and exists (
      select 1 from public.projects p
       where p.id::text = split_part(name, '/', 2)
         and p.owner_id = (select auth.uid())
         and p.status = 'uploading'));
create policy "owners replace footage" on storage.objects for update to authenticated
  using (
    bucket_id = 'assets'
    and name ~ '^footage/[0-9a-f-]{36}/(source\.(mp4|mov)|extra-[1-6]\.(mp4|mov|jpg|jpeg|png|webp))$'
    and exists (
      select 1 from public.projects p
       where p.id::text = split_part(name, '/', 2)
         and p.owner_id = (select auth.uid())
         and p.status = 'uploading'))
  with check (
    bucket_id = 'assets'
    and name ~ '^footage/[0-9a-f-]{36}/(source\.(mp4|mov)|extra-[1-6]\.(mp4|mov|jpg|jpeg|png|webp))$');

-- Soul ID characters, trained once with the higgsfield-soul-id flow; reference_id is Higgsfield's custom reference id.
create table public.soul_characters (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  reference_id text not null unique check (reference_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index soul_characters_created_by_idx on public.soul_characters (created_by);
alter table public.soul_characters enable row level security;
create policy "team reads characters" on public.soul_characters for select to authenticated using (true);
create policy "members add characters" on public.soul_characters for insert to authenticated
  with check (created_by = (select auth.uid()));
revoke update, delete on public.soul_characters from authenticated;
revoke all on public.soul_characters from anon;
```

- [ ] **Step 5: Hand-edit `packages/db/src/database.types.ts`.** Add the table between `renders` and `storyboards` (alphabetical order):
```ts
      soul_characters: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          reference_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          name: string
          reference_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          reference_id?: string
        }
        Relationships: []
      }
```

- [ ] **Step 6: Verify and commit.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS. Commit with message `feat(footage): migration for extra uploads and Soul ID characters; extra-file checks and the character setting`.

---

### Task 3: EditPlan cutaways, extras and character; plan-1 limits lifted

**Files:**
- Modify: `packages/core/src/schema/footage.ts`, `packages/core/src/schema/edit-plan.ts`, `packages/core/src/testing/fixtures.ts`
- Test: `packages/core/src/schema/edit-plan.test.ts`

**Interfaces:**
- Consumes: Task 2's `ExtraUpload` labels (copied into `FootageExtra.label` at ingest).
- Produces:
  - `AssetHashSchema` (64-hex), `FootageExtraSchema`, `type FootageExtra = { assetId; kind: "image" | "video"; width; height; durationMs; label }`; `FootageSource.extras: FootageExtra[]` (default `[]`).
  - `DiagramTemplateSchema` (`compare | list | flow`), `CutawayMediaSchema` (`image | video`), `CutawaySourceSchema`, `CutawaySchema`, `type Cutaway`, `type CutawaySource`.
  - `EditPlan.character?: { id: string; name: string }`.
  - `NOT_YET = { background }`, `notYetIssues(plan): string[]` (replace `NOT_IN_PLAN_ONE` / `planOneIssues`).
  - `EditPlanDraftSchema`: beats gain `cutaway: { kind: "none" | "ai_broll" | "ai_self" | "upload" | "diagram"; media: "image" | "video"; prompt; uploadId; template: "compare" | "list" | "flow"; items: string[]; layout: "full" | "split"; atMs; durationMs }`; `hook.patternBreak` allows `"broll"`. Export `NO_CUTAWAY` (the draft's empty cutaway).
  - Fixtures: `EXTRA_IMG = "d".repeat(64)`, `EXTRA_VID = "e".repeat(64)`, `fixtureExtras(): FootageExtra[]`, `CHARACTER_ID`.

- [ ] **Step 1: Fixtures.** Add to `packages/core/src/testing/fixtures.ts` (import `FootageExtra` type from `../schema/footage`):
```ts
export const EXTRA_IMG = "d".repeat(64);
export const EXTRA_VID = "e".repeat(64);
export const CHARACTER_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
/** A landscape screenshot and a 2 s portrait clip, as ingest stores them. */
export const fixtureExtras = (): FootageExtra[] => [
  { assetId: EXTRA_IMG, kind: "image", width: 1920, height: 1080, durationMs: 0, label: "צילום מסך" },
  { assetId: EXTRA_VID, kind: "video", width: 1080, height: 1920, durationMs: 2000, label: "demo clip" },
];
```

- [ ] **Step 2: Replace the plan-1 limit tests with plan-2 tests.** In `packages/core/src/schema/edit-plan.test.ts` replace the whole `describe("plan 1 limits", …)` block with:
```ts
const withCutaway = (cutaway: unknown, beat = 0, over: object = {}) => ({
  ...validEditPlan(),
  source: { ...validEditPlan().source, extras: fixtureExtras() },
  beats: validEditPlan().beats.map((b, i) => (i === beat ? { ...b, cutaway } : b)),
  ...over,
});
const broll = { source: { kind: "ai_broll", prompt: "laptop on a desk", media: "image" }, layout: "full", atMs: 0, durationMs: 1500 };
const message = (p: unknown) => { try { parseEditPlan(p); return ""; } catch (err) { return (err as Error).message; } };

describe("cutaways (plan 2)", () => {
  it("accepts every cutaway kind and both layouts", () => {
    expect(parseEditPlan(withCutaway(broll)).beats[0].cutaway).toEqual(broll);
    expect(() => parseEditPlan(withCutaway({ ...broll, layout: "split", source: { kind: "upload", assetId: EXTRA_IMG } }))).not.toThrow();
    expect(() => parseEditPlan(withCutaway({ ...broll, source: { kind: "diagram", template: "list", items: ["אחת", "שתיים", "שלוש"] } }))).not.toThrow();
    expect(() => parseEditPlan(withCutaway({ ...broll, source: { kind: "ai_self", prompt: "on a plane", media: "video" } }, 0, { character: { id: CHARACTER_ID, name: "Alex" } }))).not.toThrow();
  });
  it("keeps cutaways 1–3 s long", () => {
    expect(message(withCutaway({ ...broll, durationMs: 900 }))).toMatch(/durationMs/);
    expect(message(withCutaway({ ...broll, durationMs: 3100 }))).toMatch(/durationMs/);
  });
  it("needs uploads from this video, a character for AI shots of you, and the right number of diagram items", () => {
    expect(message(withCutaway({ ...broll, source: { kind: "upload", assetId: "f".repeat(64) } }))).toContain("Beat b1 uses an upload that isn't part of this video. Pick one of its uploads.");
    expect(message(withCutaway({ ...broll, source: { kind: "ai_self", prompt: "on a plane", media: "image" } }))).toContain("Beat b1 has an AI shot of you, but no character is picked. Pick one in Settings or remove the shot.");
    expect(message(withCutaway({ ...broll, source: { kind: "diagram", template: "compare", items: ["a", "b", "c"] } }))).toContain("A compare diagram has exactly 2 items.");
    expect(message(withCutaway({ ...broll, source: { kind: "diagram", template: "flow", items: ["a", "b", "c", "d"] } }))).toContain("A flow diagram has 2 or 3 steps.");
  });
  it("allows the B-roll pattern break only with a cutaway on a kept beat", () => {
    const hook = { ...validEditPlan().hook, patternBreak: "broll" };
    expect(() => parseEditPlan(withCutaway(broll, 0, { hook }))).not.toThrow();
    expect(message({ ...validEditPlan(), hook })).toContain("The B-roll pattern break needs a cutaway on a kept beat: add one, or pick zoom hit, flash or none.");
  });
  it("still rejects background replacement (plan 3)", () => {
    expect(message({ ...validEditPlan(), background: { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "office" } }] } }))
      .toContain("Background replacement arrives in a later update: keep the original background.");
  });
  it("parses plan-1 plans (no extras) unchanged", () => {
    const { extras: _none, ...plan1Source } = validEditPlan().source;
    expect(parseEditPlan({ ...validEditPlan(), source: plan1Source }).source.extras).toEqual([]);
  });
});

describe("Claude's draft schema", () => {
  it("offers cutaways and the B-roll break but never background replacement", () => {
    const json = JSON.stringify(EditPlanDraftSchema.toJSONSchema());
    expect(json).toMatch(/cutaway/);
    expect(json).toMatch(/broll/);
    expect(json).not.toMatch(/background/);
  });
  it("sends Claude a draft schema without min/max bounds", () => {
    expect(JSON.stringify(EditPlanDraftSchema.toJSONSchema())).not.toMatch(/minimum|maximum|minLength|maxLength|minItems|maxItems/);
  });
});
```
(add `CHARACTER_ID, EXTRA_IMG, fixtureExtras` to the fixtures import). Run `npx vitest run packages/core/src/schema/edit-plan.test.ts`. Expected: FAIL.

- [ ] **Step 3: Source extras** in `packages/core/src/schema/footage.ts`: rename the local `HASH` to an exported `AssetHashSchema` (keep using it in `FootageSourceSchema`), then:
```ts
/** An extra photo or clip uploaded with the video, conformed and stored by ingest. durationMs is 0 for photos. */
export const FootageExtraSchema = z.object({
  assetId: AssetHashSchema,
  kind: z.enum(["image", "video"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().nonnegative(),
  label: z.string().trim().min(1).max(80),
});
export type FootageExtra = z.infer<typeof FootageExtraSchema>;
```
and add `extras: z.array(FootageExtraSchema).max(6).default([]),` to `FootageSourceSchema` (after `faceTrackAssetId`). `FootageSource` now always has `extras`: add `extras: []` to the source `ingestFootage` returns (Task 8 fills it) and `extras: [] as FootageExtra[]` to `validEditPlan().source` in the fixtures.

- [ ] **Step 4: Cutaway schema and rules** in `packages/core/src/schema/edit-plan.ts`. Replace the private `CutawaySchema` with:
```ts
export const DiagramTemplateSchema = z.enum(["compare", "list", "flow"]);
export const CutawayMediaSchema = z.enum(["image", "video"]);
export const CutawaySourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ai_broll"), prompt: Prompt, media: CutawayMediaSchema }),
  z.object({ kind: z.literal("ai_self"), prompt: Prompt, media: CutawayMediaSchema }),
  z.object({ kind: z.literal("upload"), assetId: AssetHashSchema }),
  z.object({ kind: z.literal("diagram"), template: DiagramTemplateSchema, items: z.array(z.string().trim().min(1).max(40)).min(2).max(4) }),
]);
export type CutawaySource = z.infer<typeof CutawaySourceSchema>;
/** Spec §3: atMs is measured from the beat's first reel frame (after pause cuts). */
export const CutawaySchema = z.object({
  source: CutawaySourceSchema,
  layout: z.enum(["full", "split"]),
  atMs: z.number().int().nonnegative(),
  durationMs: z.number().int().min(1000).max(3000),
});
export type Cutaway = z.infer<typeof CutawaySchema>;
```
(import `AssetHashSchema` from `./footage`). Add `character: z.object({ id: z.uuid(), name: z.string().trim().min(1).max(40) }).optional(),` to `EditPlanSchema` after `sfx`. Add to the `superRefine` body, after the beat loop:
```ts
    const extras = new Set(plan.source.extras.map((e) => e.assetId));
    plan.beats.forEach((b, i) => {
      const s = b.cutaway?.source;
      if (!s) return;
      const path = ["beats", i, "cutaway", "source"];
      if (s.kind === "upload" && !extras.has(s.assetId)) ctx.addIssue({ code: "custom", path, message: `Beat ${b.id} uses an upload that isn't part of this video. Pick one of its uploads.` });
      if (s.kind === "ai_self" && !plan.character) ctx.addIssue({ code: "custom", path, message: `Beat ${b.id} has an AI shot of you, but no character is picked. Pick one in Settings or remove the shot.` });
      if (s.kind === "diagram" && s.template === "compare" && s.items.length !== 2) ctx.addIssue({ code: "custom", path, message: "A compare diagram has exactly 2 items." });
      if (s.kind === "diagram" && s.template === "flow" && s.items.length > 3) ctx.addIssue({ code: "custom", path, message: "A flow diagram has 2 or 3 steps." });
    });
    if (plan.hook.patternBreak === "broll" && !plan.beats.some((b) => b.keep && b.cutaway)) {
      ctx.addIssue({ code: "custom", path: ["hook", "patternBreak"], message: "The B-roll pattern break needs a cutaway on a kept beat: add one, or pick zoom hit, flash or none." });
    }
```
Replace `NOT_IN_PLAN_ONE` and `planOneIssues` with:
```ts
export const NOT_YET = { background: "Background replacement arrives in a later update: keep the original background." };

/** What the schema describes but no plan renders yet (plan 3 removes this). */
export function notYetIssues(plan: EditPlan): string[] {
  return plan.background.mode === "replace" ? [NOT_YET.background] : [];
}
```
and use `notYetIssues` in `parseEditPlan`. The issue path printing stays as is (`beats.0.cutaway.source: Beat b1 …`), so `toContain` matches.

- [ ] **Step 5: Claude's draft.** Replace the draft's beat object and pattern break:
```ts
/** The draft's flat cutaway (one object, no unions, so structured outputs stay simple). kind "none" = no cutaway. */
const DraftCutawaySchema = z.object({
  kind: z.enum(["none", "ai_broll", "ai_self", "upload", "diagram"]),
  media: z.enum(["image", "video"]),
  prompt: z.string(),
  uploadId: z.string(),
  template: z.enum(["compare", "list", "flow"]),
  items: z.array(z.string()),
  layout: z.enum(["full", "split"]),
  atMs: z.number(),
  durationMs: z.number(),
});
export type DraftCutaway = z.infer<typeof DraftCutawaySchema>;
export const NO_CUTAWAY: DraftCutaway = { kind: "none", media: "image", prompt: "", uploadId: "", template: "list", items: [], layout: "full", atMs: 0, durationMs: 0 };
```
In `EditPlanDraftSchema`: beats become `z.array(z.object({ id: z.string(), keep: z.boolean(), dropReason: z.string(), emphasisWordIdx: z.number(), emoji: z.string(), cutaway: DraftCutawaySchema }))` and `patternBreak: z.enum(["zoom_hit", "flash", "broll", "none"])`. Update the doc comment: "uploadId is the x1…x6 id from the prompt; code maps it to the asset".

The existing engine fixtures that build drafts (`footage-planner.test.ts` `draft()`, `providers/fake.ts`) now need `cutaway: NO_CUTAWAY` on every draft beat: add it in both (Task 9 builds on this). In `packages/web` nothing builds drafts.

- [ ] **Step 6: Verify and commit.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS. Commit with message `feat(core): edit plan cutaways (AI B-roll, AI shots of you, uploads, diagrams), extras and character; B-roll pattern break allowed`.

---
### Task 4: Cutaway placement rules, budget and prices

**Files:**
- Create: `packages/core/src/footage/cutaways.ts`
- Modify: `packages/core/src/footage/style.ts`, `packages/core/src/cost.ts`, `packages/core/src/footage/compile.ts` (`withFootageEstimate`), `packages/core/src/testing/fixtures.ts`, `packages/video/src/house-style.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/footage/cutaways.test.ts` (new), `packages/core/src/cost.test.ts`, `packages/core/src/footage/compile.test.ts`

**Interfaces:**
- Consumes: `CutawaySchema`, `Cutaway`, `CutawaySource` (Task 3); `planShots`, `msToFrames`, `framesToMs`, `PlannedShot` (plan 1).
- Produces:
  - `EditStyle.cutaways = { minMs: number; minSpeakerShare: number; brollBreakMs: number; kenBurns: number; contentFitRatio: number }`.
  - `type PlacedCutaway = { beatId: string; source: CutawaySource; layout: "full" | "split"; fromFrame: number; durationInFrames: number; pulled: boolean }`; `type CutawayPlacement = { placed: PlacedCutaway[]; warnings: string[] }`.
  - `ctaStartFrame(plan, total, style): number`; `placeCutaways(plan, shots, style): CutawayPlacement`; `planCutaways(plan, words, style): CutawayPlacement`.
  - `type CutawayBudget = { max: number; maxVideo: number; maxSelf: number }`; `cutawayBudget(targetSec, hasCharacter): CutawayBudget`; `applyCutawayBudget(beats, budget, targetSec): { beats; warnings }`.
  - `cost.ts`: `unitPrice(table, model, key)` (was private `price`), `cutawayCost(source, durationMs, table?)`, `estimateFootageCost(plan, durationSec, table?, placed?: PlacedCutaway[])`.

- [ ] **Step 1: Style.** Add to `EditStyleSchema`:
```ts
  /** Spec §5.4–5.5. contentFitRatio: an upload whose aspect differs from its slot by more than this is shown whole on a blurred fill. */
  cutaways: z.object({
    minMs: z.number().positive(),
    minSpeakerShare: z.number().min(0).max(1),
    brollBreakMs: z.number().positive(),
    kenBurns: z.number().min(1).max(1.5),
    contentFitRatio: z.number().min(1),
  }),
```
and to `houseStyle.edit` and `testEditStyle()`:
```ts
    cutaways: { minMs: 1000, minSpeakerShare: 0.4, brollBreakMs: 1000, kenBurns: 1.06, contentFitRatio: 1.3 },
```
(comment in houseStyle: `// spec §5.5: ≥ 40 % shows the speaker; §5.7: B-roll break 1 s; §6: stills +6 % Ken Burns`).

- [ ] **Step 2: Write the failing placement test** `packages/core/src/footage/cutaways.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseEditPlan, type Cutaway, type EditPlan } from "../schema/edit-plan";
import { footageTranscript, testEditStyle, validEditPlan } from "../testing/fixtures";
import { applyCutawayBudget, cutawayBudget, planCutaways } from "./cutaways";

const style = testEditStyle();
const words = footageTranscript().words;
const img = (atMs: number, durationMs: number, layout: "full" | "split" = "full"): Cutaway => ({ source: { kind: "ai_broll", prompt: "laptop", media: "image" }, layout, atMs, durationMs });
const plan = (cuts: Record<string, Cutaway>, over: Partial<EditPlan> = {}) =>
  parseEditPlan({ ...validEditPlan(), beats: validEditPlan().beats.map((b) => (cuts[b.id] ? { ...b, cutaway: cuts[b.id] } : b)), ...over });
const show = (p: EditPlan) => planCutaways(p, words, style);

// Fixture reel: b1 = frames 0–89, b2 = 89–146, b3 = 146–218; the CTA card starts at 143.
describe("placeCutaways", () => {
  it("places each cutaway at beat start + atMs, clips it to its beat and keeps it off the CTA card", () => {
    const r = show(plan({ b1: img(500, 1500), b2: img(0, 3000), b3: img(0, 1000) }));
    expect(r.placed.map((c) => [c.beatId, c.fromFrame, c.durationInFrames, c.layout])).toEqual([["b1", 15, 45, "full"], ["b2", 89, 54, "full"]]);
    expect(r.warnings).toEqual([
      "The cutaway in b2 was shortened to 1.8 s: it ran under the CTA card.",
      "The cutaway in b3 was dropped: it ran under the CTA card.",
    ]);
  });
  it("B-roll pattern break: the first cutaway moves to 0 s, full screen, 1 s; the next one never overlaps it", () => {
    const beats = [
      { id: "b1", startWordIdx: 0, endWordIdx: 1, keep: true, cutaway: img(300, 2000, "split") },
      { id: "b2", startWordIdx: 2, endWordIdx: 7, keep: true, cutaway: img(0, 1500) },
      { id: "b3", startWordIdx: 8, endWordIdx: 11, keep: true },
      { id: "b4", startWordIdx: 12, endWordIdx: 14, keep: true },
    ];
    const r = show(parseEditPlan({ ...validEditPlan(), beats, hook: { patternBreak: "broll", reason: "" } }));
    expect(r.placed.map((c) => [c.beatId, c.fromFrame, c.durationInFrames, c.layout, c.pulled])).toEqual([["b1", 0, 30, "full", true], ["b2", 30, 41, "full", false]]);
    expect(r.warnings).toEqual(["The cutaway in b2 was shortened to 1.4 s: it overlapped the previous cutaway."]);
  });
  it("keeps at least 40 % of the reel on the speaker (split counts as speaker)", () => {
    const loop = { ending: { kind: "loop" as const } }; // 194 frames: full cutaways may cover 116
    const r = show(plan({ b1: img(0, 2500), b2: img(0, 3000), b3: img(0, 1000) }, loop));
    expect(r.placed.map((c) => [c.beatId, c.fromFrame, c.durationInFrames])).toEqual([["b1", 0, 75], ["b2", 89, 41]]);
    expect(r.warnings).toEqual([
      "The cutaway in b2 was shortened to 1.4 s: at least 40% of the reel must show you.",
      "The cutaway in b3 was dropped: at least 40% of the reel must show you.",
    ]);
    expect(show(plan({ b1: img(0, 2500), b2: img(0, 3000), b3: img(0, 1000, "split") }, loop)).placed.map((c) => c.beatId)).toEqual(["b1", "b2", "b3"]);
  });
  it("follows the cold open's reel order and ignores dropped beats", () => {
    const cold = plan({ b1: img(0, 1000), b2: img(0, 1000) }, { hook: { coldOpenBeatId: "b2", patternBreak: "none", reason: "" } });
    expect(show(cold).placed.map((c) => [c.beatId, c.fromFrame])).toEqual([["b2", 0], ["b1", 57]]);
    const dropped = parseEditPlan({ ...validEditPlan(), beats: validEditPlan().beats.map((b) => (b.id === "b2" ? { ...b, keep: false, cutaway: img(0, 1000) } : b)) });
    expect(show(dropped).placed).toEqual([]);
  });
  it("is deterministic", () => {
    const p = plan({ b1: img(500, 1500), b2: img(0, 3000) });
    expect(JSON.stringify(show(p))).toBe(JSON.stringify(show(p)));
  });
});

describe("cutaway budget", () => {
  it("scales with the target length", () => {
    expect(cutawayBudget(15, false)).toEqual({ max: 3, maxVideo: 1, maxSelf: 0 });
    expect(cutawayBudget(30, true)).toEqual({ max: 6, maxVideo: 2, maxSelf: 1 });
    expect(cutawayBudget(90, true)).toEqual({ max: 18, maxVideo: 6, maxSelf: 4 });
  });
  it("removes AI shots of you without a character, then extras past the maximum, then turns surplus clips into stills", () => {
    const vid = (kind: "ai_broll" | "ai_self"): Cutaway => ({ source: { kind, prompt: "x", media: "video" }, layout: "full", atMs: 0, durationMs: 1000 });
    const beats = [
      { id: "b1", keep: true, cutaway: vid("ai_broll") },
      { id: "b2", keep: true, cutaway: vid("ai_broll") },
      { id: "b3", keep: true, cutaway: vid("ai_self") },
      { id: "b4", keep: false, cutaway: vid("ai_broll") },
      { id: "b5", keep: true, cutaway: { source: { kind: "diagram", template: "list", items: ["a", "b"] }, layout: "full", atMs: 0, durationMs: 1000 } as Cutaway },
      { id: "b6", keep: true, cutaway: vid("ai_broll") },
    ];
    const r = applyCutawayBudget(beats, cutawayBudget(15, false), 15);
    expect(r.beats.map((b) => b.cutaway && ("media" in b.cutaway.source ? `${b.cutaway.source.kind}:${b.cutaway.source.media}` : b.cutaway.source.kind))).toEqual(
      ["ai_broll:video", "ai_broll:image", undefined, "ai_broll:video", "diagram", undefined],
    );
    expect(r.warnings).toEqual([
      "1 AI shots of you were removed (no character is picked).",
      "1 cutaways were removed (at most 3 for a 15 s reel).",
      "1 video cutaways became stills (at most 1 clips for a 15 s reel).",
    ]);
  });
});
```
Run `npx vitest run packages/core/src/footage/cutaways.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `packages/core/src/footage/cutaways.ts`:
```ts
import type { Cutaway, CutawaySource, EditPlan } from "../schema/edit-plan";
import type { Word } from "../schema/timeline";
import { framesToMs, msToFrames, planShots, type PlannedShot } from "./shots";
import type { EditStyle } from "./style";

export type PlacedCutaway = { beatId: string; source: CutawaySource; layout: "full" | "split"; fromFrame: number; durationInFrames: number; pulled: boolean };
export type CutawayPlacement = { placed: PlacedCutaway[]; warnings: string[] };

const secs = (frames: number) => (framesToMs(frames) / 1000).toFixed(1);

/** First frame of the CTA card (the reel's length when the ending isn't a CTA). Same rule as compileFootage. */
export function ctaStartFrame(plan: Pick<EditPlan, "ending">, total: number, style: EditStyle): number {
  return plan.ending.kind === "cta" ? total - Math.min(total, msToFrames(style.ctaMs)) : total;
}

/**
 * Spec §5.4–5.5, in reel order (the B-roll break's cutaway first): place at beat start + atMs, clip to the beat,
 * never overlap the previous cutaway, never under the CTA card, full cutaways cover at most (1 − minSpeakerShare) of
 * the reel. Shortened below minMs: dropped. Every trim or drop is a warning.
 */
export function placeCutaways(plan: Pick<EditPlan, "beats" | "hook" | "ending">, shots: PlannedShot[], style: EditStyle): CutawayPlacement {
  const total = shots.reduce((n, s) => n + s.frames, 0);
  const ctaStart = ctaStartFrame(plan, total, style);
  const spans = new Map<string, [number, number]>();
  let at = 0;
  for (const s of shots) {
    const span = spans.get(s.beatId);
    spans.set(s.beatId, span ? [span[0], at + s.frames] : [at, at + s.frames]);
    at += s.frames;
  }
  const beats = new Map(plan.beats.map((b) => [b.id, b]));
  const order = [...spans.keys()].filter((id) => beats.get(id)?.cutaway);
  const pullId = plan.hook.patternBreak === "broll" ? order[0] : undefined;
  const minFrames = msToFrames(style.cutaways.minMs);
  const maxFull = Math.floor(total * (1 - style.cutaways.minSpeakerShare));
  const share = `at least ${Math.round(style.cutaways.minSpeakerShare * 100)}% of the reel must show you`;
  const placed: PlacedCutaway[] = [];
  const warnings: string[] = [];
  let prevEnd = 0;
  let fullUsed = 0;
  for (const id of order) {
    const c = beats.get(id)!.cutaway!;
    const pulled = id === pullId;
    const [beatStart, beatEnd] = pulled ? [0, total] : spans.get(id)!;
    const wanted = msToFrames(pulled ? style.cutaways.brollBreakMs : c.durationMs);
    const layout = pulled ? "full" : c.layout;
    let from = pulled ? 0 : beatStart + msToFrames(c.atMs);
    let why = "";
    if (from >= beatEnd) why = "it starts after its beat ends once pauses are cut";
    else if (from + wanted > beatEnd) why = "it ran past the end of its beat";
    let end = Math.min(from + wanted, beatEnd);
    if (from < prevEnd) {
      from = prevEnd;
      why = "it overlapped the previous cutaway";
    }
    if (end > ctaStart) {
      end = ctaStart;
      why = "it ran under the CTA card";
    }
    if (layout === "full" && fullUsed + (end - from) > maxFull) {
      end = from + Math.max(0, maxFull - fullUsed);
      why = share;
    }
    const len = end - from;
    if (len < minFrames) {
      warnings.push(`The cutaway in ${id} was dropped: ${why || "it is too short"}.`);
      continue;
    }
    if (len < wanted) warnings.push(`The cutaway in ${id} was shortened to ${secs(len)} s: ${why}.`);
    placed.push({ beatId: id, source: c.source, layout, fromFrame: from, durationInFrames: len, pulled });
    prevEnd = end;
    if (layout === "full") fullUsed += len;
  }
  return { placed, warnings };
}

export function planCutaways(plan: Pick<EditPlan, "beats" | "hook" | "ending" | "source">, words: Word[], style: EditStyle): CutawayPlacement {
  return placeCutaways(plan, planShots(plan, words, style), style);
}

export type CutawayBudget = { max: number; maxVideo: number; maxSelf: number };

/** Spec §4.3: what Claude may plan for a reel of targetSec (code enforces it with applyCutawayBudget). */
export function cutawayBudget(targetSec: number, hasCharacter: boolean): CutawayBudget {
  return { max: Math.round(targetSec / 5), maxVideo: Math.floor(targetSec / 15), maxSelf: hasCharacter ? Math.max(1, Math.floor(targetSec / 20)) : 0 };
}

/** Counts kept beats only, in beat order: AI shots of you past maxSelf go first, then cutaways past max, then clips past maxVideo become stills. */
export function applyCutawayBudget<B extends { id: string; keep: boolean; cutaway?: Cutaway }>(beats: B[], budget: CutawayBudget, targetSec: number): { beats: B[]; warnings: string[] } {
  const strip = (b: B): B => {
    const { cutaway: _drop, ...rest } = b;
    return rest as B;
  };
  let self = 0;
  let selfRemoved = 0;
  let count = 0;
  let removed = 0;
  let videos = 0;
  let stilled = 0;
  const out = beats.map((b) => {
    const c = b.cutaway;
    if (!c || !b.keep) return b;
    if (c.source.kind === "ai_self" && ++self > budget.maxSelf) {
      selfRemoved++;
      return strip(b);
    }
    if (++count > budget.max) {
      removed++;
      return strip(b);
    }
    const s = c.source;
    if ((s.kind === "ai_broll" || s.kind === "ai_self") && s.media === "video" && ++videos > budget.maxVideo) {
      stilled++;
      return { ...b, cutaway: { ...c, source: { ...s, media: "image" as const } } };
    }
    return b;
  });
  const warnings = [
    ...(selfRemoved ? [`${selfRemoved} AI shots of you were removed (${budget.maxSelf === 0 ? "no character is picked" : `at most ${budget.maxSelf} for a ${targetSec} s reel`}).`] : []),
    ...(removed ? [`${removed} cutaways were removed (at most ${budget.max} for a ${targetSec} s reel).`] : []),
    ...(stilled ? [`${stilled} video cutaways became stills (at most ${budget.maxVideo} clips for a ${targetSec} s reel).`] : []),
  ];
  return { beats: out, warnings };
}
```
Append `export * from "./footage/cutaways";` to `packages/core/src/index.ts`. Run the test. Expected: PASS.

- [ ] **Step 4: Prices, failing test first.** Add to `packages/core/src/cost.test.ts`:
```ts
import { cutawayCost } from "./cost";

describe("cutaway prices", () => {
  it("AI still $0.04, AI clip = still + 4 billed seconds × $0.08, uploads and diagrams free", () => {
    expect(cutawayCost({ kind: "ai_broll", prompt: "x", media: "image" }, 2000)).toBeCloseTo(0.04, 9);
    expect(cutawayCost({ kind: "ai_self", prompt: "x", media: "video" }, 2000)).toBeCloseTo(0.36, 9);
    expect(cutawayCost({ kind: "upload", assetId: "d".repeat(64) }, 2000)).toBe(0);
    expect(cutawayCost({ kind: "diagram", template: "list", items: ["a", "b"] }, 2000)).toBe(0);
  });
});
```
and to `compile.test.ts`'s `describe("estimate")`:
```ts
  it("prices only the cutaways that will be placed", () => {
    const cut = (media: "image" | "video", atMs = 0) => ({ source: { kind: "ai_broll" as const, prompt: "laptop", media }, layout: "full" as const, atMs, durationMs: 2000 });
    const p = plan({ beats: validEditPlan().beats.map((b) => (b.id === "b1" ? { ...b, cutaway: cut("video") } : b.id === "b2" ? { ...b, cutaway: cut("image") } : { ...b, cutaway: cut("video") })) });
    // b3's clip falls under the CTA card and is dropped, so it costs nothing.
    expect(withFootageEstimate(p, transcript.words, style).estimate.credits).toBe(0.4);
  });
```
Run `npx vitest run packages/core/src/cost.test.ts packages/core/src/footage/compile.test.ts`. Expected: FAIL.

- [ ] **Step 5: Implement prices** in `packages/core/src/cost.ts`: rename `price` to exported `unitPrice` (update its two callers), import `DEFAULT_MODELS` from `./models` and types `CutawaySource` from `./schema/edit-plan` and `PlacedCutaway` from `./footage/cutaways` (type-only imports, no cycle at runtime), then:
```ts
/** One cutaway's generation price in USD (spec §4.4): AI stills on the Soul model, AI clips animate that still. */
export function cutawayCost(source: CutawaySource, durationMs: number, table: CostTable = DEFAULT_COST_TABLE): number {
  if (source.kind !== "ai_broll" && source.kind !== "ai_self") return 0;
  const image = unitPrice(table, DEFAULT_MODELS.image, "perImage");
  return source.media === "video" ? image + videoBillSeconds(durationMs / 1000) * unitPrice(table, DEFAULT_MODELS.video, "perSecond") : image;
}

/** Generation spend of an approved footage plan, in USD: AI music fitted to the reel plus every placed AI cutaway. */
export function estimateFootageCost(plan: Pick<EditPlan, "music">, durationSec: number, table: CostTable = DEFAULT_COST_TABLE, placed: PlacedCutaway[] = []): number {
  const music = plan.music.kind === "ai" ? musicBillSeconds(durationSec) * unitPrice(table, "elevenlabs/music", "perSecond") : 0;
  return music + placed.reduce((sum, c) => sum + cutawayCost(c.source, (c.durationInFrames * 1000) / 30, table), 0);
}
```
(replace the old `estimateFootageCost`; keep its position after `ceilToCent`, and move the misplaced doc comment above `ceilToCent` to its own function). In `withFootageEstimate` (`compile.ts`):
```ts
  const { placed } = placeCutaways(plan, planShots(plan, words, style), style);
  const credits = ceilToCent(estimateFootageCost(plan, estimateReelSeconds(durationMs), table, placed));
```
(import `placeCutaways` from `./cutaways`, `planShots` is already imported). Run the tests. Expected: PASS, and every existing estimate test keeps its numbers.

- [ ] **Step 6: Verify and commit.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS. Commit with message `feat(core): cutaway placement rules (beat, overlap, CTA, 40% speaker) with warnings, cutaway budget, cutaway prices in the estimate`.

---
### Task 5: The compiler emits cutaways (full, split, B-roll break)

**Files:**
- Modify: `packages/core/src/schema/timeline.ts`, `packages/core/src/footage/cutaways.ts`, `packages/core/src/footage/compile.ts`, `packages/core/src/timeline-sources.ts`
- Test: `packages/core/src/footage/compile.test.ts`, `packages/core/src/footage/cutaways.test.ts`, `packages/core/src/timeline-sources.test.ts`

**Interfaces:**
- Consumes: `placeCutaways`, `PlacedCutaway`, `ctaStartFrame` (Task 4); `pickBreaks`, `applyBreaks`, `addSnaps`, `placeCaptionPages` (Task 1); `FootageExtra` (Task 3).
- Produces:
  - `TimelineCutawaySchema`, `type TimelineCutaway = { id: string; fromFrame: number; durationInFrames: number; layout: "full" | "split"; media: { kind: "image"; src: string; fit: "cover" | "contain_blur"; kenBurns: number } | { kind: "video"; src: string; fit: "cover" | "contain_blur" } | { kind: "diagram"; template: "compare" | "list" | "flow"; items: string[] } }`; `Timeline.cutaways?: TimelineCutaway[]`; `Timeline.hook.patternBreak` allows `"broll"`.
  - `FootageAssets.cutaways?: Record<string /* beat id */, { kind: "image" | "video"; src: string }>`; `CompiledFootage.warnings: string[]`.
  - `cutawayFit(source: CutawaySource, extras: FootageExtra[], layout: "full" | "split", ratio: number): "cover" | "contain_blur"` (in `cutaways.ts`).
  - Speaker clips under a split cutaway have `layout: "split"` and crop `{ cx: 0.5, cy: faceCentreY clamped to 0.25–0.75 (0.5 without a face), scaleFrom: 1, scaleTo: 1 }`; a clip cut by a cutaway boundary continues as `<sceneId>.2`, `.3`, … with its source span and zoom continued.

- [ ] **Step 1: Timeline schema.** In `packages/core/src/schema/timeline.ts` add before `TimelineSchema`:
```ts
const CutawayFitSchema = z.enum(["cover", "contain_blur"]);
/** A cutaway layer (spec §5.4): full replaces the picture, split fills the top half over a split speaker clip. */
export const TimelineCutawaySchema = z.object({
  id: z.string().min(1),
  fromFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  layout: z.enum(["full", "split"]),
  media: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("image"), src: z.string().min(1), fit: CutawayFitSchema, kenBurns: z.number().min(1).max(1.5) }),
    z.object({ kind: z.literal("video"), src: z.string().min(1), fit: CutawayFitSchema }),
    z.object({ kind: z.literal("diagram"), template: z.enum(["compare", "list", "flow"]), items: z.array(z.string().min(1)).min(2).max(4) }),
  ]),
});
export type TimelineCutaway = z.infer<typeof TimelineCutawaySchema>;
```
In `TimelineSchema`: `hook.patternBreak: z.enum(["zoom_hit", "flash", "broll", "none"])` and add `cutaways: z.array(TimelineCutawaySchema).optional(),`.

- [ ] **Step 2: Failing tests.** Add to `packages/core/src/footage/cutaways.test.ts`:
```ts
import { cutawayFit } from "./cutaways";
import { EXTRA_IMG, EXTRA_VID, fixtureExtras } from "../testing/fixtures";

describe("uploads", () => {
  it("shortens a cutaway to the uploaded clip's length", () => {
    const p = parseEditPlan({
      ...validEditPlan(),
      source: { ...validEditPlan().source, extras: fixtureExtras() },
      beats: validEditPlan().beats.map((b) => (b.id === "b1" ? { ...b, cutaway: { source: { kind: "upload", assetId: EXTRA_VID }, layout: "full", atMs: 0, durationMs: 3000 } } : b)),
    });
    const r = show(p);
    expect(r.placed[0].durationInFrames).toBe(60);
    expect(r.warnings).toEqual(["The cutaway in b1 was shortened to 2.0 s: the uploaded clip is only 2.0 s long."]);
  });
  it("shows an upload whole on a blurred fill when its shape doesn't fit the slot", () => {
    const x = fixtureExtras();
    expect(cutawayFit({ kind: "upload", assetId: EXTRA_IMG }, x, "full", 1.3)).toBe("contain_blur"); // landscape in 9:16
    expect(cutawayFit({ kind: "upload", assetId: EXTRA_VID }, x, "full", 1.3)).toBe("cover"); // portrait in 9:16
    expect(cutawayFit({ kind: "upload", assetId: EXTRA_VID }, x, "split", 1.3)).toBe("contain_blur"); // portrait in 9:8
    expect(cutawayFit({ kind: "ai_broll", prompt: "x", media: "image" }, x, "split", 1.3)).toBe("cover");
  });
});
```
Add to `compile.test.ts` (import `EXTRA_IMG, fixtureExtras` from the fixtures):
```ts
describe("cutaways", () => {
  const still = (layout: "full" | "split", atMs = 0, durationMs = 1500) => ({ source: { kind: "ai_broll" as const, prompt: "laptop", media: "image" as const }, layout, atMs, durationMs });
  const on = (beatId: string, cutaway: unknown, over: object = {}) => plan({ beats: validEditPlan().beats.map((b) => (b.id === beatId ? { ...b, cutaway } : b)) as EditPlan["beats"], ...over });
  const withArt = { ...assets, cutaways: { b1: { kind: "image" as const, src: "asset:b1.png" }, b2: { kind: "image" as const, src: "asset:b2.png" } } };

  it("full: a cutaway layer over the speaker (who stays underneath), with a whoosh", () => {
    const { timeline } = compileFootage(on("b2", still("full")), transcript, faceTrackFixture(), withArt, style);
    expect(timeline.cutaways).toEqual([{ id: "b2", fromFrame: 89, durationInFrames: 45, layout: "full", media: { kind: "image", src: "asset:b2.png", fit: "cover", kenBurns: 1.06 } }]);
    expect(timeline.clips.map((c) => c.sceneId)).toEqual(["b1-1", "b1-2", "b2-1", "b3-1"]);
    expect(timeline.sfx?.map((c) => `${c.name}@${c.frame}`)).toContain("whoosh2@89");
  });

  it("split: the speaker clip is cut at the cutaway's end, the split part is cropped around the face, captions sit on the seam", () => {
    const { timeline, voiceSegments } = compileFootage(on("b2", still("split")), transcript, faceTrackFixture(), withArt, style);
    const [split, rest] = timeline.clips.filter((c) => c.sceneId.startsWith("b2-1"));
    expect([split.sceneId, split.fromFrame, split.durationInFrames, split.layout]).toEqual(["b2-1", 89, 45, "split"]);
    expect(split.crop).toEqual({ cx: 0.5, cy: 0.285, scaleFrom: 1, scaleTo: 1 });
    expect([rest.sceneId, rest.fromFrame, rest.durationInFrames, rest.layout]).toEqual(["b2-1.2", 134, 12, undefined]);
    expect(rest.source!.inMs).toBeCloseTo(split.source!.inMs + 1500, 2);
    expect(rest.source!.outMs).toBeCloseTo(split.source!.inMs + (57 * 1000) / 30, 2);
    expect(timeline.captions.pages![3].topPct).toBe(50);
    expect(voiceSegments).toEqual(compile().voiceSegments); // the voice never changes
  });

  it("B-roll pattern break: the first cutaway opens the reel, full screen, 1 s, and the first shot doesn't punch", () => {
    const { timeline } = compileFootage(on("b2", still("split"), { hook: { ...validEditPlan().hook, patternBreak: "broll" } }), transcript, faceTrackFixture(), withArt, style);
    expect(timeline.cutaways!.map((c) => [c.id, c.fromFrame, c.durationInFrames, c.layout])).toEqual([["b2", 0, 30, "full"]]);
    expect(timeline.hook!.patternBreak).toBe("broll");
    expect(timeline.clips[0].crop!.punchFrames).toBeUndefined();
  });

  it("leaves out a cutaway whose asset is missing (skipped in generation); diagrams need no asset", () => {
    expect(compileFootage(on("b2", still("full")), transcript, null, assets, style).timeline.cutaways).toBeUndefined();
    const diagram = { source: { kind: "diagram", template: "list", items: ["אחת", "שתיים"] }, layout: "full", atMs: 0, durationMs: 1500 };
    expect(compileFootage(on("b2", diagram), transcript, null, assets, style).timeline.cutaways![0].media).toEqual({ kind: "diagram", template: "list", items: ["אחת", "שתיים"] });
  });

  it("fits uploads to their slot and reports placement warnings", () => {
    const up = plan({
      source: { ...validEditPlan().source, extras: fixtureExtras() },
      beats: validEditPlan().beats.map((b) => (b.id === "b1" ? { ...b, cutaway: { source: { kind: "upload", assetId: EXTRA_IMG }, layout: "full", atMs: 0, durationMs: 1000 } } : b.id === "b3" ? { ...b, cutaway: still("full") } : b)) as EditPlan["beats"],
    });
    const out = compileFootage(up, transcript, null, { ...assets, cutaways: { b1: { kind: "image", src: "asset:x.png" }, b3: { kind: "image", src: "asset:y.png" } } }, style);
    expect(out.timeline.cutaways![0].media).toMatchObject({ kind: "image", fit: "contain_blur" });
    expect(out.warnings).toEqual(["The cutaway in b3 was dropped: it ran under the CTA card."]);
  });
});
```
Add to `packages/core/src/timeline-sources.test.ts`:
```ts
  it("includes and maps cutaway media, never diagrams", () => {
    const t = { ...base(), cutaways: [
      { id: "b1", fromFrame: 0, durationInFrames: 30, layout: "full" as const, media: { kind: "video" as const, src: "asset:c.mp4", fit: "cover" as const } },
      { id: "b2", fromFrame: 30, durationInFrames: 30, layout: "split" as const, media: { kind: "diagram" as const, template: "list" as const, items: ["a", "b"] } },
    ] };
    expect(timelineAssetFiles(t)).toContain("c.mp4");
    expect(mapTimelineSources(t, (f) => `http://x/${f}`).cutaways![0].media).toMatchObject({ src: "http://x/c.mp4" });
  });
```
(`base()` stands for the timeline the existing tests in that file build; reuse that helper, or `sampleTimeline`-like object already used there.) Run `npx vitest run packages/core`. Expected: FAIL.

- [ ] **Step 3: Upload caps and fit** in `packages/core/src/footage/cutaways.ts`. `placeCutaways` takes `plan: Pick<EditPlan, "beats" | "hook" | "ending" | "source">`; right after computing `wanted`:
```ts
    const extra = c.source.kind === "upload" ? plan.source.extras.find((e) => e.assetId === (c.source as { assetId: string }).assetId) : undefined;
    const clipCap = extra?.kind === "video" ? msToFrames(extra.durationMs) : Infinity;
```
and use `Math.min(wanted, clipCap)` as the length limit: replace `let end = Math.min(from + wanted, beatEnd);` with
```ts
    let end = Math.min(from + wanted, beatEnd, from + clipCap);
    if (from + clipCap < Math.min(from + wanted, beatEnd)) why = `the uploaded clip is only ${(extra!.durationMs / 1000).toFixed(1)} s long`;
```
Then add:
```ts
/** Slot shapes: full 1080×1920, split top half 1080×960. AI media is made 9:16 and always covers. */
export function cutawayFit(source: CutawaySource, extras: FootageExtra[], layout: "full" | "split", ratio: number): "cover" | "contain_blur" {
  if (source.kind !== "upload") return "cover";
  const e = extras.find((x) => x.assetId === source.assetId);
  if (!e) return "cover";
  const r = e.width / e.height / (layout === "full" ? 1080 / 1920 : 1080 / 960);
  return r > ratio || r < 1 / ratio ? "contain_blur" : "cover";
}
```
(import `FootageExtra` type from `../schema/footage`).

- [ ] **Step 4: Compile.** In `packages/core/src/footage/compile.ts`:
  - `export type FootageAssets = { videoSrc: string; voiceSrc?: string; musicSrc?: string; sfx: Partial<Record<SfxName, string>>; cutaways?: Record<string, { kind: "image" | "video"; src: string }> };` and `export type CompiledFootage = { timeline: Timeline; voiceSegments: VoiceSegment[]; durationMs: number; warnings: string[] };`
  - Pattern break: `const patternBreak = plan.ending.kind === "loop" && plan.hook.patternBreak === "flash" ? "none" : plan.hook.patternBreak;` (drop `requested`; the clip-0 zoom only fires for `"zoom_hit"`, so `broll` gets none).
  - After the `shots.forEach` loop, replace the Task 1 break block with:
```ts
  const ctaFrames = Math.min(total, msToFrames(style.ctaMs));
  const ctaStart = plan.ending.kind === "cta" ? total - ctaFrames : total;
  const placement = placeCutaways(plan, shots, style);
  // A cutaway whose asset generation skipped is left out: the speaker stays on screen there.
  const shown = placement.placed.filter((c) => c.source.kind === "diagram" || assets.cutaways?.[c.beatId]);
  const picked = pickBreaks(
    clips.map((c) => ({ fromFrame: c.fromFrame, frames: c.durationInFrames })),
    style.breaks,
    [[ctaStart, total], ...shown.map((c): [number, number] => [c.fromFrame, c.fromFrame + c.durationInFrames])],
    shown.map((c) => c.fromFrame),
  );
  const patternBreaks = applyBreaks(clips, picked, faces, style);
  addSnaps(clips, style);
  const { clips: finalClips, faces: finalFaces } = splitForCutaways(clips, faces, shown.filter((c) => c.layout === "split"));
  const cutaways: TimelineCutaway[] = shown.map((c) => ({
    id: c.beatId, fromFrame: c.fromFrame, durationInFrames: c.durationInFrames, layout: c.layout, media: cutawayMedia(c, plan, assets, style),
  }));
```
  - Helpers at the bottom of the file:
```ts
function cutawayMedia(c: PlacedCutaway, plan: EditPlan, assets: FootageAssets, style: EditStyle): TimelineCutaway["media"] {
  if (c.source.kind === "diagram") return { kind: "diagram", template: c.source.template, items: c.source.items };
  const a = assets.cutaways![c.beatId];
  const fit = cutawayFit(c.source, plan.source.extras, c.layout, style.cutaways.contentFitRatio);
  return a.kind === "image" ? { kind: "image", src: a.src, fit, kenBurns: style.cutaways.kenBurns } : { kind: "video", src: a.src, fit };
}

/** The zoom a clip has reached `offset` frames in, as a fresh crop for the piece that continues from there. */
function cropFrom(crop: TimelineCrop, offset: number, frames: number): TimelineCrop {
  const { punchFrames, ...rest } = crop;
  const span = punchFrames ?? Math.max(1, frames - 1);
  const scaleFrom = r4(crop.scaleFrom + (crop.scaleTo - crop.scaleFrom) * Math.min(1, offset / span));
  if (punchFrames) return offset >= punchFrames ? { ...rest, scaleFrom: crop.scaleTo } : { ...rest, scaleFrom, punchFrames: punchFrames - offset };
  return { ...rest, scaleFrom };
}

/**
 * Cuts speaker clips at split-cutaway boundaries. Pieces under a split cutaway play in the bottom half (layout "split"),
 * cropped 9:8 around the face at scale 1; the other pieces continue the clip's zoom. Source spans continue frame-exactly.
 */
function splitForCutaways(clips: TimelineClip[], faces: (FaceBox | null)[], splits: PlacedCutaway[]): { clips: TimelineClip[]; faces: (FaceBox | null)[] } {
  if (!splits.length) return { clips, faces };
  const outClips: TimelineClip[] = [];
  const outFaces: (FaceBox | null)[] = [];
  const inSplit = (f: number) => splits.some((s) => f >= s.fromFrame && f < s.fromFrame + s.durationInFrames);
  clips.forEach((clip, i) => {
    const start = clip.fromFrame;
    const end = start + clip.durationInFrames;
    const cuts = [...new Set(splits.flatMap((s) => [s.fromFrame, s.fromFrame + s.durationInFrames]).filter((f) => f > start && f < end))].sort((a, b) => a - b);
    const bounds = [start, ...cuts, end];
    for (let k = 0; k < bounds.length - 1; k++) {
      const from = bounds[k];
      const len = bounds[k + 1] - from;
      const offset = from - start;
      const inMs = r3(clip.source!.inMs + framesToMs(offset));
      const face = faces[i];
      const piece: TimelineClip = {
        ...clip,
        sceneId: k === 0 ? clip.sceneId : `${clip.sceneId}.${k + 1}`,
        fromFrame: from,
        durationInFrames: len,
        source: { inMs, outMs: r3(inMs + framesToMs(len)) },
      };
      if (offset > 0) delete piece.enter;
      if (inSplit(from)) {
        delete piece.enter;
        piece.layout = "split";
        piece.crop = { cx: 0.5, cy: face ? r4(Math.min(0.75, Math.max(0.25, face.y + face.h / 2))) : 0.5, scaleFrom: 1, scaleTo: 1 };
      } else if (offset > 0) {
        piece.crop = cropFrom(clip.crop!, offset, clip.durationInFrames);
      }
      outClips.push(piece);
      outFaces.push(face);
    }
  });
  return { clips: outClips, faces: outFaces };
}
```
  - Use `finalClips` and `finalFaces` from here on: caption spans become `finalClips.map((c, i) => ({ fromFrame: c.fromFrame, endFrame: c.fromFrame + c.durationInFrames, chinY: c.layout === "split" ? null : screenChinY(finalFaces[i], c.crop!), split: c.layout === "split" }))`; the lively-tick loop iterates `finalClips`; the timeline's `clips: finalClips`.
  - Sound: in the `plan.sfx !== "off"` block, after the break whooshes:
```ts
    for (const c of shown) {
      if (c.layout !== "full" || cues.some((q) => q.name.startsWith("whoosh") && Math.abs(q.frame - c.fromFrame) <= 6)) continue;
      cues.push({ name: "whoosh2", frame: c.fromFrame, volumeDb: style.sfxVolumeDb.whoosh });
    }
```
  - Timeline: `...(cutaways.length ? { cutaways } : {}),` and return `{ timeline, voiceSegments, durationMs: framesToMs(total), warnings: placement.warnings }`.
  - Imports: `cutawayFit, placeCutaways, type PlacedCutaway` from `./cutaways`; `TimelineCutaway`, `TimelineCrop` types from `../schema/timeline`; `FaceBox` type already imported in Task 1.

- [ ] **Step 5: Timeline sources** in `packages/core/src/timeline-sources.ts`: add to the refs list `...(t.cutaways ?? []).flatMap((c) => (c.media.kind === "diagram" ? [] : [c.media.src]))`, and in `mapTimelineSources` add:
```ts
    ...(t.cutaways ? { cutaways: t.cutaways.map((c) => (c.media.kind === "diagram" ? c : { ...c, media: { ...c.media, src: map(c.media.src) ?? c.media.src } })) } : {}),
```

- [ ] **Step 6: Verify and commit.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS (no voice-reel test changes). Commit with message `feat(core): compileFootage places cutaways (full, split with face-cropped speaker, B-roll break), fits uploads to their slot, whooshes full cutaways`.

---
### Task 6: Remotion: cutaway layer, split speaker and diagram cards

**Files:**
- Create: `packages/video/src/footage/Cutaways.tsx`, `packages/video/src/footage/DiagramCard.tsx`, `packages/video/src/footage/icons.tsx`
- Modify: `packages/video/src/footage/motion.ts`, `packages/video/src/footage/SpeakerShot.tsx`, `packages/video/src/Reel.tsx`, `packages/video/src/house-style.ts`, `packages/video/src/sample-footage.ts`
- Test: `packages/video/src/footage/motion.test.ts`, `packages/video/src/footage-render.test.ts`

**Interfaces:**
- Consumes: `TimelineCutaway`, split speaker clips (Task 5); `popBounce`, `revealedCount` (motion.ts).
- Produces: `Cutaways` (rendered between the speaker clips and the overlays), `DiagramCard`, `splitTransform(cy): string`, `kenBurnsScale(frame, frames, to): number`, `houseStyle.cutaway`, `houseStyle.diagram`, `sampleCutawayTimeline(lang)`.

- [ ] **Step 1: Failing helper tests.** Add to `packages/video/src/footage/motion.test.ts`:
```ts
import { kenBurnsScale, splitTransform } from "./motion";

describe("split speaker and Ken Burns", () => {
  it("moves the full frame so the face sits at the bottom panel's centre, never showing past the frame", () => {
    expect(splitTransform(0.285)).toBe("translateY(-3.500%)");
    expect(splitTransform(0.5)).toBe("translateY(-25.000%)");
    expect(splitTransform(0.1)).toBe("translateY(0.000%)");
    expect(splitTransform(0.95)).toBe("translateY(-50.000%)");
  });
  it("zooms stills +6 % across the cutaway", () => {
    expect(kenBurnsScale(0, 45, 1.06)).toBe(1);
    expect(kenBurnsScale(44, 45, 1.06)).toBeCloseTo(1.06, 6);
  });
});
```
Run `npx vitest run packages/video/src/footage/motion.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** in `packages/video/src/footage/motion.ts`:
```ts
/**
 * Bottom-half speaker (layout "split"): the inner element is the full source frame, twice the panel's height. Moving it
 * by (0.25 − cy) of its own height puts source y = cy at the panel's centre; clamped to [−50 %, 0] so no edge shows.
 */
export function splitTransform(cy: number): string {
  const t = Math.min(0, Math.max(-0.5, 0.25 - cy));
  return `translateY(${(t * 100).toFixed(3)}%)`;
}

/** Linear zoom from 1 to `to` across the cutaway (spec §6: stills +6 %). */
export const kenBurnsScale = (frame: number, frames: number, to: number) => 1 + (to - 1) * clamp01(frame / Math.max(1, frames - 1));
```
Run the tests. Expected: PASS.

- [ ] **Step 3: houseStyle.** Add to `packages/video/src/house-style.ts`:
```ts
  /** Uploads that don't fit their slot: shown whole over a blurred, dimmed, zoomed copy of themselves. */
  cutaway: { blurPx: 40, dim: 0.35, fillScale: 1.15 },
  /** Spec §6 DiagramCard: white line art on near-black with violet wavy lines (ref R3 panels). */
  diagram: { bg: "#0B0A12", line: "#FFFFFF", wave: "#8B6CFF", waveOpacity: 0.35, stroke: 6, radius: 28, fontSize: 64, compactScale: 0.62, itemFrames: 8, popFrames: 6, iconSize: 64 },
```

- [ ] **Step 4: Icons** `packages/video/src/footage/icons.tsx`:
```tsx
import React from "react";

/** Lucide icons (ISC licence, https://lucide.dev), inlined so @reel/video needs no icon package. */
type IconProps = { size: number; color: string };
const Svg: React.FC<IconProps & { children: React.ReactNode }> = ({ size, color, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
export const Check: React.FC<IconProps> = (p) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
export const ArrowDown: React.FC<IconProps> = (p) => <Svg {...p}><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></Svg>;
```

- [ ] **Step 5: Diagram card** `packages/video/src/footage/DiagramCard.tsx`:
```tsx
import type { Timeline, TimelineCutaway } from "@reel/core";
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { ArrowDown, Check } from "./icons";
import { popBounce, revealedCount } from "./motion";

const d = houseStyle.diagram;
type Diagram = Extract<TimelineCutaway["media"], { kind: "diagram" }>;

/** Three slow violet waves drifting across the card (ref R3 explainer panels). */
const Waves: React.FC<{ frame: number }> = ({ frame }) => (
  <svg width="100%" height="100%" viewBox="0 0 1080 1920" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, opacity: d.waveOpacity }}>
    {[520, 960, 1400].map((y, i) => (
      <path key={y} d={`M-200 ${y} Q 70 ${y - 60} 340 ${y} T 880 ${y} T 1420 ${y}`} stroke={d.wave} strokeWidth={4} fill="none" transform={`translate(${(((frame * (1 + i * 0.4)) % 540) - 270).toFixed(1)} 0)`} />
    ))}
  </svg>
);

/** Spec §6: compare (2 boxes + VS), list (check rows), flow (steps with down arrows). Items pop in one by one. */
export const DiagramCard: React.FC<{ diagram: Diagram; direction: Timeline["direction"]; compact: boolean }> = ({ diagram, direction, compact }) => {
  const frame = useCurrentFrame();
  const k = compact ? d.compactScale : 1;
  const shown = revealedCount(diagram.items.length, frame, d.itemFrames);
  const look = (i: number): React.CSSProperties => ({
    opacity: i < shown ? 1 : 0,
    transform: `scale(${(i < shown ? popBounce(frame - i * d.itemFrames, d.popFrames, 0.6) : 0.6).toFixed(4)})`,
  });
  const text: React.CSSProperties = { color: d.line, fontFamily: HEEBO, fontWeight: 800, fontSize: d.fontSize * k, lineHeight: 1.15, unicodeBidi: "isolate" };
  const box = (t: string, i: number, flex?: number) => (
    <div key={i} style={{ ...text, ...look(i), flex, border: `${d.stroke}px solid ${d.line}`, borderRadius: d.radius, padding: `${28 * k}px ${32 * k}px`, textAlign: "center" }}>{t}</div>
  );
  let body: React.ReactNode;
  if (diagram.template === "compare") {
    body = (
      <div dir={direction} style={{ display: "flex", alignItems: "center", gap: 28 * k, width: "100%" }}>
        {box(diagram.items[0], 0, 1)}
        <div style={{ ...text, ...look(1), fontSize: d.fontSize * 0.8 * k, color: d.wave }}>VS</div>
        {box(diagram.items[1], 1, 1)}
      </div>
    );
  } else if (diagram.template === "list") {
    body = (
      <div dir={direction} style={{ display: "flex", flexDirection: "column", gap: 36 * k, width: "100%" }}>
        {diagram.items.map((t, i) => (
          <div key={i} style={{ ...look(i), display: "flex", alignItems: "center", gap: 24 * k }}>
            <Check size={d.iconSize * k} color={d.line} />
            <span style={text}>{t}</span>
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <div dir={direction} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 * k, width: "100%" }}>
        {diagram.items.map((t, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <div style={look(i)}><ArrowDown size={d.iconSize * k} color={d.line} /></div> : null}
            {box(t, i)}
          </React.Fragment>
        ))}
      </div>
    );
  }
  return (
    <AbsoluteFill style={{ backgroundColor: d.bg }}>
      <Waves frame={frame} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: `${80 * k}px ${72 * k}px` }}>{body}</AbsoluteFill>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 6: Cutaway layer** `packages/video/src/footage/Cutaways.tsx`:
```tsx
import type { Timeline, TimelineCutaway } from "@reel/core";
import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import { houseStyle } from "../house-style";
import { DiagramCard } from "./DiagramCard";
import { kenBurnsScale } from "./motion";

const k = houseStyle.cutaway;
type Media = Exclude<TimelineCutaway["media"], { kind: "diagram" }>;

const MediaEl: React.FC<{ media: Media; fit: "cover" | "contain" }> = ({ media, fit }) => {
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: fit };
  return media.kind === "image" ? <Img src={media.src} style={style} /> : <OffthreadVideo src={media.src} muted style={style} />;
};

/** Hard cut in and out (spec §6); stills get the Ken Burns zoom; misfit uploads show whole over a blurred fill. */
const MediaSlot: React.FC<{ media: Media; durationInFrames: number }> = ({ media, durationInFrames }) => {
  const frame = useCurrentFrame();
  const zoom = media.kind === "image" ? `scale(${kenBurnsScale(frame, durationInFrames, media.kenBurns).toFixed(4)})` : undefined;
  if (media.fit === "cover") {
    return <AbsoluteFill style={{ transform: zoom }}><MediaEl media={media} fit="cover" /></AbsoluteFill>;
  }
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${k.fillScale})`, filter: `blur(${k.blurPx}px) brightness(${1 - k.dim})` }}><MediaEl media={media} fit="cover" /></AbsoluteFill>
      <AbsoluteFill style={{ transform: zoom }}><MediaEl media={media} fit="contain" /></AbsoluteFill>
    </AbsoluteFill>
  );
};

const Slot: React.FC<{ cutaway: TimelineCutaway; direction: Timeline["direction"] }> = ({ cutaway, direction }) => {
  const split = cutaway.layout === "split";
  // Split: the top half (seam at y = 0.50); the speaker clip underneath draws the bottom half.
  const frame: React.CSSProperties = { position: "absolute", top: 0, left: 0, width: "100%", height: split ? "50%" : "100%", overflow: "hidden", backgroundColor: "#000000" };
  return (
    <div style={frame}>
      {cutaway.media.kind === "diagram"
        ? <DiagramCard diagram={cutaway.media} direction={direction} compact={split} />
        : <MediaSlot media={cutaway.media} durationInFrames={cutaway.durationInFrames} />}
    </div>
  );
};

export const Cutaways: React.FC<{ timeline: Timeline }> = ({ timeline }) => (
  <>
    {(timeline.cutaways ?? []).map((c) => (
      <Sequence key={`${c.id}@${c.fromFrame}`} from={c.fromFrame} durationInFrames={c.durationInFrames} layout="none">
        <Slot cutaway={c} direction={timeline.direction} />
      </Sequence>
    ))}
  </>
);
```

- [ ] **Step 7: Split speaker and Reel wiring.** In `SpeakerShot.tsx`, before the normal return:
```tsx
  if (clip.layout === "split") {
    // Spec §5.4: speaker cropped 9:8 around the face in the bottom half, at scale 1 (the reference split framing).
    return (
      <AbsoluteFill style={{ backgroundColor: "#000000" }}>
        <div style={{ position: "absolute", top: "50%", left: 0, width: "100%", height: "50%", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "200%", transform: splitTransform(clip.crop.cy) }}>
            <OffthreadVideo src={clip.src} muted trimBefore={Math.round((clip.source.inMs / 1000) * fps)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        </div>
      </AbsoluteFill>
    );
  }
```
(import `splitTransform`). In `Reel.tsx` import `Cutaways` and render `<Cutaways timeline={timeline} />` right after the clips `map` and before `<Overlays …/>`.

- [ ] **Step 8: Sample and stills.** Append to `packages/video/src/sample-footage.ts`:
```ts
/** 4.5 s of cutaways with no media files: a split flow diagram (pill on the seam), then full compare and list cards. */
export function sampleCutawayTimeline(lang: "he" | "en"): Timeline {
  const he = lang === "he";
  const t = he
    ? { flow: ["מקליטים", "מעלים", "מקבלים רילס"], compare: ["עריכה ידנית", "עריכה אוטומטית"], list: ["בלי חיבור", "בחינם", "בלי הגבלה"] }
    : { flow: ["Record", "Upload", "Get a reel"], compare: ["Manual edit", "Auto edit"], list: ["Offline", "Free", "No limits"] };
  return {
    fps: 30, width: 1080, height: 1920, durationInFrames: 135, language: lang, direction: he ? "rtl" : "ltr",
    style: { captionPreset: "pill", font: "Heebo", palette: ["#3A2E5C", "#9F92C3"] },
    audio: { musicDuckingDb: -12 },
    clips: [{ sceneId: "g1", kind: "graphic", fromFrame: 0, durationInFrames: 135, motion: "none", transitionIn: "cut" }],
    captions: { words: [{ text: he ? "ככה" : "Like", startMs: 0, endMs: 300 }], pages: [{ fromFrame: 0, durationInFrames: 45, topPct: 50, words: [{ text: he ? "ככה" : "Like", emphasis: false, startFrame: 0 }, { text: he ? "זה" : "this", emphasis: false, startFrame: 10 }] }] },
    overlays: [],
    cutaways: [
      { id: "b1", fromFrame: 0, durationInFrames: 45, layout: "split", media: { kind: "diagram", template: "flow", items: t.flow } },
      { id: "b2", fromFrame: 45, durationInFrames: 45, layout: "full", media: { kind: "diagram", template: "compare", items: t.compare } },
      { id: "b3", fromFrame: 90, durationInFrames: 45, layout: "full", media: { kind: "diagram", template: "list", items: t.list } },
    ],
  };
}
```
Add to `footage-render.test.ts`:
```ts
  it.each([["diagram-flow-split", 40], ["diagram-compare", 80], ["diagram-list", 130]] as const)("renders %s for he and en", async (name, frame) => {
    await mkdir(OUT, { recursive: true });
    for (const lang of ["he", "en"] as const) {
      const file = join(OUT, `footage-${name}-${lang}.png`);
      await renderReelStill(sampleCutawayTimeline(lang), file, frame);
      expect((await stat(file)).size).toBeGreaterThan(20_000);
    }
  }, 300_000);
```
Run `npx vitest run packages/video`, then look at the six PNGs: the flow card fills only the top half with the pill on the seam; Hebrew compare puts "עריכה ידנית" on the right; list rows have check icons on the right in Hebrew, on the left in English; every item is visible by the still's frame. Expected: PASS and the stills look as described.

- [ ] **Step 9: Verify and commit.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS. Commit with message `feat(video): cutaway layer (full and split, Ken Burns, blurred fill for misfit uploads), split speaker crop, line-art diagram cards`.

---
### Task 7: Soul ID reference on Higgsfield stills, extras conforming, cache keys

**Files:**
- Modify: `packages/engine/src/providers/types.ts`, `packages/engine/src/providers/higgsfield.ts`, `packages/engine/src/providers/fake.ts`, `packages/engine/src/footage-ingest.ts` (`footageHashes`), `packages/media/src/ops.ts`
- Test: `packages/engine/src/providers/higgsfield.test.ts`, `packages/engine/src/providers/fake.test.ts`, `packages/engine/src/footage-ingest.test.ts`, `packages/media/src/ops.test.ts`

**Interfaces:**
- Produces:
  - `type SoulReference = { referenceId: string; strength: number }`; `SOUL_REFERENCE_STRENGTH = 1`; `ImageGen.generate(req: { prompt: string; resumeKey?: string; character?: SoulReference })`.
  - Fake providers: `calls.selfImage` counts stills made with a character.
  - `footageHashes.extra(sha, kind)`, `footageHashes.selfImage(model, prompt, referenceId, strength)`, `footageHashes.cutawayFit(rawHash, durationMs)`.
  - `conformClip(input, output, maxSec = 10): Promise<void>` (fits inside 1080×1920, no crop, 30 fps, H.264, no audio).

- [ ] **Step 1: Failing tests.** Add to `packages/engine/src/providers/higgsfield.test.ts` inside `describe("HiggsfieldImageGen")`:
```ts
  it("adds the Soul ID reference for AI shots of the user, and only then", async () => {
    const { api, inputs } = fakeApi({ statuses: { "req-1": [completedImg()], "req-2": [completedImg("req-2")] }, submit: [async () => "req-1", async () => "req-2"] });
    const gen = new HiggsfieldImageGen(make(api));
    await gen.generate({ prompt: "on a plane", character: { referenceId: "soul-ref-123", strength: 1 } });
    await gen.generate({ prompt: "a laptop" });
    expect(inputs[0].input).toEqual({ prompt: "on a plane", aspect_ratio: "9:16", resolution: "1080p", batch_size: 1, custom_reference_id: "soul-ref-123", custom_reference_strength: 1 });
    expect(inputs[1].input).toEqual({ prompt: "a laptop", aspect_ratio: "9:16", resolution: "1080p", batch_size: 1 });
  });
```
Add to `packages/engine/src/providers/fake.test.ts`:
```ts
  it("counts fake stills made with a character", async () => {
    const p = createFakeProviders({ workDir: await mkdtemp(join(tmpdir(), "fake-self-")) });
    await p.image.generate({ prompt: "on a plane", character: { referenceId: "soul-ref-123", strength: 1 } });
    await p.image.generate({ prompt: "a laptop" });
    expect(p.calls.image).toBe(2);
    expect(p.calls.selfImage).toBe(1);
  });
```
Add to `packages/engine/src/footage-ingest.test.ts`:
```ts
describe("cutaway cache keys", () => {
  it("separate fake and real models, characters, strengths and fit lengths", () => {
    const a = footageHashes.selfImage("higgsfield-ai/soul/v2/standard", "p", "ref-1", 1);
    expect(footageHashes.selfImage("fake/image", "p", "ref-1", 1)).not.toBe(a);
    expect(footageHashes.selfImage("higgsfield-ai/soul/v2/standard", "p", "ref-2", 1)).not.toBe(a);
    expect(footageHashes.selfImage("higgsfield-ai/soul/v2/standard", "p", "ref-1", 0.8)).not.toBe(a);
    expect(footageHashes.cutawayFit("x".repeat(64), 2000)).not.toBe(footageHashes.cutawayFit("x".repeat(64), 2033));
    expect(footageHashes.extra("y".repeat(64), "image")).not.toBe(footageHashes.extra("y".repeat(64), "video"));
  });
});
```
Add to `packages/media/src/ops.test.ts` (import `conformClip`):
```ts
describe("conformClip", () => {
  it("fits a clip inside 1080×1920 without cropping, at 30 fps, silent, at most maxSec long", async () => {
    const wide = join(dir, "wide-12s.mp4");
    await makeTestVideo(wide, { durationSec: 12, width: 1280, height: 720, fps: 25, withAudio: true });
    const out = join(dir, "clip.mp4");
    await conformClip(wide, out);
    const info = await probe(out);
    expect(info.video!.width).toBe(1080);
    expect(info.video!.height).toBeGreaterThanOrEqual(606);
    expect(info.video!.height).toBeLessThanOrEqual(608);
    expect(info.video!.fps).toBeCloseTo(30, 3);
    expect(info.audio).toBeUndefined();
    expect(info.durationSec).toBeLessThanOrEqual(10.05);
    const tall = join(dir, "tall.mp4");
    await makeTestVideo(tall, { durationSec: 2, width: 720, height: 1280 });
    await conformClip(tall, join(dir, "tall-out.mp4"));
    expect((await probe(join(dir, "tall-out.mp4"))).video).toMatchObject({ width: 1080, height: 1920 });
  }, 120_000);
});
```
Run `npx vitest run packages/engine/src/providers packages/engine/src/footage-ingest.test.ts packages/media/src/ops.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement.**
  - `packages/engine/src/providers/types.ts`:
```ts
/** A trained Soul ID character (spec §4.4 ai_self): Higgsfield's custom reference id and how strongly to follow it. */
export type SoulReference = { referenceId: string; strength: number };
export const SOUL_REFERENCE_STRENGTH = 1;

export interface ImageGen {
  readonly model: string;
  generate(req: { prompt: string; resumeKey?: string; character?: SoulReference }): Promise<GenResult>;
}
```
  - `HiggsfieldImageGen.generate`:
```ts
  generate({ prompt, resumeKey, character }: { prompt: string; resumeKey?: string; character?: SoulReference }): Promise<GenResult> {
    const input = {
      prompt, aspect_ratio: "9:16", resolution: "1080p", batch_size: 1,
      // The Soul character fields @higgsfield/client documents for Soul generation; checked in the plan-2 paid smoke test.
      ...(character ? { custom_reference_id: character.referenceId, custom_reference_strength: character.strength } : {}),
    };
    return this.gateway.run(this.model, input, (r) => r.images?.[0]?.url, { resumeKey, maxWaitMs: IMAGE_MAX_WAIT_MS });
  }
```
  - Fake: add `selfImage: 0` to `calls`, change the image provider's signature to `async generate({ prompt, character })` and add `if (character) calls.selfImage++;` after `calls.image++`.
  - `footageHashes` in `footage-ingest.ts`:
```ts
  extra: (sha: string, kind: "image" | "video") => inputHash({ step: "footage-extra", v: 1, sha, kind }),
  selfImage: (model: string, prompt: string, referenceId: string, strength: number) => inputHash({ step: "self-image", v: 1, model, prompt, referenceId, strength }),
  cutawayFit: (rawHash: string, durationMs: number) => inputHash({ step: "cutaway-fit", v: 1, rawHash, durationMs }),
```
  - `packages/media/src/ops.ts`:
```ts
/** Extra uploads: fit inside 1080×1920 keeping the whole picture (Remotion fits it to its slot), 30 fps, no audio, first maxSec only. */
export async function conformClip(input: string, output: string, maxSec = 10): Promise<void> {
  const vf = "scale=w=1080:h=1920:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,setsar=1,format=yuv420p";
  await runFfmpeg(["-i", input, "-t", String(maxSec), "-vf", vf, ...H264, "-an", "-movflags", "+faststart", output]);
}
```
Run the tests. Expected: PASS.

- [ ] **Step 3: Verify and commit.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS. Commit with message `feat(engine): Soul ID reference on Higgsfield stills, conformClip for extra uploads, cutaway cache keys`.

---

### Task 8: Ingest extras and generate cutaways within the approved estimate

**Files:**
- Create: `packages/engine/src/footage-cutaways.ts`
- Modify: `packages/engine/src/footage-ingest.ts`, `packages/engine/src/footage-generate.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/src/footage-cutaways.test.ts` (new), `packages/engine/src/footage-ingest.test.ts`, `packages/engine/src/footage-generate.test.ts`

**Interfaces:**
- Consumes: `planCutaways`, `PlacedCutaway`, `cutawayCost`, `estimateFootageCost` (Task 4); `SoulReference`, `footageHashes.*`, `conformClip` (Task 7); `hashes.image`, `hashes.video`, `cached`, `estUsd`, `downloadTo`, `extFromUrl`, `contentTypeFor` (plan 1 / voice pipeline).
- Produces:
  - `ingestFootage(originalPath, deps, extras?: { path: string; label: string }[]): Promise<{ source: FootageSource; transcript: Transcript; warnings: string[] }>`; `ingestExtras(files, deps): Promise<{ extras: FootageExtra[]; warnings: string[] }>`.
  - `type SpendBudget = { remaining: number }`; `makeBudget(usd): SpendBudget`; `takeBudget(b, usd): boolean`.
  - `cutawayPrompt(prompt, layout): string`; `type CutawayAssets = Record<string, { kind: "image" | "video"; asset: StoredAsset }>`; `generateCutaways(placed, plan, deps: CutawayGenDeps): Promise<{ assets: CutawayAssets; notes: string[] }>`; `type CutawayGenDeps = { image: ImageGen; video: VideoGen; uploader: MediaUploader; store: AssetStore; tmpDir: string; log: (m: string) => void; character: SoulReference | null; budget: SpendBudget }`.
  - `FootageGenDeps` gains `image`, `video`, `uploader`, `character: SoulReference | null`; `FootageGenerated` gains `cutaways: CutawayAssets`; `buildFootageTimeline` passes them to the compiler.

- [ ] **Step 1: Failing generation tests** `packages/engine/src/footage-cutaways.test.ts`:
```ts
import { parseEditPlan, planCutaways, type EditPlan } from "@reel/core";
import { makeTestImage, probe } from "@reel/media";
import { houseStyle } from "@reel/video/house-style";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTER_ID, EXTRA_IMG, fixtureExtras, footageTranscript, validEditPlan } from "../../core/src/testing/fixtures";
import { FileAssetStore } from "./asset-store";
import { cutawayPrompt, generateCutaways, makeBudget } from "./footage-cutaways";
import { createFakeProviders } from "./providers/fake";

const REF = { referenceId: "soul-ref-123", strength: 1 };
// b1: AI clip, full, frames 0–60 ($0.36); b2: AI shot of you, split, frames 89–134 ($0.04); b3: no cutaway.
const plan = (): EditPlan => parseEditPlan({
  ...validEditPlan(),
  source: { ...validEditPlan().source, extras: fixtureExtras() },
  character: { id: CHARACTER_ID, name: "Alex" },
  beats: validEditPlan().beats.map((b) =>
    b.id === "b1" ? { ...b, cutaway: { source: { kind: "ai_broll", prompt: "laptop on a desk", media: "video" }, layout: "full", atMs: 0, durationMs: 2000 } }
    : b.id === "b2" ? { ...b, cutaway: { source: { kind: "ai_self", prompt: "the person on a plane", media: "image" }, layout: "split", atMs: 0, durationMs: 1500 } }
    : b),
});

async function setup(over: { failPromptsContaining?: string } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cutaways-"));
  const providers = createFakeProviders({ workDir: dir, ...over });
  const store = new FileAssetStore(join(dir, "cache"));
  const p = plan();
  const placed = planCutaways(p, footageTranscript().words, houseStyle.edit).placed;
  const deps = (usd: number, character: typeof REF | null = REF) => ({
    image: providers.image, video: providers.video, uploader: providers.uploader, store, tmpDir: join(dir, "t"), log: () => {}, character, budget: makeBudget(usd),
  });
  return { dir, providers, store, p, placed, deps };
}

describe("generateCutaways (fake Higgsfield, real ffmpeg)", () => {
  it("makes a 2 s 1080×1920 clip and a Soul ID still, then reuses both from the cache at no cost", async () => {
    const s = await setup();
    const first = await generateCutaways(s.placed, s.p, s.deps(0.4));
    expect(first.notes).toEqual([]);
    expect(Object.keys(first.assets).sort()).toEqual(["b1", "b2"]);
    const clip = await probe(first.assets.b1.asset.path);
    expect(clip.video).toMatchObject({ width: 1080, height: 1920 });
    expect(clip.durationSec).toBeCloseTo(2, 1);
    expect([s.providers.calls.image, s.providers.calls.selfImage, s.providers.calls.video]).toEqual([2, 1, 1]);
    const budget = makeBudget(0);
    const again = await generateCutaways(s.placed, s.p, { ...s.deps(0), budget });
    expect(again.notes).toEqual([]);
    expect([s.providers.calls.image, s.providers.calls.video]).toEqual([2, 1]);
    expect(budget.remaining).toBe(0);
  }, 300_000);

  it("skips what the approved estimate can't cover, before paying", async () => {
    const s = await setup();
    const r = await generateCutaways(s.placed, s.p, s.deps(0.05));
    expect(Object.keys(r.assets)).toEqual(["b2"]);
    expect(r.notes).toEqual(["The cutaway in b1 was skipped: it would cost more than the approved estimate. Use Edit as new version and approve again to update it."]);
    expect(s.providers.calls.video).toBe(0);
  }, 300_000);

  it("skips AI shots of you when the character is gone, and never sends a reference-less prompt", async () => {
    const s = await setup();
    const r = await generateCutaways(s.placed, s.p, s.deps(1, null));
    expect(r.notes).toEqual(["The AI shot of you in b2 was skipped: its character no longer exists."]);
    expect(s.providers.calls.selfImage).toBe(0);
    expect(Object.keys(r.assets)).toEqual(["b1"]);
  }, 300_000);

  it("a failed generation is one attempt, a note, and the speaker stays on screen", async () => {
    const s = await setup({ failPromptsContaining: "laptop" });
    const r = await generateCutaways(s.placed, s.p, s.deps(1));
    expect(r.notes).toEqual(["The cutaway in b1 failed (Higgsfield (fake) was blocked by content moderation), so you stay on screen there."]);
    expect(s.providers.calls.image).toBe(2);
    expect(s.providers.calls.video).toBe(0);
  }, 300_000);

  it("uses an upload from the store, and notes one that is missing", async () => {
    const s = await setup();
    const up = parseEditPlan({ ...s.p, beats: s.p.beats.map((b) => (b.id === "b1" ? { ...b, cutaway: { source: { kind: "upload", assetId: EXTRA_IMG }, layout: "full", atMs: 0, durationMs: 1000 } } : b)) });
    const placed = planCutaways(up, footageTranscript().words, houseStyle.edit).placed;
    expect((await generateCutaways(placed, up, s.deps(1))).notes[0]).toBe("The upload for the cutaway in b1 is missing, so you stay on screen there.");
    await makeTestImage(join(s.dir, "shot.png"), { width: 1920, height: 1080 });
    await s.store.putFile(EXTRA_IMG, join(s.dir, "shot.png"), "png", { kind: "image", provider: "upload" });
    const r = await generateCutaways(placed, up, s.deps(1));
    expect(r.assets.b1).toMatchObject({ kind: "image" });
  }, 300_000);

  it("asks for vertical, text-free stills, centred for split", () => {
    expect(cutawayPrompt(" laptop ", "full")).toBe("laptop, vertical 9:16 photo, photorealistic, natural light, no text, no captions, no watermark");
    expect(cutawayPrompt("laptop", "split")).toMatch(/main subject centred in the middle of the frame$/);
  });
});
```
Run `npx vitest run packages/engine/src/footage-cutaways.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** `packages/engine/src/footage-cutaways.ts`:
```ts
import { cutawayCost, videoBillSeconds, type EditPlan, type PlacedCutaway } from "@reel/core";
import { conformVideo, fitDuration } from "@reel/media";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssetStore, StoredAsset } from "./asset-store";
import { contentTypeFor, downloadTo, extFromUrl } from "./download";
import { footageHashes } from "./footage-ingest";
import { cached, estUsd, hashes } from "./pipeline";
import type { ImageGen, MediaUploader, SoulReference, VideoGen } from "./providers/types";

/** What is left of the approved estimate (USD). Every uncached paid element is reserved here before it is paid. */
export type SpendBudget = { remaining: number };
export const makeBudget = (usd: number): SpendBudget => ({ remaining: usd });
export function takeBudget(b: SpendBudget, usd: number): boolean {
  if (usd > b.remaining + 1e-9) return false;
  b.remaining = Math.max(0, b.remaining - usd);
  return true;
}

export type CutawayGenDeps = {
  image: ImageGen; video: VideoGen; uploader: MediaUploader; store: AssetStore; tmpDir: string; log: (m: string) => void;
  character: SoulReference | null; budget: SpendBudget;
};
export type CutawayAssets = Record<string, { kind: "image" | "video"; asset: StoredAsset }>;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function cutawayPrompt(prompt: string, layout: "full" | "split"): string {
  return `${prompt.trim()}, vertical 9:16 photo, photorealistic, natural light, no text, no captions, no watermark${layout === "split" ? ", main subject centred in the middle of the frame" : ""}`;
}

type Job = { c: PlacedCutaway; prompt: string; self: boolean; video: boolean; imageHash: string; videoHash?: string; billSec: number; durationMs: number };

/**
 * Spec §4.4 for cutaways. Uploads come from the store; AI stills and clips are reserved against the approved estimate in
 * reel order (cached parts cost nothing), then generated in parallel (the Higgsfield gateway limits concurrency).
 * One attempt each: a failure is a note and the speaker stays on screen (no repeat paid calls).
 */
export async function generateCutaways(placed: PlacedCutaway[], plan: EditPlan, deps: CutawayGenDeps): Promise<{ assets: CutawayAssets; notes: string[] }> {
  await mkdir(deps.tmpDir, { recursive: true });
  const assets: CutawayAssets = {};
  const notes = new Map<string, string>();
  const jobs: Job[] = [];
  for (const c of placed) {
    const s = c.source;
    if (s.kind === "diagram") continue;
    if (s.kind === "upload") {
      const extra = plan.source.extras.find((e) => e.assetId === s.assetId);
      const asset = extra ? await deps.store.get(s.assetId) : null;
      if (!extra || !asset) notes.set(c.beatId, `The upload for the cutaway in ${c.beatId} is missing, so you stay on screen there.`);
      else assets[c.beatId] = { kind: extra.kind, asset };
      continue;
    }
    const self = s.kind === "ai_self";
    if (self && !deps.character) {
      notes.set(c.beatId, `The AI shot of you in ${c.beatId} was skipped: its character no longer exists.`);
      continue;
    }
    const prompt = cutawayPrompt(s.prompt, c.layout);
    const durationMs = Math.round((c.durationInFrames * 1000) / 30);
    const billSec = videoBillSeconds(durationMs / 1000);
    const imageHash = self ? footageHashes.selfImage(deps.image.model, prompt, deps.character!.referenceId, deps.character!.strength) : hashes.image(deps.image.model, prompt);
    const video = s.media === "video";
    const videoHash = video ? hashes.video(deps.video.model, deps.video.resolution, prompt, imageHash, billSec) : undefined;
    // Priced with the approval's table and models, so fake and real workers skip exactly what the estimate didn't cover.
    const stillUsd = cutawayCost({ ...s, media: "image" }, durationMs);
    const usd = ((await deps.store.get(imageHash)) ? 0 : stillUsd) + (videoHash && !(await deps.store.get(videoHash)) ? cutawayCost(s, durationMs) - stillUsd : 0);
    if (!takeBudget(deps.budget, usd)) {
      notes.set(c.beatId, `The cutaway in ${c.beatId} was skipped: it would cost more than the approved estimate. Use Edit as new version and approve again to update it.`);
      continue;
    }
    jobs.push({ c, prompt, self, video, imageHash, videoHash, billSec, durationMs });
  }
  await Promise.all(jobs.map(async (j) => {
    try {
      assets[j.c.beatId] = await makeOne(j, deps);
    } catch (err) {
      notes.set(j.c.beatId, `The cutaway in ${j.c.beatId} failed (${message(err)}), so you stay on screen there.`);
    }
  }));
  // Notes in reel order, whatever order the parallel jobs finished in.
  return { assets, notes: placed.flatMap((c) => (notes.has(c.beatId) ? [notes.get(c.beatId)!] : [])) };
}

async function makeOne(j: Job, deps: CutawayGenDeps): Promise<CutawayAssets[string]> {
  const beat = j.c.beatId;
  const tmp = (name: string) => join(deps.tmpDir, `${beat}-${name}`);
  const image = await cached(deps.store, j.imageHash, async () => {
    deps.log(`${beat}: generating ${j.self ? "an AI shot of you" : "a B-roll still"}`);
    const res = await deps.image.generate({ prompt: j.prompt, resumeKey: j.imageHash, ...(j.self ? { character: deps.character! } : {}) });
    const ext = extFromUrl(res.url, "png");
    const file = tmp(`image.${ext}`);
    await downloadTo(res.url, file);
    return { path: file, ext, meta: { kind: "image", provider: deps.image.model.split("/")[0], model: deps.image.model, requestId: res.requestId, estUsd: estUsd(deps.image.model, "perImage", 1) } };
  });
  if (!j.video) return { kind: "image", asset: image };
  const raw = await cached(deps.store, j.videoHash!, async () => {
    deps.log(`${beat}: animating the still (${j.billSec} s)`);
    const imageUrl = await deps.uploader.upload(await readFile(image.path), contentTypeFor(image.fileName));
    const res = await deps.video.imageToVideo({ imageUrl, prompt: j.prompt, durationSec: j.billSec, resumeKey: j.videoHash });
    const file = tmp("raw.mp4");
    await downloadTo(res.url, file);
    return { path: file, ext: "mp4", meta: { kind: "video", provider: deps.video.model.split("/")[0], model: deps.video.model, requestId: res.requestId, estUsd: estUsd(deps.video.model, "perSecond", j.billSec) } };
  });
  const fitted = await cached(deps.store, footageHashes.cutawayFit(raw.hash, j.durationMs), async () => {
    const conformed = tmp("conformed.mp4");
    await conformVideo(raw.path, conformed);
    const out = tmp("fitted.mp4");
    await fitDuration(conformed, out, j.durationMs / 1000);
    return { path: out, ext: "mp4", meta: { kind: "video", provider: "ffmpeg", reproducible: true } };
  });
  return { kind: "video", asset: fitted };
}
```
Append `export * from "./footage-cutaways";` to `packages/engine/src/index.ts`. Run the tests. Expected: PASS.

- [ ] **Step 3: Ingest extras, failing test first.** Add to `footage-ingest.test.ts`:
```ts
describe("ingest extras", () => {
  it("stores photos as they are, fits clips inside 1080×1920 (first 10 s), and leaves out unreadable files with a warning", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "talk.mp4"), { durationSec: 4, width: 720, height: 1280, withAudio: true });
    await makeTestImage(join(dir, "shot.png"), { width: 1920, height: 1080 });
    await makeTestVideo(join(dir, "demo.mov"), { durationSec: 12, width: 1280, height: 720 });
    await writeFile(join(dir, "bad.jpg"), "not an image");
    const { source, warnings } = await ingestFootage(join(dir, "talk.mp4"), deps, [
      { path: join(dir, "shot.png"), label: "צילום מסך" },
      { path: join(dir, "demo.mov"), label: "demo" },
      { path: join(dir, "bad.jpg"), label: "bad" },
    ]);
    expect(source.extras.map((e) => [e.kind, e.width, e.label])).toEqual([["image", 1920, "צילום מסך"], ["video", 1080, "demo"]]);
    expect(source.extras[1].durationMs).toBeGreaterThan(9900);
    expect(source.extras[1].durationMs).toBeLessThanOrEqual(10_050);
    expect((await deps.store.get(source.extras[0].assetId))!.fileName).toMatch(/\.png$/);
    expect(warnings).toEqual(['The extra file "bad" couldn\'t be read, so it was left out.']);
  }, 300_000);
});
```
(import `makeTestImage` and `writeFile`). Run it. Expected: FAIL.

- [ ] **Step 4: Implement** in `packages/engine/src/footage-ingest.ts`:
```ts
/** Extra photos and clips (cutaway material). Unreadable files are left out with a warning, never failing the upload. */
export async function ingestExtras(files: { path: string; label: string }[], deps: Pick<IngestDeps, "store" | "tmpDir" | "log">): Promise<{ extras: FootageExtra[]; warnings: string[] }> {
  const extras: FootageExtra[] = [];
  const warnings: string[] = [];
  for (const [i, f] of files.entries()) {
    const ext = extname(f.path).slice(1).toLowerCase();
    const kind = ext === "mp4" || ext === "mov" ? "video" : "image";
    const info = await probe(f.path).catch(() => null);
    if (!info?.video?.width || (kind === "video" && !(info.video.durationSec > 0))) {
      warnings.push(`The extra file "${f.label}" couldn't be read, so it was left out.`);
      continue;
    }
    const sha = await sha256File(f.path);
    const asset = await cached(deps.store, footageHashes.extra(sha, kind), async () => {
      if (kind === "image") return { path: f.path, ext: ext === "jpeg" ? "jpg" : ext, meta: { kind: "image", provider: "upload", extra: { sha } } };
      deps.log(`ingest: fitting extra clip ${i + 1}`);
      const out = join(deps.tmpDir, `extra-${i + 1}.mp4`);
      await conformClip(f.path, out);
      return { path: out, ext: "mp4", meta: { kind: "video", provider: "ffmpeg", reproducible: true, extra: { sha } } };
    });
    const stored = await probe(asset.path);
    extras.push({
      assetId: asset.hash, kind, width: stored.video!.width, height: stored.video!.height,
      durationMs: kind === "video" ? Math.round(stored.video!.durationSec * 1000) : 0, label: f.label,
    });
  }
  return { extras, warnings };
}
```
Change `ingestFootage` to `export async function ingestFootage(originalPath: string, deps: IngestDeps, extraFiles: { path: string; label: string }[] = []): Promise<{ source: FootageSource; transcript: Transcript; warnings: string[] }>` and, after the transcript step:
```ts
  const { extras, warnings } = await ingestExtras(extraFiles, deps);
  return { source: { assetId: working.hash, durationMs, transcriptAssetId: transcriptAsset.hash, faceTrackAssetId: faces.hash, extras }, transcript, warnings };
```
(import `conformClip` from `@reel/media`, `extname` from `node:path`, `FootageExtra` type from `@reel/core`). The extras run after transcription because they are free and an upload without speech should fail before any work on extras. Run the ingest tests. Expected: PASS.

- [ ] **Step 5: Generation wiring, failing test first.** In `footage-generate.test.ts`, extend `prepared()`'s deps with `image: providers.image, video: providers.video, uploader: providers.uploader, character: null`, then add:
```ts
  it("renders an AI cutaway (split) within the estimate and lists cutaway steps", async () => {
    const { dir, plan: p, deps, providers } = await prepared();
    const cut = { source: { kind: "ai_broll" as const, prompt: "laptop", media: "image" as const }, layout: "split" as const, atMs: 0, durationMs: 1000 };
    const plan = parseEditPlan({ ...p, beats: p.beats.map((b) => (b.id === "b2" ? { ...b, cutaway: cut } : b)), estimate: { ...p.estimate, credits: 0.04 } });
    const gen = await generateFootageAssets(plan, deps);
    expect(gen.notes).toEqual([]);
    expect(Object.keys(gen.cutaways)).toEqual(["b2"]);
    const out = await renderFootage(plan, gen, deps, join(dir, "out"));
    expect(out.timeline.cutaways).toHaveLength(1);
    expect(out.timeline.clips.some((c) => c.layout === "split")).toBe(true);
    expect((await probe(out.reel)).video).toMatchObject({ width: 1080, height: 1920 });
    expect(providers.calls.image).toBe(1);
  }, 900_000);
```
Run `npx vitest run packages/engine/src/footage-generate.test.ts`. Expected: FAIL.

- [ ] **Step 6: Implement** in `packages/engine/src/footage-generate.ts`:
  - `FootageGenDeps` gains `image: ImageGen; video: VideoGen; uploader: MediaUploader; character: SoulReference | null;` and `FootageGenerated` gains `cutaways: CutawayAssets`.
  - At the top of `generateFootageAssets`: `const budget = makeBudget(plan.estimate.credits);`
  - Music: replace the `if (estimateFootageCost(plan, billSec) > plan.estimate.credits + 1e-9)` test with `if (!takeBudget(budget, estimateFootageCost(plan, billSec)))` (same note). Music stays first, as in plan 1.
  - After the music step:
```ts
  emit({ type: "step", step: "visuals", status: "running" });
  const { placed } = planCutaways(plan, inputs.transcript.words, deps.style);
  const cut = await generateCutaways(placed, plan, { image: deps.image, video: deps.video, uploader: deps.uploader, store, tmpDir: join(deps.tmpDir, "cutaways"), log, character: deps.character, budget });
  notes.push(...cut.notes);
  emit({ type: "step", step: "visuals", status: "done" });
```
  and return `{ inputs, voice, music, sfx, cutaways: cut.assets, notes }`.
  - `buildFootageTimeline`: pass `cutaways: Object.fromEntries(Object.entries(gen.cutaways).map(([id, c]) => [id, { kind: c.kind, src: urlFor(c.asset.fileName) }]))` in the assets object.
  - Imports: `planCutaways` from `@reel/core`; `generateCutaways, makeBudget, takeBudget, type CutawayAssets` from `./footage-cutaways`; `ImageGen, MediaUploader, SoulReference, VideoGen` types from `./providers/types`.
  - Keep the worker compiling: in `apps/worker/src/handlers/generate-footage.ts` add `image: ImageGen; video: VideoGen; uploader: MediaUploader;` to `GenerateFootageHandlerDeps` and `image: deps.image, video: deps.video, uploader: deps.uploader, character: null` to `genDeps`; in `handlers/index.ts` pass `image: deps.providers.image, video: deps.providers.video, uploader: deps.providers.uploader`; in `generate-footage.test.ts`'s `approvedPlan()` add the same three fake providers to `deps`. Task 10 replaces `character: null` with the character lookup.

Run `npx vitest run packages/engine`. Expected: PASS, including plan 1's music tests (the budget gives the same answers for music alone).

- [ ] **Step 7: Commit** with message `feat(engine): ingest extra photos and clips; generate AI B-roll, Soul ID shots and uploads as cutaways within the approved estimate, with skip notes`.

---
### Task 9: Planner: cutaways, budget, uploads and character

**Files:**
- Modify: `packages/engine/src/footage-planner.ts`, `packages/engine/src/providers/fake.ts`
- Test: `packages/engine/src/footage-planner.test.ts`, `packages/engine/src/providers/fake.test.ts`

**Interfaces:**
- Consumes: `EditPlanDraft` with `cutaway` and `NO_CUTAWAY`, `Cutaway` (Task 3); `cutawayBudget`, `applyCutawayBudget` (Task 4); `FootageExtra` (Task 3).
- Produces: `FootagePlanRequest.character?: { id: string; name: string }`; `draftCutaway(beatId, c, req): Cutaway | undefined` (throws a repair-ready message for an unknown upload id); the plan's `character` and budget warnings; the fake planner puts an upload on the first beat (when there is one) and a split list diagram on the second.

- [ ] **Step 1: Failing tests.** In `packages/engine/src/footage-planner.test.ts` add `cutaway: NO_CUTAWAY` to every beat of the `draft()` fixture if Task 3 hasn't already, then add:
```ts
import { CHARACTER_ID, EXTRA_IMG, EXTRA_VID, fixtureExtras } from "../../core/src/testing/fixtures";
import { NO_CUTAWAY, type DraftCutaway } from "@reel/core";

const RICH: FootagePlanRequest = { ...REQ, source: { ...REQ.source, extras: fixtureExtras() }, character: { id: CHARACTER_ID, name: "Alex" } };
const withCuts = (cuts: Record<string, Partial<DraftCutaway>>, over: Partial<EditPlanDraft> = {}) =>
  draft({ beats: draft().beats.map((b) => (cuts[b.id] ? { ...b, cutaway: { ...NO_CUTAWAY, ...cuts[b.id] } } : b)), ...over });

describe("cutaways from Claude's draft", () => {
  const beats = splitBeats(REQ.transcript.words);
  it("maps every kind, clamps timing to 1–3 s and trims diagram items", () => {
    const plan = buildEditPlan(withCuts({
      b1: { kind: "ai_broll", media: "video", prompt: " laptop on a desk ", atMs: 200.4, durationMs: 5000 },
      b2: { kind: "upload", uploadId: "x2", layout: "split", durationMs: 1500 },
      b3: { kind: "diagram", template: "list", items: [" אחת ", "", "שתיים"], durationMs: 800 },
    }), RICH, beats, style);
    expect(plan.beats.map((b) => b.cutaway)).toEqual([
      { source: { kind: "ai_broll", prompt: "laptop on a desk", media: "video" }, layout: "full", atMs: 200, durationMs: 3000 },
      { source: { kind: "upload", assetId: EXTRA_VID }, layout: "split", atMs: 0, durationMs: 1500 },
      { source: { kind: "diagram", template: "list", items: ["אחת", "שתיים"] }, layout: "full", atMs: 0, durationMs: 1000 },
    ]);
    expect(plan.character).toEqual({ id: CHARACTER_ID, name: "Alex" });
    expect(plan.warnings).toEqual([]);
  });
  it("sends an unknown upload id back for repair", () => {
    expect(() => buildEditPlan(withCuts({ b1: { kind: "upload", uploadId: "x9" } }), RICH, beats, style)).toThrow('Beat b1: uploadId "x9" is not one of the uploads. Use a listed id, or another cutaway kind.');
  });
  it("removes AI shots of you without a character, and a B-roll opening with no cutaway left becomes a zoom hit", () => {
    const plan = buildEditPlan(withCuts({ b1: { kind: "ai_self", prompt: "the person on a plane" } }, { hook: { ...draft().hook, patternBreak: "broll" } }), REQ, beats, style);
    expect(plan.beats[0].cutaway).toBeUndefined();
    expect(plan.hook.patternBreak).toBe("zoom_hit");
    expect(plan.warnings).toEqual(["1 AI shots of you were removed (no character is picked).", "The B-roll opening had no cutaway left, so it became a zoom hit."]);
  });
  it("tells Claude the budget, the uploads and the character", () => {
    const user = footageUserPrompt(RICH, beats);
    expect(user).toContain('Cutaway budget: at most 3 cutaways (at most 1 video clips); at most 1 AI shots of the speaker (character "Alex").');
    expect(user).toContain('- x1 (photo, landscape) "צילום מסך"');
    expect(user).toContain('- x2 (clip, 2.0 s, portrait) "demo clip"');
    expect(user).toContain("Background replacement is not available in this version: never mention it.");
    expect(footageUserPrompt(REQ, beats)).toContain("no AI shots of the speaker (no character).");
    expect(footageUserPrompt(REQ, beats)).toContain("Uploads from the user: none.");
  });
});
```
Add to `fake.test.ts`'s plan test: `expect(plan.beats[1].cutaway?.source.kind).toBe("diagram");` and a second case with `source: { ...validEditPlan().source, extras: fixtureExtras() }` expecting `plan.beats[0].cutaway?.source).toEqual({ kind: "upload", assetId: EXTRA_IMG })`. Run `npx vitest run packages/engine/src/footage-planner.test.ts packages/engine/src/providers/fake.test.ts`. Expected: FAIL.

- [ ] **Step 2: Prompt.** In `footageSystemPrompt()`:
  - change the pattern-break line to `'  - patternBreak: "zoom_hit" (a fast punch-in), "flash" (two white frames), "broll" (your first cutaway opens the reel, full screen, for 1 s: only when it is a strong visual hook) or "none".',`
  - append before the "Return every beat id" line:
```ts
    "- cutaway: at most one per beat, kind \"none\" for most beats; stay inside the cutaway budget. Show what the words talk about, 1–3 s (durationMs 1000–3000), starting atMs after the beat starts, counted after pauses are cut; keep atMs + durationMs inside the beat.",
    '  - "ai_broll": a concrete thing or action the beat names. prompt: one English sentence for a realistic photo (subject, setting, light); never text, screens with words, or logos. media "video" only when the motion matters, otherwise "image".',
    '  - "ai_self": the speaker doing what the beat describes (only when a character is available). prompt in English, calling them "the person".',
    '  - "upload": one of the user\'s uploads whose label fits the beat; uploadId is its x1…x6 id.',
    '  - "diagram": a comparison (template "compare", exactly 2 items), a short list ("list", 2–4 items) or steps ("flow", 2–3 items); items are 1–4 words in the reel\'s language.',
    '  - layout "split" (cutaway on top, speaker below) when the speaker\'s face matters; "full" for punchy visuals.',
```
  - In `footageUserPrompt` replace the "Cutaways, B-roll and background replacement…" line with:
```ts
    "Background replacement is not available in this version: never mention it.",
    cutawayBudgetLine(req),
    ...uploadLines(req.source.extras),
```
  with helpers:
```ts
function cutawayBudgetLine(req: FootagePlanRequest): string {
  const b = cutawayBudget(req.settings.targetDurationSec, !!req.character);
  const self = req.character ? `at most ${b.maxSelf} AI shots of the speaker (character "${req.character.name}").` : "no AI shots of the speaker (no character).";
  return `Cutaway budget: at most ${b.max} cutaways (at most ${b.maxVideo} video clips); ${self}`;
}

function uploadLines(extras: FootageExtra[]): string[] {
  if (!extras.length) return ["Uploads from the user: none."];
  return [
    'Uploads from the user (cutaway kind "upload"):',
    ...extras.map((e, i) => `- x${i + 1} (${e.kind === "image" ? "photo" : `clip, ${(e.durationMs / 1000).toFixed(1)} s`}, ${e.width > e.height ? "landscape" : "portrait"}) "${e.label}"`),
  ];
}
```

- [ ] **Step 3: Build.** Add `character?: { id: string; name: string };` to `FootagePlanRequest`. In `footage-planner.ts`:
```ts
/** Claude's flat draft cutaway → a schema cutaway (timing clamped to 1–3 s; upload ids x1…x6 mapped to the asset). */
export function draftCutaway(beatId: string, c: DraftCutaway, req: FootagePlanRequest): Cutaway | undefined {
  if (c.kind === "none") return undefined;
  const timing = { layout: c.layout, atMs: Math.max(0, Math.round(c.atMs)), durationMs: Math.min(3000, Math.max(1000, Math.round(c.durationMs))) };
  switch (c.kind) {
    case "ai_broll":
    case "ai_self":
      return { source: { kind: c.kind, prompt: c.prompt.trim(), media: c.media }, ...timing };
    case "upload": {
      const n = /^x([1-6])$/.exec(c.uploadId.trim())?.[1];
      const extra = n ? req.source.extras[Number(n) - 1] : undefined;
      if (!extra) throw new Error(`Beat ${beatId}: uploadId "${c.uploadId}" is not one of the uploads. Use a listed id, or another cutaway kind.`);
      return { source: { kind: "upload", assetId: extra.assetId }, ...timing };
    }
    case "diagram":
      return { source: { kind: "diagram", template: c.template, items: c.items.map((t) => t.trim()).filter(Boolean).slice(0, 4) }, ...timing };
  }
}
```
In `buildEditPlan`:
  - build the beats with `const cutaway = draftCutaway(b.id, d.cutaway, req);` and `...(cutaway ? { cutaway } : {})`;
  - then `const budgeted = applyCutawayBudget(beatsWithCutaways, cutawayBudget(req.settings.targetDurationSec, !!req.character), req.settings.targetDurationSec);`
  - pattern break: `const brollLeft = budgeted.beats.some((b) => b.keep && b.cutaway); const patternBreak = draft.hook.patternBreak === "broll" && !brollLeft ? "zoom_hit" : draft.hook.patternBreak;` and add the warning `"The B-roll opening had no cutaway left, so it became a zoom hit."` when it changed;
  - plan fields: `beats: budgeted.beats`, `hook.patternBreak: patternBreak`, `...(req.character ? { character: req.character } : {})`, `warnings: [...req.warnings, ...budgeted.warnings, ...brollWarning]`.
  The id checks and library check stay first; an upload-id error joins them as a thrown repair message (the repair round sends it back to Claude as today).

- [ ] **Step 4: Fake planner.** In `providers/fake.ts`'s `footagePlanner` draft, after `const ids = …`:
```ts
      const hasUpload = /^- x1 \(/m.test(user);
      const cutawayFor = (i: number): DraftCutaway =>
        i === 0 && hasUpload ? { ...NO_CUTAWAY, kind: "upload", uploadId: "x1", atMs: 0, durationMs: 1000 }
        : i === 1 ? { ...NO_CUTAWAY, kind: "diagram", template: "list", items: he ? ["בלי עריכה", "בחינם"] : ["No editing", "Free"], layout: "split", atMs: 0, durationMs: 1200 }
        : NO_CUTAWAY;
```
and give each draft beat `cutaway: cutawayFor(i)` (map with index). Both are free, so plan 1's fake-flow tests keep their estimates and notes.

- [ ] **Step 5: Verify and commit.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS. Commit with message `feat(engine): planner writes cutaways within the budget (B-roll, AI shots of you, uploads, diagrams) and knows the uploads and character; fake planner adds free cutaways`.

---

### Task 10: Worker: extras, characters and cutaway generation

**Files:**
- Modify: `apps/worker/src/reel-db.ts`, `apps/worker/src/testing/fakes.ts`, `apps/worker/src/handlers/footage.ts`, `apps/worker/src/handlers/generate-footage.ts`, `apps/worker/src/handlers/index.ts`
- Test: `apps/worker/src/handlers/footage.test.ts`, `apps/worker/src/handlers/generate-footage.test.ts`

**Interfaces:**
- Consumes: `IngestFootageJobPayloadSchema.extras` (Task 2); `ingestFootage(…, extras)` and its `warnings`, `FootageGenDeps.image/video/uploader/character` (Task 8); `FootagePlanRequest.character` (Task 9); `SOUL_REFERENCE_STRENGTH` (Task 7).
- Produces: `type SoulCharacter = { id: string; name: string; referenceId: string }`; `ReelDb.getCharacter(id): Promise<SoulCharacter | null>`; `InMemoryReelDb.characters: SoulCharacter[]`; `GenerateFootageHandlerDeps` gains `image`, `video`, `uploader`.

- [ ] **Step 1: Failing tests.** Add to `apps/worker/src/handlers/footage.test.ts` (imports: `parseEditPlan` from `@reel/core`, `makeTestImage`, `makeTestVideo` from `@reel/media`, `CHARACTER_ID` from the core fixtures, plus the existing helpers):
```ts
describe("ingest_footage with extras and a character", () => {
  const PID = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
  const OTHER = "11111111-2222-4333-8444-555555555555";
  async function run(payloadOver: object, characters = [{ id: CHARACTER_ID, name: "Alex", referenceId: "soul-ref-123" }]) {
    const dir = await mkdtemp(join(tmpdir(), "ingest-extras-"));
    const providers = createFakeProviders({ workDir: dir });
    const db = new InMemoryReelDb();
    db.characters.push(...characters);
    const blobs = new InMemoryBlobStore();
    const store = new FileAssetStore(join(dir, "cache"));
    await makeTestVideo(join(dir, "up.mp4"), { durationSec: 6, width: 720, height: 1280, withAudio: true });
    await makeTestImage(join(dir, "shot.png"), { width: 1920, height: 1080 });
    await blobs.upload("assets", `footage/${PID}/source.mp4`, join(dir, "up.mp4"));
    await blobs.upload("assets", `footage/${PID}/extra-1.png`, join(dir, "shot.png"));
    const payload = {
      storagePath: `footage/${PID}/source.mp4`,
      settings: { language: "he", targetDurationSec: 15, characterId: CHARACTER_ID },
      extras: [{ storagePath: `footage/${PID}/extra-1.png`, label: "צילום מסך" }],
      ...payloadOver,
    };
    await createIngestFootageHandler({ store, blobs, db, transcriber: providers.transcriber, faceTracker: noFaceTracker, footagePlanner: providers.footagePlanner })(
      makeJob({ type: "ingest_footage", project_id: PID, payload }), { report: () => {}, log: () => {} });
    return parseEditPlan(db.storyboards[0].json);
  }
  it("conforms the extras, plans with them and with the picked character", async () => {
    const plan = await run({});
    expect(plan.source.extras.map((e) => [e.kind, e.label])).toEqual([["image", "צילום מסך"]]);
    expect(plan.character).toEqual({ id: CHARACTER_ID, name: "Alex" });
    expect(plan.beats[0].cutaway?.source).toEqual({ kind: "upload", assetId: plan.source.extras[0].assetId });
  }, 300_000);
  it("warns (and plans without AI shots of you) when the picked character was removed", async () => {
    const plan = await run({}, []);
    expect(plan.character).toBeUndefined();
    expect(plan.warnings).toContain("The character you picked was removed, so AI shots of you are off.");
  }, 300_000);
  it("refuses extras stored under another reel", async () => {
    await expect(run({ extras: [{ storagePath: `footage/${OTHER}/extra-1.png`, label: "x" }] })).rejects.toThrow("This upload belongs to another reel.");
  }, 300_000);
});
```
Add to `apps/worker/src/handlers/generate-footage.test.ts` (`approvedPlan()`'s deps already carry the fake image, video and uploader since Task 8):
```ts
  it("makes AI shots of the user with the character's Soul ID, and skips them with a note when the character is gone", async () => {
    const s = await approvedPlan();
    const plan = s.record.json as EditPlan;
    s.record.json = {
      ...plan,
      character: { id: CHARACTER_ID, name: "Alex" },
      beats: plan.beats.map((b) => (b.id === "b2" ? { ...b, cutaway: { source: { kind: "ai_self", prompt: "the person on a plane", media: "image" }, layout: "full", atMs: 0, durationMs: 1000 } } : b)),
      estimate: { ...plan.estimate, credits: 1 },
    };
    s.db.characters.push({ id: CHARACTER_ID, name: "Alex", referenceId: "soul-ref-123" });
    const ok = await createGenerateFootageHandler(s.deps)(makeJob({ type: "generate_footage", project_id: PID, payload: { storyboardId: s.record.id } }), ctx);
    expect(ok.status).toBe("done");
    expect(s.providers.calls.selfImage).toBe(1);
    expect(s.db.renders[0].timeline.cutaways?.map((c) => c.id)).toContain("b2");

    // Version 2 of the same plan, approved after the character was deleted.
    s.db.characters.length = 0;
    const v2 = { id: crypto.randomUUID(), projectId: PID, version: 2, json: { ...(s.record.json as object), version: 2 }, status: "approved" as const };
    s.db.storyboards.push(v2);
    const gone = await createGenerateFootageHandler(s.deps)(makeJob({ type: "generate_footage", project_id: PID, payload: { storyboardId: v2.id } }), ctx);
    expect(gone.progress?.notes).toContain("The AI shot of you in b2 was skipped: its character no longer exists.");
    expect(s.providers.calls.selfImage).toBe(1);
  }, 900_000);
```
Run `npx vitest run apps/worker/src/handlers`. Expected: FAIL.

- [ ] **Step 2: ReelDb.** In `apps/worker/src/reel-db.ts`:
```ts
export type SoulCharacter = { id: string; name: string; referenceId: string };
```
add `getCharacter(id: string): Promise<SoulCharacter | null>;` to `ReelDb` and to `SupabaseReelDb`:
```ts
  async getCharacter(id: string) {
    const { data, error } = await this.sb.from("soul_characters").select("id, name, reference_id").eq("id", id).maybeSingle();
    check("character lookup", error);
    return data ? { id: data.id, name: data.name, referenceId: data.reference_id } : null;
  }
```
In `testing/fakes.ts`: `readonly characters: SoulCharacter[] = [];` and `async getCharacter(id: string) { return this.characters.find((c) => c.id === id) ?? null; }`.

- [ ] **Step 3: Ingest and plan handlers** (`handlers/footage.ts`):
  - `planAndSave` input gains `extraWarnings?: string[]`; before planning:
```ts
  const warnings = [...transcriptWarnings(input.transcript, input.settings, houseStyle.edit), ...(input.extraWarnings ?? [])];
  let character: { id: string; name: string } | undefined;
  if (input.settings.characterId) {
    const found = await deps.db.getCharacter(input.settings.characterId);
    if (found) character = { id: found.id, name: found.name };
    else warnings.push("The character you picked was removed, so AI shots of you are off.");
  }
```
  and pass `warnings` and `...(character ? { character } : {})` to `footagePlanner.plan`.
  - Ingest handler: parse `{ storagePath, settings, extras }`; refuse any path not under the reel:
```ts
      const prefix = `footage/${job.project_id}/`;
      if (!storagePath.startsWith(prefix) || extras.some((e) => !e.storagePath.startsWith(prefix))) throw new Error("This upload belongs to another reel.");
```
  download each extra next to the original (`join(tmpDir, basename(e.storagePath))`), then call `ingestFootage(original, ingestDeps, extraFiles)` with `extraFiles = extras.map((e) => ({ path, label: e.label }))`, and pass `extraWarnings: warnings` to `planAndSave`.
  - Re-plan needs nothing new: its payload carries the settings (with `characterId`) and the source (with `extras`).

- [ ] **Step 4: Generate handler** (`handlers/generate-footage.ts`; Task 8 already added `image`, `video`, `uploader` and `character: null`): before building `genDeps`:
```ts
      const found = plan.character ? await deps.db.getCharacter(plan.character.id) : null;
      const character = found ? { referenceId: found.referenceId, strength: SOUL_REFERENCE_STRENGTH } : null;
```
and replace `character: null` with `character` in `genDeps`. `main.ts` needs no change (it already builds real or fake providers).

- [ ] **Step 5: Verify and commit.** Run `npx vitest run apps/worker packages && npm run typecheck`. Expected: PASS. Commit with message `feat(worker): ingest extra uploads, plan with the picked Soul ID character, generate cutaways (AI shots of you only with the character)`.

---
### Task 11: Web: extra files and character on "Edit my video", Characters settings page

**Files:**
- Create: `apps/web/lib/character-form.ts`, `apps/web/app/settings/characters/page.tsx`, `apps/web/app/settings/characters/actions.ts`, `apps/web/app/settings/characters/character-form.tsx`
- Modify: `apps/web/lib/create-footage.ts`, `apps/web/lib/footage-form.ts`, `apps/web/lib/footage-send.ts`, `apps/web/app/new/footage/page.tsx`, `apps/web/app/new/footage/footage-form.tsx`, `apps/web/app/new/footage/actions.ts`, `apps/web/app/layout.tsx`
- Test: `apps/web/lib/create-footage.test.ts`, `apps/web/lib/footage-form.test.ts`, `apps/web/lib/footage-send.test.ts`, `apps/web/lib/character-form.test.ts` (new)

**Interfaces:**
- Consumes: `checkExtraFiles`, `extraExt`, `extraStoragePath`, `extraLabel`, `ExtraUploadSchema`, `EXTRA_MAX_FILES`, `FootageSettings.characterId` (Task 2); table `soul_characters` (Task 2).
- Produces:
  - `startFootage(deps, { settings, fileName, size, durationSec, extras?: { name: string; size: number }[] })` → `{ ok: true; projectId; storagePath; extraPaths: string[] }`.
  - `finishFootage(deps, { projectId, storagePath, settings, extras?: unknown })` queues ingest with `extras: ExtraUpload[]`.
  - `uploadAll(items, done: Set<string>, upload, onProgress): Promise<void>` and `extraContentType(ext): string` in `footage-send.ts`.
  - `parseFootageSettings` reads `characterId` (empty = none).
  - `CharacterInputSchema = { name (1–40), referenceId (/^[A-Za-z0-9_-]{8,64}$/) }`; server action `addCharacter(input)`.

- [ ] **Step 1: Failing tests.** In `apps/web/lib/create-footage.test.ts`:
  - update the two existing expectations: `startFootage` now returns `{ ok: true, projectId: ID, storagePath: \`footage/${ID}/source.mov\`, extraPaths: [] }`, and `insertIngestJob` is called with `{ storagePath: input.storagePath, settings, extras: [] }`;
  - add:
```ts
describe("extra files", () => {
  const extras = [{ storagePath: `footage/${ID}/extra-1.png`, label: "צילום מסך" }, { storagePath: `footage/${ID}/extra-2.mov`, label: "demo" }];
  it("checks the extras with the video and hands out their storage paths", async () => {
    const d = deps();
    expect(await startFootage(d, { settings, fileName: "a.mp4", size: 1000, durationSec: 10, extras: [{ name: "Shot.PNG", size: 10 }, { name: "demo.mov", size: 10 }] }))
      .toEqual({ ok: true, projectId: ID, storagePath: `footage/${ID}/source.mp4`, extraPaths: [`footage/${ID}/extra-1.png`, `footage/${ID}/extra-2.mov`] });
    const bad = await startFootage(d, { settings, fileName: "a.mp4", size: 1000, durationSec: 10, extras: [{ name: "IMG.HEIC", size: 10 }] });
    expect(bad).toEqual({ ok: false, errors: ["IMG.HEIC: use a JPG, PNG or WEBP photo (convert HEIC to JPG first), or an MP4 or MOV clip."] });
  });
  it("queues ingest with the extras once every file is in storage", async () => {
    const d = deps();
    expect(await finishFootage(d, { projectId: ID, storagePath: `footage/${ID}/source.mov`, settings, extras })).toEqual({ ok: true });
    expect(d.insertIngestJob).toHaveBeenCalledWith(ID, { storagePath: `footage/${ID}/source.mov`, settings, extras });
  });
  it("asks for an upload again when an extra is missing, and refuses another reel's extras", async () => {
    const missing = deps({ objectExists: async (p: string) => !p.endsWith("extra-2.mov") });
    expect(await finishFootage(missing, { projectId: ID, storagePath: `footage/${ID}/source.mov`, settings, extras }))
      .toEqual({ ok: false, errors: ['"demo" didn\'t finish uploading. Upload again.'], uploadMissing: true });
    const other = [{ storagePath: "footage/11111111-2222-4333-8444-555555555555/extra-1.png", label: "x" }];
    expect(await finishFootage(deps(), { projectId: ID, storagePath: `footage/${ID}/source.mov`, settings, extras: other }))
      .toEqual({ ok: false, errors: ["This upload doesn't belong to this reel."] });
  });
});
```
In `footage-send.test.ts`:
```ts
import { uploadAll } from "./footage-send";

describe("uploadAll", () => {
  const items = [{ objectName: "a", size: 100 }, { objectName: "b", size: 300 }, { objectName: "c", size: 100 }];
  it("never re-sends a finished file after an interruption, and reports progress by bytes", async () => {
    const done = new Set<string>();
    const sent: string[] = [];
    const progress: number[] = [];
    let failB = true;
    const upload = async (item: { objectName: string }, onFraction: (f: number) => void) => {
      sent.push(item.objectName);
      onFraction(0.5);
      if (item.objectName === "b" && failB) { failB = false; throw new Error("network down"); }
    };
    await expect(uploadAll(items, done, upload, (f) => progress.push(f))).rejects.toThrow("network down");
    expect([...done]).toEqual(["a"]);
    await uploadAll(items, done, upload, (f) => progress.push(f));
    expect(sent).toEqual(["a", "b", "b", "c"]);
    expect([...done]).toEqual(["a", "b", "c"]);
    expect(progress.slice(0, 3)).toEqual([0.1, 0.2, 0.5]);
    expect(progress.at(-1)).toBe(1);
  });
});
```
In `footage-form.test.ts`:
```ts
  it("reads the character (empty = none)", () => {
    const fd = (c: string) => { const f = new FormData(); f.set("language", "he"); f.set("targetDurationSec", "30"); f.set("characterId", c); return f; };
    expect(parseFootageSettings(fd(""))).toEqual({ ok: true, settings: { language: "he", targetDurationSec: 30 } });
    const id = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    expect(parseFootageSettings(fd(id))).toEqual({ ok: true, settings: { language: "he", targetDurationSec: 30, characterId: id } });
  });
```
New `apps/web/lib/character-form.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CharacterInputSchema } from "./character-form";

describe("CharacterInputSchema", () => {
  it("accepts a name and a Soul ID reference id", () => {
    expect(CharacterInputSchema.parse({ name: " Alex ", referenceId: " 3f2c8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e " })).toEqual({ name: "Alex", referenceId: "3f2c8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e" });
  });
  it("explains a bad name or id", () => {
    const r = CharacterInputSchema.safeParse({ name: "", referenceId: "abc" });
    expect(r.success ? [] : r.error.issues.map((i) => i.message)).toEqual(["Give the character a name.", "Paste the Soul ID reference id (8–64 letters, digits, - or _)."]);
  });
});
```
Run `npx vitest run apps/web/lib`. Expected: FAIL.

- [ ] **Step 2: Server-side logic.** In `apps/web/lib/create-footage.ts`:
```ts
export async function startFootage(
  deps: FootageDeps,
  input: { settings: FootageSettings; fileName: string; size: number; durationSec: number | null; extras?: { name: string; size: number }[] },
): Promise<Result<{ projectId: string; storagePath: string; extraPaths: string[] }>> {
  const settings = FootageSettingsSchema.safeParse(input.settings);
  if (!settings.success) return { ok: false, errors: ["The reel settings are invalid. Start again."] };
  const extras = input.extras ?? [];
  const errors = [...checkFootageFile({ name: input.fileName, size: input.size, durationSec: input.durationSec }), ...checkExtraFiles(extras)];
  if (errors.length) return { ok: false, errors };
  const project = await deps.insertProject({ title: footageTitle(input.fileName), language: settings.data.language });
  if ("error" in project) return { ok: false, errors: [`Couldn't create the reel: ${project.error}`] };
  return {
    ok: true,
    projectId: project.id,
    storagePath: footageStoragePath(project.id, footageExt(input.fileName)!),
    extraPaths: extras.map((e, i) => extraStoragePath(project.id, i + 1, extraExt(e.name)!)),
  };
}
```
and in `finishFootage` (input gains `extras?: unknown`), after the settings check:
```ts
  const extras = z.array(ExtraUploadSchema).max(EXTRA_MAX_FILES).safeParse(input.extras ?? []);
  if (!extras.success || extras.data.some((e) => !e.storagePath.startsWith(`footage/${input.projectId}/`))) return fail("This upload doesn't belong to this reel.");
```
after the source-video `objectExists` check:
```ts
  for (const e of extras.data) {
    if (!(await deps.objectExists(e.storagePath))) return { ok: false, errors: [`"${e.label}" didn't finish uploading. Upload again.`], uploadMissing: true };
  }
```
and queue `{ storagePath: input.storagePath, settings: settings.data, extras: extras.data }`. (Imports: `checkExtraFiles, EXTRA_MAX_FILES, extraExt, extraStoragePath, ExtraUploadSchema` from `@reel/core`, `* as z` from `zod`.) In `parseFootageSettings` add `...(str("characterId") ? { characterId: str("characterId") } : {}),`. In `footage-send.ts`:
```ts
const EXTRA_TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const extraContentType = (ext: string) => EXTRA_TYPES[ext] ?? "application/octet-stream";

/**
 * Uploads every item not yet in `done`, in order; each finished one joins `done`, so "Resume upload" never sends a
 * finished file again (tus forgets finished uploads and would start over). Progress is by bytes over all items.
 */
export async function uploadAll<T extends { objectName: string; size: number }>(
  items: T[], done: Set<string>, upload: (item: T, onFraction: (f: number) => void) => Promise<void>, onProgress: (fraction: number) => void,
): Promise<void> {
  const total = items.reduce((s, i) => s + i.size, 0) || 1;
  const doneBytes = () => items.filter((i) => done.has(i.objectName)).reduce((s, i) => s + i.size, 0);
  for (const item of items) {
    if (done.has(item.objectName)) continue;
    const base = doneBytes();
    await upload(item, (f) => onProgress((base + f * item.size) / total));
    done.add(item.objectName);
    onProgress(doneBytes() / total);
  }
}
```
`apps/web/lib/character-form.ts`:
```ts
import * as z from "zod";

export const CharacterInputSchema = z.object({
  name: z.string().trim().min(1, "Give the character a name.").max(40, "Keep the name to 40 characters."),
  referenceId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/, "Paste the Soul ID reference id (8–64 letters, digits, - or _)."),
});
```
Run the tests. Expected: PASS.

- [ ] **Step 3: Form.** `app/new/footage/page.tsx`: load `const { data: characters } = await supabase.from("soul_characters").select("id, name").order("name");` and render `<FootageForm supabaseUrl={…} characters={characters ?? []} />`; add to the intro: `Add up to 6 photos or clips to use as cutaways.` In `footage-form.tsx`:
  - props `characters: { id: string; name: string }[]`; state `const [extras, setExtras] = useState<{ file: File; label: string }[]>([]);`, `const doneRef = useRef(new Set<string>());`; `Started` gains `extras: { storagePath: string; label: string }[]`.
  - After the notes field:
```tsx
        <label>
          Extra photos or clips (optional, up to 6)
          <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
            onChange={(e) => setExtras(Array.from(e.currentTarget.files ?? []).map((file) => ({ file, label: extraLabel(file.name) })))} />
          <span className="muted">Screenshots, product shots or clips. The editor places them where your words fit their labels.</span>
        </label>
        {extras.map((x, i) => (
          <label key={i}>Label for {x.file.name}
            <input dir="auto" maxLength={80} value={x.label} onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
          </label>
        ))}
        <label>
          Character for AI shots of you (optional)
          <select name="characterId" defaultValue="">
            <option value="">None</option>
            {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {characters.length === 0 && <span className="muted">Add one on the Characters page to get AI shots of you.</span>}
        </label>
```
  - Show `checkExtraFiles(extras.map((x) => ({ name: x.file.name, size: x.file.size })))` errors with the file errors, and disable submit while there are any or a label is blank.
  - `onSubmit` passes `extras: extras.map((x) => ({ name: x.file.name, size: x.file.size }))` to `startFootageUpload`, then builds `s.extras = r.extraPaths.map((p, i) => ({ storagePath: p, label: extras[i].label.trim() }))`.
  - In `send`, replace the single `uploadFootageFile` call with:
```tsx
      upload: () => uploadAll(
        [
          { objectName: s.storagePath, size: f.size, file: f, contentType: f.type || (footageExt(f.name) === "mov" ? "video/quicktime" : "video/mp4") },
          ...s.extras.map((x, i) => ({ objectName: x.storagePath, size: extras[i].file.size, file: extras[i].file, contentType: extras[i].file.type || extraContentType(extraExt(extras[i].file.name)!) })),
        ],
        doneRef.current,
        (item, onFraction) => uploadFootageFile(item.file, { supabaseUrl, bucket: "assets", objectName: item.objectName, contentType: item.contentType, getToken, onProgress: onFraction }),
        setProgress,
      ),
```
  (`getToken` is the existing inline token getter, pulled into a `const`.) Lock the extras inputs with the rest of the fieldset.
  - `actions.ts`: `startFootageUpload` input type gains `extras?: { name: string; size: number }[]` and returns `extraPaths`; `finishFootageUpload` input gains `extras: { storagePath: string; label: string }[]` (both pass straight through).

- [ ] **Step 4: Characters page.**
  - `app/settings/characters/actions.ts` (`"use server"`), like `settings/music/actions.ts`:
```ts
export async function addCharacter(input: unknown): Promise<Result> {
  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  if (!data?.claims) return { ok: false, errors: ["Your session expired. Sign in again."] };
  const parsed = CharacterInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  const { error } = await sb.from("soul_characters").insert({ name: parsed.data.name, reference_id: parsed.data.referenceId });
  if (error) return { ok: false, errors: [error.code === "23505" ? "This reference id is already saved." : `Couldn't add the character: ${error.message}`] };
  revalidatePath("/settings/characters");
  return { ok: true };
}
```
  - `page.tsx` (server, auth check like the Music page): `<h1>Characters</h1>`, the muted text `A character is a Soul ID trained once on 5–20 photos of a person. Train it with the Higgsfield Soul ID flow (it costs Higgsfield credits: ask before training), then paste its reference id here. Edit plans use it for AI shots of that person.`, a table of `name` and `reference_id` (`soul_characters` ordered by name; error and empty states as on the Music page), then `<CharacterForm />`.
  - `character-form.tsx` (`"use client"`): name input (`maxLength={40}`, `dir="auto"`), reference id input (`maxLength={64}`, `autoComplete="off"`), an Add button that calls `addCharacter({ name, referenceId })`, shows errors in `ul.error`, clears the inputs and `router.refresh()` on success.
  - `app/layout.tsx`: add `<Link href="/settings/characters">Characters</Link>` next to the Music link.

- [ ] **Step 5: Verify and commit.** Run `npx vitest run apps/web && npm run typecheck && npm run build -w @reel/web`. Expected: PASS; the build lists `/settings/characters`. Commit with message `feat(web): extra photos and clips and a Soul ID character on Edit my video (resumable, finished files never re-sent); Characters settings page`.

---

### Task 12: Web: cutaways, character and placement warnings on the review page; docs

**Files:**
- Create: `apps/web/lib/cutaway-edit.ts`, `apps/web/components/CutawayEditor.tsx`
- Modify: `apps/web/lib/edit-plan-edit.ts`, `apps/web/lib/approve-plan.ts`, `apps/web/app/projects/[id]/footage-actions.ts`, `apps/web/app/projects/[id]/page.tsx`, `apps/web/components/FootagePlanEditor.tsx`, `apps/web/lib/progress-view.ts`, `docs/RUNNING.md`
- Test: `apps/web/lib/cutaway-edit.test.ts` (new), `apps/web/lib/edit-plan-edit.test.ts`, `apps/web/lib/approve-plan.test.ts`, `apps/web/lib/progress-view.test.ts`

**Interfaces:**
- Consumes: `Cutaway`, `CutawaySource`, `EditPlan.character` (Task 3); `planCutaways`, `cutawayCost` (Task 4).
- Produces:
  - `PlanAction` gains `{ type: "setCutaway"; beatId: string; cutaway: Cutaway | null }` and `{ type: "setCharacter"; character: { id: string; name: string } | null }`; `setPatternBreak.value` allows `"broll"`.
  - `cutaway-edit.ts`: `type CutawayChoice = "none" | "ai_broll:image" | "ai_broll:video" | "ai_self:image" | "ai_self:video" | "upload" | "diagram"`; `cutawayChoice(c?: Cutaway): CutawayChoice`; `defaultCutaway(choice, plan, previous?: Cutaway): Cutaway | null`; `cutawayPriceLabel(c: Cutaway): string`; `placementWarnings(plan, words, style): string[]`.
  - `PlanWriteDeps.getCharacter(id): Promise<{ id: string; name: string } | null>`.

- [ ] **Step 1: Failing tests.** `apps/web/lib/cutaway-edit.test.ts`:
```ts
import { parseEditPlan } from "@reel/core";
import { houseStyle } from "@reel/video/house-style";
import { describe, expect, it } from "vitest";
import { EXTRA_IMG, fixtureExtras, footageTranscript, validEditPlan } from "../../../packages/core/src/testing/fixtures";
import { cutawayChoice, cutawayPriceLabel, defaultCutaway, placementWarnings } from "./cutaway-edit";

const plan = () => parseEditPlan({ ...validEditPlan(), source: { ...validEditPlan().source, extras: fixtureExtras() } });

describe("cutaway editing helpers", () => {
  it("round-trips the type picker and keeps the prompt and timing when switching AI kinds", () => {
    const c = defaultCutaway("ai_broll:video", plan())!;
    expect(c).toEqual({ source: { kind: "ai_broll", prompt: "", media: "video" }, layout: "full", atMs: 0, durationMs: 1500 });
    expect(cutawayChoice(c)).toBe("ai_broll:video");
    const typed = { ...c, source: { ...c.source, prompt: "laptop" }, atMs: 400 };
    expect(defaultCutaway("ai_self:image", plan(), typed)).toEqual({ source: { kind: "ai_self", prompt: "laptop", media: "image" }, layout: "full", atMs: 400, durationMs: 1500 });
    expect(defaultCutaway("upload", plan())!.source).toEqual({ kind: "upload", assetId: EXTRA_IMG });
    expect(defaultCutaway("diagram", plan())!.source).toEqual({ kind: "diagram", template: "list", items: ["", ""] });
    expect(defaultCutaway("none", plan())).toBeNull();
    expect(cutawayChoice(undefined)).toBe("none");
  });
  it("prices each cutaway the way the estimate does", () => {
    expect(cutawayPriceLabel(defaultCutaway("ai_broll:image", plan())!)).toBe("$0.04");
    expect(cutawayPriceLabel(defaultCutaway("ai_self:video", plan())!)).toBe("$0.36");
    expect(cutawayPriceLabel(defaultCutaway("diagram", plan())!)).toBe("free");
  });
  it("lists the placement warnings for the review page", () => {
    const p = parseEditPlan({ ...plan(), beats: plan().beats.map((b) => (b.id === "b3" ? { ...b, cutaway: { source: { kind: "ai_broll", prompt: "x", media: "image" }, layout: "full", atMs: 0, durationMs: 1000 } } : b)) });
    expect(placementWarnings(p, footageTranscript().words, houseStyle.edit)).toEqual(["The cutaway in b3 was dropped: it ran under the CTA card."]);
  });
});
```
Add to `edit-plan-edit.test.ts`:
```ts
  it("sets and clears a cutaway and the character; saving trims prompts and empty diagram items", () => {
    const c = { source: { kind: "diagram" as const, template: "list" as const, items: [" אחת ", "", "שתיים"] }, layout: "full" as const, atMs: 0, durationMs: 1500 };
    let p = editPlan(parseEditPlan(validEditPlan()), { type: "setCutaway", beatId: "b2", cutaway: c });
    p = editPlan(p, { type: "setCharacter", character: { id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", name: "Alex" } });
    expect(normalizePlanForSave(p).beats[1].cutaway!.source).toEqual({ kind: "diagram", template: "list", items: ["אחת", "שתיים"] });
    expect(p.character?.name).toBe("Alex");
    p = editPlan(editPlan(p, { type: "setCutaway", beatId: "b2", cutaway: null }), { type: "setCharacter", character: null });
    expect(p.beats[1].cutaway).toBeUndefined();
    expect(p.character).toBeUndefined();
  });
```
Add to `approve-plan.test.ts` (give `deps()` a default `getCharacter: vi.fn(async (id: string) => (id === CHAR ? { id, name: "Alex (from DB)" } : null))` with `const CHAR = "7c9e6679-7425-40de-944b-e07fc1f90ae7"`):
```ts
  it("takes the character's name from the database and refuses a character that no longer exists", async () => {
    const d = deps();
    const shot = { source: { kind: "ai_self", prompt: "the person on a plane", media: "image" }, layout: "full", atMs: 0, durationMs: 1000 };
    const client = (id: string) => ({ ...stored(), character: { id, name: "typed by the client" }, beats: stored().beats.map((b) => (b.id === "b2" ? { ...b, cutaway: shot } : b)) });
    expect(await savePlan(d, { projectId: "p1", storyboardId: SB, json: client(CHAR) })).toEqual({ ok: true });
    expect(d.written[0].character).toEqual({ id: CHAR, name: "Alex (from DB)" });
    expect(d.written[0].estimate.credits).toBe(0.04);
    expect(await savePlan(d, { projectId: "p1", storyboardId: SB, json: client("11111111-2222-4333-8444-555555555555") }))
      .toEqual({ ok: false, errors: ["The character you picked no longer exists. Pick another one or remove the AI shots of you."] });
  });
```
In `progress-view.test.ts`, update any expectation of the `generate_footage` steps to `["voice", "music", "visuals", "render", "export"]`. Run `npx vitest run apps/web/lib`. Expected: FAIL.

- [ ] **Step 2: Implement the helpers.** `apps/web/lib/cutaway-edit.ts`:
```ts
import { cutawayCost, planCutaways, type Cutaway, type EditPlan, type EditStyle, type Word } from "@reel/core";

export type CutawayChoice = "none" | "ai_broll:image" | "ai_broll:video" | "ai_self:image" | "ai_self:video" | "upload" | "diagram";

export const CUTAWAY_CHOICES: [CutawayChoice, string][] = [
  ["none", "No cutaway"], ["ai_broll:image", "AI B-roll photo"], ["ai_broll:video", "AI B-roll clip"],
  ["ai_self:image", "AI photo of you"], ["ai_self:video", "AI clip of you"], ["upload", "One of your uploads"], ["diagram", "Diagram card"],
];

export function cutawayChoice(c?: Cutaway): CutawayChoice {
  if (!c) return "none";
  const s = c.source;
  return s.kind === "ai_broll" || s.kind === "ai_self" ? `${s.kind}:${s.media}` : s.kind;
}

/** A fresh cutaway for the picked type, keeping the previous one's timing, layout and (for AI kinds) prompt. */
export function defaultCutaway(choice: CutawayChoice, plan: EditPlan, previous?: Cutaway): Cutaway | null {
  if (choice === "none") return null;
  const timing = { layout: previous?.layout ?? "full", atMs: previous?.atMs ?? 0, durationMs: previous?.durationMs ?? 1500 } as const;
  const prompt = previous && (previous.source.kind === "ai_broll" || previous.source.kind === "ai_self") ? previous.source.prompt : "";
  if (choice === "upload") return plan.source.extras[0] ? { source: { kind: "upload", assetId: plan.source.extras[0].assetId }, ...timing } : null;
  if (choice === "diagram") return { source: { kind: "diagram", template: "list", items: ["", ""] }, ...timing };
  const [kind, media] = choice.split(":") as ["ai_broll" | "ai_self", "image" | "video"];
  return { source: { kind, prompt, media }, ...timing };
}

export const cutawayPriceLabel = (c: Cutaway) => {
  const usd = cutawayCost(c.source, c.durationMs);
  return usd === 0 ? "free" : `$${usd.toFixed(2)}`;
};

/** Spec §7: the compiler's trims and drops, shown before approval. An invalid plan has none to show yet. */
export function placementWarnings(plan: EditPlan, words: Word[], style: EditStyle): string[] {
  try {
    return planCutaways(plan, words, style).warnings;
  } catch {
    return [];
  }
}
```
In `edit-plan-edit.ts`: add the two actions and widen `setPatternBreak`:
```ts
    case "setCutaway":
      return withBeat(plan, a.beatId, (b) => (a.cutaway ? { ...b, cutaway: a.cutaway } : without(b, "cutaway")));
    case "setCharacter":
      return a.character ? { ...plan, character: a.character } : without(plan, "character");
```
and in `normalizePlanForSave` trim cutaways:
```ts
const trimCutaway = (c: Cutaway): Cutaway => {
  const s = c.source;
  if (s.kind === "ai_broll" || s.kind === "ai_self") return { ...c, source: { ...s, prompt: s.prompt.trim() } };
  if (s.kind === "diagram") return { ...c, source: { ...s, items: s.items.map((t) => t.trim()).filter(Boolean) } };
  return c;
};
```
applied as `beats: plan.beats.map((b) => { const e = b.emoji !== undefined && !b.emoji.trim() ? without(b, "emoji") : b; return e.cutaway ? { ...e, cutaway: trimCutaway(e.cutaway) } : e; })`.

In `approve-plan.ts`: add `getCharacter(id: string): Promise<{ id: string; name: string } | null>;` to `PlanWriteDeps`; in `prepare`, after `merged` passes and before the estimate:
```ts
  let plan = merged.plan;
  if (plan.character) {
    const found = await deps.getCharacter(plan.character.id);
    if (!found) return { ok: false, errors: ["The character you picked no longer exists. Pick another one or remove the AI shots of you."] };
    plan = { ...plan, character: found };
  }
```
and compute the estimate on `plan`. In `footage-actions.ts` add:
```ts
    async getCharacter(id) {
      const { data, error } = await sb.from("soul_characters").select("id, name").eq("id", id).maybeSingle();
      if (error) throw new Error(`character lookup: ${error.message}`);
      return data;
    },
```
In `progress-view.ts` make `generate_footage`'s steps `[["voice", "Cut audio"], ["music", "Music"], ["visuals", "Cutaways"], ["render", "Render"], ["export", "Export"]]`. Run the tests. Expected: PASS.

- [ ] **Step 3: Cutaway card** `apps/web/components/CutawayEditor.tsx` (`"use client"`):
```tsx
"use client";
import type { Cutaway, EditPlan } from "@reel/core";
import { CUTAWAY_CHOICES, cutawayChoice, cutawayPriceLabel, defaultCutaway, type CutawayChoice } from "@/lib/cutaway-edit";

const TEMPLATES = [["list", "List (2–4)"], ["compare", "Compare (2)"], ["flow", "Steps (2–3)"]] as const;
const MAX_ITEMS = { list: 4, compare: 2, flow: 3 } as const;

/** One beat's cutaway (spec §3 review page): type, prompt or file or diagram, layout, timing and price. */
export function CutawayEditor({ plan, cutaway, onChange }: { plan: EditPlan; cutaway?: Cutaway; onChange: (c: Cutaway | null) => void }) {
  const choice = cutawayChoice(cutaway);
  const disabled = (c: CutawayChoice) => (c.startsWith("ai_self") && !plan.character) || (c === "upload" && plan.source.extras.length === 0);
  const set = (patch: Partial<Cutaway>) => cutaway && onChange({ ...cutaway, ...patch });
  const s = cutaway?.source;
  return (
    <div className="stack" style={{ gap: "0.5em" }}>
      <div className="row">
        <label>Cutaway
          <select value={choice} onChange={(e) => onChange(defaultCutaway(e.target.value as CutawayChoice, plan, cutaway))}>
            {CUTAWAY_CHOICES.map(([v, label]) => <option key={v} value={v} disabled={disabled(v) && v !== choice}>{label}</option>)}
          </select>
        </label>
        {cutaway && (
          <>
            <label>Layout
              <select value={cutaway.layout} onChange={(e) => set({ layout: e.target.value as Cutaway["layout"] })}>
                <option value="full">Full screen</option>
                <option value="split">Split (you below)</option>
              </select>
            </label>
            <label>Starts after (s)
              <input type="number" min={0} step={0.1} value={cutaway.atMs / 1000} onChange={(e) => set({ atMs: Math.max(0, Math.round(Number(e.target.value) * 1000)) })} style={{ width: 80 }} />
            </label>
            <label>Length (s)
              <input type="number" min={1} max={3} step={0.1} value={cutaway.durationMs / 1000} onChange={(e) => set({ durationMs: Math.round(Number(e.target.value) * 1000) })} style={{ width: 80 }} />
            </label>
            <span className="muted">{cutawayPriceLabel(cutaway)}</span>
          </>
        )}
      </div>
      {s && (s.kind === "ai_broll" || s.kind === "ai_self") && (
        <label>{s.kind === "ai_self" ? `Prompt (AI shot of ${plan.character?.name ?? "you"})` : "Prompt"}
          <textarea dir="auto" maxLength={1500} rows={2} value={s.prompt} placeholder="e.g. a laptop on a wooden desk, morning light" onChange={(e) => set({ source: { ...s, prompt: e.target.value } })} />
        </label>
      )}
      {s?.kind === "upload" && (
        <label>File
          <select value={s.assetId} onChange={(e) => set({ source: { kind: "upload", assetId: e.target.value } })}>
            {plan.source.extras.map((x) => <option key={x.assetId} value={x.assetId}>{x.label} ({x.kind === "image" ? "photo" : "clip"})</option>)}
          </select>
        </label>
      )}
      {s?.kind === "diagram" && (
        <div className="stack" style={{ gap: "0.5em" }}>
          <label>Diagram
            <select value={s.template} onChange={(e) => { const t = e.target.value as typeof s.template; set({ source: { ...s, template: t, items: s.items.slice(0, MAX_ITEMS[t]) } }); }}>
              {TEMPLATES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
          {s.items.map((t, i) => (
            <input key={i} dir="auto" maxLength={40} value={t} aria-label={`Item ${i + 1}`} onChange={(e) => set({ source: { ...s, items: s.items.map((x, j) => (j === i ? e.target.value : x)) } })} />
          ))}
          {s.items.length < MAX_ITEMS[s.template] && <button type="button" onClick={() => set({ source: { ...s, items: [...s.items, ""] } })}>Add item</button>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Editor and page.** In `FootagePlanEditor.tsx`:
  - props gain `characters: { id: string; name: string }[]`;
  - `PATTERN_BREAKS` becomes `[["zoom_hit", "Zoom hit"], ["flash", "Flash"], ["broll", "B-roll (first cutaway)"], ["none", "None"]]` and the select's cast `as "zoom_hit" | "flash" | "broll" | "none"`;
  - in each beat card, below the emoji row: `<CutawayEditor plan={plan} cutaway={beat.cutaway} onChange={(c) => dispatch({ type: "setCutaway", beatId: beat.id, cutaway: c })} />`;
  - in Settings, before Music: a `Character` select (`None` + `characters`, value `plan.character?.id ?? ""`, `onChange` dispatching `setCharacter` with `{ id, name }` or `null`) and, when `characters.length === 0`, the muted note `Add a character on the Characters page for AI shots of you.`;
  - `const placement = useMemo(() => placementWarnings(normalizePlanForSave(plan), words, style), [plan, words, style]);` shown as a `warn` list titled `Cutaway placement:` under the header warnings;
  - the approve note becomes `Approving may spend Higgsfield credits for AI cutaways and ElevenLabs credits for AI music, up to the estimate above.`
  In `app/projects/[id]/page.tsx`'s `FootageReview` add `supabase.from("soul_characters").select("id, name").order("name")` to the `Promise.all`, show its error like the music one, and pass `characters`.

- [ ] **Step 5: Docs.** In `docs/RUNNING.md` add after step 8:
```markdown
9. Cutaways (footage reels): AI B-roll and AI shots of you are made on Higgsfield after you approve. On the Starter plan (about 2 concurrent jobs) set `HF_CONCURRENCY=2` in `.env.local`.
10. AI shots of you need a character: train a Soul ID once with the `higgsfield-soul-id` flow (paid, 5–20 photos), then add its name and reference id on the Characters page. Pick the character on "Edit my video" (or in the edit plan's Settings).
```
and under "Fake worker note": `The fake worker also makes cutaways for free (coloured stills and test clips); real workers never reuse them because their cache keys include the model.`

- [ ] **Step 6: Verify and commit.** Run `npm test && npm run typecheck && npm run build -w @reel/web`. Expected: PASS. Commit with message `feat(web): cutaway cards on the footage review page (type, prompt, upload, diagram, layout, timing, price), character setting, placement warnings, cutaway progress; RUNNING notes`.

---

## After the tasks (controller)

1. **Final whole-branch review** (most capable model), then one fix wave.
2. **Migration.** Show the user `supabase/migrations/20261013120000_footage_cutaways.sql` (it replaces the two footage storage policies to allow `extra-1…6` files and adds `soul_characters`). Only after their OK, apply it to the hosted project (Supabase MCP `apply_migration`, name `footage_cutaways`), then check the regenerated types match Task 2's hand edits. The web app must not run the new upload form before this (extra uploads would be refused by storage).
3. **Commit the sound-effect pack** (`packages/video/assets/sfx/*.mp3`, already generated and approved) as its own commit if it isn't committed yet. Never regenerate it.
4. **Fake worker end to end in the browser:** `npm run worker:fake` + `npm run web`. Upload a short clip with one landscape screenshot and one short clip as extras; check the plan has the upload cutaway on beat 1 and the split list diagram on beat 2; add an AI B-roll clip on beat 3 and see its $0.36 in the estimate and any placement warning; approve; check the reel: no pill under the headline or CTA card, pills below the face, active-word marker, emoji pop, split layout with the pill on the seam, the screenshot shown whole on a blurred fill, pattern breaks in a reel over 8 s. Interrupt an upload of the extras once and check Resume continues without re-sending the video. Add a test character on the Characters page with a made-up id: the fake worker accepts it (no Higgsfield call).
5. **Soul ID training (paid, only with the user's explicit OK and the cost stated first).** First check for free whether a character already exists (`higgsfield soul-id list`). The repo's cost table has no Soul ID training price: look it up for free (Higgsfield pricing page or the account's plan page) and tell the user the credit cost before asking. Training needs 5–20 photos of the user (varied angles and light) that the user supplies; run the `higgsfield-soul-id` skill with `--soul-2`, then add the reference id on the Characters page.
6. **Paid smoke test (only with the user's explicit OK and the cost stated first):** one real reel on a user clip, 30 s target, with the real worker (`HF_CONCURRENCY=2`). Costs from `DEFAULT_COST_TABLE` (planning numbers): Scribe ≈ $0.02 for 3 min, Claude planning (as plan 1), and the cutaways the approved estimate shows. The 30 s budget allows at most 6 cutaways with 2 clips: worst case 4 stills × $0.04 + 2 clips × $0.36 = $0.88, plus at most 1 AI shot of the user ($0.04 still / $0.36 clip), plus AI music only if chosen (30 s × $0.01 = $0.30). So at most about $1.56 + Claude, and never more than the estimate the user approves. This run also verifies two unknowns: (a) Higgsfield accepts `custom_reference_id` / `custom_reference_strength` on `higgsfield-ai/soul/v2/standard` with the API key and a reference trained through the `higgsfield-soul-id` flow (if not, stop and report; do not retry with other parameters without the user), and (b) the real per-still and per-second prices against the account's credit use, updating `DEFAULT_COST_TABLE` if they differ.
7. **Merge, then restart the worker and web.**
