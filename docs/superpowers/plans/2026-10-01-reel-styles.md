# Reel Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Create reel" opens a picker of 12 styles plus Custom. Each available style is a prompt template with a form of variables that drives Claude's storyboard. A pasted script is kept word for word, and every render gets an `.srt`.

**Architecture:**
- A new browser-safe `@reel/styles` package holds the registry (fields and engine notes), template filling and input checks. A Node-only loader reads the verbatim prompt files.
- The web app builds the picker and forms from the registry. The plan job payload carries `{ style: { id, values, script } }`.
- The worker fills the template and hands `PlanRequest.style` to the planner.
- The planner adds the style brief and engine notes, and enforces exact-script mode with `scriptMatches` from `@reel/core`.
- `@reel/video` builds the SRT from the same caption pages the renderer draws.

**Tech Stack:** existing monorepo: TypeScript 7, zod 4, Vitest 5, Next.js 16 (Turbopack), Supabase, Remotion 4.0.531 (`@remotion/captions`).

**Spec:** `docs/superpowers/specs/2026-10-01-reel-styles-design.md`. The prompt sources are in `docs/superpowers/specs/2026-10-01-reel-styles-prompts/`.

## Global Constraints

- **Style ids** (folder name, URL slug and `projects.style_id`) match `^[a-z0-9-]{1,40}$`. They are:
  - available: `faceless`, `product-demo`, `before-after`, `mini-story`, `listicle`, `myth-fact`, `customer-story`, `process`, `custom`
  - coming soon: `presenter` (reason: "Needs the talking-avatar feature"), `screen-tutorial` (reason: "Needs file uploads"), `text-led` (reason: "Needs music and reels without a voiceover"), `loop-asmr` (reason: "Needs music and sound effects")
- **Prompts** are stored verbatim. `packages/styles/src/prompts/<id>.md` must be byte-identical to `docs/superpowers/specs/2026-10-01-reel-styles-prompts/<id>.md`.
- **Variable sources:**
  - Shared variables:
    - `LANGUAGE` becomes "Hebrew" or "English".
    - `DURATION` and `DURATION_SECONDS` become the length in seconds.
    - `ACCENT_COLOR` becomes `palette[0]`.
    - `VOICE` and `VOICE_STYLE` become the voice description.
  - Asset variables become `not provided (file uploads are not available yet; use generated visuals)`.
  - Empty fields become `not provided`.
  - An empty script becomes `not provided: draft one`.
  - `{{{{LANGUAGE}}_SCRIPT}}` and `{{{{LANGUAGE}}_COPY}}` are substituted before `{{LANGUAGE}}`.
- **Field limits:** 2000 characters per field and 5000 for the script. `dir="auto"` on every text input.
- **Exact script:** compare after NFC normalisation and whitespace collapse (`/\s+/g` becomes one space, then trim). Punctuation, digits and letters must match exactly.
- **Exact-mode length:** a too-long speech estimate never triggers a repair and never shortens the script. Too many scenes still triggers the one repair round.
- **Mismatch twice:** throw `ScriptMismatchError` with the message `Couldn't split your script without changing words. Try shorter sentences or break it into paragraphs.`
- **Custom and payloads without `style`** behave byte for byte as today. The system prompt for Custom is unchanged.
- **SRT:**
  - pages from `createTikTokStyleCaptions` with `COMBINE_MS`
  - a cue ends at the next page's start, otherwise at `startMs + durationMs`
  - `HH:MM:SS,mmm`
  - UTF-8 without BOM
  - cues longer than 42 characters split into 2 lines at the space nearest the middle
- **Migration:** `projects.style_id text` (nullable, regex check) and `renders.srt_path text` (nullable). The controller shows it to the user and applies it to the hosted project only after they approve.
- **Safety:** no paid API calls in any task. Never read `.env.local`.

## Review Focus

1. **A Hebrew script with ״ ׳ ־ quote marks, maqaf or niqqud, pasted with line breaks.** Exact mode must accept Claude's split when only the whitespace differs, and must reject it when one mark changes. Pinned in Task 3.
2. **A user types `{{TOPIC}}` or `{{LANGUAGE}}` inside a field value.** It must reach Claude literally, not be substituted a second time. Pinned in Task 2.
3. **A crafted POST or job for a coming-soon or unknown style, or with extra value keys.** The server action and the worker refuse the style; unknown keys are dropped. Pinned in Tasks 4 and 5.
4. **Old data:** plan payloads without `style`, and renders without `srt_path`. These must keep working: Custom planning is unchanged and the page shows no SRT link. Pinned in Tasks 4 and 6.
5. **A one-word Hebrew script, or a single sentence over 400 characters, in exact mode.** Claude cannot split it validly, so this must fail with the `ScriptMismatchError` message or the scene limit, never loop or silently alter the words. Pinned in Task 3.

---

### Task 1: Plan payload `style` and the DB migration

**Files:**
- Modify: `packages/core/src/plan-form.ts`, `packages/db/src/database.types.ts`
- Create: `supabase/migrations/20261001120000_reel_styles.sql`
- Test: `packages/core/src/plan-form.test.ts` (extend)

**Interfaces:**
- Produces: `PlanFormSchema` now has optional `style: { id: string; values: Record<string, string>; script?: string }`, and `PlanStyleInputSchema` is exported. The DB types gain `projects.style_id: string | null` and `renders.srt_path: string | null`.

- [ ] **Step 1: Write the failing test.** Add to `plan-form.test.ts`:
```ts
describe("PlanFormSchema style", () => {
  const base = { brief: "Listicle: 3 tips", language: "he", targetDurationSec: 30, pacing: "punchy", captionPreset: "bold_pop", palette: ["#FFE14D"] };
  it("accepts a style part", () => {
    const f = PlanFormSchema.parse({ ...base, style: { id: "listicle", values: { TOPIC: "טיפים" }, script: "שלום עולם" } });
    expect(f.style).toEqual({ id: "listicle", values: { TOPIC: "טיפים" }, script: "שלום עולם" });
  });
  it("stays valid without style", () => {
    expect(PlanFormSchema.parse(base).style).toBeUndefined();
  });
  it("rejects bad ids and oversized values", () => {
    expect(() => PlanFormSchema.parse({ ...base, style: { id: "../x", values: {} } })).toThrow();
    expect(() => PlanFormSchema.parse({ ...base, style: { id: "faceless", values: { TOPIC: "x".repeat(2001) } } })).toThrow();
    expect(() => PlanFormSchema.parse({ ...base, style: { id: "faceless", values: {}, script: "x".repeat(5001) } })).toThrow();
  });
});
```
Run `npx vitest run packages/core/src/plan-form.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement it.** In `plan-form.ts`, before `PlanFormSchema`:
```ts
export const PlanStyleInputSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  values: z.record(z.string().regex(/^[A-Z_]{1,40}$/), z.string().max(2000)),
  script: z.string().max(5000).optional(),
});
export type PlanStyleInput = z.infer<typeof PlanStyleInputSchema>;
```
Then add `style: PlanStyleInputSchema.optional(),` to `PlanFormSchema`.

- [ ] **Step 3: Write the migration** `supabase/migrations/20261001120000_reel_styles.sql`:
```sql
-- Reel styles: which style template a reel was created from, and the subtitle file of each render.
alter table public.projects add column style_id text check (style_id is null or style_id ~ '^[a-z0-9-]{1,40}$');
alter table public.renders add column srt_path text;
```
Signed-in users already have insert on `projects`, so no grant changes are needed. `srt_path` is written only by the worker, which uses the secret key.

- [ ] **Step 4: Update `packages/db/src/database.types.ts` by hand.**
  - `projects`: in Row add `style_id: string | null`; in Insert and Update add `style_id?: string | null`.
  - `renders`: in Row add `srt_path: string | null`; in Insert and Update add `srt_path?: string | null`.
  - Keep the keys alphabetical, as the generated file does.

- [ ] **Step 5: Verify.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS.

- [ ] **Step 6: Commit** with message `feat: plan payload carries an optional style; migration for style_id and srt_path`.

---

### Task 2: The `@reel/styles` package

**Files:**
- Create:
  - `packages/styles/package.json`
  - `packages/styles/src/index.ts`
  - `packages/styles/src/registry.ts`
  - `packages/styles/src/fill.ts`
  - `packages/styles/src/check.ts`
  - `packages/styles/src/load.ts`
  - `packages/styles/src/prompts/*.md` (12 files, copied)
- Test: `packages/styles/src/registry.test.ts`, `packages/styles/src/fill.test.ts`, `packages/styles/src/check.test.ts`

**Interfaces:**
- Produces, from `@reel/styles` (browser-safe):
  - `STYLES: StyleDef[]`
  - `getStyle(id: string): StyleDef | undefined`
  - `SHARED_VARS`
  - `ASSET_PLACEHOLDER`
  - `fillTemplate(prompt: string, def: StyleDef, input: FillInput): string`
  - `checkStyleInput(def: StyleDef, values: Record<string,string>): { values: Record<string,string>; errors: string[] }`
  - `styleTitle(def, values): string`
  - types `StyleDef`, `FieldDef`, `FillInput`
- Produces, from `@reel/styles/load` (Node only): `readPrompt(id: string): string`.

- [ ] **Step 1: Create the package and copy the prompts.**

`packages/styles/package.json`:
```json
{
  "name": "@reel/styles",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./load": "./src/load.ts" }
}
```
Then run:
```bash
mkdir -p packages/styles/src/prompts && cp docs/superpowers/specs/2026-10-01-reel-styles-prompts/*.md packages/styles/src/prompts/ && npm install
```

- [ ] **Step 2: Write the failing tests.**

`fill.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fillTemplate } from "./fill";
import { getStyle } from "./registry";

const def = getStyle("myth-fact")!;
const input = (over = {}) => ({ values: { TOPIC: "שינה", MYTH: "צריך 8 שעות", FACT: "זה משתנה" }, language: "he" as const, durationSec: 30, accentColor: "#FFE14D", voiceDescription: "the team Hebrew voice", ...over });

describe("fillTemplate", () => {
  it("substitutes the nested script variable before LANGUAGE", () => {
    const out = fillTemplate("Script: {{{{LANGUAGE}}_SCRIPT}} in {{LANGUAGE}}", def, input({ script: "שלום" }));
    expect(out).toBe("Script: שלום in Hebrew");
  });
  it("uses the draft marker when there is no script, and English for en", () => {
    expect(fillTemplate("{{{{LANGUAGE}}_SCRIPT}}|{{LANGUAGE}}", def, input({ language: "en" }))).toBe("not provided: draft one|English");
  });
  it("fills shared, asset, empty and field variables", () => {
    const out = fillTemplate("{{TOPIC}}|{{AUDIENCE}}|{{ASSETS}}|{{ACCENT_COLOR}}|{{DURATION}}", def, input());
    expect(out).toBe("שינה|not provided|not provided (file uploads are not available yet; use generated visuals)|#FFE14D|30");
  });
  it("does not re-substitute variables typed inside values", () => {
    const out = fillTemplate("{{TOPIC}}", def, input({ values: { TOPIC: "{{LANGUAGE}} {{MYTH}}", MYTH: "m", FACT: "f" } }));
    expect(out).toBe("{{LANGUAGE}} {{MYTH}}");
  });
  it("throws on a variable with no source", () => {
    expect(() => fillTemplate("{{NOPE}}", def, input())).toThrow(/NOPE/);
  });
  it("fills every shipped prompt without throwing", async () => {
    const { STYLES } = await import("./registry");
    const { readPrompt } = await import("./load");
    for (const s of STYLES.filter((x) => x.id !== "custom")) {
      const values = Object.fromEntries(s.fields.map((f) => [f.key, f.default ?? "x"]));
      expect(() => fillTemplate(readPrompt(s.id), s, { ...input(), values })).not.toThrow();
    }
  });
});
```

`registry.test.ts` (coverage and integrity):
```ts
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPrompt } from "./load";
import { SHARED_VARS, STYLES } from "./registry";

const NESTED = /\{\{\{\{LANGUAGE\}\}_(SCRIPT|COPY)\}\}/g;
const varsIn = (p: string) => [...p.replace(NESTED, "").matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]);

describe("style registry", () => {
  const withPrompts = STYLES.filter((s) => s.id !== "custom");
  it("has a prompt file for every style and a style for every prompt file", () => {
    const files = readdirSync(new URL("./prompts/", import.meta.url)).map((f) => f.replace(/\.md$/, "")).sort();
    expect(withPrompts.map((s) => s.id).sort()).toEqual(files);
  });
  it.each(withPrompts.map((s) => [s.id, s] as const))("%s: every variable has a source and every field is used", (_id, s) => {
    const p = readPrompt(s.id);
    const known = new Set([...SHARED_VARS, ...s.assetVars, ...s.fields.map((f) => f.key)]);
    for (const v of varsIn(p)) expect(known.has(v), `${s.id}: {{${v}}} has no source`).toBe(true);
    for (const f of s.fields) expect(p.includes(`{{${f.key}}}`), `${s.id}: field ${f.key} unused`).toBe(true);
    expect(Boolean(s.scriptVar)).toBe(/\{\{\{\{LANGUAGE\}\}_(SCRIPT|COPY)\}\}/.test(p));
  });
  it.each(withPrompts.map((s) => [s.id] as const))("%s: prompt is byte-identical to the spec copy", (id) => {
    const spec = readFileSync(new URL(`../../../docs/superpowers/specs/2026-10-01-reel-styles-prompts/${id}.md`, import.meta.url));
    expect(Buffer.from(readPrompt(id)).equals(spec)).toBe(true);
  });
  it("marks exactly the 4 agreed styles as coming soon", () => {
    expect(STYLES.filter((s) => s.status === "coming_soon").map((s) => s.id).sort()).toEqual(["loop-asmr", "presenter", "screen-tutorial", "text-led"]);
  });
});
```

`check.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { checkStyleInput, styleTitle } from "./check";
import { getStyle } from "./registry";

describe("checkStyleInput", () => {
  const def = getStyle("myth-fact")!;
  it("reports missing required fields by label", () => {
    expect(checkStyleInput(def, { TOPIC: " " }).errors).toEqual(["Topic is required", "Misconception is required", "Accurate explanation is required"]);
  });
  it("trims values, drops unknown keys and keeps optional empties out", () => {
    const r = checkStyleInput(def, { TOPIC: " a ", MYTH: "b", FACT: "c", EVIL: "x", EXAMPLE: "" });
    expect(r).toEqual({ values: { TOPIC: "a", MYTH: "b", FACT: "c" }, errors: [] });
  });
  it("rejects a select value outside its options", () => {
    const l = getStyle("listicle")!;
    expect(checkStyleInput(l, { TOPIC: "t", TIPS_MISTAKES_TOOLS_OR_IDEAS: "hacks", NUMBER: "9" }).errors).toEqual(["List type must be one of: tips, mistakes, tools, ideas", "Number of items must be one of: 3, 4, 5, 6, 7"]);
  });
  it("builds the title from the title field, max 120 chars", () => {
    expect(styleTitle(def, { TOPIC: "x".repeat(200) })).toHaveLength(120);
  });
});
```
Run `npx vitest run packages/styles`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `registry.ts`.**
```ts
export type FieldDef = {
  key: string;
  label: string;
  kind: "line" | "text" | "select";
  required: boolean;
  options?: string[];
  default?: string;
  maxLength: number;
};
export type StyleDef = {
  id: string;
  name: string;
  description: string;
  status: "available" | "coming_soon";
  comingSoonReason?: string;
  fields: FieldDef[];
  scriptVar?: "SCRIPT" | "COPY";
  assetVars: string[];
  titleField?: string;
  engineNotes: string[];
  defaultDurationSec: 15 | 30 | 45 | 60;
};

export const SHARED_VARS = ["LANGUAGE", "DURATION", "DURATION_SECONDS", "ACCENT_COLOR", "VOICE", "VOICE_STYLE"] as const;
export const ASSET_PLACEHOLDER = "not provided (file uploads are not available yet; use generated visuals)";

const line = (key: string, label: string, required = false): FieldDef => ({ key, label, kind: "line", required, maxLength: 2000 });
const text = (key: string, label: string, required = false): FieldDef => ({ key, label, kind: "text", required, maxLength: 2000 });

export const STYLES: StyleDef[] = [
  {
    id: "presenter", name: "Presenter-Led (Avatar)", description: "A presenter speaks to camera, with demonstrations and labels.",
    status: "coming_soon", comingSoonReason: "Needs the talking-avatar feature",
    fields: [line("TOPIC", "Topic", true), line("TARGET_AUDIENCE", "Audience"), text("MAIN_MESSAGE", "Main message", true), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["PRESENTER_REFERENCE", "SUPPORTING_ASSETS"], titleField: "TOPIC", engineNotes: [], defaultDurationSec: 30,
  },
  {
    id: "faceless", name: "Faceless + Voiceover", description: "Voiceover over footage, close-ups and motion graphics. No host.",
    status: "available",
    fields: [line("TOPIC", "Topic", true), line("AUDIENCE", "Audience"), text("MAIN_MESSAGE", "Main takeaway", true), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["IMAGES_VIDEOS_SCREENSHOTS"], titleField: "TOPIC", defaultDurationSec: 30,
    engineNotes: [
      "No people speaking to camera.",
      "Change the visual about every 2-4 seconds, within the scene limits.",
      "Prefer concrete demonstrations; use graphic scenes with an overlay for numbers and key terms.",
    ],
  },
  {
    id: "screen-tutorial", name: "Screen Tutorial", description: "Teach one task with a clear screen demonstration.",
    status: "coming_soon", comingSoonReason: "Needs file uploads",
    fields: [line("TASK", "Task", true), line("APP_OR_WEBSITE", "App or website", true), line("AUDIENCE", "Audience"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["SCREEN_ASSETS"], titleField: "TASK", engineNotes: [], defaultDurationSec: 30,
  },
  {
    id: "product-demo", name: "Product Demonstration", description: "Show how a product solves one clear problem.",
    status: "available",
    fields: [line("PRODUCT", "Product", true), line("AUDIENCE", "Audience"), text("PROBLEM", "Problem", true), text("BENEFIT", "Primary benefit", true), text("VERIFIED_FACTS", "Verified features and claims"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["PRODUCT_ASSETS"], titleField: "PRODUCT", defaultDurationSec: 30,
    engineNotes: [
      "Scene order: problem, product, how it works, benefit, final product shot with the call to action.",
      "Describe the product in visual prompts only as the user described it; never invent logos or packaging details. If no description was given, describe it generically.",
      "Use only claims from the verified features and the primary benefit.",
    ],
  },
  {
    id: "before-after", name: "Before and After", description: "Show a clear transformation and what caused it.",
    status: "available",
    fields: [line("SUBJECT", "Subject", true), text("BEFORE_STATE", "Starting state", true), text("AFTER_STATE", "Final state", true), text("METHOD", "What caused the change", true), text("VERIFIED_DETAILS", "Evidence and context"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["ASSETS"], titleField: "SUBJECT", defaultDurationSec: 30,
    engineNotes: [
      "Scene 1 previews the final result.",
      'Before scenes carry an overlay "לפני" (Hebrew reels) or "Before" (English reels); after scenes carry "אחרי" or "After".',
      'These visuals are generated, not documented: every before or after scene also carries a short overlay "המחשה" (Hebrew) or "Illustration" (English).',
      "Use the same framing words (angle, distance, setting) in matching before and after visual prompts. There is no split-screen; alternate matched shots instead.",
    ],
  },
  {
    id: "mini-story", name: "Mini Story", description: "A short story with a challenge, a turning point and a payoff.",
    status: "available",
    fields: [line("SUBJECT", "Main subject or character", true), line("SETTING", "Setting"), text("CHALLENGE", "Challenge", true), text("TURNING_POINT", "Turning point"), text("RESOLUTION", "Resolution", true), text("TAKEAWAY", "Main takeaway"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["ASSETS"], titleField: "SUBJECT", defaultDurationSec: 30,
    engineNotes: [
      "Follow the five moments of the brief.",
      "Describe the main character identically in every visual prompt (same age, clothing and setting words).",
      "The narration is a narrator's voice; nobody speaks on screen.",
      'If the story is invented, the final scene carries a short overlay "סיפור להמחשה" (Hebrew) or "Illustrative story" (English).',
    ],
  },
  {
    id: "listicle", name: "Listicle", description: "A short numbered list of tips, mistakes, tools or ideas.",
    status: "available",
    fields: [
      line("TOPIC", "Topic", true), line("AUDIENCE", "Audience"),
      { key: "TIPS_MISTAKES_TOOLS_OR_IDEAS", label: "List type", kind: "select", required: true, options: ["tips", "mistakes", "tools", "ideas"], default: "tips", maxLength: 20 },
      { key: "NUMBER", label: "Number of items", kind: "select", required: true, options: ["3", "4", "5", "6", "7"], default: "3", maxLength: 1 },
      text("ITEMS", "Approved items"), line("CTA", "Call to action"),
    ],
    scriptVar: "SCRIPT", assetVars: ["ASSETS"], titleField: "TOPIC", defaultDurationSec: 30,
    engineNotes: [
      "Open with a promise scene, then exactly the requested number of item scenes, then a takeaway and call-to-action scene.",
      'Each item scene has an overlay "N. <short title>" in the reel\'s language.',
      "If no items were provided, choose them yourself.",
    ],
  },
  {
    id: "myth-fact", name: "Myth vs Fact", description: "Correct one misconception and give a practical takeaway.",
    status: "available",
    fields: [line("TOPIC", "Topic", true), line("AUDIENCE", "Audience"), text("MYTH", "Misconception", true), text("FACT", "Accurate explanation", true), text("SOURCES_OR_EVIDENCE", "Supporting evidence"), text("EXAMPLE", "Practical example"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["ASSETS"], titleField: "TOPIC", defaultDurationSec: 30,
    engineNotes: [
      'The first scene states the myth with an overlay "מיתוס" (Hebrew) or "Myth" (English); then the missing context.',
      'The fact reveal has an overlay "עובדה" (Hebrew) or "Fact" (English), followed by one example scene and a call-to-action scene.',
      "Mark the correction with a graphic scene or a change of transition.",
    ],
  },
  {
    id: "text-led", name: "Text-Led, Music Only", description: "The whole message in on-screen text and visuals, no narration.",
    status: "coming_soon", comingSoonReason: "Needs music and reels without a voiceover",
    fields: [line("TOPIC", "Topic", true), line("AUDIENCE", "Audience"), text("MAIN_MESSAGE", "Main message", true), line("CTA", "Call to action"), line("MOOD", "Mood")],
    scriptVar: "COPY", assetVars: ["ASSETS", "MUSIC_ASSET"], titleField: "TOPIC", engineNotes: [], defaultDurationSec: 15,
  },
  {
    id: "customer-story", name: "Customer Story", description: "A case study: problem, action taken, documented outcome.",
    status: "available",
    fields: [line("NAME", "Customer or project", true), line("AUDIENCE", "Audience"), text("PROBLEM", "Initial problem", true), text("ACTION", "Solution or action", true), text("RESULT", "Verified outcome", true), text("QUOTES", "Approved quotes"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["ASSETS"], titleField: "NAME", defaultDurationSec: 30,
    engineNotes: [
      "Open with the strongest outcome from the verified outcome.",
      'Quotes appear only as overlays in quotation marks, only if quotes were provided, and word for word (shorten with "…" to fit the overlay limit).',
      "Never invent numbers, names or endorsements. Generated visuals are illustrative.",
    ],
  },
  {
    id: "process", name: "Process / Behind the Scenes", description: "How something is made, prepared or completed.",
    status: "available",
    fields: [line("PROCESS", "Process", true), line("AUDIENCE", "Audience"), text("RESULT", "Finished result", true), text("STEPS", "Essential stages"), text("TAKEAWAY", "Main takeaway"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["ASSETS"], titleField: "PROCESS", defaultDurationSec: 30,
    engineNotes: [
      "Open with the finished result, then the stages in the order given, each with a short stage-label overlay.",
      "Return to the finished result for the call to action.",
    ],
  },
  {
    id: "loop-asmr", name: "Looping Visual / ASMR", description: "One satisfying repeating action with detailed sound.",
    status: "coming_soon", comingSoonReason: "Needs music and sound effects",
    fields: [line("SUBJECT", "Subject or product", true), line("ACTION", "Main action", true), line("MOOD", "Mood"), line("HOOK_TEXT", "Hook text"), line("CTA", "Optional call to action")],
    assetVars: ["ASSETS", "AUDIO_ASSETS"], titleField: "SUBJECT", engineNotes: [], defaultDurationSec: 15,
  },
  {
    id: "custom", name: "Custom", description: "Write your own brief.",
    status: "available", fields: [], assetVars: [], engineNotes: [], defaultDurationSec: 30,
  },
];

export const getStyle = (id: string) => STYLES.find((s) => s.id === id);
```
The 13 cards appear in this order, which matches the user's list with Custom last.

- [ ] **Step 4: Implement `fill.ts`, `check.ts`, `load.ts` and `index.ts`.**

`fill.ts`:
```ts
import { ASSET_PLACEHOLDER, SHARED_VARS, type StyleDef } from "./registry";

export type FillInput = {
  values: Record<string, string>;
  script?: string;
  language: "he" | "en";
  durationSec: number;
  accentColor: string;
  voiceDescription: string;
};

export function fillTemplate(prompt: string, def: StyleDef, input: FillInput): string {
  const shared: Record<(typeof SHARED_VARS)[number], string> = {
    LANGUAGE: input.language === "he" ? "Hebrew" : "English",
    DURATION: String(input.durationSec),
    DURATION_SECONDS: String(input.durationSec),
    ACCENT_COLOR: input.accentColor,
    VOICE: input.voiceDescription,
    VOICE_STYLE: input.voiceDescription,
  };
  const fieldKeys = new Set(def.fields.map((f) => f.key));
  const script = input.script?.trim() ? input.script : "not provided: draft one";
  // One pass over the original prompt, so text inside substituted values is never re-read as a variable.
  return prompt.replace(/\{\{\{\{LANGUAGE\}\}_(?:SCRIPT|COPY)\}\}|\{\{([A-Z_]+)\}\}/g, (match, name: string | undefined) => {
    if (name === undefined) return script;
    if (name in shared) return shared[name as keyof typeof shared];
    if (def.assetVars.includes(name)) return ASSET_PLACEHOLDER;
    if (fieldKeys.has(name)) return input.values[name]?.trim() || "not provided";
    throw new Error(`Style ${def.id}: template variable {{${name}}} has no source`);
  });
}
```

`check.ts`:
```ts
import type { StyleDef } from "./registry";

export function checkStyleInput(def: StyleDef, raw: Record<string, string>): { values: Record<string, string>; errors: string[] } {
  const values: Record<string, string> = {};
  const errors: string[] = [];
  for (const f of def.fields) {
    const v = (raw[f.key] ?? "").trim();
    if (!v) {
      if (f.required) errors.push(`${f.label} is required`);
      continue;
    }
    if (v.length > f.maxLength) errors.push(`${f.label} is too long (max ${f.maxLength} characters)`);
    else if (f.options && !f.options.includes(v)) errors.push(`${f.label} must be one of: ${f.options.join(", ")}`);
    else values[f.key] = v;
  }
  return { values, errors };
}

export function styleTitle(def: StyleDef, values: Record<string, string>): string {
  const v = def.titleField ? values[def.titleField] : undefined;
  return Array.from(v || def.name).slice(0, 120).join("");
}
```

`load.ts`:
```ts
import { readFileSync } from "node:fs";

/** Node only: the verbatim prompt template for a style. */
export function readPrompt(id: string): string {
  if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error(`invalid style id "${id}"`);
  return readFileSync(new URL(`./prompts/${id}.md`, import.meta.url), "utf8");
}
```

`index.ts`:
```ts
export * from "./registry";
export * from "./fill";
export * from "./check";
```
It does **not** export `load` (browser safety).

- [ ] **Step 5: Verify.** Run `npx vitest run packages/styles && npm run typecheck`. Expected: PASS. The `tsconfig.json` include `packages/*/src` already covers the new package.

- [ ] **Step 6: Commit** with message `feat(styles): style registry, verbatim prompts, template filling and input checks`.

---

### Task 3: `scriptMatches` and the planner's style and exact-script modes

**Files:**
- Create: `packages/core/src/script-match.ts`
- Modify: `packages/core/src/index.ts`, `packages/engine/src/providers/types.ts`, `packages/engine/src/planner.ts`
- Test: `packages/core/src/script-match.test.ts`, `packages/engine/src/planner.test.ts` (extend)

**Interfaces:**
- Produces:
  - `scriptMatches(expected: string, scenes: string[]): { ok: true } | { ok: false; diff: string }` (core)
  - `PlanRequest.style?: { name: string; brief: string; engineNotes: string[]; script?: string }`
  - `ScriptMismatchError` (engine; exported from `planner.ts`, which the `@reel/engine` barrel re-exports)
  - `systemPrompt(opts?: { style?: boolean })`

- [ ] **Step 1: Write the failing core test** `script-match.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { scriptMatches } from "./script-match";

describe("scriptMatches", () => {
  const he = "רוצים יותר צפיות? הנה ה״טיפ״ הכי חשוב:\n\nשלוש השניות הראשונות קובעות הכול - 100%.";
  it("accepts a split that differs only in whitespace", () => {
    expect(scriptMatches(he, ["רוצים יותר צפיות?", "הנה ה״טיפ״ הכי חשוב: שלוש השניות", "הראשונות  קובעות הכול - 100%."])).toEqual({ ok: true });
  });
  it("rejects one changed punctuation mark and points at it", () => {
    const r = scriptMatches(he, ["רוצים יותר צפיות!", "הנה ה״טיפ״ הכי חשוב: שלוש השניות הראשונות קובעות הכול - 100%."]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.diff).toMatch(/צפיות\?/);
  });
  it("rejects a dropped word and an added word", () => {
    expect(scriptMatches("one two three", ["one three"]).ok).toBe(false);
    expect(scriptMatches("one two", ["one two three"]).ok).toBe(false);
  });
  it("treats NFC-equivalent text as equal", () => {
    expect(scriptMatches("é", ["é"]).ok).toBe(true);
  });
});
```
Run `npx vitest run packages/core/src/script-match.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `script-match.ts`** and append `export * from "./script-match";` to the core index:
```ts
const normalize = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/** Exact-script check: the scenes, joined, must equal the user's script (whitespace aside). */
export function scriptMatches(expected: string, scenes: string[]): { ok: true } | { ok: false; diff: string } {
  const want = normalize(expected);
  const got = normalize(scenes.join(" "));
  if (want === got) return { ok: true };
  let i = 0;
  while (i < want.length && i < got.length && want[i] === got[i]) i++;
  const ctx = (s: string) => s.slice(Math.max(0, i - 40), i + 40);
  return { ok: false, diff: `The scenes differ from the script at character ${i + 1}.\nScript:  …${ctx(want)}…\nScenes:  …${ctx(got)}…` };
}
```

- [ ] **Step 3: Write the failing planner tests.** Add to `planner.test.ts`, reusing `REQ`, `draft`, `reply`:
```ts
import { ScriptMismatchError, systemPrompt } from "./planner";

const STYLE_REQ = (script?: string): PlanRequest => ({
  ...REQ,
  style: { name: "Myth vs Fact", brief: "Create a clear Hebrew reel… Misconception: X", engineNotes: ['The first scene has an overlay "מיתוס".'], ...(script ? { script } : {}) },
});
const scenesDraft = (scripts: string[]): StoryboardDraft => ({
  title: "t",
  scenes: scripts.map((script) => ({ script, visual: { kind: "graphic", prompt: "", motion: "none" }, overlays: [], transitionOut: "cut" })),
});

describe("style mode", () => {
  it("keeps Custom's system prompt unchanged and adds engine rules only for styles", () => {
    expect(systemPrompt({ style: false })).toBe(systemPrompt());
    expect(systemPrompt({ style: true })).toMatch(/Never invent quotes, numbers, results/);
    expect(systemPrompt()).not.toMatch(/Never invent quotes/);
  });
  it("puts the style brief, engine notes and draft mode into the user prompt", () => {
    const u = userPrompt(STYLE_REQ());
    expect(u).toMatch(/Style brief \(follow its structure, pacing and tone\):\nCreate a clear Hebrew reel/);
    expect(u).toMatch(/Engine notes:\n- The first scene has an overlay "מיתוס"\./);
    expect(u).toMatch(/No script was provided/);
    expect(u).not.toMatch(/^Brief: /m);
  });
  it("custom prompt is unchanged", () => {
    expect(userPrompt(REQ)).toMatch(/^Brief: 3 טיפים/);
  });
});

describe("exact script mode", () => {
  const script = "מיתוס נפוץ: צריך שמונה שעות שינה. האמת? זה משתנה מאדם לאדם.";
  it("accepts a verbatim split in one call and states the mode", async () => {
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft(["מיתוס נפוץ: צריך שמונה שעות שינה.", "האמת? זה משתנה מאדם לאדם."])));
    const sb = await createPlanner(model).plan(STYLE_REQ(script));
    expect(model).toHaveBeenCalledTimes(1);
    expect(model.mock.calls[0][0].user).toMatch(/Exact script mode/);
    expect(sb.scenes.map((s) => s.script)).toEqual(["מיתוס נפוץ: צריך שמונה שעות שינה.", "האמת? זה משתנה מאדם לאדם."]);
  });
  it("repairs once with the diff, then succeeds", async () => {
    const model = vi.fn<DraftModel>()
      .mockResolvedValueOnce(reply(scenesDraft(["מיתוס נפוץ: צריך 8 שעות שינה.", "האמת? זה משתנה מאדם לאדם."])))
      .mockResolvedValueOnce(reply(scenesDraft([script])));
    await createPlanner(model).plan(STYLE_REQ(script));
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].user).toMatch(/differ from the script/);
  });
  it("throws ScriptMismatchError after two altered answers", async () => {
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft(["משהו אחר לגמרי."])));
    await expect(createPlanner(model).plan(STYLE_REQ(script))).rejects.toBeInstanceOf(ScriptMismatchError);
    expect(model).toHaveBeenCalledTimes(2);
  });
  it("never repairs an over-long exact script (speech length is ignored)", async () => {
    const long = Array.from({ length: 150 }, () => "מילה").join(" ");
    const halves = [long.split(" ").slice(0, 75).join(" "), long.split(" ").slice(75).join(" ")];
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft(halves)));
    const sb = await createPlanner(model).plan({ ...STYLE_REQ(long), targetDurationSec: 15 });
    expect(model).toHaveBeenCalledTimes(1);
    expect(sb.scenes).toHaveLength(2);
  });
  it("still repairs too many scenes, and returns a matching over-count second answer", async () => {
    const words = Array.from({ length: 20 }, (_, i) => `w${i}`);
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft(words)));
    const sb = await createPlanner(model).plan({ ...STYLE_REQ(words.join(" ")), targetDurationSec: 15 });
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].user).toMatch(/at most 6 scenes \(you wrote 20\)/);
    expect(sb.scenes).toHaveLength(20);
  });
  it("fails with the mismatch message when a single sentence cannot be split validly", async () => {
    const huge = Array.from({ length: 90 }, () => "מילה").join(" "); // one scene would exceed 400 characters
    const model = vi.fn<DraftModel>(async () => reply(scenesDraft([huge.slice(0, 200)])));
    await expect(createPlanner(model).plan(STYLE_REQ(huge))).rejects.toThrow(/Couldn't split your script without changing words/);
  });
});
```
Run `npx vitest run packages/engine/src/planner.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 4: Implement it.**

1. In `providers/types.ts`, add to `PlanRequest`:
```ts
  /** Present for style reels: the filled style template, its engine notes and the user's exact script (if any). */
  style?: { name: string; brief: string; engineNotes: string[]; script?: string };
```

2. In `planner.ts`:
   - Add `ScriptMismatchError`:
```ts
export class ScriptMismatchError extends Error {
  constructor(readonly diff: string) {
    super("Couldn't split your script without changing words. Try shorter sentences or break it into paragraphs.");
    this.name = "ScriptMismatchError";
  }
}
```
   - Change `systemPrompt` to `systemPrompt(opts: { style?: boolean } = {})`. It returns exactly today's lines, plus, only when `opts.style` is true, these lines appended at the end:
```ts
      "",
      "Style reels: the user message contains a style brief written for a full production team. Follow its structure, pacing and tone, but this renderer can only do: AI images, AI b-roll video, plain graphic backgrounds, up to 2 text overlays per scene, automatic voiceover captions, and transitions.",
      "Ignore requests for music, sound effects, split-screen, lip-sync, subtitle files or supplied assets, and never claim to provide them.",
      "Never invent quotes, numbers, results, certifications or testimonials that are not in the brief.",
      "Write labels and overlays in the reel's language: if the brief names a Hebrew label and the reel is English, use its English equivalent.",
```
   - Change `userPrompt(req)`:
     - When `req.style` is absent, keep the current output unchanged.
     - Otherwise replace the `Brief:` line with:
```ts
    "Style brief (follow its structure, pacing and tone):",
    req.style.brief,
    "",
    "Engine notes:",
    ...req.style.engineNotes.map((n) => `- ${n}`),
    "",
```
       then the existing language, length, stay-within, pacing and 400-character lines, then the mode line:
       - `req.style.script?.trim()` set: `"Exact script mode: the voiceover must be exactly the script below, split into scenes at natural pauses. Do not add, remove, reorder or change any word or punctuation mark. Only choose where each scene starts. Ignore the spoken-word target above; the script decides the length.\nScript:\n" + req.style.script`
       - otherwise: `"No script was provided: write the voiceover yourself following the style brief."`
   - Extend `Attempt` with `mismatch?: boolean`. In `attempt(result, req)`, after `buildStoryboard` succeeds:
```ts
  const exact = req.style?.script?.trim() ? req.style.script : undefined;
  if (exact) {
    const match = scriptMatches(exact, storyboard.scenes.map((s) => s.script));
    if (!match.ok) return { ok: false, error: match.diff, mismatch: true };
    const max = maxScenesFor(storyboard.targetDurationSec);
    return storyboard.scenes.length > max
      ? { ok: false, error: `Use at most ${max} scenes (you wrote ${storyboard.scenes.length}). Merge neighbouring scenes; keep every word.`, storyboard }
      : { ok: true, storyboard };
  }
```
     The existing `lengthIssues` path is unchanged for drafted and Custom reels. A mismatching attempt carries **no** storyboard, so it can never be returned as a fallback.
   - In `createPlanner`, use `systemPrompt({ style: Boolean(req.style) })`. After the second attempt:
```ts
      if (second.ok) return second.storyboard;
      const fallback = second.storyboard ?? firstAttempt.storyboard;
      if (fallback) return fallback;
      if (second.mismatch || firstAttempt.mismatch) throw new ScriptMismatchError(second.error);
      throw new Error(`Claude returned an invalid storyboard twice:\n${second.error}`);
```
     The "one sentence over 400 characters" test lands here: `buildStoryboard` is fine but the words mismatch twice, so the planner throws `ScriptMismatchError`.
   - Import `scriptMatches` from `@reel/core`.

- [ ] **Step 5: Verify.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS, with the existing planner tests unchanged.

- [ ] **Step 6: Commit** with message `feat(planner): style briefs with engine notes and exact-script mode`.

---

### Task 4: Worker wiring (style payload → planner)

**Files:**
- Modify: `apps/worker/package.json` (add `"@reel/styles": "*"`), `apps/worker/src/handlers/plan.ts`
- Test: `apps/worker/src/handlers/handlers.test.ts` (extend; it already holds the plan-handler tests and their fake `ReelDb`/planner helpers)

**Interfaces:**
- Consumes:
  - `PlanFormSchema.style` (Task 1)
  - `getStyle`, `checkStyleInput`, `fillTemplate` from `@reel/styles`, and `readPrompt` from `@reel/styles/load` (Task 2)
  - `PlanRequest.style` (Task 3)

- [ ] **Step 1: Write the failing tests.** Use the fake `ReelDb` and a recording planner already in `handlers.test.ts`. The helper names below (`jobWith`, `basePayload`, `sampleStoryboard`, `db.statuses`, `ctx`) are illustrative, so map them onto that file's existing helpers:
```ts
it("fills the style template and passes style to the planner", async () => {
  const calls: PlanRequest[] = [];
  const planner = { plan: async (r: PlanRequest) => { calls.push(r); return sampleStoryboard(); } };
  const handler = createPlanHandler({ planner, db, voices: { he: "v-he" }, voiceModelId: "eleven_v4" });
  await handler(jobWith({ ...basePayload, brief: "Myth vs Fact: שינה", style: { id: "myth-fact", values: { TOPIC: "שינה", MYTH: "8 שעות", FACT: "משתנה", EVIL: "x" }, script: "שלום עולם" } }), ctx);
  const s = calls[0].style!;
  expect(s.name).toBe("Myth vs Fact");
  expect(s.brief).toMatch(/Misconception: 8 שעות/);
  expect(s.brief).toMatch(/Exact Hebrew narration: שלום עולם/);
  expect(s.brief).not.toMatch(/\{\{/);
  expect(s.engineNotes.length).toBeGreaterThan(0);
  expect(s.script).toBe("שלום עולם");
});
it.each([["presenter"], ["no-such-style"]])("refuses style %s and marks the project failed", async (id) => {
  await expect(handler(jobWith({ ...basePayload, style: { id, values: { TOPIC: "t", MAIN_MESSAGE: "m" } } }), ctx)).rejects.toThrow(/not available/);
  expect(db.statuses.at(-1)).toBe("failed");
});
it("refuses a style payload missing a required field", async () => {
  await expect(handler(jobWith({ ...basePayload, style: { id: "myth-fact", values: { TOPIC: "t" } } }), ctx)).rejects.toThrow(/Misconception is required/);
});
it("passes no style for a payload without one (Custom, old jobs)", async () => {
  await handler(jobWith(basePayload), ctx);
  expect(calls[0].style).toBeUndefined();
  expect(calls[0].brief).toBe(basePayload.brief);
});
```
Run `npx vitest run apps/worker`. Expected: FAIL.

- [ ] **Step 2: Implement it** in `plan.ts`. After resolving `voiceId`:
```ts
      let style: PlanRequest["style"];
      if (form.style) {
        const def = getStyle(form.style.id);
        if (!def || def.status !== "available" || def.id === "custom") throw new Error(`Style "${form.style.id}" is not available`);
        const checked = checkStyleInput(def, form.style.values);
        if (checked.errors.length) throw new Error(`Style form is incomplete: ${checked.errors.join("; ")}`);
        const script = form.style.script?.trim() || undefined;
        const voiceDescription = form.voiceId ? `ElevenLabs voice ${form.voiceId}` : `the team ${form.language === "he" ? "Hebrew" : "English"} voice`;
        const brief = fillTemplate(readPrompt(def.id), def, {
          values: checked.values, script, language: form.language, durationSec: form.targetDurationSec,
          accentColor: form.palette[0], voiceDescription,
        });
        style = { name: def.name, brief, engineNotes: def.engineNotes, ...(script ? { script } : {}) };
      }
```
  - Pass `...(style ? { style } : {})` into `deps.planner.plan({...})`.
  - Import `PlanRequest` from `@reel/engine` (the barrel re-exports `providers/types`).
  - The existing `catch` already sets the project to `failed`.

- [ ] **Step 3: Verify.** Run `npm install && npx vitest run apps/worker packages && npm run typecheck`. Expected: PASS.

- [ ] **Step 4: Commit** with message `feat(worker): plan jobs with a style fill its template for the planner`.

---

### Task 5: Web picker, style form and action

**Files:**
- Modify:
  - `apps/web/package.json` (add `"@reel/styles": "*"`)
  - `apps/web/next.config.ts` (add `"@reel/styles"` to `transpilePackages`)
  - `apps/web/lib/create-reel.ts`
  - `apps/web/app/new/actions.ts`
  - `apps/web/app/new/page.tsx`
  - `apps/web/app/globals.css` (card grid)
- Create:
  - `apps/web/app/new/custom/page.tsx`
  - `apps/web/app/new/[styleId]/page.tsx`
  - `apps/web/app/new/[styleId]/style-reel-form.tsx`
  - `apps/web/app/new/[styleId]/actions.ts`
  - `apps/web/lib/style-form.ts`
  - `apps/web/lib/script-estimate.ts`
- Test: `apps/web/lib/style-form.test.ts`, `apps/web/lib/script-estimate.test.ts`, `apps/web/lib/create-reel.test.ts` (extend)

**Interfaces:**
- Consumes:
  - `STYLES`, `getStyle`, `checkStyleInput`, `styleTitle` (Task 2)
  - `PlanForm.style` (Task 1)
  - `estimateSceneSeconds`, `LENGTH_TOLERANCE` (core)
- Produces:
  - `parseStyleForm(styleId: string, fd: FormData): { ok: true; form: PlanForm; title: string } | { ok: false; errors: string[] }`
  - `describeScriptLength(script: string, language: "he" | "en", targetSec: number): { text: string; tooLong: boolean } | null`
  - `createReelFromForm(deps, form, opts?: { title?: string; styleId?: string })`
  - `insertProject(input: { title; language; styleId?: string })`

- [ ] **Step 1: Write the failing tests.**

`style-form.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseStyleForm } from "./style-form";

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ language: "he", targetDurationSec: "30", pacing: "punchy", captionPreset: "bold_pop", color1: "#ffe14d", color2: "#111111", ...entries })) f.set(k, v);
  return f;
};

describe("parseStyleForm", () => {
  it("builds a plan payload with style, brief summary and title", () => {
    const r = parseStyleForm("myth-fact", fd({ "field.TOPIC": "שינה", "field.MYTH": "8 שעות", "field.FACT": "משתנה", "field.EVIL": "x", script: " שלום " }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.form.style).toEqual({ id: "myth-fact", values: { TOPIC: "שינה", MYTH: "8 שעות", FACT: "משתנה" }, script: "שלום" });
    expect(r.form.brief).toBe("Myth vs Fact: שינה");
    expect(r.title).toBe("שינה");
  });
  it("omits an empty script", () => {
    const r = parseStyleForm("myth-fact", fd({ "field.TOPIC": "t", "field.MYTH": "m", "field.FACT": "f", script: "  " }));
    expect(r.ok && r.form.style?.script).toBeUndefined();
  });
  it("reports missing required fields", () => {
    const r = parseStyleForm("myth-fact", fd({ "field.TOPIC": "t" }));
    expect(r).toEqual({ ok: false, errors: ["Misconception is required", "Accurate explanation is required"] });
  });
  it.each(["presenter", "custom", "nope"])("refuses %s", (id) => {
    expect(parseStyleForm(id, fd({})).ok).toBe(false);
  });
});
```

`script-estimate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { describeScriptLength } from "./script-estimate";

describe("describeScriptLength", () => {
  it("is null for an empty script", () => expect(describeScriptLength("  ", "he", 30)).toBeNull());
  it("warns when the script is over the target", () => {
    const script = Array.from({ length: 90 }, () => "מילה").join(" ");
    expect(describeScriptLength(script, "he", 30)).toEqual({ text: "≈ 39 s of speech; longer than your 30 s target", tooLong: true });
  });
  it("shows the estimate when it fits", () => {
    expect(describeScriptLength("one two three four five", "en", 15)).toEqual({ text: "≈ 2 s of speech", tooLong: false });
  });
});
```
Add to `create-reel.test.ts`: when `opts` is given, `insertProject` receives `{ title: opts.title, language, styleId: opts.styleId }`, and without `opts` the call is unchanged (title taken from the brief).

Run `npx vitest run apps/web`. Expected: FAIL.

- [ ] **Step 2: Implement the pure helpers.**

`script-estimate.ts`:
```ts
import { estimateSceneSeconds, LENGTH_TOLERANCE } from "@reel/core";

export function describeScriptLength(script: string, language: "he" | "en", targetSec: number): { text: string; tooLong: boolean } | null {
  if (!script.trim()) return null;
  const raw = estimateSceneSeconds(script, language);
  const tooLong = raw > targetSec * LENGTH_TOLERANCE;
  const base = `≈ ${Math.round(raw)} s of speech`;
  return { text: tooLong ? `${base}; longer than your ${targetSec} s target` : base, tooLong };
}
```
If the test's expected seconds differ from what `estimateSceneSeconds` actually returns (it applies a 2 s floor and the words-per-second rates), fix the **test numbers** to match the real function and note it in the report. Don't change the function.

`style-form.ts`:
```ts
import { PlanFormSchema, type PlanForm } from "@reel/core";
import { checkStyleInput, getStyle, styleTitle } from "@reel/styles";

export function parseStyleForm(styleId: string, fd: FormData): { ok: true; form: PlanForm; title: string } | { ok: false; errors: string[] } {
  const def = getStyle(styleId);
  if (!def || def.status !== "available" || def.id === "custom") return { ok: false, errors: ["This style is not available."] };
  const str = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
  const raw = Object.fromEntries(def.fields.map((f) => [f.key, str(`field.${f.key}`)]));
  const { values, errors } = checkStyleInput(def, raw);
  if (errors.length) return { ok: false, errors };
  const script = str("script").trim();
  const title = styleTitle(def, values);
  const voiceId = str("voiceId").trim();
  const parsed = PlanFormSchema.safeParse({
    brief: Array.from(`${def.name}: ${title}`).slice(0, 2000).join(""),
    language: str("language"),
    targetDurationSec: Number(str("targetDurationSec")),
    pacing: str("pacing"),
    captionPreset: str("captionPreset"),
    palette: [str("color1"), str("color2")].filter(Boolean),
    ...(voiceId ? { voiceId } : {}),
    style: { id: def.id, values, ...(script ? { script } : {}) },
  });
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`) };
  return { ok: true, form: parsed.data, title };
}
```

`create-reel.ts`: add the optional third parameter `opts?: { title?: string; styleId?: string }`.
- The title is `opts?.title ?? <today's brief-derived title>`.
- `insertProject` gets `{ title, language, ...(opts?.styleId ? { styleId: opts.styleId } : {}) }`.
- Widen the `insertProject` input type accordingly.

- [ ] **Step 3: Build the pages.**
  - **`app/new/page.tsx`: the picker.** It keeps the existing auth check.
    - It renders `<h1>New reel</h1>` and `<p className="muted">Pick a style. Planning uses Claude only; nothing is generated until you approve.</p>`, then `<div className="style-grid">` with one card per entry in `STYLES`.
    - Available styles are `<Link className="card style-card" href={`/new/${s.id}`}>` containing `<strong>{s.name}</strong><span className="muted">{s.description}</span>`.
    - Coming-soon styles are a `<div className="card style-card disabled" aria-disabled="true">` with the name, the description and `<span className="badge">Coming soon</span><span className="muted">{s.comingSoonReason}</span>`.
    - Custom links to `/new/custom`.
  - **`app/new/custom/page.tsx`:** the old `app/new/page.tsx` body (auth check, `<h1>New reel: Custom</h1>`, `<NewReelForm />`), importing `NewReelForm` from `../new-reel-form`.
  - **`app/new/[styleId]/page.tsx`:** a server component.
    - It awaits `params`, runs the auth check, and calls `const def = getStyle(styleId)`.
    - `if (!def) notFound();`
    - `if (def.id === "custom") redirect("/new/custom");`
    - If the style is coming soon, render `<main className="stack"><h1>{def.name}</h1><p className="muted">Coming soon: {def.comingSoonReason}.</p><Link href="/new">Back to styles</Link></main>`.
    - Otherwise render `<h1>{def.name}</h1><p className="muted">{def.description}</p><StyleReelForm style={def} />`. `StyleDef` is plain data, so it is safe to pass to a client component.
  - **`app/new/[styleId]/actions.ts`:** `"use server"` and `createStyleReel(styleId: string, _prev: NewReelState, fd: FormData)`.
    - It calls `parseStyleForm`, runs the auth check, then `createReelFromForm` with the same deps as `app/new/actions.ts`.
    - Its `insertProject` inserts `{ title, language, format: "faceless", status: "planning", style_id: input.styleId ?? null }`.
    - It passes `{ title: parsed.title, styleId }` as `opts` and redirects to `/projects/<id>`.
    - Factor the Supabase deps object out of `app/new/actions.ts` into a shared `function reelDeps(supabase)` in `apps/web/lib/reel-deps.ts`, so both actions use one copy, and update `app/new/actions.ts` to use it (behaviour unchanged).
  - **`style-reel-form.tsx`:** `"use client"`.
    - It uses `useActionState(createStyleReel.bind(null, style.id), {})`.
    - For each field:
      - `line`: `<input name={`field.${f.key}`} dir="auto" maxLength={f.maxLength} required={f.required} />`
      - `text`: `<textarea … rows={3} />`
      - `select`: `<select name=… defaultValue={f.default}>{f.options.map(...)}</select>`
      - Each is inside `<label>{f.label}{f.required ? " *" : ""}</label>`.
    - When `style.scriptVar`, show a Script textarea (`name="script"`, `dir="auto"`, `maxLength={5000}`, `rows={6}`) with the hint `<span className="muted">Leave empty and the agent drafts one for you to review. If you paste a script, it is used word for word.</span>`.
      - Under it, the live estimate: track `script`, `language` and `target` in state (`onChange` on the script, language and length controls), and render `describeScriptLength(...)` as `<span className={v.tooLong ? "warn" : "muted"}>{v.text}</span>` when it isn't null.
    - The shared settings row is the same markup as `new-reel-form.tsx`: language, length (`defaultValue={String(style.defaultDurationSec)}`), pacing, captions, accent, background, voice ID.
    - The errors list and submit button are as in `new-reel-form.tsx`, and the button reads "Create storyboard".
  - **`globals.css`:**
```css
.style-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; }
.style-card { display: flex; flex-direction: column; gap: 0.4rem; text-decoration: none; color: inherit; }
.style-card.disabled { opacity: 0.55; cursor: not-allowed; }
```

- [ ] **Step 4: Verify.** Run `npm install && npx vitest run apps/web && npm run typecheck && npm run build -w @reel/web`. Expected: PASS. The build must list the routes `/new`, `/new/custom` and `/new/[styleId]`.

- [ ] **Step 5: Commit** with message `feat(web): style picker, per-style forms with live script estimate, style reels saved with style_id`.

---

### Task 6: SRT subtitles

**Files:**
- Create: `packages/video/src/srt.ts`
- Modify:
  - `packages/video/package.json` (exports `"./srt": "./src/srt.ts"`)
  - `packages/engine/src/pipeline.ts` (`RenderOutputs.srt`; write `reel.srt`)
  - `packages/db/src/index.ts` (`renderPaths` adds `srt`)
  - `apps/worker/src/reel-db.ts` (`insertRender` `paths.srt` → `srt_path`)
  - `apps/worker/src/handlers/generate.ts` (upload the srt)
  - `apps/web/lib/render-urls.ts` (`srtUrl?`)
  - `apps/web/components/ReelPreview.tsx`
  - `apps/web/app/projects/[id]/page.tsx`
- Test: `packages/video/src/srt.test.ts`, `apps/web/lib/render-urls.test.ts` (extend), `packages/db/src/index.test.ts` (extend `renderPaths`), plus the existing generate-handler test (extend)

**Interfaces:**
- Produces:
  - `buildSrt(words: Word[]): string`
  - `RenderOutputs.srt: string` (file path)
  - `renderPaths(...).srt = "<project>/v<N>/reel.srt"`
  - `SignedRender.srtUrl?: string`

- [ ] **Step 1: Write the failing test** `srt.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildSrt, formatSrtTime } from "./srt";

const w = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });

describe("buildSrt", () => {
  it("formats timestamps", () => {
    expect(formatSrtTime(3_723_004)).toBe("01:02:03,004");
  });
  it("numbers cues from 1 and ends each cue at the next page start", () => {
    const srt = buildSrt([w("שלום", 0, 400), w("עולם", 450, 800), w("מה", 2000, 2300), w("נשמע", 2350, 2800)]);
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:02,000\nשלום עולם\n\n2\n00:00:02,000 --> 00:00:02,800\nמה נשמע\n");
  });
  it("splits a long cue into two lines at the space nearest the middle", () => {
    const words = "this caption page is definitely longer than forty two characters".split(" ").map((t, i) => w(t, i * 50, i * 50 + 40));
    const text = buildSrt(words).split("\n").slice(2, 4);
    expect(text).toHaveLength(2);
    expect(text.join(" ")).toBe("this caption page is definitely longer than forty two characters");
  });
  it("returns an empty string for no words", () => expect(buildSrt([])).toBe(""));
});
```
The expected page grouping follows `createTikTokStyleCaptions` with `COMBINE_MS = 900`. If the library groups the first test's words differently, derive the expected cues by calling `createTikTokStyleCaptions` in the test for the page boundaries, and keep the timestamp and format assertions. Record this in the report.

Run `npx vitest run packages/video/src/srt.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `srt.ts`.**
```ts
import type { Word } from "@reel/core";
import { createTikTokStyleCaptions } from "@remotion/captions";
import { COMBINE_MS, wordsToCaptions } from "./Captions";

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export function formatSrtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor(t / 60_000) % 60)}:${pad(Math.floor(t / 1000) % 60)},${pad(t % 1000, 3)}`;
}

function twoLines(text: string): string {
  if (text.length <= 42) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/** Subtitle cues that match the burned-in caption pages exactly (same grouping and timing as Captions.tsx). */
export function buildSrt(words: Word[]): string {
  if (!words.length) return "";
  const { pages } = createTikTokStyleCaptions({ captions: wordsToCaptions(words), combineTokensWithinMilliseconds: COMBINE_MS });
  return pages
    .map((page, i) => {
      const end = pages[i + 1]?.startMs ?? page.startMs + page.durationMs;
      const text = page.tokens.map((t) => t.text.trim()).filter(Boolean).join(" ");
      return `${i + 1}\n${formatSrtTime(page.startMs)} --> ${formatSrtTime(end)}\n${twoLines(text)}\n`;
    })
    .join("\n");
}
```
Add `"./srt": "./src/srt.ts"` to the `@reel/video` exports.

- [ ] **Step 3: Wire it through.**
  - **`pipeline.ts`:**
    - Add `srt: string` to `RenderOutputs`.
    - In `renderAndExport`, after the thumbnail: `const srt = join(outDir, "reel.srt"); await writeFile(srt, buildSrt(timeline.captions.words));`, then include `srt` in the return.
    - Import `buildSrt` from `@reel/video/srt`.
    - The CLI writes into the same `outDir`, so it now produces `reel.srt` too.
  - **`db/src/index.ts`:** add `srt: `${base}/reel.srt`` to `renderPaths`, and extend its test.
  - **`reel-db.ts`:** add `srt: string` to `insertRender`'s `paths` type, and insert `srt_path: input.paths.srt`.
  - **`generate.ts`:** after the thumbnail upload, add `await deps.blobs.upload(BUCKETS.renders, paths.srt, out.srt, "application/x-subrip");`. `blobs.upload` takes a file path, like the other uploads. Extend the generate-handler test: `blobs` received `reel.srt`, and `insertRender` got `paths.srt`.
  - **`render-urls.ts`:**
    - Widen the `render` param with `srt_path?: string | null`.
    - When it is set, also sign `client.createSignedUrl(BUCKETS.renders, render.srt_path, SIGNED_URL_TTL_SECONDS, "reel.srt")`.
    - `SignedRender` gets `srtUrl?: string`.
    - Tests: with `srt_path`, `srtUrl` is set; without it (old renders), `srtUrl` is undefined and nothing is signed for it.
  - **`ReelPreview.tsx`:** accept `srtUrl?: string`. Next to the MP4 button, render `{srtUrl && <a className="button" href={srtUrl}>Download subtitles (.srt)</a>}`.
  - **`projects/[id]/page.tsx`:** pass `srtUrl={signed.srtUrl}`.
  - A render that already exists without an SRT stays as it is, with no backfill.

- [ ] **Step 4: Verify.** Run `npm test && npm run typecheck && npm run build -w @reel/web`. Expected: PASS.

- [ ] **Step 5: Commit** with message `feat: SRT subtitles matching the burned-in captions, stored with each render and downloadable`.

---

## After the tasks (controller)

1. **Final whole-branch review** (most capable model), then one fix wave.
2. **Migration.** Show the user `supabase/migrations/20261001120000_reel_styles.sql`. After their OK, apply it to project `aawjjdxneashqatwaxrt` (Supabase MCP `apply_migration`) and confirm that the regenerated types match the hand edits from Task 1. The web app must not be restarted on the new code before this, because inserting `style_id` would fail.
3. **Fake worker end to end:** one style with a script and one without, checking that the storyboard is created and the SRT is produced.
4. **With the user's go-ahead:** one real Claude planning run per mode (a few cents).
5. **Merge, then restart the worker and web.**
