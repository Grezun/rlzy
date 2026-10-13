# Footage Editor, Plan 2b: Look Pass (iOS captions, denser B-roll, motion graphics): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Act on the user's verdict on the first real reel with cutaways ("much better, but … more graphic motion and animation, captions with better font and less orange color, white and red colors, the captions need to look more like iOS app design, more B-rolls"). This plan delivers: iOS glass-pill captions in white and red (Heebo), a matching red-sticker hook headline and CTA, about one cutaway every 3 s, whip / zoom / slide transitions into and out of cutaways, Ken Burns drift on stills, iOS-style diagram cards that fill their slot, animated keyword callouts and a thin red progress bar. Background replacement stays in plan 3.

**Architecture:**
- `@reel/core` (pure):
  - the cutaway budget (Task 1)
  - cutaway transitions and still drift chosen by the compiler (Task 3)
  - callouts: the `Beat.callout` field, the budget, timing from the plan alone, face-aware position and timeline layers (Task 5)
  - Claude's draft field for callouts (Task 6)
- `@reel/video` (Remotion):
  - glass `PillCaptions` and red-sticker `HookHeadline` / `CtaCard` (Task 2)
  - transitions and Ken Burns drift in `Cutaways` (Task 3)
  - iOS `DiagramCard` (Task 4)
  - `Callouts` and `ProgressBar` (Task 7)
  - the look sample timeline (Task 9)
- `@reel/engine`:
  - the planner prompt uses the budget (Task 1)
  - callouts in the planner, generation notes for callouts (Task 6)
  - a free preview script (Task 9)
- `apps/web`: callout field and placement warnings on the review page (Task 8).

All new numbers live in `houseStyle` (video) and `EditStyle` (core), as spec §6 requires.

**Tech Stack:** unchanged from plans 1 and 2: TypeScript 7, zod 4, Vitest 5, Next.js 16, Remotion 4.0.531 (`@remotion/google-fonts` Heebo), FFmpeg 8. No new dependencies, no migration (callouts live in the edit-plan JSON; the new timeline fields live in the timeline JSON).

**Spec:** `docs/superpowers/specs/2026-10-12-footage-editor-design.md`. Its §11 amendment (2026-10-13, "look pass") is what this plan implements, together with the amended §3 (headline, `callout`), §4.3 (budgets), §5.4 (transitions), §5.6 (captions, callouts), §5.9 (sound cues) and §6 (look table). Plans 1 and 2 (`docs/superpowers/plans/2026-10-12-footage-editor-core.md`, `docs/superpowers/plans/2026-10-13-footage-editor-cutaways.md`) are implemented on this branch (HEAD 03a440c); this plan edits their code.

## Global Constraints

- **Scope:** look pass only. No background replacement (plan 3): `background.mode: "replace"` stays rejected with the plan-1 message. No migration. No paid API call in any task.
- **Colours (spec §11):**
  - iOS red `#FF3B30`, white `#FFFFFF`, ink `#1C1C1E`, secondary `#8E8E93`, grouped background `#F2F2F7`, separator `rgba(60,60,67,0.18)`.
  - No yellow or orange anywhere in `houseStyle`. `house-style.test` fails on any hex colour with hue 20–70°, saturation > 0.4 and lightness 0.25–0.85.
  - The edit-plan editor's red word uses `#FF3B30` too.
- **Font:** Heebo from `@remotion/google-fonts` (already in `@reel/video`, Hebrew + Latin subsets), weights 600, 700 and 800.
  - Captions: 600 at 64 px (1080 wide).
  - Headline, CTA, diagrams and callouts: 700 and 800.
- **Captions:**
  - iOS glass pill: dark frosted glass `rgba(22,22,24,0.62)`, backdrop blur 28 px with saturate 1.8, a 2 px `rgba(255,255,255,0.22)` border and a soft shadow.
  - Corner radius 48 px (18 pt on a 402 pt-wide iPhone, scaled to 1080 px). Padding 12 × 34 px.
  - White text with a 1 px shadow.
  - The spoken word turns `#FF3B30` and pulses 1 → 1.08 → 1 (3 frames up, 4 down).
  - Claude's emphasis word is white on a red capsule for the whole page.
  - Pages pop 0.85 → 1 with a small overshoot over 6 frames and fade in over 3. The emoji pop is unchanged.
  - Placement is unchanged (below the face, 55–72 %, seam 50 % on splits, hidden under the headline and the CTA card).
  - White text on the glass keeps a contrast of at least 4.5:1 over a flat black, mid-grey or white frame.
- **Headline and CTA:** small words in white on the same glass pill (headline), or white with a shadow (CTA). The big words / keyword are white Heebo 800 on a red `#FF3B30` sticker (radius 36, tilted −2°).
- **Cutaway budget (spec §4.3 as amended), per reel target T s:**
  - at most `round(T/3)` cutaways, `floor(T/7.5)` of them video
  - `ai_self` unchanged: `max(1, floor(T/20))` with a character, else 0
  - So 15 s → 5 / 2, 30 s → 10 / 4, 45 s → 15 / 6, 60 s → 20 / 8, 90 s → 30 / 12.
  - Claude is told to plan close to the maximum.
  - Prices are unchanged (still $0.04, clip $0.36 at ≤ 4 billed s). Generation still reserves every paid element against the approved estimate.
- **Cutaway transitions (spec §5.4 as amended):**
  - Full cutaways alternate `whip` and `zoom` (whip: a slide with a 22 px blur that moves forward in reading order; zoom: 1.25 → 1 with an 18 px blur and a fade, leaving as 1 → 1.15 with a fade).
  - Split cutaways `slide` down from the top and back up.
  - The B-roll opening (pulled to frame 0) enters with `cut`.
  - A cutaway followed by another within 6 frames leaves with `cut`.
  - Entry is 6 frames and exit 5 frames, both inside the cutaway's own frames, so no timing changes.
  - Every cutaway that enters with a transition gets a whoosh (whoosh2 / whoosh1 alternating, −14 dB) unless a whoosh is already within 6 frames.
- **Ken Burns (spec §6 as amended):**
  - Stills zoom 1 → 1.12 with an ease-out sine and drift 3 % of the frame.
  - Drift direction cycles right, up, left, down per still.
  - The translate is clamped so no frame edge ever shows.
  - A misfit upload's blurred fill drifts half as far the other way (parallax).
  - Video cutaways get no Ken Burns.
- **Diagram cards:** an iOS card, white `#FFFFFF`, radius 56, on `#F2F2F7`. The card fills its slot (inset 44 px full, 28 px split).
  - Items spring in staggered (stiffness 170, damping 15, every 7 frames).
  - List rows: a red circle with a checkmark that draws itself, plus hairline separators.
  - Compare: two grey tiles and a red "VS" badge.
  - Flow: numbered red circles joined by a red line that draws downward.
  - Rows and tiles flex to fill the card (no empty area).
- **Callouts (spec §5.6 as amended):**
  - Field: `Beat.callout?: { text }`, trimmed, 1–16 characters, at most 3 words (a number like "1/5" or 1–3 words).
  - Budget: at most `floor(T/5)` per reel, enforced after Claude in beat order with a warning.
  - Timing (from the plan alone, so the review page shows the same warnings): the first free stretch of the beat of at least 800 ms, at most 1600 ms long. Not free:
    - the hook headline (0 to `headlineMs`)
    - the CTA card
    - every placed cutaway plus 6 frames after it

    No free stretch: dropped with "The callout in bN was dropped: the hook headline, a cutaway or the CTA card covers its beat."
  - Position (compiler, from the face track):
    1. Centred just above the on-screen face, if its top edge stays below the 9 % top safe area (badge height 7 %, gap 2 %).
    2. Otherwise in the top band (centre 12.5 %) on the side with at least 48 % free width beside the face (4 % side padding).
    3. Otherwise left out, with the generation note "The callout in bN was left out: there was no room for it without covering your face."
    4. No face: centred at 20 %.
  - Pattern breaks never start during a callout or 6 frames before it.
  - Each callout gets a pop (pop1 / pop2 alternating, the pop volume) unless any cue is within 3 frames.
- **Callout look:** white badge, red `#FF3B30` Heebo 800 text at 52 px, radius 40, tilted −4°, shadow. Springs in (stiffness 220, damping 14) and shrinks out over the last 5 frames.
- **Progress bar:** footage reels only (`timeline.progressBar: true`). 8 px at the top edge, red `#FF3B30` on a `rgba(255,255,255,0.28)` track. Fills from the reading-start side (left in English, right in Hebrew).
- **Existing formats** (faceless, Custom, styles, voice SRT) render byte for byte as before: every `Timeline` addition is optional and only `compileFootage` sets it. Plans saved before this change still parse (`callout` is optional).
- **Safety:** no paid API calls (Claude, Scribe, ElevenLabs, Higgsfield). All tests use fakes and lavfi fixtures. Never read `.env.local`. Never touch `tools/` or the scratchpad.
- **Copy:** UI copy is English. In-video copy follows the reel language (Hebrew RTL, English LTR); callout and caption text uses `unicode-bidi: isolate`.
- **Commits:** every commit message ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the files the task lists.

## Review Focus

1. **Glass readability over bright frames.** A pill on the split seam over the new white diagram card, over a white flash, or over bright B-roll must keep white text readable (≥ 4.5:1 on a flat white backdrop, even if the backdrop blur doesn't render). Pinned in Task 2 (contrast test on the composited glass colour).
2. **Callout text from Claude or the review page.** "1/5", "AI", Hebrew words, mixed Hebrew and numbers, 4+ words or 17+ characters. Valid ones show isolated in their direction. Invalid ones are removed with a plain warning when Claude wrote them (no repair round spent), and refused with a plain message on the review page. Pinned in Tasks 5, 6 and 8.
3. **Callouts that collide.** A beat covered by the headline, a cutaway or the CTA card; a face that fills the top of the frame; a pattern break on the same moment. Each must drop or yield deterministically with a warning or note, never cover the face or share a moment with another effect. Pinned in Task 5.
4. **Spend at the new budget.** A 30 s reel at the full budget (10 cutaways, 4 clips) must estimate $1.68, and generation must skip, with a note, the one element the approved estimate can't cover, never paying past it. Pinned in Task 1.
5. **Back-to-back cutaways and the B-roll opening.**
   - No flicker of the speaker between adjacent cutaways.
   - The opening cutaway is on screen at frame 0 (no entry animation).
   - No doubled whoosh where the hook already whooshes.

   Pinned in Task 3.

## File map

| Area | Files |
|---|---|
| Core | `footage/cutaways.ts`, `footage/style.ts`, `footage/compile.ts`, `footage/caption-place.ts`, `footage/callouts.ts` (new), `schema/edit-plan.ts`, `schema/timeline.ts`, `testing/fixtures.ts`, `index.ts` |
| Video | `fonts.ts`, `house-style.ts`, `footage/glass.ts` (new), `footage/motion.ts`, `footage/PillCaptions.tsx`, `footage/HookHeadline.tsx`, `footage/CtaCard.tsx`, `footage/Cutaways.tsx`, `footage/DiagramCard.tsx`, `footage/icons.tsx`, `footage/Callouts.tsx` (new), `footage/ProgressBar.tsx` (new), `Reel.tsx`, `sample-footage.ts` |
| Engine | `footage-planner.ts`, `footage-generate.ts`, `providers/fake.ts`, `scripts/preview-look.ts` (new) |
| Web | `lib/edit-plan-edit.ts`, `lib/cutaway-edit.ts`, `components/FootagePlanEditor.tsx` |
| Root and docs | `package.json` (script `preview:look`), `docs/RUNNING.md` |

Tasks run in order: several touch `house-style.ts`, `style.ts`, `compile.ts` and `fixtures.ts`.

---

### Task 1: Cutaway budget of about one per 3 s; the planner uses it

**Files:**
- Modify: `packages/core/src/footage/cutaways.ts` (`cutawayBudget`)
- Modify: `packages/engine/src/footage-planner.ts` (`footageSystemPrompt`, `cutawayBudgetLine`)
- Test: `packages/core/src/footage/cutaways.test.ts`, `packages/core/src/footage/compile.test.ts`, `packages/engine/src/footage-planner.test.ts`, `packages/engine/src/footage-cutaways.test.ts`

**Interfaces:**
- Consumes: `cutawayBudget`, `applyCutawayBudget`, `planCutaways`, `withFootageEstimate`, `generateCutaways`, `makeBudget` (all existing).
- Produces: `cutawayBudget(targetSec, hasCharacter)` returns `{ max: round(T/3), maxVideo: floor(T/7.5), maxSelf }` (signature unchanged).

- [ ] **Step 1: Write the failing budget tests.** In `packages/core/src/footage/cutaways.test.ts`, replace the test `"scales with the target length"` with:
```ts
  it("allows about one cutaway every 3 s and one clip every 7.5 s", () => {
    expect(cutawayBudget(15, false)).toEqual({ max: 5, maxVideo: 2, maxSelf: 0 });
    expect(cutawayBudget(30, true)).toEqual({ max: 10, maxVideo: 4, maxSelf: 1 });
    expect(cutawayBudget(45, true)).toEqual({ max: 15, maxVideo: 6, maxSelf: 2 });
    expect(cutawayBudget(60, false)).toEqual({ max: 20, maxVideo: 8, maxSelf: 0 });
    expect(cutawayBudget(90, true)).toEqual({ max: 30, maxVideo: 12, maxSelf: 4 });
  });
```
In the next test (`"removes AI shots of you without a character, …"`), replace `applyCutawayBudget(beats, cutawayBudget(15, false), 15)` with `applyCutawayBudget(beats, { max: 3, maxVideo: 1, maxSelf: 0 }, 15)`. That test checks the trimming order, not the formula; its expectations stay as they are.

- [ ] **Step 2: Write the failing estimate test.** In `packages/core/src/footage/compile.test.ts` add `import { cutawayBudget, planCutaways } from "./cutaways";`, then add to `describe("estimate", …)`:
```ts
  it("prices a 30 s reel at the full budget: 10 cutaways, 4 of them clips", () => {
    const words = Array.from({ length: 60 }, (_, i) => ({ text: `מילה${i}`, startMs: i * 500, endMs: i * 500 + 400 }));
    const cut = (media: "image" | "video") => ({ source: { kind: "ai_broll" as const, prompt: "laptop", media }, layout: "full" as const, atMs: 0, durationMs: 1500 });
    const budget = cutawayBudget(30, false);
    const p = parseEditPlan({
      ...validEditPlan(),
      targetDurationSec: 30,
      source: { ...validEditPlan().source, durationMs: 30_000 },
      beats: Array.from({ length: budget.max }, (_, i) => ({ id: `b${i + 1}`, startWordIdx: i * 6, endWordIdx: i * 6 + 5, keep: true, cutaway: cut(i % 3 === 0 ? "video" : "image") })),
      hook: { patternBreak: "none", reason: "" },
      ending: { kind: "none" },
    });
    expect(planCutaways(p, words, style).placed).toHaveLength(10);
    // 4 clips × ($0.04 still + 4 billed s × $0.08) + 6 stills × $0.04
    expect(withFootageEstimate(p, words, style).estimate.credits).toBe(1.68);
  });
```

- [ ] **Step 3: Write the failing spend-cap test.** In `packages/engine/src/footage-cutaways.test.ts` change the first import to `import { parseEditPlan, planCutaways, type EditPlan, type PlacedCutaway } from "@reel/core";` and add to the `describe`:
```ts
  it("at the full 30 s budget, reserves in reel order and skips the one clip the estimate can't cover", async () => {
    const s = await setup();
    const placed: PlacedCutaway[] = Array.from({ length: 10 }, (_, i) => ({
      beatId: `b${i + 1}`, source: { kind: "ai_broll", prompt: `scene ${i + 1}`, media: i % 3 === 0 ? "video" : "image" },
      layout: "full", fromFrame: i * 90, durationInFrames: 45, pulled: false,
    }));
    const budget = makeBudget(1.67); // the full price is $1.68
    const r = await generateCutaways(placed, s.p, { ...s.deps(0), budget });
    expect(r.notes).toEqual(["The cutaway in b10 was skipped: it would cost more than the approved estimate. Use Edit as new version and approve again to update it."]);
    expect(Object.keys(r.assets)).toHaveLength(9);
    expect([s.providers.calls.image, s.providers.calls.video]).toEqual([9, 3]);
    expect(budget.remaining).toBeCloseTo(1.67 - 1.32, 6);
  }, 300_000);
```
(b1, b4 and b7 are clips at $0.36 each, and the six stills before b10 are $0.04 each: $1.32 reserved. b10's clip needs $0.36 and only $0.35 is left.)

- [ ] **Step 4: Write the failing prompt tests.** In `packages/engine/src/footage-planner.test.ts` add `footageSystemPrompt` to the import from `./footage-planner`. Replace the first `expect(user).toContain(…)` in `"tells Claude the budget, the uploads and the character"` with:
```ts
    expect(user).toContain('Cutaway budget: at most 5 cutaways (at most 2 video clips); at most 1 AI shot of the speaker (character "Alex"). Plan close to the maximum: about one cutaway every 3 s.');
```
and add a test to the same `describe`:
```ts
  it("asks Claude to use the cutaway budget, and never mentions yellow", () => {
    const system = footageSystemPrompt();
    expect(system).toContain("plan close to its maximum (about one cutaway every 3 seconds of the finished reel)");
    expect(system).toContain("one or two huge words on a red sticker");
    expect(system).not.toMatch(/yellow/i);
  });
```

- [ ] **Step 5: Run the tests to verify they fail.** Run `npx vitest run packages/core/src/footage packages/engine/src/footage-planner.test.ts packages/engine/src/footage-cutaways.test.ts`.

  Expected:
  - The budget test fails: it gets `{ max: 3, maxVideo: 1, … }`.
  - The estimate test fails: `cutawayBudget(30).max` is still 6, so the plan has 6 beats and only 6 cutaways are placed.
  - The prompt tests fail on the missing text.
  - The spend-cap test already passes: it pins behaviour that must not regress.

- [ ] **Step 6: Implement the budget.** In `packages/core/src/footage/cutaways.ts` replace `cutawayBudget` and its doc comment with:
```ts
/** Spec §4.3 as amended by the look pass: about one cutaway every 3 s and one clip every 7.5 s. Code enforces it with applyCutawayBudget. */
export function cutawayBudget(targetSec: number, hasCharacter: boolean): CutawayBudget {
  return { max: Math.round(targetSec / 3), maxVideo: Math.floor(targetSec / 7.5), maxSelf: hasCharacter ? Math.max(1, Math.floor(targetSec / 20)) : 0 };
}
```

- [ ] **Step 7: Implement the prompt changes.** In `packages/engine/src/footage-planner.ts`, `footageSystemPrompt()`:
  - Replace the headline line with:
    ```ts
        "  - headlineSmall + headlineBig: a small white line (at most 5 words) and one or two huge words on a red sticker (at most 12 characters), in the reel's language. Both empty for no headline.",
    ```
  - Replace the cutaway line (`"- cutaway: at most one per beat, kind \"none\" for most beats; …"`) with:
    ```ts
        "- cutaway: at most one per beat. Use the cutaway budget: plan close to its maximum (about one cutaway every 3 seconds of the finished reel), spread evenly over the kept beats, and use the video clips it allows on the most visual moments. Show what the words talk about; 1–2 s is typical (durationMs 1000–3000), starting atMs after the beat starts, counted after pauses are cut; keep atMs + durationMs inside the beat.",
    ```

  In `cutawayBudgetLine`, change the return to:
```ts
  return `Cutaway budget: at most ${plural(b.max, "cutaway", "cutaways")} (at most ${plural(b.maxVideo, "video clip", "video clips")}); ${self} Plan close to the maximum: about one cutaway every 3 s.`;
```

- [ ] **Step 8: Run the tests.** Run `npx vitest run packages/core packages/engine/src/footage-planner.test.ts packages/engine/src/footage-cutaways.test.ts && npm run typecheck`.

  Expected: PASS.

- [ ] **Step 9: Commit.**
```bash
git add packages/core/src/footage/cutaways.ts packages/core/src/footage/cutaways.test.ts packages/core/src/footage/compile.test.ts packages/engine/src/footage-planner.ts packages/engine/src/footage-planner.test.ts packages/engine/src/footage-cutaways.test.ts
git commit -m "feat(footage): about one cutaway every 3 s (round(T/3), clips floor(T/7.5)); the planner is told to use the budget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: iOS glass-pill captions, red-sticker headline and CTA, Heebo weights

**Files:**
- Create: `packages/video/src/footage/glass.ts`
- Modify: `packages/video/src/fonts.ts`, `packages/video/src/house-style.ts`, `packages/video/src/footage/motion.ts`, `packages/video/src/footage/PillCaptions.tsx`, `packages/video/src/footage/HookHeadline.tsx`, `packages/video/src/footage/CtaCard.tsx`, `packages/core/src/footage/compile.ts` (palette only)
- Test: `packages/video/src/house-style.test.ts`, `packages/video/src/footage/motion.test.ts`, `packages/video/src/footage-render.test.ts` (existing stills, re-rendered)

**Interfaces:**
- Produces:
  - `IOS` (exported from `house-style.ts`): `{ red, white, ink, secondary, groupedBg, separator }`.
  - `houseStyle.captions`, now `{ topPct, fontSize, fontWeight, textColor, textShadow, glass, radius, padX, padY, maxWidthPct, popFrames, popFrom, fadeFrames, minVisibleFrames, activeWord: { color, peak, upFrames, downFrames }, emphasis: { background, color, fontWeight, padX, radius }, emoji }`.
  - `houseStyle.headline` and `houseStyle.cta` with `sticker: { color, radius, padX, padY, tiltDeg }`.
  - `glassStyle(g: Glass): React.CSSProperties`.
  - `wordPulse(frame, up, down, peak): number` (replaces `wordPop`).

- [ ] **Step 1: Write the failing house-style tests.** Replace `packages/video/src/house-style.test.ts` with:
```ts
import { EditStyleSchema } from "@reel/core";
import { describe, expect, it } from "vitest";
import { testEditStyle } from "../../core/src/testing/fixtures";
import { houseStyle, IOS } from "./house-style";

const hexes = (o: unknown) => [...JSON.stringify(o).matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => m[1]);
function hsl(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}
const luminance = (rgb: number[]) => {
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb.map((v) => f(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** The glass fill composited over a flat backdrop: the worst case, as if the backdrop blur didn't render. */
const glassOver = (bg: number[]) => {
  const m = houseStyle.captions.glass.background.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/)!;
  const [r, g, b, a] = m.slice(1).map(Number);
  return [r, g, b].map((v, i) => v * a + bg[i] * (1 - a));
};

describe("houseStyle", () => {
  it("is a valid edit style and matches the core test fixture", () => {
    expect(EditStyleSchema.parse(houseStyle.edit)).toEqual(testEditStyle());
  });
  it("uses iOS white and red for captions, headline and CTA (Heebo SemiBold 64 px captions)", () => {
    expect(houseStyle.captions).toMatchObject({ fontSize: 64, fontWeight: 600, textColor: "#FFFFFF", radius: 48 });
    expect(houseStyle.captions.activeWord).toMatchObject({ color: "#FF3B30", peak: 1.08, upFrames: 3, downFrames: 4 });
    expect(houseStyle.captions.emphasis).toMatchObject({ background: IOS.red, color: IOS.white });
    expect(houseStyle.headline.sticker.color).toBe("#FF3B30");
    expect(houseStyle.cta.sticker.color).toBe("#FF3B30");
  });
  it("has no yellow or orange anywhere", () => {
    const warm = hexes(houseStyle).filter((h) => {
      const c = hsl(h);
      return c.s > 0.4 && c.l > 0.25 && c.l < 0.85 && c.h >= 20 && c.h <= 70;
    });
    expect(warm).toEqual([]);
  });
  it("keeps white caption text readable on the glass over black, mid-grey and white frames", () => {
    for (const bg of [[0, 0, 0], [128, 128, 128], [255, 255, 255]]) expect(contrast([255, 255, 255], glassOver(bg))).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Write the failing motion test.** In `packages/video/src/footage/motion.test.ts`:
  - Replace `wordPop` with `wordPulse` in the import.
  - Replace the test `"pops the active word from 1.12 back to 1 over 3 frames"` with:
    ```ts
      it("pulses the spoken word 1 → 1.08 → 1 (3 frames up, 4 down)", () => {
        expect(wordPulse(-2, 3, 4, 1.08)).toBe(1);
        expect(wordPulse(0, 3, 4, 1.08)).toBe(1);
        expect(wordPulse(1, 3, 4, 1.08)).toBeGreaterThan(1.03);
        expect(wordPulse(3, 3, 4, 1.08)).toBeCloseTo(1.08, 6);
        expect(wordPulse(5, 3, 4, 1.08)).toBeLessThan(1.08);
        expect(wordPulse(7, 3, 4, 1.08)).toBeCloseTo(1, 6);
        expect(wordPulse(40, 3, 4, 1.08)).toBe(1);
      });
    ```

- [ ] **Step 3: Run the tests to verify they fail.** Run `npx vitest run packages/video/src/house-style.test.ts packages/video/src/footage/motion.test.ts`.

  Expected: FAIL: `IOS` is not exported, `wordPulse` is not a function, and the yellow test lists `FEE80A`.

- [ ] **Step 4: Load the Heebo weights.** Replace `packages/video/src/fonts.ts` with:
```ts
import { loadFont } from "@remotion/google-fonts/Heebo";

// Heebo covers Hebrew and Latin. Look pass: SemiBold 600 for captions, 700/800 for headline, CTA, diagrams and callouts.
// Timeline.style.font is reserved for more fonts later; all text uses Heebo for now.
export const { fontFamily: HEEBO } = loadFont("normal", { weights: ["600", "700", "800"], subsets: ["hebrew", "latin"] });
```

- [ ] **Step 5: Add the glass helper.** Create `packages/video/src/footage/glass.ts`:
```ts
import type React from "react";

export type Glass = { background: string; blurPx: number; saturate: number; border: string; shadow: string };

/** iOS frosted glass: blurs and saturates what is behind it; the translucent fill alone keeps text readable (house-style.test). */
export function glassStyle(g: Glass): React.CSSProperties {
  const filter = `blur(${g.blurPx}px) saturate(${g.saturate})`;
  return { background: g.background, backdropFilter: filter, WebkitBackdropFilter: filter, border: `2px solid ${g.border}`, boxShadow: g.shadow };
}
```

- [ ] **Step 6: Restyle `houseStyle`.** In `packages/video/src/house-style.ts`:
  - Add above `export const houseStyle`:
    ```ts
    /** iOS system colours (Apple HIG). The look pass uses white and red only: never yellow or orange (house-style.test). */
    export const IOS = {
      red: "#FF3B30",
      white: "#FFFFFF",
      ink: "#1C1C1E", // label
      secondary: "#8E8E93", // secondaryLabel
      groupedBg: "#F2F2F7", // systemGroupedBackground
      separator: "rgba(60,60,67,0.18)",
    } as const;

    /** Frosted dark glass: white text stays ≥ 4.5:1 even over a white diagram card or a flash (house-style.test). */
    const GLASS = { background: "rgba(22,22,24,0.62)", blurPx: 28, saturate: 1.8, border: "rgba(255,255,255,0.22)", shadow: "0 12px 32px rgba(0,0,0,0.28)" } as const;
    ```
  - Replace the whole `captions: { … }` entry with:
    ```ts
      captions: {
        topPct: 45, // only when a page has no position
        fontSize: 64, fontWeight: 600, textColor: IOS.white, textShadow: "0 1px 2px rgba(0,0,0,0.35)",
        glass: GLASS,
        // 18 pt corner radius on a 402 pt-wide iPhone, scaled to 1080 px wide.
        radius: 48, padX: 34, padY: 12, maxWidthPct: 86,
        popFrames: 6, popFrom: 0.85, fadeFrames: 3,
        minVisibleFrames: 8,
        // The spoken word turns iOS red and pulses 1 → 1.08 → 1 on its beat.
        activeWord: { color: IOS.red, peak: 1.08, upFrames: 3, downFrames: 4 },
        // Claude's emphasis word: white on a red capsule for the whole page (distinct from the spoken word).
        emphasis: { background: IOS.red, color: IOS.white, fontWeight: 800, padX: 14, radius: 18 },
        emoji: { popFrames: 8, overshoot: 1.35 },
      },
    ```
  - Replace the `headline`, `cta` and `flash` entries with:
    ```ts
      /** Under the captions' range so neither covers the face. Small line on the caption glass, big words on a red sticker. */
      headline: {
        topPct: 58, smallSize: 58, smallWeight: 700, bigSize: 150, bigWeight: 800, color: IOS.white,
        sticker: { color: IOS.red, radius: 36, padX: 36, padY: 4, tiltDeg: -2 },
        shadow: "0 10px 30px rgba(0,0,0,0.35)", popFrames: 5, popFrom: 0.6,
      },
      cta: {
        topPct: 62, smallSize: 64, smallWeight: 700, bigSize: 140, bigWeight: 800, color: IOS.white,
        sticker: { color: IOS.red, radius: 36, padX: 40, padY: 4, tiltDeg: -2 },
        shadow: "0 10px 30px rgba(0,0,0,0.45)", scrim: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.6) 100%)", popFrames: 6, popFrom: 0.7,
      },
      flash: { color: IOS.white },
    ```

- [ ] **Step 7: Add `wordPulse`.** In `packages/video/src/footage/motion.ts` replace the `wordPop` export with:
```ts
/** The spoken word's pulse: 1 → peak over `up` frames, then back to 1 over `down` frames. */
export function wordPulse(frame: number, up: number, down: number, peak: number): number {
  if (frame <= 0) return 1;
  if (frame < up) return 1 + (peak - 1) * easeOutCubic(frame / up);
  return 1 + (peak - 1) * (1 - easeOutCubic(clamp01((frame - up) / down)));
}
```

- [ ] **Step 8: Rewrite `PillCaptions`.** Replace `packages/video/src/footage/PillCaptions.tsx` with:
```tsx
import type { CaptionPage, Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { glassStyle } from "./glass";
import { activeWordIndex, captionHideRanges, emojiScale, popBounce, visiblePages, wordPulse } from "./motion";

const c = houseStyle.captions;

/** One page on an iOS glass pill: white text, the spoken word red with a pulse, Claude's emphasis word on a red capsule. */
const PillPage: React.FC<{ page: CaptionPage; startAt: number; direction: Timeline["direction"] }> = ({ page, startAt, direction }) => {
  const frame = useCurrentFrame();
  const abs = startAt + frame;
  const active = activeWordIndex(page.words, abs);
  const emojiAt = page.words.at(-1)?.startFrame ?? startAt;
  const e = c.emphasis;
  return (
    <div style={{ position: "absolute", top: `${page.topPct ?? c.topPct}%`, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div
        dir={direction}
        style={{
          ...glassStyle(c.glass),
          transform: `translateY(-50%) scale(${popBounce(frame, c.popFrames, c.popFrom).toFixed(4)})`,
          opacity: Math.min(1, (frame + 1) / c.fadeFrames),
          maxWidth: `${c.maxWidthPct}%`, color: c.textColor, borderRadius: c.radius, padding: `${c.padY}px ${c.padX}px`,
          fontFamily: HEEBO, fontWeight: c.fontWeight, fontSize: c.fontSize, lineHeight: 1.25, textAlign: "center", direction, textShadow: c.textShadow,
        }}
      >
        {page.words.map((w, i) => {
          const on = i === active;
          const scale = on ? wordPulse(abs - (w.startFrame ?? startAt), c.activeWord.upFrames, c.activeWord.downFrames, c.activeWord.peak) : 1;
          return (
            <React.Fragment key={i}>
              {i > 0 ? " " : null}
              <span
                style={{
                  display: "inline-block", unicodeBidi: "isolate", transform: `scale(${scale.toFixed(4)})`,
                  ...(w.emphasis
                    ? { background: e.background, color: e.color, fontWeight: e.fontWeight, borderRadius: e.radius, padding: `0 ${e.padX}px`, textShadow: "none" }
                    : on ? { color: c.activeWord.color } : {}),
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
 * The footage caption preset "pill": rendered above the clips, cutaways and callouts, so it survives cuts. It gives way to the hook
 * headline and the CTA card (those show bigger text); the SRT keeps every page.
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

- [ ] **Step 9: Rewrite `HookHeadline`.** Replace `packages/video/src/footage/HookHeadline.tsx` with:
```tsx
import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { glassStyle } from "./glass";
import { popIn, revealedCount } from "./motion";

const h = houseStyle.headline;
const wf = houseStyle.edit.headlineWordFrames;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** Small line on the caption glass, big words in white on a tilted red sticker; words pop in one by one (spec §5.7). */
const Headline: React.FC<{ small: string; big: string; direction: Timeline["direction"] }> = ({ small, big, direction }) => {
  const frame = useCurrentFrame();
  const smallWords = words(small);
  const bigWords = words(big);
  const shown = revealedCount(smallWords.length + bigWords.length, frame, wf);
  const scaleAt = (i: number) => (i < shown ? popIn(frame - i * wf, h.popFrames, h.popFrom) : h.popFrom);
  // Unrevealed words keep their space (visibility: hidden), so the pill and the sticker never resize while words appear.
  const word = (text: string, i: number) => (
    <span key={i} style={{ display: "inline-block", margin: "0 0.16em", visibility: i < shown ? "visible" : "hidden", transform: `scale(${scaleAt(i).toFixed(4)})`, unicodeBidi: "isolate" }}>
      {text}
    </span>
  );
  const firstBig = smallWords.length;
  return (
    <div
      dir={direction}
      style={{ position: "absolute", top: `${h.topPct}%`, left: 40, right: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, textAlign: "center", direction, fontFamily: HEEBO, color: h.color, lineHeight: 1.1 }}
    >
      {smallWords.length > 0 ? (
        <div style={{ ...glassStyle(houseStyle.captions.glass), borderRadius: houseStyle.captions.radius, padding: "8px 30px", fontSize: h.smallSize, fontWeight: h.smallWeight, opacity: shown > 0 ? 1 : 0 }}>
          {smallWords.map((t, i) => word(t, i))}
        </div>
      ) : null}
      <div
        style={{
          background: h.sticker.color, borderRadius: h.sticker.radius, padding: `${h.sticker.padY}px ${h.sticker.padX}px`, fontSize: h.bigSize, fontWeight: h.bigWeight,
          boxShadow: h.shadow, maxWidth: "100%", overflowWrap: "anywhere", visibility: shown > firstBig ? "visible" : "hidden",
          transform: `rotate(${h.sticker.tiltDeg}deg) scale(${scaleAt(firstBig).toFixed(4)})`,
        }}
      >
        {bigWords.map((t, j) => word(t, firstBig + j))}
      </div>
    </div>
  );
};

export const HookHeadline: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const headline = timeline.hook?.headline;
  if (!headline) return null;
  return (
    <AbsoluteFill>
      <Sequence from={headline.fromFrame} durationInFrames={headline.durationInFrames} layout="none">
        <Headline small={headline.small} big={headline.big} direction={timeline.direction} />
      </Sequence>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 10: Rewrite `CtaCard`.** Replace `packages/video/src/footage/CtaCard.tsx` with:
```tsx
import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { ctaLines, popIn } from "./motion";

const k = houseStyle.cta;

/** "Comment 'KEYWORD'": white lines, the keyword in white on a tilted red sticker (look pass; no yellow). */
const Card: React.FC<{ keyword: string; timeline: Timeline }> = ({ keyword, timeline }) => {
  const frame = useCurrentFrame();
  const lines = ctaLines(keyword, timeline.language);
  const line = (text: string) =>
    text ? <div style={{ fontSize: k.smallSize, fontWeight: k.smallWeight, color: k.color, textShadow: k.shadow, unicodeBidi: "isolate" }}>{text}</div> : null;
  return (
    <AbsoluteFill style={{ background: k.scrim }}>
      <div
        dir={timeline.direction}
        style={{ position: "absolute", top: `${k.topPct}%`, left: 40, right: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center", fontFamily: HEEBO, lineHeight: 1.1, direction: timeline.direction, transform: `scale(${popIn(frame, k.popFrames, k.popFrom).toFixed(4)})` }}
      >
        {line(lines.before)}
        <div
          style={{
            background: k.sticker.color, color: k.color, borderRadius: k.sticker.radius, padding: `${k.sticker.padY}px ${k.sticker.padX}px`, fontSize: k.bigSize, fontWeight: k.bigWeight,
            boxShadow: k.shadow, transform: `rotate(${k.sticker.tiltDeg}deg)`, unicodeBidi: "isolate", maxWidth: "100%", overflowWrap: "anywhere",
          }}
        >
          {lines.keyword}
        </div>
        {line(lines.after)}
      </div>
    </AbsoluteFill>
  );
};

export const CtaCard: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const ending = timeline.ending;
  if (ending?.kind !== "cta") return null;
  return (
    <Sequence from={ending.fromFrame} durationInFrames={ending.durationInFrames} layout="none">
      <Card keyword={ending.keyword} timeline={timeline} />
    </Sequence>
  );
};
```

- [ ] **Step 11: Drop the yellow palette from footage timelines.** In `packages/core/src/footage/compile.ts` change `palette: ["#FEE80A", "#000000"]` to `palette: ["#FF3B30", "#FFFFFF"]`. The palette is only read by voice-reel graphic clips; footage timelines carry it for the schema.

- [ ] **Step 12: Run the tests and render the stills.** Run `npx vitest run packages/video packages/core && npm run typecheck`.

  Expected: PASS. `footage-render.test.ts` re-renders `work/stills/footage-*.png`.

  Open `footage-pill-active-word-he.png`, `footage-pill-emphasis-emoji-he.png`, `footage-headline-only-he.png` and `footage-cta-card-he.png`, plus their `-en` versions, and check by eye:
  - The pill is dark glass with white Heebo text and a red spoken word.
  - The emphasis word is white on a red capsule.
  - The headline's big words and the CTA keyword sit on a red sticker.
  - No yellow anywhere.

  Hebrew reads right to left.

- [ ] **Step 13: Commit.**
```bash
git add packages/video/src/fonts.ts packages/video/src/house-style.ts packages/video/src/house-style.test.ts packages/video/src/footage/glass.ts packages/video/src/footage/motion.ts packages/video/src/footage/motion.test.ts packages/video/src/footage/PillCaptions.tsx packages/video/src/footage/HookHeadline.tsx packages/video/src/footage/CtaCard.tsx packages/core/src/footage/compile.ts
git commit -m "feat(video): iOS glass-pill captions in white and red (Heebo 600), red-sticker hook headline and CTA; no yellow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cutaway transitions (whip, zoom, slide) and Ken Burns drift on stills

**Files:**
- Modify: `packages/core/src/footage/style.ts`, `packages/core/src/schema/timeline.ts`, `packages/core/src/footage/cutaways.ts`, `packages/core/src/footage/compile.ts`, `packages/core/src/testing/fixtures.ts`, `packages/video/src/house-style.ts`, `packages/video/src/footage/motion.ts`, `packages/video/src/footage/Cutaways.tsx`
- Test: `packages/core/src/footage/cutaways.test.ts`, `packages/core/src/footage/compile.test.ts`, `packages/video/src/footage/motion.test.ts`

**Interfaces:**
- Consumes: `PlacedCutaway` (`{ beatId, source, layout, fromFrame, durationInFrames, pulled }`), `compileFootage`.
- Produces (core):
  - `CutawayTransitionSchema = z.enum(["cut", "whip", "zoom", "slide"])` and `type CutawayTransition`.
  - `TimelineCutaway.transition?: { in: CutawayTransition; out: CutawayTransition }`.
  - Image media `drift?: { x: number; y: number }` (fractions of the frame, |x|, |y| ≤ 0.1).
  - `EditStyle.cutaways` gains `driftPct`, `transitions: ("whip" | "zoom")[]`, `backToBackFrames`, `whooshDb`; `kenBurns` becomes 1.12.
  - `cutawayTransitions(shown: Pick<PlacedCutaway, "layout" | "fromFrame" | "durationInFrames" | "pulled">[], style: EditStyle): { in: CutawayTransition; out: CutawayTransition }[]` in `footage/cutaways.ts`.
- Produces (video):
  - `houseStyle.cutaway.transition = { inFrames, outFrames, whipBlurPx, zoomFrom, zoomTo, zoomBlurPx }`.
  - `cutawayMotion(t, frame, durationInFrames, direction, m): SlotMotion`.
  - `kenBurnsTransform(frame, frames, to, drift?)`, which replaces `kenBurnsScale`.
  - `parallaxFill(frame, frames, scale, drift)`.

- [ ] **Step 1: Write the failing core tests.** In `packages/core/src/footage/cutaways.test.ts` add `cutawayTransitions` to the import from `./cutaways` and add:
```ts
describe("cutaway transitions", () => {
  const c = (layout: "full" | "split", fromFrame: number, durationInFrames: number, pulled = false) => ({ layout, fromFrame, durationInFrames, pulled });
  it("cycles whip and zoom on full cutaways, slides split ones, and cuts in the B-roll opening at frame 0", () => {
    expect(cutawayTransitions([c("full", 0, 30, true), c("split", 60, 45), c("full", 150, 45), c("full", 250, 45)], style)).toEqual([
      { in: "cut", out: "whip" }, { in: "slide", out: "slide" }, { in: "zoom", out: "zoom" }, { in: "whip", out: "whip" },
    ]);
  });
  it("leaves with a cut when the next cutaway follows within 6 frames, so the speaker never flickers between them", () => {
    expect(cutawayTransitions([c("full", 0, 45), c("full", 51, 45), c("full", 120, 45)], style).map((t) => t.out)).toEqual(["cut", "zoom", "whip"]);
  });
});
```
In `packages/core/src/footage/compile.test.ts`, inside `describe("cutaways", …)`:
- Replace the two `expect`s about the cutaway layer and the whoosh in `"full: a cutaway layer over the speaker …"` with:
  ```ts
      expect(timeline.cutaways).toEqual([{
        id: "b2", fromFrame: 89, durationInFrames: 45, layout: "full", transition: { in: "whip", out: "whip" },
        media: { kind: "image", src: "asset:b2.png", fit: "cover", kenBurns: 1.12, drift: { x: 0.03, y: 0 } },
      }]);
      expect(timeline.sfx).toContainEqual({ name: "whoosh2", frame: 89, src: "w2.wav", volumeDb: -14 });
  ```
- In the `"split: …"` test add:
  ```ts
      expect(timeline.cutaways![0].transition).toEqual({ in: "slide", out: "slide" });
      expect(timeline.sfx?.map((c) => `${c.name}@${c.frame}`)).toContain("whoosh2@89");
  ```
- In the `"B-roll pattern break: …"` test add:
  ```ts
      expect(timeline.cutaways![0].transition).toEqual({ in: "cut", out: "whip" });
      expect(timeline.sfx!.filter((c) => c.frame === 0).map((c) => c.name)).toEqual(["whoosh1"]); // the hook's whoosh only, never doubled
  ```
- Add a test:
  ```ts
    it("drifts each still a different way (right, up, left, down) and never drifts clips", () => {
      const four = plan({
        ending: { kind: "none" }, hook: { patternBreak: "none", reason: "" },
        beats: validEditPlan().beats.map((b) => ({ ...b, cutaway: still("split", 0, 1000) })) as EditPlan["beats"],
      });
      const art = { ...assets, cutaways: { b1: { kind: "image" as const, src: "asset:1.png" }, b2: { kind: "video" as const, src: "asset:2.mp4" }, b3: { kind: "image" as const, src: "asset:3.png" } } };
      const media = compileFootage(four, transcript, faceTrackFixture(), art, style).timeline.cutaways!.map((c) => c.media);
      expect(media.map((m) => (m.kind === "image" ? m.drift : m.kind))).toEqual([{ x: 0.03, y: 0 }, "video", { x: 0, y: -0.03 }]);
    });
  ```
  (b2's asset is a video, so the plan's still source doesn't matter: the media kind comes from the asset.)

- [ ] **Step 2: Write the failing video tests.** In `packages/video/src/footage/motion.test.ts`:
  - Replace `kenBurnsScale` in the import with `cutawayMotion, kenBurnsTransform, parallaxFill`.
  - Add `import { houseStyle } from "../house-style";`.
  - Replace the test `"zooms stills +6 % across the cutaway"` with:
    ```ts
      it("zooms stills to 1.12 while drifting, easing out, and never shows an edge", () => {
        expect(kenBurnsTransform(0, 45, 1.12, { x: 0.03, y: 0 })).toBe("scale(1.0000) translate(0.000%, 0.000%)");
        expect(kenBurnsTransform(44, 45, 1.12, { x: 0.03, y: 0 })).toBe("scale(1.1200) translate(3.000%, 0.000%)");
        for (const to of [1.06, 1.12, 1.3])
          for (const dx of [-0.1, -0.03, 0, 0.03, 0.1])
            for (let f = 0; f < 45; f++) {
              const m = kenBurnsTransform(f, 45, to, { x: dx, y: -dx }).match(/^scale\(([\d.]+)\) translate\((-?[\d.]+)%, (-?[\d.]+)%\)$/);
              expect(m).not.toBeNull();
              const [s, tx, ty] = m!.slice(1).map(Number);
              const limit = ((1 - 1 / s) / 2) * 100 + 0.005;
              expect(Math.abs(tx)).toBeLessThanOrEqual(limit);
              expect(Math.abs(ty)).toBeLessThanOrEqual(limit);
            }
      });
      it("drifts the blurred fill half as far the other way (parallax)", () => {
        expect(parallaxFill(44, 45, 1.15, { x: 0.03, y: 0 })).toBe("scale(1.15) translate(-1.500%, 0.000%)");
      });
    ```
  - Add:
    ```ts
    describe("cutaway entries and exits", () => {
      const m = houseStyle.cutaway.transition;
      const t = (kind: "whip" | "zoom" | "slide") => ({ in: kind, out: kind });
      const STILL = { x: 0, y: 0, scale: 1, blurPx: 0, opacity: 1 };
      it("does nothing for hard cuts, for no transition, and between the entry and the exit", () => {
        expect(cutawayMotion({ in: "cut", out: "cut" }, 0, 45, "ltr", m)).toEqual(STILL);
        expect(cutawayMotion({ in: "cut", out: "cut" }, 44, 45, "ltr", m)).toEqual(STILL);
        expect(cutawayMotion(undefined, 0, 45, "ltr", m)).toEqual(STILL);
        expect(cutawayMotion(t("whip"), 20, 45, "ltr", m)).toEqual(STILL);
      });
      it("whips in from the reading side and out the other way, settled by the 6th frame", () => {
        expect(cutawayMotion(t("whip"), 0, 45, "ltr", m).x).toBeGreaterThan(40);
        expect(cutawayMotion(t("whip"), 0, 45, "rtl", m).x).toBeLessThan(-40);
        expect(cutawayMotion(t("whip"), 5, 45, "ltr", m)).toMatchObject({ x: 0, blurPx: 0 });
        expect(cutawayMotion(t("whip"), 44, 45, "ltr", m).x).toBeCloseTo(-100);
        expect(cutawayMotion(t("whip"), 44, 45, "rtl", m).x).toBeCloseTo(100);
      });
      it("zooms in from 1.25 with blur and a fade, zooms out to 1.15 and fades, and slides split cutaways from the top", () => {
        const z0 = cutawayMotion(t("zoom"), 0, 45, "ltr", m);
        expect(z0.scale).toBeGreaterThan(1.1);
        expect(z0.opacity).toBeLessThan(0.5);
        expect(z0.blurPx).toBeGreaterThan(5);
        const z44 = cutawayMotion(t("zoom"), 44, 45, "ltr", m);
        expect(z44.opacity).toBe(0);
        expect(z44.scale).toBeCloseTo(1.15, 6);
        expect(cutawayMotion(t("slide"), 0, 45, "ltr", m).y).toBeLessThan(-40);
        expect(cutawayMotion(t("slide"), 44, 45, "ltr", m).y).toBeCloseTo(-100);
      });
    });
    ```

- [ ] **Step 3: Run the tests to verify they fail.** Run `npx vitest run packages/core/src/footage packages/video/src/footage/motion.test.ts`.

  Expected: FAIL (missing exports, no `transition` or `drift` on the layers, `kenBurns` still 1.06).

- [ ] **Step 4: Extend the edit style.** In `packages/core/src/footage/style.ts` replace the `cutaways` entry with:
```ts
  /** Spec §5.4–5.5. contentFitRatio: an upload whose aspect differs from its slot by more than this is shown whole on a blurred fill. */
  cutaways: z.object({
    minMs: z.number().positive(),
    minSpeakerShare: z.number().min(0).max(1),
    brollBreakMs: z.number().positive(),
    kenBurns: z.number().min(1).max(1.5),
    /** Stills also drift this far (% of the frame) while they zoom; the direction changes per still. */
    driftPct: z.number().min(0).max(10),
    contentFitRatio: z.number().min(1),
    /** Full cutaways cycle these entries (split ones slide in from the top). */
    transitions: z.array(z.enum(["whip", "zoom"])).min(1),
    /** A cutaway followed by another within this many frames leaves with a cut, so the speaker never flickers between them. */
    backToBackFrames: z.number().int().nonnegative(),
    /** Whoosh level for cutaway entries (quieter than the hook's: about one every 3 s). */
    whooshDb: z.number(),
  }),
```
In `packages/core/src/testing/fixtures.ts` (`testEditStyle`) and in `packages/video/src/house-style.ts` (`edit`), replace the `cutaways` value with:
```ts
  cutaways: { minMs: 1000, minSpeakerShare: 0.4, brollBreakMs: 1000, kenBurns: 1.12, driftPct: 3, contentFitRatio: 1.3, transitions: ["whip", "zoom"], backToBackFrames: 6, whooshDb: -14 },
```
(In `house-style.ts`, update the comment above it to `// spec §5.5: ≥ 40 % shows the speaker; §5.7: B-roll break 1 s; look pass: stills +12 % with a 3 % drift, whip/zoom entries, quieter whooshes`.)

- [ ] **Step 5: Extend the timeline.** In `packages/core/src/schema/timeline.ts`, above `CutawayFitSchema`, add:
```ts
/** How a cutaway enters and leaves (look pass): whip pan, zoom blur, slide (split cutaways) or a hard cut. */
export const CutawayTransitionSchema = z.enum(["cut", "whip", "zoom", "slide"]);
export type CutawayTransition = z.infer<typeof CutawayTransitionSchema>;
```
In `TimelineCutawaySchema`:
- Add `transition: z.object({ in: CutawayTransitionSchema, out: CutawayTransitionSchema }).optional(),` after `layout`.
- Change the image media to:
  ```ts
      z.object({
        kind: z.literal("image"), src: z.string().min(1), fit: CutawayFitSchema, kenBurns: z.number().min(1).max(1.5),
        drift: z.object({ x: z.number().min(-0.1).max(0.1), y: z.number().min(-0.1).max(0.1) }).optional(),
      }),
  ```

- [ ] **Step 6: Choose transitions in core.** In `packages/core/src/footage/cutaways.ts`:
  - Change the timeline import to `import type { CutawayTransition, Word } from "../schema/timeline";`.
  - Add:
    ```ts
    /**
     * Look pass (spec §5.4): full cutaways cycle style.cutaways.transitions, split ones slide, the B-roll opening cuts in at
     * frame 0, and a cutaway followed by another within backToBackFrames leaves with a cut. Entries and exits play inside
     * the cutaway's own frames, so no timing changes.
     */
    export function cutawayTransitions(shown: Pick<PlacedCutaway, "layout" | "fromFrame" | "durationInFrames" | "pulled">[], style: EditStyle): { in: CutawayTransition; out: CutawayTransition }[] {
      const kinds = style.cutaways.transitions;
      let full = 0;
      return shown.map((c, i) => {
        const kind: CutawayTransition = c.layout === "split" ? "slide" : kinds[full++ % kinds.length];
        const next = shown[i + 1];
        const backToBack = !!next && next.fromFrame - (c.fromFrame + c.durationInFrames) <= style.cutaways.backToBackFrames;
        return { in: c.pulled ? "cut" : kind, out: backToBack ? "cut" : kind };
      });
    }
    ```

- [ ] **Step 7: Emit transitions, drift and whooshes in `compileFootage`.** In `packages/core/src/footage/compile.ts`:
  - Import `cutawayTransitions` from `./cutaways`.
  - Add below the `splitWords` helper:
    ```ts
    /** Still drift directions, cycled per still: right, up, left, down. */
    const DRIFTS: [number, number][] = [[1, 0], [0, -1], [-1, 0], [0, 1]];
    ```
  - Replace the `const cutaways: TimelineCutaway[] = shown.map(…)` statement with:
    ```ts
      const transitions = cutawayTransitions(shown, style);
      let still = 0;
      const drift = (v: number) => (v === 0 ? 0 : r4((v * style.cutaways.driftPct) / 100));
      const cutaways: TimelineCutaway[] = shown.map((c, i) => {
        const media = cutawayMedia(c, plan, assets, style);
        const d = media.kind === "image" ? DRIFTS[still++ % DRIFTS.length] : null;
        return {
          id: c.beatId, fromFrame: c.fromFrame, durationInFrames: c.durationInFrames, layout: c.layout, transition: transitions[i],
          media: d && media.kind === "image" ? { ...media, drift: { x: drift(d[0]), y: drift(d[1]) } } : media,
        };
      });
    ```
  - Replace the cutaway whoosh loop (`for (const c of shown) { if (c.layout !== "full" || …) continue; cues.push({ name: "whoosh2", … }); }`) with:
    ```ts
        // Look pass: a whoosh on every cutaway that enters with a transition (the B-roll opening shares the hook's).
        shown.forEach((c, i) => {
          if (transitions[i].in === "cut" || cues.some((q) => q.name.startsWith("whoosh") && Math.abs(q.frame - c.fromFrame) <= 6)) return;
          cues.push({ name: i % 2 === 0 ? "whoosh2" : "whoosh1", frame: c.fromFrame, volumeDb: style.cutaways.whooshDb });
        });
    ```

- [ ] **Step 8: Add the video motion helpers.** In `packages/video/src/house-style.ts`, change the `cutaway` entry to:
```ts
  /** Uploads that don't fit their slot: shown whole over a blurred, dimmed, zoomed copy. Look pass: entries 6 frames, exits 5, inside the cutaway. */
  cutaway: { blurPx: 40, dim: 0.35, fillScale: 1.15, transition: { inFrames: 6, outFrames: 5, whipBlurPx: 22, zoomFrom: 1.25, zoomTo: 1.15, zoomBlurPx: 18 } },
```
In `packages/video/src/footage/motion.ts`:
- Change the type import to `import type { CutawayTransition, Timeline, TimelineClip, TimelineCrop } from "@reel/core";`.
- Replace `kenBurnsScale` with:
  ```ts
  const easeInCubic = (p: number) => p * p * p;
  const easeOutSine = (p: number) => Math.sin((p * Math.PI) / 2);

  /**
   * Still cutaways (look pass): zoom 1 → `to` and drift by `drift` (fractions of the frame), easing out so the motion reads
   * even on a 1 s still. The translate (applied before the scale) is clamped to (1 − 1/s)/2, so no frame edge ever shows.
   */
  export function kenBurnsTransform(frame: number, frames: number, to: number, drift: { x: number; y: number } = { x: 0, y: 0 }): string {
    const p = easeOutSine(clamp01(frame / Math.max(1, frames - 1)));
    const s = 1 + (to - 1) * p;
    const limit = (1 - 1 / s) / 2;
    const t = (d: number) => Math.max(-limit, Math.min(limit, d * p)) * 100;
    return `scale(${s.toFixed(4)}) translate(${t(drift.x).toFixed(3)}%, ${t(drift.y).toFixed(3)}%)`;
  }

  /** The blurred fill behind a misfit upload drifts half as far the other way (parallax). */
  export function parallaxFill(frame: number, frames: number, scale: number, drift: { x: number; y: number }): string {
    const p = easeOutSine(clamp01(frame / Math.max(1, frames - 1)));
    return `scale(${scale}) translate(${(-drift.x * 50 * p).toFixed(3)}%, ${(-drift.y * 50 * p).toFixed(3)}%)`;
  }

  export type SlotMotion = { x: number; y: number; scale: number; blurPx: number; opacity: number };
  export type SlotTransitionStyle = { inFrames: number; outFrames: number; whipBlurPx: number; zoomFrom: number; zoomTo: number; zoomBlurPx: number };
  const STILL: SlotMotion = { x: 0, y: 0, scale: 1, blurPx: 0, opacity: 1 };

  function phase(kind: Exclude<CutawayTransition, "cut">, amount: number, fwd: number, m: SlotTransitionStyle, entering: boolean): SlotMotion {
    switch (kind) {
      case "whip":
        return { x: (entering ? fwd : -fwd) * 100 * amount, y: 0, scale: 1, blurPx: m.whipBlurPx * amount, opacity: 1 };
      case "zoom":
        return { x: 0, y: 0, scale: 1 + ((entering ? m.zoomFrom : m.zoomTo) - 1) * amount, blurPx: m.zoomBlurPx * amount, opacity: 1 - amount };
      case "slide":
        return { x: 0, y: -100 * amount, scale: 1, blurPx: 0, opacity: 1 };
    }
  }

  /**
   * A cutaway's entry and exit, inside its own frames (the speaker underneath shows as it leaves). x and y are % of the slot.
   * Whips move forward in reading order: LTR content enters from the right and leaves to the left; RTL mirrors it.
   */
  export function cutawayMotion(t: { in: CutawayTransition; out: CutawayTransition } | undefined, frame: number, durationInFrames: number, direction: Timeline["direction"], m: SlotTransitionStyle): SlotMotion {
    if (!t) return STILL;
    const fwd = direction === "ltr" ? 1 : -1;
    if (t.in !== "cut" && frame < m.inFrames) return phase(t.in, 1 - easeOutCubic(clamp01((frame + 1) / m.inFrames)), fwd, m, true);
    const outStart = durationInFrames - m.outFrames;
    if (t.out !== "cut" && frame >= outStart) return phase(t.out, easeInCubic(clamp01((frame - outStart + 1) / m.outFrames)), fwd, m, false);
    return STILL;
  }
  ```

- [ ] **Step 9: Animate the cutaway layer.** Replace `packages/video/src/footage/Cutaways.tsx` with:
```tsx
import type { Timeline, TimelineCutaway } from "@reel/core";
import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import { houseStyle } from "../house-style";
import { DiagramCard } from "./DiagramCard";
import { cutawayMotion, kenBurnsTransform, parallaxFill } from "./motion";

const k = houseStyle.cutaway;
type Media = Exclude<TimelineCutaway["media"], { kind: "diagram" }>;
const NO_DRIFT = { x: 0, y: 0 };

const MediaEl: React.FC<{ media: Media; fit: "cover" | "contain" }> = ({ media, fit }) => {
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: fit };
  return media.kind === "image" ? <Img src={media.src} style={style} /> : <OffthreadVideo src={media.src} muted style={style} />;
};

/** Stills zoom and drift (Ken Burns); misfit uploads show whole over a blurred fill that drifts the other way (parallax). */
const MediaSlot: React.FC<{ media: Media; durationInFrames: number }> = ({ media, durationInFrames }) => {
  const frame = useCurrentFrame();
  const drift = media.kind === "image" ? (media.drift ?? NO_DRIFT) : NO_DRIFT;
  const zoom = media.kind === "image" ? kenBurnsTransform(frame, durationInFrames, media.kenBurns, drift) : undefined;
  if (media.fit === "cover") {
    return <AbsoluteFill style={{ transform: zoom }}><MediaEl media={media} fit="cover" /></AbsoluteFill>;
  }
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: parallaxFill(frame, durationInFrames, k.fillScale, drift), filter: `blur(${k.blurPx}px) brightness(${1 - k.dim})` }}><MediaEl media={media} fit="cover" /></AbsoluteFill>
      <AbsoluteFill style={{ transform: zoom }}><MediaEl media={media} fit="contain" /></AbsoluteFill>
    </AbsoluteFill>
  );
};

/** One cutaway: full screen or the top half (seam at y = 0.50), entering and leaving with its transition (spec §5.4). */
const Slot: React.FC<{ cutaway: TimelineCutaway; direction: Timeline["direction"] }> = ({ cutaway, direction }) => {
  const frame = useCurrentFrame();
  const split = cutaway.layout === "split";
  const m = cutawayMotion(cutaway.transition, frame, cutaway.durationInFrames, direction, k.transition);
  return (
    <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: split ? "50%" : "100%", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute", inset: 0, backgroundColor: "#000000", opacity: m.opacity,
          transform: `translate(${m.x.toFixed(3)}%, ${m.y.toFixed(3)}%) scale(${m.scale.toFixed(4)})`,
          ...(m.blurPx > 0 ? { filter: `blur(${m.blurPx.toFixed(2)}px)` } : {}),
        }}
      >
        {cutaway.media.kind === "diagram"
          ? <DiagramCard diagram={cutaway.media} direction={direction} compact={split} />
          : <MediaSlot media={cutaway.media} durationInFrames={cutaway.durationInFrames} />}
      </div>
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

- [ ] **Step 10: Run the tests.** Run `npx vitest run packages && npm run typecheck`.

  Expected: PASS. The engine render tests still produce a reel (the fake planner's split diagram now slides in, with a whoosh).

- [ ] **Step 11: Commit.**
```bash
git add packages/core/src/footage/style.ts packages/core/src/schema/timeline.ts packages/core/src/footage/cutaways.ts packages/core/src/footage/cutaways.test.ts packages/core/src/footage/compile.ts packages/core/src/footage/compile.test.ts packages/core/src/testing/fixtures.ts packages/video/src/house-style.ts packages/video/src/footage/motion.ts packages/video/src/footage/motion.test.ts packages/video/src/footage/Cutaways.tsx
git commit -m "feat(footage): whip, zoom and slide transitions into and out of cutaways with whooshes; Ken Burns drift and parallax on stills

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: iOS diagram cards that fill their slot

**Files:**
- Modify: `packages/video/src/house-style.ts` (`diagram`), `packages/video/src/footage/motion.ts`, `packages/video/src/footage/icons.tsx`, `packages/video/src/footage/DiagramCard.tsx`
- Test: `packages/video/src/footage/motion.test.ts`, `packages/engine/src/footage-render.test.ts`

**Interfaces:**
- Consumes: `IOS` (Task 2); the `DiagramCard` props, unchanged: `{ diagram, direction, compact }`.
- Produces:
  - `springValue(frame, { stiffness, damping }, fps = 30): number` (0 at frame ≤ 0, settles to 1).
  - `diagramFontScale(items: string[]): number`.
  - `drawProgress(frame, frames): number`.
  - `CheckDraw` icon (`{ size, color, progress }`).
  - `houseStyle.diagram` (new keys, listed in Step 4).

- [ ] **Step 1: Write the failing motion tests.** In `packages/video/src/footage/motion.test.ts` add `springValue, diagramFontScale, drawProgress` to the import and add:
```ts
describe("diagram motion", () => {
  const spring = { stiffness: 170, damping: 15 };
  it("springs 0 → 1 with a small overshoot and settles within 2 s", () => {
    expect(springValue(0, spring)).toBe(0);
    expect(springValue(-3, spring)).toBe(0);
    const values = Array.from({ length: 40 }, (_, f) => springValue(f + 1, spring));
    expect(Math.max(...values)).toBeGreaterThan(1.05);
    expect(Math.max(...values)).toBeLessThan(1.2);
    expect(springValue(60, spring)).toBeCloseTo(1, 2);
  });
  it("shrinks long items so 40-character Hebrew steps fit", () => {
    expect(diagramFontScale(["בחינם", "בלי חיבור"])).toBe(1);
    expect(diagramFontScale(["a".repeat(25)])).toBe(0.82);
    expect(diagramFontScale(["a".repeat(40)])).toBe(0.68);
  });
  it("draws lines 0 → 1 over the given frames", () => {
    expect(drawProgress(-2, 10)).toBe(0);
    expect(drawProgress(10, 10)).toBe(1);
    expect(drawProgress(5, 10)).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Write the failing render check.** In `packages/engine/src/footage-render.test.ts` change the sample import to `import { sampleCutawayTimeline, sampleFootageTimeline } from "@reel/video/sample-footage";` and add:
```ts
describe("diagram cards (iOS card fills its slot)", () => {
  it("renders light full and split cards with no large dark area", async () => {
    const dir = await mkdtemp(join(tmpdir(), "diagram-"));
    const full = join(dir, "list.png");
    await renderReelStill(sampleCutawayTimeline("he"), full, 130);
    expect(await averageLuma(full)).toBeGreaterThan(170);
    const split = join(dir, "flow.png");
    await renderReelStill(sampleCutawayTimeline("he"), split, 40);
    const top = join(dir, "flow-top.png");
    // The top 45 % (above the pill on the seam) is the split card.
    await runFfmpeg(["-i", split, "-vf", "crop=iw:ih*0.45:0:0", top]);
    expect(await averageLuma(top)).toBeGreaterThan(170);
  }, 300_000);
});
```

- [ ] **Step 3: Run the tests to verify they fail.** Run `npx vitest run packages/video/src/footage/motion.test.ts packages/engine/src/footage-render.test.ts`.

  Expected: FAIL. The helpers are missing, and the luma is about 20 on today's near-black cards.

- [ ] **Step 4: Restyle `houseStyle.diagram`.** In `packages/video/src/house-style.ts` replace the `diagram` entry with:
```ts
  /** Spec §6 DiagramCard, iOS look: a white rounded card on the grouped background, filling its slot; red accents. */
  diagram: {
    backdrop: IOS.groupedBg, card: IOS.white, tile: IOS.groupedBg, ink: IOS.ink, accent: IOS.red, onAccent: IOS.white, separator: IOS.separator,
    radius: 56, inset: 44, compactInset: 28, padding: 56, compactPadding: 32, shadow: "0 24px 60px rgba(0,0,0,0.16)",
    fontSize: 68, fontWeight: 700, compactScale: 0.7, iconSize: 92,
    // Items spring in one after another; checkmarks and flow lines draw themselves.
    itemFrames: 7, spring: { stiffness: 170, damping: 15 }, drawFrames: 10, riseFrom: 48,
  },
```

- [ ] **Step 5: Add the motion helpers.** Append to `packages/video/src/footage/motion.ts`:
```ts
/**
 * A damped spring from 0 to 1 (mass 1, Remotion-style stiffness and damping, at `fps`). 170/15 overshoots by ≈ 11 % and
 * settles by ≈ 0.6 s. Pure, so components and tests share it.
 */
export function springValue(frame: number, cfg: { stiffness: number; damping: number }, fps = 30): number {
  if (frame <= 0) return 0;
  const w0 = Math.sqrt(cfg.stiffness);
  const zeta = cfg.damping / (2 * w0);
  const t = frame / fps;
  if (zeta >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
}

/** Diagram text size multiplier: long items (Hebrew steps run up to 40 characters) shrink so they fit in about 2 lines. */
export function diagramFontScale(items: string[]): number {
  const longest = Math.max(0, ...items.map((s) => s.length));
  return longest > 30 ? 0.68 : longest > 20 ? 0.82 : 1;
}

/** 0 → 1 over `frames`, eased: a line drawing itself (checkmarks, flow connectors). */
export const drawProgress = (frame: number, frames: number) => easeOutCubic(clamp01(frame / frames));
```

- [ ] **Step 6: Replace the icons.** Replace `packages/video/src/footage/icons.tsx` with:
```tsx
import React from "react";

/** Lucide icon paths (ISC licence, https://lucide.dev), inlined so @reel/video needs no icon package. */
type IconProps = { size: number; color: string };
const Svg: React.FC<IconProps & { strokeWidth?: number; children: React.ReactNode }> = ({ size, color, strokeWidth = 2, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

/** Lucide "check", drawn left to right up to `progress` (0–1): pathLength 1 makes the dash offset the share drawn. */
export const CheckDraw: React.FC<IconProps & { progress: number }> = ({ progress, ...p }) => (
  <Svg {...p} strokeWidth={3}>
    <path d="M4 12l5 5L20 6" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - Math.max(0, Math.min(1, progress))} />
  </Svg>
);
```

- [ ] **Step 7: Rewrite `DiagramCard`.** Replace `packages/video/src/footage/DiagramCard.tsx` with:
```tsx
import type { Timeline, TimelineCutaway } from "@reel/core";
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { CheckDraw } from "./icons";
import { diagramFontScale, drawProgress, springValue } from "./motion";

const d = houseStyle.diagram;
type Diagram = Extract<TimelineCutaway["media"], { kind: "diagram" }>;

/**
 * Spec §6 DiagramCard, iOS look: a white card filling its slot. list = rows with a red check circle that draws itself;
 * compare = two tiles and a red VS badge; flow = numbered red circles joined by a line that draws downward. Rows and
 * tiles flex to fill the card, and items spring in one after another.
 */
export const DiagramCard: React.FC<{ diagram: Diagram; direction: Timeline["direction"]; compact: boolean }> = ({ diagram, direction, compact }) => {
  const frame = useCurrentFrame();
  const k = compact ? d.compactScale : 1;
  const font = d.fontSize * k * diagramFontScale(diagram.items);
  const icon = d.iconSize * k;
  const at = (i: number) => frame - i * d.itemFrames;
  const enter = (i: number): React.CSSProperties => {
    const s = springValue(at(i), d.spring);
    return { opacity: Math.min(1, Math.max(0, s * 1.5)), transform: `translateY(${((1 - s) * d.riseFrom * k).toFixed(2)}px) scale(${(0.92 + 0.08 * s).toFixed(4)})` };
  };
  const text: React.CSSProperties = { color: d.ink, fontFamily: HEEBO, fontWeight: d.fontWeight, fontSize: font, lineHeight: 1.2, unicodeBidi: "isolate", overflowWrap: "anywhere" };
  const circle = (children: React.ReactNode, extra: React.CSSProperties = {}) => (
    <div style={{ width: icon, height: icon, borderRadius: icon / 2, background: d.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, ...extra }}>{children}</div>
  );
  const badgeText: React.CSSProperties = { ...text, color: d.onAccent, fontWeight: 800 };

  let body: React.ReactNode;
  if (diagram.template === "list") {
    body = diagram.items.map((t, i) => (
      <React.Fragment key={i}>
        {i > 0 ? <div style={{ ...enter(i), height: 2, background: d.separator, marginInlineStart: icon + 32 * k }} /> : null}
        <div style={{ ...enter(i), flex: 1, display: "flex", alignItems: "center", gap: 32 * k }}>
          {circle(<CheckDraw size={icon * 0.62} color={d.onAccent} progress={drawProgress(at(i) - 4, d.drawFrames)} />)}
          <span style={text}>{t}</span>
        </div>
      </React.Fragment>
    ));
  } else if (diagram.template === "compare") {
    const vs = springValue(at(2), d.spring);
    const tile = (t: string, i: number) => (
      <div key={i} style={{ ...enter(i), flex: 1, background: d.tile, borderRadius: d.radius * 0.7 * k, display: "flex", alignItems: "center", justifyContent: "center", padding: 28 * k, textAlign: "center" }}>
        <span style={text}>{t}</span>
      </div>
    );
    body = (
      <div style={{ flex: 1, display: "flex", alignItems: "stretch", gap: 24 * k, position: "relative" }}>
        {tile(diagram.items[0], 0)}
        {tile(diagram.items[1], 1)}
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: `translate(-50%, -50%) scale(${vs.toFixed(4)})` }}>
          {circle(<span style={{ ...badgeText, fontSize: icon * 0.36 }}>VS</span>, { boxShadow: `0 0 0 ${10 * k}px ${d.card}` })}
        </div>
      </div>
    );
  } else {
    body = diagram.items.map((t, i) => (
      <div key={i} style={{ flex: 1, display: "flex", alignItems: "stretch", gap: 32 * k }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: icon }}>
          <div style={enter(i)}>{circle(<span style={{ ...badgeText, fontSize: icon * 0.45 }}>{i + 1}</span>)}</div>
          {i < diagram.items.length - 1 ? (
            <div style={{ flex: 1, width: 6 * k, borderRadius: 3 * k, margin: `${8 * k}px 0`, background: d.accent, transformOrigin: "top", transform: `scaleY(${drawProgress(at(i) - 4, d.itemFrames).toFixed(4)})` }} />
          ) : null}
        </div>
        <div style={{ ...enter(i), flex: 1, display: "flex", alignItems: "flex-start", paddingTop: Math.max(0, (icon - font * 1.2) / 2) }}>
          <span style={text}>{t}</span>
        </div>
      </div>
    ));
  }

  const card = springValue(frame, d.spring);
  return (
    <AbsoluteFill style={{ backgroundColor: d.backdrop, padding: compact ? d.compactInset : d.inset }}>
      <div
        dir={direction}
        style={{
          flex: 1, display: "flex", flexDirection: "column", direction, background: d.card, borderRadius: d.radius * k, boxShadow: d.shadow,
          padding: compact ? d.compactPadding : d.padding, transform: `scale(${(0.94 + 0.06 * card).toFixed(4)})`,
        }}
      >
        {body}
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 8: Run the tests.** Run `npx vitest run packages/video packages/engine/src/footage-render.test.ts && npm run typecheck`.

  Expected: PASS. Open `work/stills/footage-diagram-{flow-split,compare,list}-{he,en}.png` and check:
  - The white card fills its half or the screen.
  - The rows, tiles or steps fill the card.
  - The red check circles, the VS badge and the numbered circles are red.
  - Hebrew rows run right to left.

- [ ] **Step 9: Commit.**
```bash
git add packages/video/src/house-style.ts packages/video/src/footage/motion.ts packages/video/src/footage/motion.test.ts packages/video/src/footage/icons.tsx packages/video/src/footage/DiagramCard.tsx packages/engine/src/footage-render.test.ts
git commit -m "feat(video): iOS diagram cards: white card filling its slot, staggered springs, drawn checkmarks and flow lines, red VS badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Callouts in core: field, budget, timing, face-aware position, timeline layer, progress bar flag

**Files:**
- Create: `packages/core/src/footage/callouts.ts`, `packages/core/src/footage/callouts.test.ts`
- Modify: `packages/core/src/schema/edit-plan.ts`, `packages/core/src/footage/style.ts`, `packages/core/src/footage/caption-place.ts`, `packages/core/src/schema/timeline.ts`, `packages/core/src/footage/compile.ts`, `packages/core/src/testing/fixtures.ts`, `packages/core/src/index.ts`, `packages/video/src/house-style.ts` (`edit.callouts`)
- Test: `packages/core/src/schema/edit-plan.test.ts`, `packages/core/src/footage/callouts.test.ts`, `packages/core/src/footage/caption-place.test.ts`, `packages/core/src/footage/compile.test.ts`

**Interfaces:**
- Consumes: `planShots`, `placeCutaways`, `ctaStartFrame`, `msToFrames`, `pickBreaks`, `plural`.
- Produces:
  - `CALLOUT_MAX_CHARS = 16`, `CalloutSchema` (`{ text }`: trimmed, 1–16 characters, ≤ 3 words), `type Callout`, and `Beat.callout?: Callout`.
  - `EditStyle.callouts: { durationMs; minMs; clearFrames; topSafePct; gapPct; heightPct; noFaceTopPct; sideWidthPct; sidePadPct }`.
  - In `footage/callouts.ts`:
    - `calloutBudget(targetSec): number`
    - `applyCalloutBudget(beats, max, targetSec): { beats; warnings }`
    - `type PlacedCallout = { beatId; text; fromFrame; durationInFrames }`
    - `placeCallouts(plan, shots, cutaways, style): { placed; warnings }`
    - `planCallouts(plan, words, style)`
    - `type CalloutSpot = { topPct; align: "center" | "left" | "right" }`
    - `calloutSpot(face: ScreenRect | null, p): CalloutSpot | null`
  - In `footage/caption-place.ts`: `type ScreenRect = { top; bottom; left; right }` and `screenFaceRect(face, crop): ScreenRect | null`.
  - Timeline:
    - `TimelineCalloutSchema` (`{ text, fromFrame, durationInFrames, topPct, align }`) and `type TimelineCallout`
    - `Timeline.callouts?: TimelineCallout[]`
    - `Timeline.progressBar?: boolean`
  - `CompiledFootage.notes: string[]` (callouts left out for lack of room beside the face).

- [ ] **Step 1: Write the failing schema tests.** In `packages/core/src/schema/edit-plan.test.ts` add:
```ts
describe("callouts (look pass)", () => {
  const withCallout = (text: string) => ({ ...validEditPlan(), beats: validEditPlan().beats.map((b) => (b.id === "b2" ? { ...b, callout: { text } } : b)) });
  it("accepts a number or 1–3 words, trimmed, in either language", () => {
    expect(parseEditPlan(withCallout(" 1/5 ")).beats[1].callout).toEqual({ text: "1/5" });
    expect(parseEditPlan(withCallout("חוסך שעות")).beats[1].callout).toEqual({ text: "חוסך שעות" });
    expect(parseEditPlan(validEditPlan()).beats[1].callout).toBeUndefined();
  });
  it("refuses 4 words, 17 characters or an empty callout with plain messages", () => {
    expect(() => parseEditPlan(withCallout("one two three four"))).toThrow("beats.1.callout.text: A callout is a number or 1–3 words.");
    expect(() => parseEditPlan(withCallout("a".repeat(17)))).toThrow("beats.1.callout.text: A callout is at most 16 characters.");
    expect(() => parseEditPlan(withCallout("  "))).toThrow(/beats\.1\.callout\.text/);
  });
});
```

- [ ] **Step 2: Write the failing callout tests.** Create `packages/core/src/footage/callouts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { testEditStyle } from "../testing/fixtures";
import { applyCalloutBudget, calloutBudget, calloutSpot } from "./callouts";

const p = testEditStyle().callouts;

describe("callout budget", () => {
  it("allows one callout per 5 s and removes the rest of the kept beats' callouts in beat order", () => {
    expect([15, 30, 90].map(calloutBudget)).toEqual([3, 6, 18]);
    const beats = ["b1", "b2", "b3", "b4", "b5"].map((id, i) => ({ id, keep: i !== 1, callout: { text: `${i + 1}/5` } }));
    const r = applyCalloutBudget(beats, 3, 15);
    expect(r.beats.map((b) => b.callout?.text)).toEqual(["1/5", "2/5", "3/5", "4/5", undefined]);
    expect(r.warnings).toEqual(["1 callout was removed (at most 3 for a 15 s reel)."]);
    expect(applyCalloutBudget(beats, 5, 30).warnings).toEqual([]);
  });
});

describe("calloutSpot", () => {
  it("centres the badge just above the face when there is room below the top safe area", () => {
    expect(calloutSpot({ top: 0.25, bottom: 0.46, left: 0.31, right: 0.69 }, p)).toEqual({ topPct: 19.5, align: "center" });
  });
  it("moves into the top band beside the face when the face reaches the top", () => {
    expect(calloutSpot({ top: 0.1, bottom: 0.4, left: 0.05, right: 0.35 }, p)).toEqual({ topPct: 12.5, align: "right" });
    expect(calloutSpot({ top: 0.1, bottom: 0.4, left: 0.65, right: 0.95 }, p)).toEqual({ topPct: 12.5, align: "left" });
  });
  it("gives up when the face fills the top of the frame, and centres at 20 % with no face", () => {
    expect(calloutSpot({ top: 0.05, bottom: 0.55, left: 0.08, right: 0.92 }, p)).toBeNull();
    expect(calloutSpot(null, p)).toEqual({ topPct: 20, align: "center" });
  });
});
```
In `packages/core/src/footage/caption-place.test.ts` add `screenFaceRect` to the import from `./caption-place` and add:
```ts
describe("screenFaceRect", () => {
  it("maps the face box through the crop's zoom range onto the screen", () => {
    const face = { x: 0.35, y: 0.2, w: 0.3, h: 0.17 };
    expect(screenFaceRect(face, { cx: 0.5, cy: 0.4, scaleFrom: 1.25, scaleTo: 1.25 })).toEqual({ top: 0.25, bottom: 0.4625, left: 0.3125, right: 0.6875 });
    expect(screenFaceRect(null, { cx: 0.5, cy: 0.5, scaleFrom: 1, scaleTo: 1 })).toBeNull();
  });
});
```

- [ ] **Step 3: Write the failing compile tests.** In `packages/core/src/footage/compile.test.ts` add `import { planCallouts } from "./callouts";` and append:
```ts
describe("callouts", () => {
  const withCallouts = (texts: Record<string, string>, over: Partial<EditPlan> = {}) =>
    plan({ beats: validEditPlan().beats.map((b) => (texts[b.id] ? { ...b, callout: { text: texts[b.id] } } : b)) as EditPlan["beats"], ...over });

  it("places each callout in its beat's first free stretch, centred above the face, with a pop", () => {
    const { timeline, notes } = compile(withCallouts({ b1: "1/5", b2: "חוסך שעות" }));
    expect(timeline.callouts).toEqual([
      { text: "1/5", fromFrame: 60, durationInFrames: 29, topPct: 17.5, align: "center" }, // after the headline (0–60), until b1 ends at 89
      { text: "חוסך שעות", fromFrame: 89, durationInFrames: 48, topPct: 19.5, align: "center" },
    ]);
    expect(notes).toEqual([]);
    expect(timeline.sfx?.map((c) => `${c.name}@${c.frame}`)).toEqual(["whoosh1@0", "pop1@12", "pop2@18", "pop1@60", "pop2@89", "pop1@143"]);
  });

  it("drops a callout whose beat has no free stretch, and the review page sees the same warning", () => {
    const p = withCallouts({ b3: "AI" }); // b3 (146–218) runs under the CTA card (143–218)
    expect(compile(p).timeline.callouts).toBeUndefined();
    expect(planCallouts(p, transcript.words, style).warnings).toEqual(["The callout in b3 was dropped: the hook headline, a cutaway or the CTA card covers its beat."]);
  });

  it("waits for a cutaway's exit and never shares a moment with it", () => {
    const cut = { source: { kind: "ai_broll", prompt: "laptop", media: "image" }, layout: "full", atMs: 0, durationMs: 1000 };
    const p = plan({ hook: { patternBreak: "none", reason: "" }, beats: validEditPlan().beats.map((b) => (b.id === "b1" ? { ...b, cutaway: cut, callout: { text: "3x" } } : b)) as EditPlan["beats"] });
    // The cutaway covers 0–30, plus 6 frames for its exit.
    expect(planCallouts(p, transcript.words, style).placed).toEqual([{ beatId: "b1", text: "3x", fromFrame: 36, durationInFrames: 48 }]);
    expect(compileFootage(p, transcript, faceTrackFixture(), assets, style).timeline.callouts![0].fromFrame).toBe(36);
  });

  it("keeps pattern breaks off a callout", () => {
    const beats = longPlan().beats.map((b) => (b.id === "b3" ? { ...b, callout: { text: "3x" } } : b));
    const { timeline } = compileFootage(longPlan({ beats }), longTalk(), null, assets, style);
    expect(timeline.callouts).toEqual([{ text: "3x", fromFrame: 299, durationInFrames: 48, topPct: 20, align: "center" }]);
    expect(timeline.patternBreaks).toEqual([{ frame: 449, kind: "zoom_blur" }, { frame: 749, kind: "zoom_hit" }]);
  });

  it("leaves out a callout with no room beside a face that fills the top of the frame, with a note", () => {
    const big = { intervalMs: 100, samples: Array.from({ length: 91 }, (_, i) => ({ tMs: i * 100, box: { x: 0.1, y: 0.05, w: 0.8, h: 0.5 } })) };
    const { timeline, notes } = compileFootage(withCallouts({ b2: "3x" }), transcript, big, assets, style);
    expect(timeline.callouts).toBeUndefined();
    expect(notes).toEqual(["The callout in b2 was left out: there was no room for it without covering your face."]);
  });

  it("turns the progress bar on for footage reels", () => {
    expect(compile().timeline.progressBar).toBe(true);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail.** Run `npx vitest run packages/core`.

  Expected: FAIL. `./callouts` is missing, `callout` is stripped by the schema, and there is no `screenFaceRect`, `notes` or `progressBar`.

- [ ] **Step 5: Add the schema field.** In `packages/core/src/schema/edit-plan.ts`, above `BeatSchema`, add:
```ts
/** Look pass: a short sticker on a beat: a number like "1/5" or 1–3 words. */
export const CALLOUT_MAX_CHARS = 16;
export const CalloutSchema = z.object({
  text: z.string().trim()
    .min(1, "A callout needs text.")
    .max(CALLOUT_MAX_CHARS, `A callout is at most ${CALLOUT_MAX_CHARS} characters.`)
    .refine((t) => t.split(/\s+/).length <= 3, "A callout is a number or 1–3 words."),
});
export type Callout = z.infer<typeof CalloutSchema>;
```
and add `callout: CalloutSchema.optional(),` to `BeatSchema` after `cutaway`.

- [ ] **Step 6: Add the style block.** In `packages/core/src/footage/style.ts` add to `EditStyleSchema`, after `cutaways`:
```ts
  /** Look pass callouts: timing, and the badge box (in % of the frame) used to keep it off the face and the captions. */
  callouts: z.object({
    durationMs: z.number().positive(),
    minMs: z.number().positive(),
    /** Frames kept clear after a cutaway (its exit) and before a callout (no pattern break starts there). */
    clearFrames: z.number().int().nonnegative(),
    topSafePct: z.number().min(0).max(100),
    gapPct: z.number().min(0).max(100),
    heightPct: z.number().min(0).max(100),
    noFaceTopPct: z.number().min(0).max(100),
    sideWidthPct: z.number().min(0).max(100),
    sidePadPct: z.number().min(0).max(100),
  }),
```
Add the same values to `testEditStyle()` in `packages/core/src/testing/fixtures.ts` (after `cutaways`):
```ts
  callouts: { durationMs: 1600, minMs: 800, clearFrames: 6, topSafePct: 9, gapPct: 2, heightPct: 7, noFaceTopPct: 20, sideWidthPct: 48, sidePadPct: 4 },
```
and to `houseStyle.edit` in `packages/video/src/house-style.ts` (after `cutaways`), with the reasons:
```ts
    // 9 %: below Instagram's top bar (Reels title, camera). 7 %: a 52 px badge with padding and tilt ≈ 120 px.
    // 48 %: 16 characters at 52 px. Captions sit below the face, so a badge above or beside the face never meets them.
    callouts: { durationMs: 1600, minMs: 800, clearFrames: 6, topSafePct: 9, gapPct: 2, heightPct: 7, noFaceTopPct: 20, sideWidthPct: 48, sidePadPct: 4 },
```

- [ ] **Step 7: Add `screenFaceRect`.** In `packages/core/src/footage/caption-place.ts` add:
```ts
/** A box on screen, normalised (0–1, origin top-left). */
export type ScreenRect = { top: number; bottom: number; left: number; right: number };

/** The face's on-screen box over the crop's zoom range (same maths as screenChinY), for callout placement. */
export function screenFaceRect(face: FaceBox | null, crop: TimelineCrop): ScreenRect | null {
  if (!face) return null;
  const r = { top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity };
  for (const raw of [crop.scaleFrom, crop.scaleTo]) {
    const s = Math.max(1, raw);
    const half = 0.5 / s;
    const clamp = (v: number) => Math.min(1 - half, Math.max(half, v));
    const cx = clamp(crop.cx);
    const cy = clamp(crop.cy);
    r.top = Math.min(r.top, 0.5 + (face.y - cy) * s);
    r.bottom = Math.max(r.bottom, 0.5 + (face.y + face.h - cy) * s);
    r.left = Math.min(r.left, 0.5 + (face.x - cx) * s);
    r.right = Math.max(r.right, 0.5 + (face.x + face.w - cx) * s);
  }
  return { top: r4(r.top), bottom: r4(r.bottom), left: r4(r.left), right: r4(r.right) };
}
```

- [ ] **Step 8: Create `footage/callouts.ts`.**
```ts
import { plural } from "../plural";
import type { Callout, EditPlan } from "../schema/edit-plan";
import type { Word } from "../schema/timeline";
import type { ScreenRect } from "./caption-place";
import { placeCutaways } from "./cutaways";
import { ctaStartFrame, msToFrames, planShots, type PlannedShot } from "./shots";
import type { EditStyle } from "./style";

export type PlacedCallout = { beatId: string; text: string; fromFrame: number; durationInFrames: number };
export type CalloutPlacement = { placed: PlacedCallout[]; warnings: string[] };
export type CalloutSpot = { topPct: number; align: "center" | "left" | "right" };

const toHalf = (v: number) => Math.round(v * 2) / 2;

/** Spec §4.3 as amended: at most one callout per 5 s of target length. */
export const calloutBudget = (targetSec: number) => Math.floor(targetSec / 5);

/** Counts kept beats in beat order; callouts past max are removed with one warning. Dropped beats keep theirs (they never show). */
export function applyCalloutBudget<B extends { keep: boolean; callout?: Callout }>(beats: B[], max: number, targetSec: number): { beats: B[]; warnings: string[] } {
  let count = 0;
  let removed = 0;
  const out = beats.map((b) => {
    if (!b.callout || !b.keep || ++count <= max) return b;
    removed++;
    const { callout: _drop, ...rest } = b;
    return rest as B;
  });
  return { beats: out, warnings: removed ? [`${plural(removed, "callout was", "callouts were")} removed (at most ${max} for a ${targetSec} s reel).`] : [] };
}

/**
 * Callout timing from the plan alone, so the review page shows the same warnings as generation: the first free stretch
 * of the beat at least minMs long, used for at most durationMs. Not free: the hook headline, the CTA card, and every
 * placed cutaway plus clearFrames after it (its exit). A beat with no free stretch loses its callout, with a warning.
 */
export function placeCallouts(plan: Pick<EditPlan, "beats" | "hook" | "ending">, shots: PlannedShot[], cutaways: { fromFrame: number; durationInFrames: number }[], style: EditStyle): CalloutPlacement {
  const total = shots.reduce((n, s) => n + s.frames, 0);
  const blocked: [number, number][] = [
    ...(plan.hook.headline ? [[0, Math.min(total, msToFrames(style.headlineMs))] as [number, number]] : []),
    [ctaStartFrame(plan, total, style), total],
    ...cutaways.map((c): [number, number] => [c.fromFrame, c.fromFrame + c.durationInFrames + style.callouts.clearFrames]),
  ];
  const spans = new Map<string, [number, number]>();
  let at = 0;
  for (const s of shots) {
    const span = spans.get(s.beatId);
    spans.set(s.beatId, span ? [span[0], at + s.frames] : [at, at + s.frames]);
    at += s.frames;
  }
  const beats = new Map(plan.beats.map((b) => [b.id, b]));
  const minFrames = msToFrames(style.callouts.minMs);
  const maxFrames = msToFrames(style.callouts.durationMs);
  const placed: PlacedCallout[] = [];
  const warnings: string[] = [];
  for (const [id, span] of spans) {
    const callout = beats.get(id)?.callout;
    if (!callout) continue;
    let free: [number, number][] = [span];
    for (const [a, b] of blocked) {
      free = free.flatMap(([s, e]): [number, number][] => (b <= s || a >= e ? [[s, e]] : [...(a > s ? [[s, a] as [number, number]] : []), ...(b < e ? [[b, e] as [number, number]] : [])]));
    }
    const slot = free.find(([s, e]) => e - s >= minFrames);
    if (!slot) {
      warnings.push(`The callout in ${id} was dropped: the hook headline, a cutaway or the CTA card covers its beat.`);
      continue;
    }
    placed.push({ beatId: id, text: callout.text, fromFrame: slot[0], durationInFrames: Math.min(maxFrames, slot[1] - slot[0]) });
  }
  return { placed, warnings };
}

/** The placement compileFootage makes, for the review page and generation notes. */
export function planCallouts(plan: Pick<EditPlan, "beats" | "hook" | "ending" | "source">, words: Word[], style: EditStyle): CalloutPlacement {
  const shots = planShots(plan, words, style);
  return placeCallouts(plan, shots, placeCutaways(plan, shots, style).placed, style);
}

/**
 * Where the badge goes. Never over the face, and never near the captions, which sit below the face:
 * 1. Centred just above the face when its top edge stays below the top safe area.
 * 2. Otherwise in the top band, on the side with room beside the face.
 * 3. Otherwise nowhere (null).
 * No face: centred at noFaceTopPct.
 */
export function calloutSpot(face: ScreenRect | null, p: EditStyle["callouts"]): CalloutSpot | null {
  if (!face) return { topPct: p.noFaceTopPct, align: "center" };
  const h = p.heightPct / 100;
  const gap = p.gapPct / 100;
  const safe = p.topSafePct / 100;
  const above = face.top - gap - h / 2;
  if (above - h / 2 >= safe) return { topPct: toHalf(above * 100), align: "center" };
  const pad = p.sidePadPct / 100;
  const leftRoom = face.left - gap - pad;
  const rightRoom = 1 - pad - face.right - gap;
  if (Math.max(leftRoom, rightRoom) < p.sideWidthPct / 100) return null;
  return { topPct: toHalf((safe + h / 2) * 100), align: rightRoom >= leftRoom ? "right" : "left" };
}
```
Add `export * from "./footage/callouts";` to `packages/core/src/index.ts` after the `cutaways` export.

- [ ] **Step 9: Extend the timeline.** In `packages/core/src/schema/timeline.ts`, above `TimelineSchema`, add:
```ts
/** A keyword callout badge (look pass), placed by compileFootage above or beside the face. */
export const TimelineCalloutSchema = z.object({
  text: z.string().min(1),
  fromFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  topPct: z.number().min(0).max(100),
  align: z.enum(["center", "left", "right"]),
});
export type TimelineCallout = z.infer<typeof TimelineCalloutSchema>;
```
Add to `TimelineSchema`, after `cutaways`:
```ts
  callouts: z.array(TimelineCalloutSchema).optional(),
  /** Footage reels: a thin progress bar along the top edge. */
  progressBar: z.boolean().optional(),
```

- [ ] **Step 10: Wire callouts into `compileFootage`.** In `packages/core/src/footage/compile.ts`:
  - Imports: add `import { calloutSpot, placeCallouts } from "./callouts";` and change the caption-place import to `import { placeCaptionPages, screenChinY, screenFaceRect, type FaceSpan, type ScreenRect } from "./caption-place";`.
  - Change `CompiledFootage` to:
    ```ts
    /** notes: callouts left out because no spot avoided the face (generation adds them to its notes). */
    export type CompiledFootage = { timeline: Timeline; voiceSegments: VoiceSegment[]; durationMs: number; notes: string[] };
    ```
  - Right after `const ctaStart = ctaStartFrame(plan, total, style);`, add:
    ```ts
      // Callouts are timed from the plan alone (placed cutaways, headline, CTA); pattern breaks then keep off them.
      const calloutPlan = placeCallouts(plan, shots, placement.placed, style);
    ```
  - Change the `blocked` argument of `pickBreaks` to:
    ```ts
        [
          [ctaStart, total],
          ...shown.map((c): [number, number] => [c.fromFrame, c.fromFrame + c.durationInFrames]),
          ...calloutPlan.placed.map((c): [number, number] => [c.fromFrame - style.callouts.clearFrames, c.fromFrame + c.durationInFrames]),
        ],
    ```
  - After `const placedPages = …;`, add:
    ```ts
      const notes: string[] = [];
      const callouts = calloutPlan.placed.flatMap((c) => {
        const end = c.fromFrame + c.durationInFrames;
        const rects = finalClips
          .flatMap((clip, i) => (clip.fromFrame < end && clip.fromFrame + clip.durationInFrames > c.fromFrame ? [screenFaceRect(finalFaces[i], clip.crop!)] : []))
          .filter((r): r is ScreenRect => r !== null);
        const face = rects.length
          ? { top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)), left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) }
          : null;
        const spot = calloutSpot(face, style.callouts);
        if (!spot) {
          notes.push(`The callout in ${c.beatId} was left out: there was no room for it without covering your face.`);
          return [];
        }
        return [{ text: c.text, fromFrame: c.fromFrame, durationInFrames: c.durationInFrames, topPct: spot.topPct, align: spot.align }];
      });
    ```
  - In the sound-cue block, immediately before the CTA pop line (`if (ending.kind === "cta") cues.push(…)`), add:
    ```ts
        for (const c of callouts) {
          if (cues.some((q) => Math.abs(q.frame - c.fromFrame) <= 3)) continue;
          cues.push({ name: pops[pop++ % 2], frame: c.fromFrame, volumeDb: style.sfxVolumeDb.pop });
        }
    ```
  - In `TimelineSchema.parse({ … })`, after the `cutaways` spread, add:
    ```ts
        ...(callouts.length ? { callouts } : {}),
        progressBar: true,
    ```
  - Change the return to `return { timeline, voiceSegments, durationMs: framesToMs(total), notes };`.

- [ ] **Step 11: Run the tests.** Run `npx vitest run packages && npm run typecheck`.

  Expected: PASS. The `house-style.test` fixture match passes because Step 6 updated both.

- [ ] **Step 12: Commit.**
```bash
git add packages/core/src/schema/edit-plan.ts packages/core/src/schema/edit-plan.test.ts packages/core/src/footage/style.ts packages/core/src/footage/caption-place.ts packages/core/src/footage/caption-place.test.ts packages/core/src/footage/callouts.ts packages/core/src/footage/callouts.test.ts packages/core/src/schema/timeline.ts packages/core/src/footage/compile.ts packages/core/src/footage/compile.test.ts packages/core/src/testing/fixtures.ts packages/core/src/index.ts packages/video/src/house-style.ts
git commit -m "feat(core): keyword callouts (field, one per 5 s, timing clear of headline/cutaways/CTA, face-aware spot, pop) and the progress bar flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Planner writes callouts; generation notes for callouts

**Files:**
- Modify: `packages/core/src/schema/edit-plan.ts` (`EditPlanDraftSchema`), `packages/engine/src/footage-planner.ts`, `packages/engine/src/providers/fake.ts`, `packages/engine/src/footage-generate.ts`
- Test: `packages/core/src/schema/edit-plan.test.ts`, `packages/engine/src/footage-planner.test.ts`, `packages/engine/src/footage-generate.test.ts`

**Interfaces:**
- Consumes (Task 5): `CalloutSchema`, `CALLOUT_MAX_CHARS`, `calloutBudget`, `applyCalloutBudget`, `planCallouts`, and `CompiledFootage.notes`.
- Produces:
  - The draft beat gains `callout: string` (`""` for none).
  - The planner's plans carry `Beat.callout`.
  - `generateFootageAssets` notes include callout timing drops and callouts left out for lack of room beside the face.

- [ ] **Step 1: Write the failing tests.**
  - In `packages/core/src/schema/edit-plan.test.ts`, `describe("Claude's draft schema")`, add:
    ```ts
      it("offers a callout per beat", () => {
        expect(JSON.stringify(EditPlanDraftSchema.toJSONSchema())).toMatch(/"callout"/);
      });
    ```
  - In `packages/engine/src/footage-planner.test.ts`:
    - Change the beat in `draft()` to `({ id, keep: true, dropReason: "", emphasisWordIdx: id === "b1" ? 7 : -1, emoji: id === "b2" ? "👇" : "", cutaway: NO_CUTAWAY, callout: "" })`.
    - Add `footageSystemPrompt` to the import if Task 1 hasn't.
    - Add:
      ```ts
      describe("callouts from Claude's draft", () => {
        const beats = splitBeats(REQ.transcript.words);
        it("keeps valid callouts (trimmed), and removes one that is too long with a warning instead of a repair round", () => {
          const d = draft();
          d.beats = d.beats.map((b, i) => ({ ...b, callout: ["1/5", "this callout is far too long", " 3x "][i] }));
          const plan = buildEditPlan(d, REQ, beats, style);
          expect(plan.beats.map((b) => b.callout)).toEqual([{ text: "1/5" }, undefined, { text: "3x" }]);
          expect(plan.warnings).toEqual(['The callout in b2 ("this callout is far too long") was removed: a callout is a number or 1–3 words, at most 16 characters.']);
        });
        it("tells Claude the callout budget and what a callout is", () => {
          expect(footageUserPrompt(REQ, beats)).toContain("Callout budget: at most 3 callouts.");
          expect(footageSystemPrompt()).toContain('a number from the talk ("1/5", "3x", "90%") or 1–3 key words');
        });
      });
      ```
  - In `packages/engine/src/footage-generate.test.ts` add to the first `describe`:
    ```ts
      it("notes a callout that can't show (its beat runs under the CTA card)", async () => {
        const { plan: p, deps } = await prepared();
        const last = p.beats.filter((b) => b.keep).at(-1)!.id;
        const plan = parseEditPlan({ ...p, beats: p.beats.map((b) => (b.id === last ? { ...b, callout: { text: "AI" } } : b)) });
        const gen = await generateFootageAssets(plan, deps);
        expect(gen.notes).toContain(`The callout in ${last} was dropped: the hook headline, a cutaway or the CTA card covers its beat.`);
      }, 300_000);
    ```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run packages/core/src/schema packages/engine/src/footage-planner.test.ts packages/engine/src/footage-generate.test.ts`.

  Expected: FAIL. There is no draft `callout`, the planner drops callouts, and there are no notes.

- [ ] **Step 3: Add the draft field.** In `packages/core/src/schema/edit-plan.ts`, change the draft beat object in `EditPlanDraftSchema` to:
```ts
  beats: z.array(z.object({ id: z.string(), keep: z.boolean(), dropReason: z.string(), emphasisWordIdx: z.number(), emoji: z.string(), cutaway: DraftCutawaySchema, callout: z.string() })),
```
and add `callout: "" for none` to the draft schema's doc comment (after `-1 mean "none"`).

- [ ] **Step 4: Update the fake planner.** In `packages/engine/src/providers/fake.ts`, change the draft beats to `ids.map((id, i) => ({ id, keep: true, dropReason: "", emphasisWordIdx: -1, emoji: "", cutaway: cutawayFor(i), callout: "" }))`.

  The fake 6 s talk has no free moment for a callout: the headline, the diagram and the CTA cover it. Callouts are checked in the browser by adding one on the review page (see "After the tasks").

- [ ] **Step 5: Plan callouts.** In `packages/engine/src/footage-planner.ts`:
  - Add `CALLOUT_MAX_CHARS, CalloutSchema, applyCalloutBudget, calloutBudget` to the `@reel/core` import.
  - In `footageSystemPrompt()`, after the `emoji` line, add:
    ```ts
        '- callout: in a few beats, a short sticker that springs in above the speaker: a number from the talk ("1/5", "3x", "90%") or 1–3 key words (at most 16 characters), in the reel\'s language, where that number or phrase is said. Stay inside the callout budget; not on the first beat (the headline covers it) or the last (the CTA card covers it). Empty otherwise.',
    ```
  - In `footageUserPrompt`, after `cutawayBudgetLine(req),`, add:
    ```ts
        `Callout budget: at most ${plural(calloutBudget(req.settings.targetDurationSec), "callout", "callouts")}.`,
    ```
  - In `buildEditPlan`:
    - Add `const calloutWarnings: string[] = [];` before `const withCutaways`.
    - Inside its `beats.map`, after `const cutaway = …`, add:
      ```ts
          const text = d.callout.trim();
          const callout = text && CalloutSchema.safeParse({ text }).success ? { text } : undefined;
          if (text && !callout) calloutWarnings.push(`The callout in ${b.id} ("${text}") was removed: a callout is a number or 1–3 words, at most ${CALLOUT_MAX_CHARS} characters.`);
      ```
    - Add `...(callout ? { callout } : {}),` after `...(cutaway ? { cutaway } : {}),`.
    - After `const budgeted = applyCutawayBudget(…);`, add:
      ```ts
        const withCallouts = applyCalloutBudget(budgeted.beats, calloutBudget(req.settings.targetDurationSec), req.settings.targetDurationSec);
      ```
    - Change `brollLeft` to read `withCallouts.beats`, and in the plan object set `beats: withCallouts.beats,` and:
      ```ts
          warnings: [...req.warnings, ...budgeted.warnings, ...calloutWarnings, ...withCallouts.warnings, ...(brollLost ? ["The B-roll opening had no cutaway left, so it became a zoom hit."] : [])],
      ```

- [ ] **Step 6: Generation notes.** In `packages/engine/src/footage-generate.ts`:
  - Add `planCallouts` to the `@reel/core` import.
  - Change `notes.push(...placementNotes);` to:
    ```ts
      notes.push(...placementNotes, ...planCallouts(plan, inputs.transcript.words, deps.style).warnings);
    ```
  - After `notes.push(...cut.notes);`, add:
    ```ts
      // Callouts with no room beside the face: needs the face track and the cutaways that were actually made.
      const made = Object.fromEntries(Object.entries(cut.assets).map(([id, c]) => [id, { kind: c.kind, src: "draft" }]));
      notes.push(...compileFootage(plan, inputs.transcript, inputs.faceTrack, { videoSrc: "draft", sfx: {}, cutaways: made }, deps.style).notes);
    ```

- [ ] **Step 7: Run the tests.** Run `npx vitest run packages && npm run typecheck`.

  Expected: PASS.

- [ ] **Step 8: Commit.**
```bash
git add packages/core/src/schema/edit-plan.ts packages/core/src/schema/edit-plan.test.ts packages/engine/src/footage-planner.ts packages/engine/src/footage-planner.test.ts packages/engine/src/providers/fake.ts packages/engine/src/footage-generate.ts packages/engine/src/footage-generate.test.ts
git commit -m "feat(engine): Claude writes keyword callouts within one per 5 s; generation notes callouts that can't show

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Remotion: callout badges and the progress bar

**Files:**
- Create: `packages/video/src/footage/Callouts.tsx`, `packages/video/src/footage/ProgressBar.tsx`
- Modify: `packages/video/src/house-style.ts`, `packages/video/src/footage/motion.ts`, `packages/video/src/Reel.tsx`, `packages/video/src/sample-footage.ts` (`sampleFootageTimeline`)
- Test: `packages/video/src/footage/motion.test.ts`, `packages/video/src/footage-render.test.ts`

**Interfaces:**
- Consumes: `Timeline.callouts`, `Timeline.progressBar` (Task 5), `houseStyle.edit.callouts.sidePadPct` (Task 5), `springValue` (Task 4).
- Produces:
  - `houseStyle.callout` and `houseStyle.progress`.
  - `calloutScale(frame, durationInFrames, spring, outFrames): number`.
  - `progressShare(frame, total): number`.
  - The `Callouts` and `ProgressBar` components.

- [ ] **Step 1: Write the failing tests.** In `packages/video/src/footage/motion.test.ts` add `calloutScale, progressShare` to the import and add:
```ts
describe("callouts and the progress bar", () => {
  const spring = { stiffness: 220, damping: 14 };
  it("springs the badge in with an overshoot and shrinks it away over the last 5 frames", () => {
    expect(calloutScale(0, 48, spring, 5)).toBeGreaterThan(0);
    expect(calloutScale(0, 48, spring, 5)).toBeLessThan(0.5);
    expect(Math.max(...Array.from({ length: 20 }, (_, f) => calloutScale(f, 48, spring, 5)))).toBeGreaterThan(1.05);
    expect(calloutScale(30, 48, spring, 5)).toBeCloseTo(1, 2);
    expect(calloutScale(46, 48, spring, 5)).toBeLessThan(0.7);
    expect(calloutScale(47, 48, spring, 5)).toBe(0);
  });
  it("fills the progress bar frame by frame to 100 % on the last frame", () => {
    expect(progressShare(0, 300)).toBeCloseTo(1 / 300, 6);
    expect(progressShare(149, 300)).toBe(0.5);
    expect(progressShare(299, 300)).toBe(1);
  });
});
```
In `packages/video/src/footage-render.test.ts`, add `["callout-progress", 80]` to the first `it.each` list (the footage sample, Step 6, gains a callout over frames 62–101 and the progress bar).

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run packages/video/src/footage/motion.test.ts`.

  Expected: FAIL (`calloutScale` is not a function).

- [ ] **Step 3: Add the style and the helpers.** In `packages/video/src/house-style.ts` add after `cta`:
```ts
  /** Look pass callout: a white sticker badge with red text that springs in, tilted like a sticker. */
  callout: { fontSize: 52, fontWeight: 800, color: IOS.red, background: IOS.white, radius: 40, padX: 30, padY: 8, tiltDeg: -4, shadow: "0 10px 28px rgba(0,0,0,0.30)", spring: { stiffness: 220, damping: 14 }, outFrames: 5 },
  /** A thin progress bar along the top edge of footage reels. */
  progress: { heightPx: 8, color: IOS.red, track: "rgba(255,255,255,0.28)", radius: 4 },
```
Append to `packages/video/src/footage/motion.ts`:
```ts
/** Callout badge scale: springs in (≈ 19 % overshoot at 220/14), then shrinks to 0 over the last outFrames. */
export function calloutScale(frame: number, durationInFrames: number, spring: { stiffness: number; damping: number }, outFrames: number): number {
  const s = springValue(frame + 1, spring);
  const left = durationInFrames - frame;
  return left <= outFrames ? s * easeOutCubic(clamp01((left - 1) / outFrames)) : s;
}

/** Share of the reel shown once this frame is on screen (0–1). */
export const progressShare = (frame: number, total: number) => clamp01((frame + 1) / Math.max(1, total));
```

- [ ] **Step 4: Create the components.** `packages/video/src/footage/Callouts.tsx`:
```tsx
import type { Timeline, TimelineCallout } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { calloutScale } from "./motion";

const k = houseStyle.callout;
const pad = houseStyle.edit.callouts.sidePadPct;

const Badge: React.FC<{ callout: TimelineCallout; direction: Timeline["direction"] }> = ({ callout, direction }) => {
  const frame = useCurrentFrame();
  const scale = calloutScale(frame, callout.durationInFrames, k.spring, k.outFrames);
  const row: React.CSSProperties =
    callout.align === "center" ? { left: 0, right: 0, justifyContent: "center" }
    : callout.align === "left" ? { left: `${pad}%`, justifyContent: "flex-start" }
    : { right: `${pad}%`, justifyContent: "flex-end" };
  return (
    <div style={{ position: "absolute", top: `${callout.topPct}%`, display: "flex", ...row }}>
      <div
        dir={direction}
        style={{
          transform: `translateY(-50%) rotate(${k.tiltDeg}deg) scale(${scale.toFixed(4)})`, background: k.background, color: k.color, borderRadius: k.radius,
          padding: `${k.padY}px ${k.padX}px`, boxShadow: k.shadow, fontFamily: HEEBO, fontWeight: k.fontWeight, fontSize: k.fontSize, lineHeight: 1.2,
          whiteSpace: "nowrap", unicodeBidi: "isolate",
        }}
      >
        {callout.text}
      </div>
    </div>
  );
};

/** Look pass keyword callouts. compileFootage places them above or beside the face, never with a cutaway, the headline or the CTA card. */
export const Callouts: React.FC<{ timeline: Timeline }> = ({ timeline }) => (
  <AbsoluteFill>
    {(timeline.callouts ?? []).map((c, i) => (
      <Sequence key={i} from={c.fromFrame} durationInFrames={c.durationInFrames} layout="none">
        <Badge callout={c} direction={timeline.direction} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
```
`packages/video/src/footage/ProgressBar.tsx`:
```tsx
import type { Timeline } from "@reel/core";
import React from "react";
import { useCurrentFrame } from "remotion";
import { houseStyle } from "../house-style";
import { progressShare } from "./motion";

const p = houseStyle.progress;

/** Footage reels only: a thin red bar along the top edge, filling from the reading-start side (right in Hebrew). */
export const ProgressBar: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  const frame = useCurrentFrame();
  if (!timeline.progressBar) return null;
  const rtl = timeline.direction === "rtl";
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: p.heightPx, background: p.track }}>
      <div
        style={{
          position: "absolute", top: 0, bottom: 0, [rtl ? "right" : "left"]: 0, background: p.color,
          width: `${(progressShare(frame, timeline.durationInFrames) * 100).toFixed(3)}%`,
          borderRadius: rtl ? `${p.radius}px 0 0 ${p.radius}px` : `0 ${p.radius}px ${p.radius}px 0`,
        }}
      />
    </div>
  );
};
```

- [ ] **Step 5: Add both to the reel.** In `packages/video/src/Reel.tsx`, import `Callouts` from `./footage/Callouts` and `ProgressBar` from `./footage/ProgressBar`, then change the layer list after `<PatternBreak …/>` to:
```tsx
      <PatternBreak timeline={timeline} />
      <Callouts timeline={timeline} />
      <CaptionLayer timeline={timeline} />
      <ProgressBar timeline={timeline} />
      <SfxCues timeline={timeline} />
```

- [ ] **Step 6: Show them in the footage sample.** In `packages/video/src/sample-footage.ts`, `sampleFootageTimeline`:
  - Update the doc comment to mention "a callout over frames 62–101 and the progress bar".
  - Add to the returned object, after `patternBreaks`:
    ```ts
        callouts: [{ text: "1/3", fromFrame: 62, durationInFrames: 40, topPct: 22, align: "center" }],
        progressBar: true,
    ```

- [ ] **Step 7: Run the tests and look.** Run `npx vitest run packages/video && npm run typecheck`.

  Expected: PASS. Open `work/stills/footage-callout-progress-{he,en}.png` and check:
  - A white tilted badge with red "1/3" sits above the pill.
  - A thin red bar runs along the top, filling from the right in Hebrew and from the left in English.

- [ ] **Step 8: Commit.**
```bash
git add packages/video/src/house-style.ts packages/video/src/footage/motion.ts packages/video/src/footage/motion.test.ts packages/video/src/footage/Callouts.tsx packages/video/src/footage/ProgressBar.tsx packages/video/src/Reel.tsx packages/video/src/sample-footage.ts packages/video/src/footage-render.test.ts
git commit -m "feat(video): callout sticker badges that spring in and out, and a thin red progress bar on footage reels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Web: callout field on the review page, callout placement warnings, iOS red

**Files:**
- Modify: `apps/web/lib/edit-plan-edit.ts`, `apps/web/lib/cutaway-edit.ts`, `apps/web/components/FootagePlanEditor.tsx`
- Test: `apps/web/lib/edit-plan-edit.test.ts`, `apps/web/lib/cutaway-edit.test.ts`

**Interfaces:**
- Consumes: `CALLOUT_MAX_CHARS`, `planCallouts` (Task 5).
- Produces:
  - `PlanAction` gains `{ type: "setCallout"; beatId: string; text: string }`. An empty string removes the callout; text is kept as typed and trimmed on save.
  - `placementWarnings` returns the cutaway warnings, then the callout warnings.

- [ ] **Step 1: Write the failing tests.** In `apps/web/lib/edit-plan-edit.test.ts` add to `describe("editPlan")`:
```ts
  it("sets, trims and removes a callout", () => {
    const p = editPlan(plan(), { type: "setCallout", beatId: "b2", text: " 1/5 " });
    expect(p.beats[1].callout).toEqual({ text: " 1/5 " });
    expect(normalizePlanForSave(p).beats[1].callout).toEqual({ text: "1/5" });
    expect(normalizePlanForSave(editPlan(p, { type: "setCallout", beatId: "b2", text: "   " })).beats[1].callout).toBeUndefined();
    expect(editPlan(p, { type: "setCallout", beatId: "b2", text: "" }).beats[1].callout).toBeUndefined();
  });
```
and to `describe("checkEditPlan")`:
```ts
  it("refuses a callout of more than 3 words with a plain message", () => {
    const r = checkEditPlan(editPlan(plan(), { type: "setCallout", beatId: "b2", text: "one two three four" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/A callout is a number or 1–3 words/);
  });
```
In `apps/web/lib/cutaway-edit.test.ts` add to `describe("cutaway editing helpers")`:
```ts
  it("adds callout warnings to the placement list", () => {
    const p = parseEditPlan({ ...plan(), beats: plan().beats.map((b) => (b.id === "b3" ? { ...b, callout: { text: "AI" } } : b)) });
    expect(placementWarnings(p, footageTranscript().words, houseStyle.edit)).toEqual(["The callout in b3 was dropped: the hook headline, a cutaway or the CTA card covers its beat."]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail.** Run `npx vitest run apps/web/lib/edit-plan-edit.test.ts apps/web/lib/cutaway-edit.test.ts`.

  Expected: FAIL (an unknown action leaves the plan unchanged; there are no callout warnings).

- [ ] **Step 3: Implement the editing helpers.** In `apps/web/lib/edit-plan-edit.ts`:
  - Add `| { type: "setCallout"; beatId: string; text: string }` to `PlanAction`.
  - Add a case to `editPlan`:
    ```ts
        case "setCallout":
          return withBeat(plan, a.beatId, (b) => (a.text === "" ? without(b, "callout") : { ...b, callout: { text: a.text } }));
    ```
  - In `normalizePlanForSave`, replace the `beats: plan.beats.map(…)` callback with:
    ```ts
        beats: plan.beats.map((b) => {
          const e = b.emoji !== undefined && !b.emoji.trim() ? without(b, "emoji") : b;
          const c = e.callout ? (e.callout.text.trim() ? { ...e, callout: { text: e.callout.text.trim() } } : without(e, "callout")) : e;
          return c.cutaway ? { ...c, cutaway: trimCutaway(c.cutaway) } : c;
        }),
    ```

  In `apps/web/lib/cutaway-edit.ts`:
  - Change the import to `import { cutawayCost, planCallouts, planCutaways, type Cutaway, type EditPlan, type EditStyle, type Word } from "@reel/core";`.
  - Replace `placementWarnings` with:
    ```ts
    /** Spec §7: the compiler's cutaway and callout trims and drops, shown before approval. An invalid plan has none to show yet. */
    export function placementWarnings(plan: EditPlan, words: Word[], style: EditStyle): string[] {
      try {
        return [...planCutaways(plan, words, style).warnings, ...planCallouts(plan, words, style).warnings];
      } catch {
        return [];
      }
    }
    ```

- [ ] **Step 4: Add the field to the review page.** In `apps/web/components/FootagePlanEditor.tsx`:
  - Change the core import to `import { CALLOUT_MAX_CHARS, EmptyEditError, footageDurationMs, withFootageEstimate, type EditPlan, type Word } from "@reel/core";`.
  - Change `const RED = "#E5262A";` to `const RED = "#FF3B30"; // iOS red, as in the reel`.
  - Change the placement heading `<strong>Cutaway placement:</strong>` to `<strong>Cutaways and callouts:</strong>`.
  - In each beat's row with the Emoji field, after the Emoji `<label>`, add:
    ```tsx
                    <label>Callout
                      <input
                        dir="auto"
                        maxLength={CALLOUT_MAX_CHARS}
                        value={beat.callout?.text ?? ""}
                        placeholder="e.g. 1/5"
                        title="A number or 1–3 words that pops up above you"
                        onChange={(e) => dispatch({ type: "setCallout", beatId: beat.id, text: e.target.value })}
                        style={{ width: 160 }}
                      />
                    </label>
                    {beat.callout && <button type="button" onClick={() => dispatch({ type: "setCallout", beatId: beat.id, text: "" })}>Remove callout</button>}
    ```

- [ ] **Step 5: Run the tests and the web build.** Run `npx vitest run apps/web && npm run typecheck && npm run build -w @reel/web`.

  Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add apps/web/lib/edit-plan-edit.ts apps/web/lib/edit-plan-edit.test.ts apps/web/lib/cutaway-edit.ts apps/web/lib/cutaway-edit.test.ts apps/web/components/FootagePlanEditor.tsx
git commit -m "feat(web): callout field per beat (text + remove) with placement warnings on the review page; iOS red for the red word

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Free local preview of the look (sample timeline, stills, contact sheet)

**Files:**
- Create: `packages/engine/scripts/preview-look.ts`
- Modify: `packages/video/src/sample-footage.ts` (`sampleLookTimeline`, `LOOK_FRAMES`), `package.json` (script), `docs/RUNNING.md`
- Test: `packages/video/src/footage-render.test.ts`

**Interfaces:**
- Consumes: every component above, `renderReelStill`, `serveDir`, `makeTestVideo`, `makeTestImage`, `runFfmpeg`.
- Produces:
  - `sampleLookTimeline(lang: "he" | "en", media?: { videoSrc: string; imageSrc: string }): Timeline`.
  - `LOOK_FRAMES: readonly (readonly [string, number])[]`.
  - The npm script `preview:look`, which writes `work/stills/look/{he,en}-NN.png` and `{he,en}-sheet.png`.

- [ ] **Step 1: Write the failing render test.** In `packages/video/src/footage-render.test.ts`, change the sample import to `import { LOOK_FRAMES, sampleCutawayTimeline, sampleFootageTimeline, sampleLookTimeline } from "./sample-footage";` and add inside the `describe`:
```ts
  it.each(LOOK_FRAMES)("renders the look sample %s for he and en", async (name, frame) => {
    await mkdir(OUT, { recursive: true });
    for (const lang of ["he", "en"] as const) {
      const file = join(OUT, `look-${name}-${lang}.png`);
      await renderReelStill(sampleLookTimeline(lang), file, frame);
      expect((await stat(file)).size).toBeGreaterThan(20_000);
    }
  }, 300_000);
```

- [ ] **Step 2: Run the test to verify it fails.** Run `npx vitest run packages/video/src/footage-render.test.ts -t "look sample"`.

  Expected: FAIL (`LOOK_FRAMES` is undefined).

- [ ] **Step 3: Add the look sample.** In `packages/video/src/sample-footage.ts`:
  - Change the type import to `import type { CaptionPage, Timeline, TimelineClip, TimelineCutaway } from "@reel/core";`.
  - Append:
```ts
/** Frames worth looking at in sampleLookTimeline: [name, frame]. */
export const LOOK_FRAMES = [
  ["headline", 20], ["pill-callout", 60], ["whip-in", 77], ["kenburns", 100], ["exit", 117], ["split-slide", 122], ["split-seam", 140], ["cta", 165],
] as const;

/**
 * 6 s of the whole look pass, frame-exact for LOOK_FRAMES:
 * - headline 0–45
 * - glass pills (red spoken word, red-capsule emphasis)
 * - a callout 48–75
 * - a full cutaway 75–120: a drifting still with whip transitions when `media` is given, else a list card zooming in and out
 * - a split flow card 120–150 sliding in, with the pill on the seam
 * - the CTA 150–180
 * - the progress bar
 * Without media the speaker is a graphic clip (no files needed).
 */
export function sampleLookTimeline(lang: "he" | "en", media?: { videoSrc: string; imageSrc: string }): Timeline {
  const he = lang === "he";
  const t = he
    ? { small: "הטריק ש", big: "חוסך שעות", a: ["ככה", "עורכים", "רילס"], b: ["בלי", "לגעת", "בעריכה"], c: ["שלושה", "צעדים"], list: ["בלי חיבור", "בחינם", "בלי הגבלה"], flow: ["מקליטים", "מעלים", "מקבלים רילס"] }
    : { small: "The trick that", big: "saves hours", a: ["This", "is", "how"], b: ["you", "edit", "reels"], c: ["three", "steps"], list: ["Offline", "Free", "No limits"], flow: ["Record", "Upload", "Get a reel"] };
  const page = (words: string[], fromFrame: number, durationInFrames: number, topPct: number, emphasisAt = -1): CaptionPage => ({
    fromFrame, durationInFrames, topPct, words: words.map((text, j) => ({ text, emphasis: j === emphasisAt, startFrame: fromFrame + j * 8 })),
  });
  const clips: TimelineClip[] = media
    ? [{ sceneId: "s1", kind: "speaker", src: media.videoSrc, fromFrame: 0, durationInFrames: 180, motion: "none", transitionIn: "cut", source: { inMs: 0, outMs: 6000 }, crop: { cx: 0.5, cy: 0.4, scaleFrom: 1, scaleTo: 1.08 } }]
    : [{ sceneId: "g1", kind: "graphic", fromFrame: 0, durationInFrames: 180, motion: "zoom_in", transitionIn: "cut" }];
  const full: TimelineCutaway = media
    ? { id: "b2", fromFrame: 75, durationInFrames: 45, layout: "full", transition: { in: "whip", out: "whip" }, media: { kind: "image", src: media.imageSrc, fit: "cover", kenBurns: 1.12, drift: { x: 0.03, y: 0 } } }
    : { id: "b2", fromFrame: 75, durationInFrames: 45, layout: "full", transition: { in: "zoom", out: "zoom" }, media: { kind: "diagram", template: "list", items: t.list } };
  return {
    fps: 30, width: 1080, height: 1920, durationInFrames: 180, language: lang, direction: he ? "rtl" : "ltr",
    style: { captionPreset: "pill", font: "Heebo", palette: ["#FF3B30", "#FFFFFF"] },
    audio: { musicDuckingDb: -12 },
    clips,
    captions: {
      words: [...t.a, ...t.b, ...t.c].map((text, i) => ({ text, startMs: 1500 + i * 300, endMs: 1500 + i * 300 + 250 })),
      pages: [page(t.a, 45, 30, 62, 2), page(t.b, 75, 45, 62), page(t.c, 120, 30, 50)],
    },
    overlays: [],
    hook: { patternBreak: "none", headline: { small: t.small, big: t.big, fromFrame: 0, durationInFrames: 45 } },
    cutaways: [full, { id: "b3", fromFrame: 120, durationInFrames: 30, layout: "split", transition: { in: "slide", out: "cut" }, media: { kind: "diagram", template: "flow", items: t.flow } }],
    callouts: [{ text: "1/3", fromFrame: 48, durationInFrames: 27, topPct: 22, align: "center" }],
    ending: { kind: "cta", keyword: "AI", fromFrame: 150, durationInFrames: 30 },
    progressBar: true,
  };
}
```

- [ ] **Step 4: Add the preview script.** Create `packages/engine/scripts/preview-look.ts`:
```ts
/**
 * Free local preview of the footage look: no API keys and no paid calls. It renders the look sample timeline with a
 * lavfi test video as the speaker and a flat test still as the B-roll, then one contact sheet per language.
 *   npm run preview:look   →   work/stills/look/he-01.png … he-08.png, he-sheet.png (and en-…)
 */
import { makeTestImage, makeTestVideo, runFfmpeg } from "@reel/media";
import { renderReelStill } from "@reel/video/render";
import { LOOK_FRAMES, sampleLookTimeline } from "@reel/video/sample-footage";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveDir } from "../src/serve";

async function main() {
  const out = resolve("work/stills/look");
  await mkdir(out, { recursive: true });
  const dir = await mkdtemp(join(tmpdir(), "look-"));
  await makeTestVideo(join(dir, "speaker.mp4"), { durationSec: 7 });
  await makeTestImage(join(dir, "still.png"), { color: "teal" });
  const server = await serveDir(dir);
  try {
    for (const lang of ["he", "en"] as const) {
      const timeline = sampleLookTimeline(lang, { videoSrc: server.urlFor("speaker.mp4"), imageSrc: server.urlFor("still.png") });
      for (const [i, [name, frame]] of LOOK_FRAMES.entries()) {
        const file = join(out, `${lang}-${String(i + 1).padStart(2, "0")}.png`);
        await renderReelStill(timeline, file, frame);
        console.log(`${file}  (${name}, frame ${frame})`);
      }
      const sheet = join(out, `${lang}-sheet.png`);
      await runFfmpeg(["-framerate", "1", "-i", join(out, `${lang}-%02d.png`), "-vf", "scale=270:-1,tile=4x2", "-frames:v", "1", sheet]);
      console.log(sheet);
    }
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```
In the root `package.json` add the script after `"studio"`: `"preview:look": "tsx packages/engine/scripts/preview-look.ts",`.

- [ ] **Step 5: Document it.** In `docs/RUNNING.md`, after the "Fake worker note" section, add:
```markdown
### Preview the footage look (free)

`npm run preview:look` renders the look sample: headline, glass pills, a callout, a whip into a drifting still, a split flow card, the CTA and the progress bar. It uses a test video and a test still, in Hebrew and English, with no API keys and no paid calls. Open `work/stills/look/he-sheet.png` and `en-sheet.png` (8 frames each), or the single frames `he-01.png` … `he-08.png`.
```

- [ ] **Step 6: Run everything.** Run `npm test && npm run typecheck && npm run preview:look`.

  Expected: PASS, and the script prints 16 frame paths and 2 sheet paths. Open both sheets and check, in order:
  1. Headline (glass small line, red sticker).
  2. Pill with the red spoken word, and the red-capsule emphasis word under the "1/3" badge.
  3. The still whipping in from the reading side.
  4. The drifting still.
  5. The whip out.
  6. The split card sliding down.
  7. The split flow card with the pill on the seam.
  8. The CTA sticker.
  9. The red bar at the top on every frame.

  No yellow or orange anywhere.

- [ ] **Step 7: Commit** (the stills under `work/` are git-ignored and never committed).
```bash
git add packages/video/src/sample-footage.ts packages/video/src/footage-render.test.ts packages/engine/scripts/preview-look.ts package.json docs/RUNNING.md
git commit -m "feat(video): look sample timeline and npm run preview:look (free stills and contact sheets of the whole look)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the tasks (controller)

1. **Final whole-branch review** (most capable model), then one fix wave.
2. **Look check with the user (free):** run `npm run preview:look` and show the user `work/stills/look/he-sheet.png` and `en-sheet.png`. Tune only `houseStyle` numbers from their feedback (glass opacity, radius, sticker tilt, Ken Burns, transition frames). Update `testEditStyle()` when `houseStyle.edit` changes.
3. **Fake worker end to end in the browser:** run `npm run worker:fake` and `npm run web`.
   1. Upload a short clip with no CTA keyword, so the ending is a loop and the second beat is free.
   2. On the review page, add a callout "1/5" on beat 2 and "one two three four" on beat 1: approving must be refused with "A callout is a number or 1–3 words.". Remove that callout.
   3. Add an AI B-roll still on beat 3 and check the placement warnings.
   4. Approve, then check the reel:
      - the glass pills with the red word
      - the red-sticker headline
      - the split card sliding in
      - the "1/5" badge above the face, with a pop
      - the progress bar
      - no yellow
4. **Paid smoke test (only with the user's explicit OK and the cost stated first):** one real 30 s reel on a user clip, with the real worker (`HF_CONCURRENCY=2`).
   - The new budget allows up to 10 cutaways, 4 of them clips. Worst case: 6 stills × $0.04 + 4 clips × $0.36 = $1.68, plus AI music only if chosen (30 s × $0.01 = $0.30), plus Scribe (≈ $0.02) and Claude planning. Never more than the estimate the user approves.
   - Check that Claude now plans close to the budget (the last run: 6 allowed, 5 planned) and adds a few callouts.
5. **Merge**, then restart the worker and web. Plan 3 (background replacement) follows.
