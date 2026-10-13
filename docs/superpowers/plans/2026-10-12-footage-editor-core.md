# Footage Editor, Plan 1: Core Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user uploads a 1–3 minute Hebrew (or English) talking-head video. The app transcribes it, finds the face, has Claude plan the edit (beats, hook, ending, music, sound effects), lets the user review and approve the plan, then renders a 9:16 reel with jump cuts, punch-in zooms, white-pill captions, a hook headline, a pattern break, a CTA or loop ending, music and sound effects.

**Architecture:**
- `@reel/core` (pure, browser-safe) gets the footage settings and upload checks, the transcript / face-track / `EditPlan` schemas, beat splitting, and the deterministic edit compiler `compileFootage`, which turns an approved plan into the existing `Timeline` (with new optional fields, so voice reels are untouched).
- `@reel/media` gets audio cutting, music fitting, file hashing and a wrapper around a new Swift CLI, `tools/face-helper`, which runs Apple Vision face detection.
- `@reel/engine` gets the Scribe and ElevenLabs Music providers (plus fakes), the footage planner (Claude, structured output, one repair round), `ingestFootage` and `generateFootageAssets` / `renderFootage`.
- `@reel/video` gets one `houseStyle` config and the Remotion components `SpeakerShot`, `PillCaptions`, `HookHeadline`, `PatternBreak`, `CtaCard` and sound-effect cues.
- The worker gets three job handlers: `ingest_footage` (which also plans, see "Decisions"), `plan_footage` (Re-plan) and `generate_footage`.
- The web app gets the "Edit my video" card and resumable upload form, the footage review page, and a team music settings page.

**Tech Stack:** existing monorepo: TypeScript 7, zod 4, Vitest 5, Next.js 16 (Turbopack), Supabase (`@supabase/supabase-js` 2.117.2), Remotion 4.0.531, `@elevenlabs/elevenlabs-js` 2.70.0, `@anthropic-ai/sdk` 0.129, FFmpeg 8, Swift 6.4 (Apple Vision). New: `tus-js-client` 4.3.1 (web only).

**Spec:** `docs/superpowers/specs/2026-10-12-footage-editor-design.md` (§2 row "1. Core edit"). Numbers marked *(ref)* come from `docs/superpowers/specs/2026-10-12-footage-editor/reference-style-report.md`.

## Global Constraints

- **Scope:** plan 1 only. `cutaway`, `background.mode: "replace"` and `patternBreak: "broll"` exist in the `EditPlan` schema shape but are rejected by `parseEditPlan` with these exact messages:
  - `Beat <id> has a cutaway. Cutaways arrive in a later update: remove it.`
  - `Background replacement arrives in a later update: keep the original background.`
  - `The B-roll pattern break needs cutaways, which arrive in a later update: pick zoom hit, flash or none.`
  - Claude's draft schema and the review UI never offer them.
- **Upload:** MP4 or MOV only, at most 2 GB (`2 * 1024 ** 3` bytes), at most 3:00 (180 s; ingest allows 180.5 s for container rounding). Browser uploads directly with TUS into bucket `assets` at `footage/<projectId>/source.<ext>`. The Next.js server only creates the project and records the finished upload. A project stays `uploading` until recorded; an `uploading` project older than 1 hour shows `Upload incomplete: upload again`.
- **Target lengths:** 15, 30, 45, 60 or 90 s (90 is footage-only).
- **Working copy:** `conformVideo(original, working, { keepAudio: true })`: 1080×1920, 30 fps CFR, H.264, SAR 1, rotation applied by FFmpeg. The original stays in storage.
- **Transcription:** ElevenLabs Scribe `scribe_v2`, word timestamps, `tagAudioEvents: true`, no `languageCode` (so the language is detected). Fewer than 5 words fails ingest with `No speech found. This editor needs a video of you talking.`
- **Face track:** Vision `VNDetectFaceRectanglesRequest` on every 3rd frame of the working copy, largest face, normalised top-left coordinates. A 5-sample moving average; gaps up to 1000 ms are interpolated, longer gaps stay "no face".
- **Beats:** split after sentence-ending punctuation (`. ! ? … ׃`) and at pauses ≥ 600 ms; a beat over 10 s splits at its longest internal pause; a beat under 1.2 s merges with its closer neighbour.
- **Compiler (`houseStyle.edit`):** cut every gap ≥ 150 ms, pad each span 50 ms; filler words removed and always cut around; zoom steps 1.0 → 1.15 → 1.25 repeating, centred on the face at the shot's midpoint and clamped so the face is never cut off (no face: centred); shots over 2 s push in ×1.08; captions ≤ 3 words and ≤ 22 visible characters per page (combining marks such as niqqud not counted), breaking at punctuation first, never across beats; headline 0–2 s, word by word, one word every 6 frames; `zoom_hit` 1.0 → 1.3 over 6 frames; `flash` 2 white frames; CTA card 2.5 s; voice −14 LUFS; music 12 dB under the voice; frame rate 30.
- **Look (`houseStyle`):** pill captions are black Heebo 800 in a white rounded pill, centred at y = 45 %, emphasis `#E5262A`, each page pops 90 % → 100 % over 4 frames, rendered above every other layer. Headline: small white line then huge yellow `#FEE80A` word(s). CTA: Hebrew `תכתבו '<KEYWORD>' בתגובות`, English `Comment '<KEYWORD>'`.
- **Sound effects:** names `whoosh1, whoosh2, pop1, pop2, tick, riser, ding, swoosh_out`, committed under `packages/video/assets/sfx/<name>.mp3`. They are generated once by `npm run sfx:generate -- --yes`, a **paid** call that no task runs; the controller runs it only after the user's explicit OK. Tests and the fake worker use generated placeholder tones.
- **Money:** nothing is generated before approval (Scribe and Claude run during ingest/planning, as Claude planning already does today). `estimate.credits` is in USD from `DEFAULT_COST_TABLE`. AI music is skipped (with a note) if it would exceed the approved estimate. A failed paid element never fails the reel: it is skipped and listed.
- **Cache keys** include the provider model id (`fake/scribe` vs `elevenlabs/scribe_v2`, `fake/music` vs `elevenlabs/music`), so fake-worker data can never be reused by the real worker through the shared Supabase asset index.
- **Existing formats** (faceless, Custom, styles, SRT) behave byte for byte as before. `Timeline` additions are all optional.
- **Migration:** `supabase/migrations/20261012150000_footage_editor.sql`, applied to the hosted project only by the controller after the user approves. Tasks hand-edit `packages/db/src/database.types.ts`.
- **Safety:** no paid API calls in any task (Claude, Scribe, ElevenLabs, Higgsfield); all tests use fakes. Never read `.env.local`.
- **Commits:** every commit message ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Fake-worker data reaching a real reel.** The fake worker writes transcripts, face tracks and music into the same Supabase asset index the real worker reads. A real worker must never reuse a fake transcript, and must refuse to generate a plan built on one, before any spend. Pinned in Tasks 11 and 12.
2. **A slow 2 GB upload that outlives the 1-hour access token, or a dropped connection mid-upload.** The upload must keep authenticating (fresh token on every request) and resume where it stopped; only a closed tab ends in "Upload incomplete". Pinned in Task 13.
3. **Nothing left to show:** every kept beat is only fillers, or the user unticks every beat. Compile, the planner and Approve must refuse with a plain message, never render a 0-frame reel. Pinned in Tasks 5, 10 and 14.
4. **Real phone footage:** landscape, rotated, variable-frame-rate, no audio track, over 3:00 by a few seconds. Ingest must produce a 1080×1920 30 fps working copy or fail with the plain message for that case. Pinned in Task 11.
5. **Endings at the edge of the source:** the speaker talks until the very last frame with a CTA ending, or keeps talking in a dropped beat right after the last kept word; and a library track shorter than the reel. The CTA must never show unrelated speech or run past the source, and short music must loop. Pinned in Tasks 4 and 6.

## Prerequisites (the user, before or during execution)

- **Supabase storage limit:** in the dashboard, Storage → Settings, raise the global upload file size limit from 50 MB to 2 GB (Pro plan). Not a task; the controller reminds the user before the browser check.
- **Swift toolchain on the worker Mac:** `swift --version` must work (Xcode or the command line tools). Checked in Task 8.
- **Speech + face fixture (optional for most tests):** a ≤ 10 s, small (≤ 5 MB) Hebrew talking-head clip from the user at `packages/media/fixtures/talking-head-he.mp4`. It is committed only with the user's OK. Only the face-helper fixture test and the ingest integration test need it; they skip with a clear message when it is absent. Do not invent or download a clip.

## File map

| Area | Files |
|---|---|
| DB | `supabase/migrations/20261012150000_footage_editor.sql`, `packages/db/src/database.types.ts`, `packages/db/src/index.ts` |
| Core | `packages/core/src/footage-form.ts`, `schema/footage.ts`, `schema/edit-plan.ts`, `schema/timeline.ts`, `beats.ts`, `footage/style.ts`, `footage/face-track.ts`, `footage/shots.ts`, `footage/captions.ts`, `footage/compile.ts`, `cost.ts`, `models.ts`, `events.ts`, `timeline-sources.ts`, `testing/fixtures.ts`, `index.ts` |
| Media | `packages/media/src/footage.ts`, `face.ts`, `testing.ts` |
| Face helper | `tools/face-helper/Package.swift`, `tools/face-helper/Sources/face-helper/main.swift` |
| Video | `packages/video/src/house-style.ts`, `sfx.ts`, `footage/motion.ts`, `footage/SpeakerShot.tsx`, `footage/PillCaptions.tsx`, `footage/HookHeadline.tsx`, `footage/PatternBreak.tsx`, `footage/CtaCard.tsx`, `footage/SfxCues.tsx`, `sample-footage.ts`, `Reel.tsx`, `srt.ts` |
| Engine | `providers/types.ts`, `providers/elevenlabs.ts`, `providers/fake.ts`, `providers/index.ts`, `footage-planner.ts`, `face-tracker.ts`, `footage-ingest.ts`, `footage-generate.ts`, `pipeline.ts`, `asset-store.ts`, `download.ts`, `scripts/generate-sfx.ts` |
| Worker | `handlers/footage.ts`, `handlers/generate-footage.ts`, `handlers/index.ts`, `reel-db.ts`, `storage.ts`, `testing/fakes.ts`, `main.ts`, `loop.test.ts` |
| Web | `lib/footage-upload.ts`, `lib/create-footage.ts`, `lib/footage-form.ts`, `lib/edit-plan-edit.ts`, `lib/approve-plan.ts`, `lib/transcript.ts`, `lib/music-form.ts`, `lib/progress-view.ts`, `lib/retry-visibility.ts`, `app/new/page.tsx`, `app/new/footage/*`, `app/projects/[id]/*`, `app/settings/music/*`, `components/FootagePlanEditor.tsx`, `components/JobPanel.tsx`, `app/page.tsx`, `app/layout.tsx` |

---

### Task 1: Migration, DB types, footage settings and upload checks

**Files:**
- Create: `supabase/migrations/20261012150000_footage_editor.sql`, `packages/core/src/footage-form.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/events.ts`, `packages/db/src/index.ts`, `packages/db/src/database.types.ts`
- Test: `packages/core/src/footage-form.test.ts` (new), `packages/db/src/index.test.ts` (extend)

**Interfaces:**
- Produces (core):
  - `FOOTAGE_MAX_BYTES`, `FOOTAGE_MAX_SEC = 180`, `FOOTAGE_MAX_SEC_INGEST = 180.5`, `FOOTAGE_PATH_RE`
  - `FootageTargetSchema` (15 | 30 | 45 | 60 | 90), `FootageSettingsSchema`, type `FootageSettings = { language; targetDurationSec; ctaKeyword?; notes? }`
  - `type FootageExt = "mp4" | "mov"`, `footageExt(fileName): FootageExt | null`, `footageStoragePath(projectId, ext): string`, `formatMinSec(sec): string`
  - `checkFootageFile(file: { name: string; size: number; durationSec: number | null }): string[]`
  - `PipelineStep` gains `"conform" | "transcribe" | "faces" | "plan" | "music"`; `PipelineEvent` gains `{ type: "note"; message: string }`
- Produces (db):
  - `ProjectStatus` gains `"uploading"`
  - `IngestFootageJobPayloadSchema = { storagePath, settings }`, type `IngestFootagePayload`
  - `JobProgressSchema.steps` accepts the new step names; `JobProgress.notes?: string[]`; `applyPipelineEvent` appends notes
  - DB types gain table `team_music`

- [ ] **Step 1: Write the failing core test** `packages/core/src/footage-form.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { checkFootageFile, footageExt, footageStoragePath, FootageSettingsSchema, FOOTAGE_PATH_RE, formatMinSec } from "./footage-form";

describe("checkFootageFile", () => {
  const ok = { name: "talk.MOV", size: 50_000_000, durationSec: 95 };
  it("accepts an MP4 or MOV under the limits", () => {
    expect(checkFootageFile(ok)).toEqual([]);
    expect(checkFootageFile({ ...ok, name: "a.mp4" })).toEqual([]);
  });
  it("rejects other types, empty and oversized files, and videos over 3:00", () => {
    expect(checkFootageFile({ ...ok, name: "talk.avi" })).toEqual(["Upload an MP4 or MOV video."]);
    expect(checkFootageFile({ ...ok, size: 0 })).toEqual(["This file is empty."]);
    expect(checkFootageFile({ ...ok, size: 2 * 1024 ** 3 + 1 })).toEqual(["This video is over 2 GB. Trim or compress it first."]);
    expect(checkFootageFile({ ...ok, durationSec: 192.4 })).toEqual(["This video is 3:12 long. Trim it to 3:00 or less."]);
  });
  it("allows exactly 3:00 and 2 GB, and skips the length check when the browser can't read it", () => {
    expect(checkFootageFile({ ...ok, size: 2 * 1024 ** 3, durationSec: 180 })).toEqual([]);
    expect(checkFootageFile({ ...ok, durationSec: null })).toEqual([]);
  });
});

describe("footage paths and settings", () => {
  it("builds and recognises the storage path", () => {
    const id = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
    expect(footageStoragePath(id, "mov")).toBe(`footage/${id}/source.mov`);
    expect(FOOTAGE_PATH_RE.test(footageStoragePath(id, "mp4"))).toBe(true);
    expect(FOOTAGE_PATH_RE.test(`footage/${id}/../x.mp4`)).toBe(false);
    expect(footageExt("A.Mp4")).toBe("mp4");
    expect(footageExt("noext")).toBeNull();
  });
  it("accepts 90 s targets and trims optional text", () => {
    const s = FootageSettingsSchema.parse({ language: "he", targetDurationSec: 90, ctaKeyword: " AI ", notes: " קצר " });
    expect(s).toEqual({ language: "he", targetDurationSec: 90, ctaKeyword: "AI", notes: "קצר" });
    expect(() => FootageSettingsSchema.parse({ language: "he", targetDurationSec: 20 })).toThrow();
    expect(() => FootageSettingsSchema.parse({ language: "he", targetDurationSec: 30, ctaKeyword: "x".repeat(31) })).toThrow();
  });
  it("formats minutes and seconds", () => {
    expect(formatMinSec(59.9)).toBe("0:59");
    expect(formatMinSec(181)).toBe("3:01");
  });
});
```
Run `npx vitest run packages/core/src/footage-form.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 2: Implement** `packages/core/src/footage-form.ts` and append `export * from "./footage-form";` to `packages/core/src/index.ts`:
```ts
import * as z from "zod";
import { LanguageSchema } from "./schema/storyboard";

export const FOOTAGE_MAX_BYTES = 2 * 1024 ** 3;
export const FOOTAGE_MAX_SEC = 180;
/** Ingest allows half a second more than the browser check: containers round durations differently. */
export const FOOTAGE_MAX_SEC_INGEST = 180.5;
export const FOOTAGE_PATH_RE = /^footage\/[0-9a-f-]{36}\/source\.(mp4|mov)$/;

export type FootageExt = "mp4" | "mov";
export const FootageTargetSchema = z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(90)]);

/** The "Edit my video" form. It travels in the ingest and plan job payloads. */
export const FootageSettingsSchema = z.object({
  language: LanguageSchema,
  targetDurationSec: FootageTargetSchema,
  ctaKeyword: z.string().trim().min(1).max(30).optional(),
  notes: z.string().trim().min(1).max(2000).optional(),
});
export type FootageSettings = z.infer<typeof FootageSettingsSchema>;

export function footageExt(fileName: string): FootageExt | null {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return ext === "mp4" || ext === "mov" ? ext : null;
}

export const footageStoragePath = (projectId: string, ext: FootageExt) => `footage/${projectId}/source.${ext}`;

export const formatMinSec = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Browser checks before upload. durationSec is null when the browser can't read it; ingest checks again. */
export function checkFootageFile(file: { name: string; size: number; durationSec: number | null }): string[] {
  const errors: string[] = [];
  if (!footageExt(file.name)) errors.push("Upload an MP4 or MOV video.");
  if (file.size === 0) errors.push("This file is empty.");
  if (file.size > FOOTAGE_MAX_BYTES) errors.push("This video is over 2 GB. Trim or compress it first.");
  if (file.durationSec !== null && file.durationSec > FOOTAGE_MAX_SEC) {
    errors.push(`This video is ${formatMinSec(file.durationSec)} long. Trim it to 3:00 or less.`);
  }
  return errors;
}
```

- [ ] **Step 3: Extend events** in `packages/core/src/events.ts`:
```ts
export type PipelineStep = "voice" | "visuals" | "render" | "export" | "conform" | "transcribe" | "faces" | "plan" | "music";

/** Progress events emitted by the engine pipeline; the worker folds them into the job's progress JSON. */
export type PipelineEvent =
  | { type: "step"; step: PipelineStep; status: "running" | "done" }
  | { type: "scene"; sceneId: string; status: "running" | "done" | "failed"; reason?: string }
  | { type: "render-progress"; progress: number }
  | { type: "note"; message: string };
```

- [ ] **Step 4: Write the failing db test.** Add to `packages/db/src/index.test.ts` (it already imports from `./index`; add the new names to that import):
```ts
describe("footage payloads and progress", () => {
  it("validates the ingest payload path", () => {
    const settings = { language: "he", targetDurationSec: 30 };
    const id = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
    expect(IngestFootageJobPayloadSchema.parse({ storagePath: `footage/${id}/source.mp4`, settings }).storagePath).toContain(id);
    expect(() => IngestFootageJobPayloadSchema.parse({ storagePath: "footage/x/source.mp4", settings })).toThrow();
  });
  it("accepts footage steps and appends notes", () => {
    let p = applyPipelineEvent(emptyProgress(), { type: "step", step: "transcribe", status: "running" });
    p = applyPipelineEvent(p, { type: "note", message: "AI music failed twice" });
    p = applyPipelineEvent(p, { type: "note", message: "No sound effects" });
    expect(JobProgressSchema.parse(p)).toEqual({ steps: { transcribe: "running" }, scenes: {}, notes: ["AI music failed twice", "No sound effects"] });
  });
});
```
Run `npx vitest run packages/db`. Expected: FAIL.

- [ ] **Step 5: Implement db changes** in `packages/db/src/index.ts`:
  - Import `FOOTAGE_PATH_RE, FootageSettingsSchema` from `@reel/core`.
  - `export type ProjectStatus = "uploading" | "planning" | "draft" | "generating" | "needs_attention" | "rendered" | "failed";`
  - Add:
```ts
export const IngestFootageJobPayloadSchema = z.object({ storagePath: z.string().regex(FOOTAGE_PATH_RE), settings: FootageSettingsSchema });
export type IngestFootagePayload = z.infer<typeof IngestFootageJobPayloadSchema>;
```
  - In `JobProgressSchema`: change the steps enum to `z.enum(["voice", "visuals", "render", "export", "conform", "transcribe", "faces", "plan", "music"])` and add `notes: z.array(z.string()).optional(),`. Leave `emptyProgress()` unchanged (no `notes` key), so existing progress values compare equal as before.
  - In `applyPipelineEvent` add `case "note": return { ...progress, notes: [...(progress.notes ?? []), event.message] };`
  - Do **not** change `JobType` here; Tasks 11 and 12 extend it together with the handlers (the worker's `Handlers` type is `Record<JobType, JobHandler>`).

- [ ] **Step 6: Write the migration** `supabase/migrations/20261012150000_footage_editor.sql`:
```sql
-- Footage editor, plan 1: the user's own video upload, three footage job types, JSON data assets and the team music library.

-- A footage reel waits in 'uploading' until the web app records the finished upload.
alter table public.projects drop constraint projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('uploading', 'planning', 'draft', 'generating', 'needs_attention', 'rendered', 'failed'));

alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('plan', 'generate', 'ingest_footage', 'plan_footage', 'generate_footage'));

-- 'data' assets hold the transcript and face-track JSON.
alter table public.assets drop constraint assets_kind_check;
alter table public.assets add constraint assets_kind_check check (kind in ('image', 'video', 'audio', 'data'));

-- Team music library: tracks uploaded on the settings page, picked by mood.
create table public.team_music (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique check (storage_path ~ '^music/[0-9a-f-]{36}\.(mp3|wav|m4a|aac)$'),
  title text not null check (char_length(title) between 1 and 80),
  mood text not null check (mood in ('calm', 'upbeat', 'dramatic')),
  duration_sec numeric not null check (duration_sec > 0 and duration_sec <= 900),
  created_by uuid not null default auth.uid() references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index team_music_created_by_idx on public.team_music (created_by);
alter table public.team_music enable row level security;
create policy "team reads music" on public.team_music for select to authenticated using (true);
create policy "members add music" on public.team_music for insert to authenticated
  with check (created_by = (select auth.uid()));
revoke update, delete on public.team_music from authenticated;
revoke all on public.team_music from anon;

-- Storage: the owner of an 'uploading' footage project may upload (and resume or replace) its source video.
create policy "owners upload footage" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assets'
    and name ~ '^footage/[0-9a-f-]{36}/source\.(mp4|mov)$'
    and exists (
      select 1 from public.projects p
       where p.id::text = split_part(name, '/', 2)
         and p.owner_id = (select auth.uid())
         and p.status = 'uploading'));
create policy "owners replace footage" on storage.objects for update to authenticated
  using (
    bucket_id = 'assets'
    and name ~ '^footage/[0-9a-f-]{36}/source\.(mp4|mov)$'
    and exists (
      select 1 from public.projects p
       where p.id::text = split_part(name, '/', 2)
         and p.owner_id = (select auth.uid())
         and p.status = 'uploading'))
  with check (
    bucket_id = 'assets'
    and name ~ '^footage/[0-9a-f-]{36}/source\.(mp4|mov)$');
-- Signed-in members may add music tracks.
create policy "members upload music" on storage.objects for insert to authenticated
  with check (bucket_id = 'assets' and name ~ '^music/[0-9a-f-]{36}\.(mp3|wav|m4a|aac)$');
```
The existing policy "team reads reel media" already lets signed-in users read the `assets` bucket. The worker writes assets at the bucket root with the secret key, which bypasses these policies.

- [ ] **Step 7: Hand-edit `packages/db/src/database.types.ts`.** Add a `team_music` table after `storyboards`, keeping the generated file's alphabetical table order (`assets, jobs, projects, renders, storyboards, team_music`):
```ts
      team_music: {
        Row: {
          created_at: string
          created_by: string
          duration_sec: number
          id: string
          mood: string
          storage_path: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          duration_sec: number
          id?: string
          mood: string
          storage_path: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string
          duration_sec?: number
          id?: string
          mood?: string
          storage_path?: string
          title?: string
        }
        Relationships: []
      }
```
Columns stay plain `string` (the generated file doesn't encode check constraints).

- [ ] **Step 8: Verify.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS.

- [ ] **Step 9: Commit** with message `feat(footage): migration, footage settings and upload checks, footage progress steps and notes` (plus the trailer from Global Constraints).

---

### Task 2: Transcript, face-track and EditPlan schemas

**Files:**
- Create: `packages/core/src/schema/footage.ts`, `packages/core/src/schema/edit-plan.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/testing/fixtures.ts`, `packages/db/src/index.ts`
- Test: `packages/core/src/schema/edit-plan.test.ts` (new), `packages/db/src/index.test.ts` (extend)

**Interfaces:**
- Consumes: `FootageSettingsSchema`, `FootageTargetSchema` (Task 1).
- Produces (core):
  - `TranscriptSchema`, `type Transcript = { languageCode: string; languageProbability: number; words: (Word & { logprob?: number })[]; events: Word[] }`
  - `FaceBoxSchema`, `type FaceBox = { x; y; w; h }` (normalised, top-left origin)
  - `RawFaceTrackSchema`, `type RawFaceTrack = { width; height; fps; sampleEvery; samples: { tMs: number; box: FaceBox | null }[] }`
  - `FaceTrackSchema`, `type FaceTrack = { intervalMs: number; samples: { tMs: number; box: FaceBox | null }[] }`
  - `FootageSourceSchema`, `type FootageSource = { assetId; durationMs; transcriptAssetId; faceTrackAssetId }` (asset ids are 64-hex asset-store hashes)
  - `BEAT_ID_RE`, `SfxLevelSchema`, `MusicMoodSchema`, `type MusicMood`, `PatternBreakSchema`, `BeatSchema`, `type Beat`, `EditPlanSchema`, `type EditPlan`
  - `NOT_IN_PLAN_ONE` messages, `planOneIssues(plan: EditPlan): string[]`, `parseEditPlan(input: unknown): EditPlan` (throws `Invalid edit plan:\n  - path: message` lines)
  - `EditPlanDraftSchema`, `type EditPlanDraft`
  - fixtures: `footageTranscript(): Transcript`, `validEditPlan(): EditPlan` (plain object), `HASH_A`, `HASH_B`, `HASH_C`
- Produces (db): `PlanFootageJobPayloadSchema = { settings, source, fromStoryboardId?: uuid, instruction?: string (≤ 500) }`, type `PlanFootagePayload`.

- [ ] **Step 1: Add fixtures** to `packages/core/src/testing/fixtures.ts`. Every later task's tests use these, so keep the numbers exactly:
```ts
import type { Transcript } from "../schema/footage";

export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);
export const HASH_C = "c".repeat(64);

const tw = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs, logprob: -0.05 });

/** 15 Hebrew words over a 9 s source: a filler at idx 2, sentence ends at idx 7, 11 and 14, pauses of 700 ms and 650 ms. */
export const footageTranscript = (): Transcript => ({
  languageCode: "heb",
  languageProbability: 0.98,
  words: [
    tw("היי", 0, 300), tw("חברים,", 350, 800), tw("אממ", 1000, 1300), tw("היום", 1500, 1900),
    tw("אני", 1950, 2200), tw("אראה", 2250, 2700), tw("לכם", 2750, 3000), tw("טריק.", 3050, 3500),
    tw("זה", 4200, 4400), tw("חוסך", 4450, 4900), tw("שעות", 4950, 5400), tw("עבודה.", 5450, 6000),
    tw("תכתבו", 6650, 7100), tw("AI", 7150, 7500), tw("בתגובות.", 7550, 8200),
  ],
  events: [],
});

export const validEditPlan = () => ({
  format: "footage" as const,
  version: 1,
  title: "טריק שחוסך שעות",
  language: "he" as const,
  targetDurationSec: 15 as const,
  source: { assetId: HASH_A, durationMs: 9000, transcriptAssetId: HASH_B, faceTrackAssetId: HASH_C },
  beats: [
    { id: "b1", startWordIdx: 0, endWordIdx: 7, keep: true, emphasisWordIdx: 7 },
    { id: "b2", startWordIdx: 8, endWordIdx: 11, keep: true, emoji: "👇" },
    { id: "b3", startWordIdx: 12, endWordIdx: 14, keep: true },
  ],
  hook: { headline: { small: "הטריק ש", big: "חוסך שעות" }, patternBreak: "zoom_hit" as const, reason: "A bold promise plus a punch-in." },
  ending: { kind: "cta" as const, keyword: "AI" },
  background: { mode: "original" as const },
  music: { kind: "none" as const },
  sfx: "subtle" as const,
  estimate: { durationSec: 0, credits: 0 },
  warnings: [] as string[],
});
```
Note: `fixtures.ts` must not import from `../index` (keep it a leaf for the browser-safe check).

- [ ] **Step 2: Write the failing test** `packages/core/src/schema/edit-plan.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { validEditPlan } from "../testing/fixtures";
import { EditPlanDraftSchema, EditPlanSchema, parseEditPlan } from "./edit-plan";
import { FaceTrackSchema, RawFaceTrackSchema, TranscriptSchema } from "./footage";

describe("EditPlanSchema", () => {
  it("accepts the fixture and defaults warnings", () => {
    const { warnings: _w, ...noWarnings } = validEditPlan();
    expect(parseEditPlan(noWarnings).warnings).toEqual([]);
  });
  it("requires contiguous beats in source order", () => {
    const p = validEditPlan();
    p.beats[1].startWordIdx = 9;
    expect(() => parseEditPlan(p)).toThrow(/beats\.1\.startWordIdx: beat b2 must start at word 8/);
  });
  it("keeps the emphasis word inside its beat", () => {
    const p = validEditPlan();
    p.beats[0].emphasisWordIdx = 9;
    expect(() => parseEditPlan(p)).toThrow(/word 9 is outside beat b1 \(words 0–7\)/);
  });
  it("needs at least one kept beat and a kept cold-open beat", () => {
    const none = validEditPlan();
    none.beats.forEach((b) => (b.keep = false));
    expect(() => parseEditPlan(none)).toThrow(/Keep at least one beat/);
    const cold = validEditPlan();
    cold.beats[1].keep = false;
    expect(() => parseEditPlan({ ...cold, hook: { ...cold.hook, coldOpenBeatId: "b2" } })).toThrow(/cold-open beat b2 is dropped/);
    expect(() => parseEditPlan({ ...cold, hook: { ...cold.hook, coldOpenBeatId: "b9" } })).toThrow(/no beat b9/);
  });
  it("needs a keyword for a CTA ending", () => {
    expect(() => parseEditPlan({ ...validEditPlan(), ending: { kind: "cta", keyword: " " } })).toThrow(/ending\.keyword/);
  });
});

describe("plan 1 limits", () => {
  it("accepts the full plan 2/3 shape in the schema but parseEditPlan rejects it with clear messages", () => {
    const p = {
      ...validEditPlan(),
      hook: { ...validEditPlan().hook, patternBreak: "broll" },
      background: { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "office" } }] },
      beats: validEditPlan().beats.map((b, i) =>
        i === 0 ? { ...b, cutaway: { source: { kind: "ai_broll", prompt: "laptop" }, layout: "full", atMs: 0, durationMs: 1500 } } : b,
      ),
    };
    expect(EditPlanSchema.safeParse(p).success).toBe(true);
    let message = "";
    try { parseEditPlan(p); } catch (err) { message = (err as Error).message; }
    expect(message).toContain("Beat b1 has a cutaway. Cutaways arrive in a later update: remove it.");
    expect(message).toContain("Background replacement arrives in a later update: keep the original background.");
    expect(message).toContain("The B-roll pattern break needs cutaways, which arrive in a later update: pick zoom hit, flash or none.");
  });
  it("never offers cutaways, background or broll to Claude", () => {
    const json = JSON.stringify(EditPlanDraftSchema.toJSONSchema());
    expect(json).not.toMatch(/cutaway|background|broll/);
  });
});

describe("footage data schemas", () => {
  it("parses a transcript, a raw face track (null boxes) and a smoothed track", () => {
    expect(TranscriptSchema.parse({ languageCode: "heb", languageProbability: 0.9, words: [{ text: "שלום", startMs: 0, endMs: 300 }] }).events).toEqual([]);
    expect(RawFaceTrackSchema.parse({ width: 1080, height: 1920, fps: 30, sampleEvery: 3, samples: [{ tMs: 0, box: null }] }).samples[0].box).toBeNull();
    expect(() => FaceTrackSchema.parse({ intervalMs: 0, samples: [] })).toThrow();
  });
});
```
Run `npx vitest run packages/core/src/schema/edit-plan.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `packages/core/src/schema/footage.ts`:
```ts
import * as z from "zod";
import { WordSchema } from "./timeline";

const HASH = z.string().regex(/^[0-9a-f]{64}$/, "must be an asset hash");

export const TranscriptWordSchema = WordSchema.extend({ logprob: z.number().optional() });
/** Scribe output, reduced: spoken words (indexable, in order) and audio events (laughter, breaths) kept apart. */
export const TranscriptSchema = z.object({
  languageCode: z.string(),
  languageProbability: z.number().min(0).max(1),
  words: z.array(TranscriptWordSchema),
  events: z.array(WordSchema).default([]),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

/** Normalised to the frame, origin top-left. */
export const FaceBoxSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
export type FaceBox = z.infer<typeof FaceBoxSchema>;
const FaceSampleSchema = z.object({ tMs: z.number().nonnegative(), box: FaceBoxSchema.nullable() });

/** What tools/face-helper prints: the largest face on every `sampleEvery`-th frame, or null. */
export const RawFaceTrackSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  sampleEvery: z.number().int().positive(),
  samples: z.array(FaceSampleSchema),
});
export type RawFaceTrack = z.infer<typeof RawFaceTrackSchema>;

/** Smoothed and gap-filled (see footage/face-track.ts). null = no face at that time. */
export const FaceTrackSchema = z.object({ intervalMs: z.number().positive(), samples: z.array(FaceSampleSchema) });
export type FaceTrack = z.infer<typeof FaceTrackSchema>;

export const FootageSourceSchema = z.object({
  assetId: HASH, // the 1080×1920 working copy in the asset store
  durationMs: z.number().int().positive(),
  transcriptAssetId: HASH,
  faceTrackAssetId: HASH,
});
export type FootageSource = z.infer<typeof FootageSourceSchema>;
```

- [ ] **Step 4: Implement** `packages/core/src/schema/edit-plan.ts`:
```ts
import * as z from "zod";
import { FootageTargetSchema } from "../footage-form";
import { FootageSourceSchema } from "./footage";
import { LanguageSchema } from "./storyboard";

export const BEAT_ID_RE = /^b[0-9]{1,3}$/;
const BeatId = z.string().regex(BEAT_ID_RE, "beat ids look like b1, b2, …");
export const SfxLevelSchema = z.enum(["off", "subtle", "lively"]);
export const MusicMoodSchema = z.enum(["calm", "upbeat", "dramatic"]);
export type MusicMood = z.infer<typeof MusicMoodSchema>;
export const PatternBreakSchema = z.enum(["zoom_hit", "flash", "broll", "none"]);

const Prompt = z.string().trim().min(1).max(1500);
/** Plan 2. Present in the shape so later plans extend it; parseEditPlan rejects it in plan 1. */
const CutawaySchema = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ai_broll"), prompt: Prompt }),
    z.object({ kind: z.literal("ai_self"), prompt: Prompt }),
    z.object({ kind: z.literal("upload"), assetId: z.string().min(1) }),
    z.object({ kind: z.literal("diagram"), template: z.enum(["compare", "list", "flow"]), items: z.array(z.string().trim().min(1).max(40)).min(2).max(4) }),
  ]),
  layout: z.enum(["full", "split"]),
  atMs: z.number().int().nonnegative(),
  durationMs: z.number().int().min(1000).max(3000),
});

export const BeatSchema = z.object({
  id: BeatId,
  startWordIdx: z.number().int().nonnegative(),
  endWordIdx: z.number().int().nonnegative(), // inclusive
  keep: z.boolean(),
  dropReason: z.string().trim().max(200).optional(),
  emphasisWordIdx: z.number().int().nonnegative().optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  cutaway: CutawaySchema.optional(),
});
export type Beat = z.infer<typeof BeatSchema>;

export const EditPlanSchema = z
  .object({
    format: z.literal("footage"),
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(120),
    language: LanguageSchema,
    targetDurationSec: FootageTargetSchema,
    source: FootageSourceSchema,
    beats: z.array(BeatSchema).min(1).max(300),
    hook: z.object({
      coldOpenBeatId: BeatId.optional(),
      headline: z.object({ small: z.string().trim().max(40), big: z.string().trim().min(1).max(24) }).optional(),
      patternBreak: PatternBreakSchema,
      reason: z.string().trim().max(300),
    }),
    ending: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("cta"), keyword: z.string().trim().min(1).max(30) }),
      z.object({ kind: z.literal("loop") }),
      z.object({ kind: z.literal("none") }),
    ]),
    background: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("original") }),
      z.object({
        mode: z.literal("replace"), // plan 3
        sections: z.array(z.object({
          fromBeatId: BeatId,
          source: z.discriminatedUnion("kind", [z.object({ kind: z.literal("ai"), prompt: Prompt }), z.object({ kind: z.literal("brand"), assetId: z.string().min(1) })]),
        })).min(1),
      }),
    ]),
    music: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("library"), assetId: z.uuid() }), // team_music.id
      z.object({ kind: z.literal("ai"), prompt: z.string().trim().min(1).max(300) }),
      z.object({ kind: z.literal("none") }),
    ]),
    sfx: SfxLevelSchema,
    estimate: z.object({ durationSec: z.number().nonnegative(), credits: z.number().nonnegative() }), // computed by code; credits in USD
    warnings: z.array(z.string()).default([]),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.beats.forEach((b, i) => {
      if (seen.has(b.id)) ctx.addIssue({ code: "custom", path: ["beats", i, "id"], message: `duplicate beat id "${b.id}"` });
      seen.add(b.id);
      const expected = i === 0 ? 0 : plan.beats[i - 1].endWordIdx + 1;
      if (b.startWordIdx !== expected) ctx.addIssue({ code: "custom", path: ["beats", i, "startWordIdx"], message: `beat ${b.id} must start at word ${expected}` });
      if (b.endWordIdx < b.startWordIdx) ctx.addIssue({ code: "custom", path: ["beats", i, "endWordIdx"], message: `beat ${b.id} ends before it starts` });
      if (b.emphasisWordIdx !== undefined && (b.emphasisWordIdx < b.startWordIdx || b.emphasisWordIdx > b.endWordIdx)) {
        ctx.addIssue({ code: "custom", path: ["beats", i, "emphasisWordIdx"], message: `word ${b.emphasisWordIdx} is outside beat ${b.id} (words ${b.startWordIdx}–${b.endWordIdx})` });
      }
    });
    if (!plan.beats.some((b) => b.keep)) ctx.addIssue({ code: "custom", path: ["beats"], message: "Keep at least one beat." });
    const cold = plan.hook.coldOpenBeatId;
    if (cold) {
      const beat = plan.beats.find((b) => b.id === cold);
      if (!beat) ctx.addIssue({ code: "custom", path: ["hook", "coldOpenBeatId"], message: `there is no beat ${cold}` });
      else if (!beat.keep) ctx.addIssue({ code: "custom", path: ["hook", "coldOpenBeatId"], message: `the cold-open beat ${cold} is dropped` });
    }
  });
export type EditPlan = z.infer<typeof EditPlanSchema>;

export const NOT_IN_PLAN_ONE = {
  cutaway: (beatId: string) => `Beat ${beatId} has a cutaway. Cutaways arrive in a later update: remove it.`,
  background: "Background replacement arrives in a later update: keep the original background.",
  brollBreak: "The B-roll pattern break needs cutaways, which arrive in a later update: pick zoom hit, flash or none.",
};

/** Plan 1 renders no cutaways, keeps the real background and has no B-roll pattern break. Plans 2 and 3 shrink this list. */
export function planOneIssues(plan: EditPlan): string[] {
  return [
    ...plan.beats.filter((b) => b.cutaway).map((b) => NOT_IN_PLAN_ONE.cutaway(b.id)),
    ...(plan.background.mode === "replace" ? [NOT_IN_PLAN_ONE.background] : []),
    ...(plan.hook.patternBreak === "broll" ? [NOT_IN_PLAN_ONE.brollBreak] : []),
  ];
}

/** Parses an edit plan, throwing an Error that lists every schema issue and every plan-1 limit as one line each. */
export function parseEditPlan(input: unknown): EditPlan {
  const result = EditPlanSchema.safeParse(input);
  const lines = result.success
    ? planOneIssues(result.data).map((m) => `  - ${m}`)
    : result.error.issues.map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  if (result.success && lines.length === 0) return result.data;
  throw new Error(`Invalid edit plan:\n${lines.join("\n")}`);
}

/**
 * What Claude writes. Free of min/max constraints (structured outputs don't enforce them); empty strings and -1 mean
 * "none". Code fills in the beat spans, source, estimate and warnings, then validates with parseEditPlan.
 */
export const EditPlanDraftSchema = z.object({
  title: z.string(),
  beats: z.array(z.object({ id: z.string(), keep: z.boolean(), dropReason: z.string(), emphasisWordIdx: z.number().int(), emoji: z.string() })),
  hook: z.object({
    coldOpenBeatId: z.string(),
    headlineSmall: z.string(),
    headlineBig: z.string(),
    patternBreak: z.enum(["zoom_hit", "flash", "none"]),
    reason: z.string(),
  }),
  ending: z.object({ kind: z.enum(["cta", "loop", "none"]), keyword: z.string() }),
  music: z.object({ kind: z.enum(["library", "ai", "none"]), trackId: z.string(), prompt: z.string() }),
  sfx: SfxLevelSchema,
});
export type EditPlanDraft = z.infer<typeof EditPlanDraftSchema>;
```
Append to `packages/core/src/index.ts`: `export * from "./schema/footage";` and `export * from "./schema/edit-plan";`.

If `z.toJSONSchema` is not a method on schemas in the installed zod (check `node_modules/zod/package.json` version and `z.toJSONSchema` in its types), change the test line to `JSON.stringify(z.toJSONSchema(EditPlanDraftSchema))` with `import * as z from "zod"`.

- [ ] **Step 5: Add the plan payload** in `packages/db/src/index.ts` (import `FootageSourceSchema` from `@reel/core`):
```ts
export const PlanFootageJobPayloadSchema = z.object({
  settings: FootageSettingsSchema,
  source: FootageSourceSchema,
  /** Re-plan: the plan the user was looking at, given to Claude as context. */
  fromStoryboardId: z.uuid().optional(),
  instruction: z.string().trim().min(1).max(500).optional(),
});
export type PlanFootagePayload = z.infer<typeof PlanFootageJobPayloadSchema>;
```
Add a db test: a payload with `instruction: "x".repeat(501)` throws; one with `fromStoryboardId: "not-a-uuid"` throws; a minimal `{ settings, source }` parses (use `HASH_A/B/C` literals inline: `"a".repeat(64)` etc.).

- [ ] **Step 6: Verify.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS (including `browser-safe.test.ts`).

- [ ] **Step 7: Commit** with message `feat(core): transcript, face-track and EditPlan schemas with plan-1 limits; Claude's edit draft schema`.

---

### Task 3: Beat splitting

**Files:**
- Create: `packages/core/src/beats.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/beats.test.ts`

**Interfaces:**
- Consumes: `Word` (existing), `footageTranscript()` (Task 2).
- Produces: `BEAT_PAUSE_MS = 600`, `BEAT_MAX_MS = 10_000`, `BEAT_MIN_MS = 1200`, `type BeatSpan = { id: string; startWordIdx: number; endWordIdx: number }`, `splitBeats(words: Word[]): BeatSpan[]` (ids `b1…bN`, contiguous, covering every word).

- [ ] **Step 1: Write the failing test** `packages/core/src/beats.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { splitBeats } from "./beats";
import { footageTranscript } from "./testing/fixtures";

/** Words of 300 ms separated by `gaps[i]` ms (gap before word i+1). */
const timed = (texts: string[], gaps: number[] = []) => {
  let t = 0;
  return texts.map((text, i) => {
    const w = { text, startMs: t, endMs: t + 300 };
    t += 300 + (gaps[i] ?? 50);
    return w;
  });
};
const spans = (words: { text: string }[]) => splitBeats(words as never).map((b) => [b.id, b.startWordIdx, b.endWordIdx]);

describe("splitBeats", () => {
  it("splits the fixture at its three sentence ends", () => {
    expect(spans(footageTranscript().words)).toEqual([["b1", 0, 7], ["b2", 8, 11], ["b3", 12, 14]]);
  });
  it("splits at Hebrew and English sentence punctuation, also before closing quotes", () => {
    const w = timed(["אחת", "שתיים", "שלוש", "ארבע.", "חמש", "שש", "שבע", "שמונה?״", "nine", "ten", "eleven", "twelve!"]);
    expect(spans(w)).toEqual([["b1", 0, 3], ["b2", 4, 7], ["b3", 8, 11]]);
  });
  it("splits at a pause of 600 ms or more, not at 599 ms", () => {
    const w = timed(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"], [50, 50, 599, 50, 50, 600, 50, 50, 50, 50, 50]);
    expect(spans(w)).toEqual([["b1", 0, 5], ["b2", 6, 11]]);
  });
  it("splits a beat over 10 s at its longest internal pause", () => {
    const texts = Array.from({ length: 30 }, (_, i) => `w${i}`);
    const gaps = texts.map((_, i) => (i === 11 ? 400 : 50)); // ≈ 10.5 s with no punctuation; longest pause after w11
    expect(spans(timed(texts, gaps))).toEqual([["b1", 0, 11], ["b2", 12, 29]]);
  });
  it("merges a beat under 1.2 s into the neighbour across the smaller gap", () => {
    const w = timed(["a", "b", "c", "d.", "short.", "e", "f", "g", "h."], [50, 50, 50, 700, 650, 50, 50, 50]);
    // "short." is 300 ms: 700 ms gap before it, 650 ms after → it joins the next beat.
    expect(spans(w)).toEqual([["b1", 0, 3], ["b2", 4, 8]]);
  });
  it("returns one beat for a single short sentence and none for no words", () => {
    expect(spans(timed(["hi."]))).toEqual([["b1", 0, 0]]);
    expect(splitBeats([])).toEqual([]);
  });
});
```
Run `npx vitest run packages/core/src/beats.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** `packages/core/src/beats.ts`, then append `export * from "./beats";` to the core index:
```ts
import type { Word } from "./schema/timeline";

export const BEAT_PAUSE_MS = 600;
export const BEAT_MAX_MS = 10_000;
export const BEAT_MIN_MS = 1200;
export type BeatSpan = { id: string; startWordIdx: number; endWordIdx: number };

const SENTENCE_END = /[.!?…׃]["'״”’)\]]*$/u;
type Group = [number, number]; // inclusive word indices

const durationOf = (words: Word[], [a, b]: Group) => words[b].endMs - words[a].startMs;
const gapAfter = (words: Word[], i: number) => words[i + 1].startMs - words[i].endMs;

function splitLong(words: Word[], g: Group): Group[] {
  if (g[1] === g[0] || durationOf(words, g) <= BEAT_MAX_MS) return [g];
  let at = g[0];
  for (let i = g[0]; i < g[1]; i++) if (gapAfter(words, i) > gapAfter(words, at)) at = i;
  return [...splitLong(words, [g[0], at]), ...splitLong(words, [at + 1, g[1]])];
}

/** Code-side beat splitting (spec §4.3): sentences and long pauses, long beats split, short beats merged. */
export function splitBeats(words: Word[]): BeatSpan[] {
  if (!words.length) return [];
  let groups: Group[] = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const last = i === words.length - 1;
    if (last || SENTENCE_END.test(words[i].text) || gapAfter(words, i) >= BEAT_PAUSE_MS) {
      groups.push([start, i]);
      start = i + 1;
    }
  }
  groups = groups.flatMap((g) => splitLong(words, g));
  for (;;) {
    const i = groups.findIndex((g) => durationOf(words, g) < BEAT_MIN_MS);
    if (i < 0 || groups.length === 1) break;
    const before = i > 0 ? words[groups[i][0]].startMs - words[groups[i - 1][1]].endMs : Infinity;
    const after = i < groups.length - 1 ? words[groups[i + 1][0]].startMs - words[groups[i][1]].endMs : Infinity;
    if (before <= after) groups.splice(i - 1, 2, [groups[i - 1][0], groups[i][1]]);
    else groups.splice(i, 2, [groups[i][0], groups[i + 1][1]]);
  }
  return groups.map(([a, b], i) => ({ id: `b${i + 1}`, startWordIdx: a, endWordIdx: b }));
}
```

- [ ] **Step 3: Verify.** Run `npx vitest run packages/core && npm run typecheck`. Expected: PASS. If the "longest pause" test's word count lands under 10 s with the real durations (30 words × 300 ms + gaps), raise the word count until the group exceeds 10 s and keep the split point after `w11`; record that in the report.

- [ ] **Step 4: Commit** with message `feat(core): split transcripts into beats at sentences and pauses`.

---
### Task 4: Timeline additions, edit style, face track and shot planning

**Files:**
- Create: `packages/core/src/footage/style.ts`, `packages/core/src/footage/face-track.ts`, `packages/core/src/footage/shots.ts`
- Modify: `packages/core/src/schema/timeline.ts`, `packages/core/src/timeline-sources.ts`, `packages/core/src/testing/fixtures.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/footage/face-track.test.ts`, `packages/core/src/footage/shots.test.ts` (new), `packages/core/src/timeline-sources.test.ts` (extend)

**Interfaces:**
- Consumes: `EditPlan`, `FaceBox`, `FaceTrack`, `RawFaceTrack` (Task 2); `FPS` from `assemble.ts`.
- Produces:
  - Timeline: `SFX_NAMES`, `SfxNameSchema`, `type SfxName`; `TimelineCropSchema`, `type TimelineCrop = { cx; cy; scaleFrom; scaleTo; punchFrames? }`; clip `kind` adds `"speaker"`, clips gain optional `source: { inMs; outMs }`, `crop`, `layout: "full" | "split"`; `CaptionPageSchema`, `type CaptionPage = { fromFrame; durationInFrames; words: { text; emphasis }[]; emoji? }`; `captions.pages?`; `style.captionPreset` also accepts `"pill"`; optional `hook`, `ending`, `sfx`.
  - `EditStyleSchema`, `type EditStyle` (fields listed in Step 3), fixture `testEditStyle()`, fixture `faceTrackFixture()`.
  - `smoothFaceTrack(raw: RawFaceTrack, opts?: { window?: number; maxGapMs?: number }): FaceTrack`, `faceAt(track: FaceTrack, tMs: number): FaceBox | null`
  - `msToFrames(ms): number`, `framesToMs(frames): number`, `isFiller(text: string, fillers: string[]): boolean`, `orderedKeptBeats(plan): Beat[]`
  - `type PlannedShot = { id: string; beatId: string; inFrame: number; frames: number; speechFrames: number; wordIdx: number[] }`
  - `planShots(plan: Pick<EditPlan, "beats" | "hook" | "ending" | "source">, words: Word[], style: EditStyle): PlannedShot[]`
  - `maxScaleFor(face: FaceBox | null, style: EditStyle): number`, `centerFor(face: FaceBox | null, scale: number): { cx: number; cy: number }`, `shotCrop(index: number, durationMs: number, face: FaceBox | null, style: EditStyle): TimelineCrop`

- [ ] **Step 1: Extend the Timeline** in `packages/core/src/schema/timeline.ts`. Every addition is optional, so stored voice timelines still parse and render unchanged:
```ts
export const SFX_NAMES = ["whoosh1", "whoosh2", "pop1", "pop2", "tick", "riser", "ding", "swoosh_out"] as const;
export const SfxNameSchema = z.enum(SFX_NAMES);
export type SfxName = z.infer<typeof SfxNameSchema>;

/** Face-centred zoom of a speaker clip: (cx, cy) is the visible centre, normalised; scale goes from→to across the clip, or within punchFrames. */
export const TimelineCropSchema = z.object({
  cx: z.number().min(0).max(1),
  cy: z.number().min(0).max(1),
  scaleFrom: z.number().min(1).max(3),
  scaleTo: z.number().min(1).max(3),
  punchFrames: z.number().int().positive().optional(),
});
export type TimelineCrop = z.infer<typeof TimelineCropSchema>;
```
In `TimelineClipSchema`: `kind: z.enum(["video", "image", "graphic", "speaker"])`, and add
```ts
  /** speaker clips: the span of the working copy this clip plays (source time). */
  source: z.object({ inMs: z.number().nonnegative(), outMs: z.number().positive() }).optional(),
  crop: TimelineCropSchema.optional(),
  layout: z.enum(["full", "split"]).optional(),
```
Add before `TimelineSchema`:
```ts
export const CaptionPageSchema = z.object({
  fromFrame: z.number().int().nonnegative(),
  durationInFrames: z.number().int().positive(),
  words: z.array(z.object({ text: z.string().min(1), emphasis: z.boolean() })).min(1),
  emoji: z.string().optional(),
});
export type CaptionPage = z.infer<typeof CaptionPageSchema>;
```
In `TimelineSchema`:
- `style.captionPreset: z.union([CaptionPresetSchema, z.literal("pill")])`
- `captions: z.object({ words: z.array(WordSchema), pages: z.array(CaptionPageSchema).optional() })`
- add
```ts
  hook: z.object({
    patternBreak: z.enum(["zoom_hit", "flash", "none"]),
    headline: z.object({ small: z.string(), big: z.string().min(1), fromFrame: z.number().int().nonnegative(), durationInFrames: z.number().int().positive() }).optional(),
  }).optional(),
  ending: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("cta"), keyword: z.string().min(1), fromFrame: z.number().int().nonnegative(), durationInFrames: z.number().int().positive() }),
    z.object({ kind: z.literal("loop") }),
    z.object({ kind: z.literal("none") }),
  ]).optional(),
  sfx: z.array(z.object({ name: SfxNameSchema, frame: z.number().int().nonnegative(), src: z.string().min(1), volumeDb: z.number() })).optional(),
```
`Captions.tsx` keeps compiling: its `tokenStyle` falls through to the bold style for any preset other than `clean`, and footage timelines never reach it (Task 7 routes them to `PillCaptions`).

- [ ] **Step 2: Map sound-effect sources** in `packages/core/src/timeline-sources.ts`:
```ts
export function timelineAssetFiles(t: Timeline): string[] {
  const refs = [t.audio.voiceUrl, t.audio.musicUrl, ...t.clips.map((c) => c.src), ...(t.sfx ?? []).map((s) => s.src)]
    .map(refOf)
    .filter((r): r is string => !!r);
  return [...new Set(refs)];
}
```
and in `mapTimelineSources` add `...(t.sfx ? { sfx: t.sfx.map((s) => ({ ...s, src: map(s.src) ?? s.src })) } : {}),` to the returned object. Extend `timeline-sources.test.ts`: a timeline with `sfx: [{ name: "pop1", frame: 3, src: "asset:p.wav", volumeDb: -12 }]` lists `p.wav` and maps it; a timeline without `sfx` has no `sfx` key after mapping (`expect("sfx" in mapped).toBe(false)`).

- [ ] **Step 3: Edit style** `packages/core/src/footage/style.ts`. The values live in `houseStyle.edit` in `@reel/video` (Task 7); core only owns the shape, so the compiler stays pure and tunable:
```ts
import * as z from "zod";

export const EditStyleSchema = z.object({
  cutGapMs: z.number().positive(),
  padMs: z.number().nonnegative(),
  zoomSteps: z.array(z.number().min(1).max(2)).min(1),
  /** The visible window must be at least the face size × this, so a zoom never cuts the face. */
  faceMargin: z.number().min(1),
  pushInAfterMs: z.number().positive(),
  pushInFactor: z.number().min(1).max(1.5),
  captionMaxChars: z.number().int().positive(),
  captionMaxWords: z.number().int().positive(),
  headlineMs: z.number().positive(),
  headlineWordFrames: z.number().int().positive(),
  ctaMs: z.number().positive(),
  zoomHitFrames: z.number().int().positive(),
  zoomHitScale: z.number().min(1).max(2),
  flashFrames: z.number().int().positive(),
  musicUnderVoiceDb: z.number().max(0),
  sfxVolumeDb: z.object({ whoosh: z.number(), pop: z.number(), tick: z.number() }),
  fillerWords: z.array(z.string().min(1)),
  /** Mean word logprob below this adds a "noisy audio" note to the plan. */
  noisyLogprob: z.number().max(0),
});
export type EditStyle = z.infer<typeof EditStyleSchema>;
```
Add to `testing/fixtures.ts` (same numbers as `houseStyle.edit` in Task 7; Task 7 adds a test that they match):
```ts
import type { EditStyle } from "../footage/style";
import type { FaceTrack } from "../schema/footage";

export const testEditStyle = (): EditStyle => ({
  cutGapMs: 150, padMs: 50, zoomSteps: [1, 1.15, 1.25], faceMargin: 1.2, pushInAfterMs: 2000, pushInFactor: 1.08,
  captionMaxChars: 22, captionMaxWords: 3, headlineMs: 2000, headlineWordFrames: 6, ctaMs: 2500,
  zoomHitFrames: 6, zoomHitScale: 1.3, flashFrames: 2, musicUnderVoiceDb: -12,
  sfxVolumeDb: { whoosh: -10, pop: -12, tick: -18 },
  fillerWords: ["אממ", "אמ", "אהה", "אה", "אהמ", "ממ", "umm", "um", "uh", "uhh", "erm", "hmm"],
  noisyLogprob: -0.7,
});

/** A steady face in the upper-middle of the frame for the whole 9 s fixture. */
export const faceTrackFixture = (): FaceTrack => ({
  intervalMs: 100,
  samples: Array.from({ length: 91 }, (_, i) => ({ tMs: i * 100, box: { x: 0.35, y: 0.2, w: 0.3, h: 0.17 } })),
});
```

- [ ] **Step 4: Write the failing face-track test** `packages/core/src/footage/face-track.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { faceAt, smoothFaceTrack } from "./face-track";

const box = (x: number) => ({ x, y: 0.2, w: 0.3, h: 0.2 });
const raw = (xs: (number | null)[]) => ({
  width: 1080, height: 1920, fps: 30, sampleEvery: 3,
  samples: xs.map((x, i) => ({ tMs: i * 100, box: x === null ? null : box(x) })),
});

describe("smoothFaceTrack", () => {
  it("fills a gap of up to 1 s by interpolation", () => {
    const t = smoothFaceTrack(raw([0.4, 0.4, 0.4, 0.4, null, null, null, null, null, null, 0.6, 0.6, 0.6, 0.6]));
    expect(t.intervalMs).toBe(100);
    expect(t.samples.every((s) => s.box)).toBe(true);
    const xs = t.samples.map((s) => s.box!.x);
    for (let i = 4; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9);
    expect(xs[6]).toBeGreaterThan(0.4);
    expect(xs[6]).toBeLessThan(0.6);
  });
  it("leaves gaps over 1 s and leading/trailing gaps as no face", () => {
    const t = smoothFaceTrack(raw([null, 0.4, ...Array(15).fill(null), 0.5, null]));
    expect(t.samples[0].box).toBeNull();
    expect(t.samples[5].box).toBeNull();
    expect(t.samples.at(-1)!.box).toBeNull();
  });
  it("smooths jitter with a moving average", () => {
    const t = smoothFaceTrack(raw([0.4, 0.5, 0.4, 0.5, 0.4, 0.5, 0.4, 0.5, 0.4, 0.5]));
    for (const s of t.samples.slice(2, 8)) {
      expect(s.box!.x).toBeGreaterThan(0.42);
      expect(s.box!.x).toBeLessThan(0.48);
    }
  });
});

describe("faceAt", () => {
  const t = smoothFaceTrack(raw([0.4, 0.4, 0.4]));
  it("returns the nearest sample within one interval", () => {
    expect(faceAt(t, 140)!.x).toBeCloseTo(0.4);
    expect(faceAt(t, 290)).not.toBeNull();
  });
  it("returns null past the track or for an empty track", () => {
    expect(faceAt(t, 350)).toBeNull();
    expect(faceAt({ intervalMs: 100, samples: [] }, 0)).toBeNull();
  });
});
```
Run `npx vitest run packages/core/src/footage/face-track.test.ts`. Expected: FAIL.

- [ ] **Step 5: Implement** `packages/core/src/footage/face-track.ts`:
```ts
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
```

- [ ] **Step 6: Write the failing shots test** `packages/core/src/footage/shots.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseEditPlan, type EditPlan } from "../schema/edit-plan";
import { footageTranscript, testEditStyle, validEditPlan } from "../testing/fixtures";
import { isFiller, planShots, shotCrop } from "./shots";

const style = testEditStyle();
const words = footageTranscript().words;
const plan = (over: Partial<EditPlan> = {}) => parseEditPlan({ ...validEditPlan(), ...over });
const layout = (p: EditPlan) => planShots(p, words, style).map((s) => [s.id, s.inFrame, s.frames, s.speechFrames]);

describe("isFiller", () => {
  it("matches fillers with stretched letters, punctuation and case", () => {
    for (const w of ["אממממ", "אהה,", "Umm", "hmmm", "אה."]) expect(isFiller(w, style.fillerWords)).toBe(true);
    for (const w of ["אמא", "שָׁלוֹם", "um-hum", "AI"]) expect(isFiller(w, style.fillerWords)).toBe(false);
  });
});

describe("planShots", () => {
  it("cuts pauses of 150 ms or more and fillers, pads 50 ms, and snaps to frames", () => {
    // b1 splits around the filler; the CTA extends the last shot by the 22 frames of source left after the last word.
    expect(layout(plan())).toEqual([["b1-1", 0, 26, 26], ["b1-2", 44, 63, 63], ["b2-1", 125, 57, 57], ["b3-1", 198, 72, 50]]);
    expect(planShots(plan(), words, style)[0].wordIdx).toEqual([0, 1]);
  });
  it("cuts at a gap of exactly 150 ms but not 149 ms, and always around a filler", () => {
    const w = [
      { text: "a", startMs: 0, endMs: 300 }, { text: "b", startMs: 449, endMs: 700 }, { text: "c", startMs: 850, endMs: 1100 },
      { text: "אממ", startMs: 1120, endMs: 1300 }, { text: "d.", startMs: 1320, endMs: 1600 },
    ];
    const p = plan({ beats: [{ id: "b1", startWordIdx: 0, endWordIdx: 4, keep: true }], hook: { patternBreak: "none", reason: "" }, ending: { kind: "none" } });
    expect(planShots(p, w, style).map((s) => s.wordIdx)).toEqual([[0, 1], [2], [4]]);
  });
  it("plays the cold-open beat first and never repeats it", () => {
    const p = plan({ hook: { ...validEditPlan().hook, coldOpenBeatId: "b2" } });
    expect(planShots(p, words, style).map((s) => s.id)).toEqual(["b2-1", "b1-1", "b1-2", "b3-1"]);
  });
  it("skips dropped beats", () => {
    const p = validEditPlan();
    p.beats[1].keep = false;
    expect(planShots(parseEditPlan(p), words, style).map((s) => s.beatId)).toEqual(["b1", "b1", "b3"]);
  });
  it("loop: the last shot ends exactly on its last word", () => {
    expect(layout(plan({ ending: { kind: "loop" } })).at(-1)).toEqual(["b3-1", 198, 48, 48]);
  });
  it("CTA: adds no frames when the speaker talks to the last frame of the source", () => {
    const p = plan({ source: { ...validEditPlan().source, durationMs: 8250 } });
    expect(layout(p).at(-1)).toEqual(["b3-1", 198, 49, 49]);
  });
  it("CTA: the extension stops before the next (dropped) beat's speech", () => {
    const p = validEditPlan();
    p.beats[2].keep = false;
    // b2 ends at frame 182; b3's first word starts at 6650 ms, so the extension may run to frame 198 (6600 ms) only.
    expect(layout(parseEditPlan(p)).at(-1)).toEqual(["b2-1", 125, 73, 57]);
  });
  it("returns no shots when every kept beat is only fillers", () => {
    const w = [{ text: "אממ", startMs: 0, endMs: 400 }, { text: "אהה", startMs: 900, endMs: 1500 }];
    const p = plan({ beats: [{ id: "b1", startWordIdx: 0, endWordIdx: 1, keep: true }], hook: { patternBreak: "none", reason: "" }, ending: { kind: "none" } });
    expect(planShots(p, w, style)).toEqual([]);
  });
});

describe("shotCrop", () => {
  it("alternates 1.0 → 1.15 → 1.25 and pushes in on shots over 2 s", () => {
    expect(shotCrop(0, 1000, null, style)).toEqual({ cx: 0.5, cy: 0.5, scaleFrom: 1, scaleTo: 1 });
    expect(shotCrop(1, 1000, null, style)).toEqual({ cx: 0.5, cy: 0.5, scaleFrom: 1.15, scaleTo: 1.15 });
    expect(shotCrop(2, 2500, null, style)).toEqual({ cx: 0.5, cy: 0.5, scaleFrom: 1.25, scaleTo: 1.35 });
    expect(shotCrop(3, 1000, null, style).scaleFrom).toBe(1);
  });
  it("centres on the face and clamps to the frame", () => {
    expect(shotCrop(2, 1000, { x: 0.85, y: 0.3, w: 0.15, h: 0.1 }, style)).toEqual({ cx: 0.6, cy: 0.4, scaleFrom: 1.25, scaleTo: 1.25 });
    expect(shotCrop(1, 1000, { x: 0.4, y: 0.1, w: 0.2, h: 0.12 }, style)).toEqual({ cx: 0.5, cy: 0.4348, scaleFrom: 1.15, scaleTo: 1.15 });
  });
  it("never zooms past a face that fills the frame", () => {
    expect(shotCrop(2, 2500, { x: 0.05, y: 0.1, w: 0.9, h: 0.5 }, style)).toEqual({ cx: 0.5, cy: 0.5, scaleFrom: 1, scaleTo: 1 });
  });
  it("keeps every face fully inside the visible window at both ends of the push-in", () => {
    for (const x of [0, 0.2, 0.5, 0.75]) for (const y of [0, 0.3, 0.7]) for (const w of [0.1, 0.25, 0.5]) for (let i = 0; i < 3; i++) {
      const face = { x, y, w, h: w * 0.6 };
      const c = shotCrop(i, 2500, face, style);
      for (const s of [c.scaleFrom, c.scaleTo]) {
        const half = 1 / (2 * s);
        expect(face.x).toBeGreaterThanOrEqual(c.cx - half - 1e-4);
        expect(Math.min(1, face.x + face.w)).toBeLessThanOrEqual(c.cx + half + 1e-4);
        expect(face.y).toBeGreaterThanOrEqual(c.cy - half - 1e-4);
        expect(Math.min(1, face.y + face.h)).toBeLessThanOrEqual(c.cy + half + 1e-4);
      }
    }
  });
});
```
Run `npx vitest run packages/core/src/footage/shots.test.ts`. Expected: FAIL.

- [ ] **Step 7: Implement** `packages/core/src/footage/shots.ts`:
```ts
import { FPS } from "../assemble";
import type { Beat, EditPlan } from "../schema/edit-plan";
import type { FaceBox } from "../schema/footage";
import type { TimelineCrop, Word } from "../schema/timeline";
import type { EditStyle } from "./style";

export const msToFrames = (ms: number) => Math.round((ms * FPS) / 1000);
export const framesToMs = (frames: number) => (frames * 1000) / FPS;
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

const norm = (s: string) =>
  s.normalize("NFC").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase().replace(/(.)\1+/gu, "$1$1");

/** Filler check: punctuation, niqqud and case are ignored, and stretched letters ("אממממ", "hmmm") count as two. */
export function isFiller(text: string, fillers: string[]): boolean {
  const t = norm(text);
  return t.length > 0 && fillers.some((f) => norm(f) === t);
}

/** Kept beats in reel order: the cold-open beat first, then the rest in source order (the cold open is not repeated). */
export function orderedKeptBeats(plan: Pick<EditPlan, "beats" | "hook">): Beat[] {
  const kept = plan.beats.filter((b) => b.keep);
  const cold = kept.find((b) => b.id === plan.hook.coldOpenBeatId);
  return cold ? [cold, ...kept.filter((b) => b !== cold)] : kept;
}

export type PlannedShot = { id: string; beatId: string; inFrame: number; frames: number; speechFrames: number; wordIdx: number[] };

/**
 * Speech cuts (spec §5.2): inside each kept beat, words closer than cutGapMs stay together; every larger gap and every
 * filler is cut. Spans are padded by padMs and snapped to whole frames so picture and voice cut on the same sample.
 * The ending adjusts the last shot: a loop ends on its last word; a CTA continues the picture (not the voice) until
 * the next spoken word or the end of the source, at most ctaMs.
 */
export function planShots(plan: Pick<EditPlan, "beats" | "hook" | "ending" | "source">, words: Word[], style: EditStyle): PlannedShot[] {
  const sourceFrames = Math.floor((plan.source.durationMs * FPS) / 1000);
  const shots: PlannedShot[] = [];
  for (const beat of orderedKeptBeats(plan)) {
    const spans: number[][] = [];
    let current: number[] = [];
    for (let i = beat.startWordIdx; i <= beat.endWordIdx && i < words.length; i++) {
      if (isFiller(words[i].text, style.fillerWords)) {
        if (current.length) spans.push(current);
        current = [];
        continue;
      }
      const prev = current.at(-1);
      if (prev !== undefined && words[i].startMs - words[prev].endMs >= style.cutGapMs) {
        spans.push(current);
        current = [];
      }
      current.push(i);
    }
    if (current.length) spans.push(current);
    let usedUntil = 0;
    spans.forEach((span, k) => {
      const first = words[span[0]];
      const last = words[span[span.length - 1]];
      const inFrame = Math.max(usedUntil, msToFrames(Math.max(0, first.startMs - style.padMs)));
      const outFrame = Math.min(sourceFrames, msToFrames(last.endMs + style.padMs));
      const frames = Math.max(1, outFrame - inFrame);
      usedUntil = inFrame + frames;
      shots.push({ id: `${beat.id}-${k + 1}`, beatId: beat.id, inFrame, frames, speechFrames: frames, wordIdx: span });
    });
  }
  const last = shots.at(-1);
  if (!last) return shots;
  const lastWordIdx = last.wordIdx[last.wordIdx.length - 1];
  if (plan.ending.kind === "loop") {
    last.frames = last.speechFrames = Math.max(1, msToFrames(words[lastWordIdx].endMs) - last.inFrame);
  } else if (plan.ending.kind === "cta") {
    const next = words[lastWordIdx + 1];
    const limit = next ? Math.min(sourceFrames, msToFrames(next.startMs - style.padMs)) : sourceFrames;
    last.frames += Math.max(0, Math.min(msToFrames(style.ctaMs), limit - (last.inFrame + last.frames)));
  }
  return shots;
}

/** The largest zoom that still shows the whole face (with faceMargin); at least 1. */
export function maxScaleFor(face: FaceBox | null, style: EditStyle): number {
  if (!face) return Infinity;
  return Math.max(1, Math.min(1 / (face.w * style.faceMargin), 1 / (face.h * style.faceMargin)));
}

/** Face centre, clamped so the zoomed window (1/scale wide) stays inside the frame. No face: the frame centre. */
export function centerFor(face: FaceBox | null, scale: number): { cx: number; cy: number } {
  if (!face) return { cx: 0.5, cy: 0.5 };
  const half = 1 / (2 * scale);
  const clamp = (v: number) => Math.min(1 - half, Math.max(half, v));
  return { cx: r4(clamp(face.x + face.w / 2)), cy: r4(clamp(face.y + face.h / 2)) };
}

/** Zoom per shot (spec §5.3): repeating zoom steps, centred on the face, push-in on long shots. */
export function shotCrop(index: number, durationMs: number, face: FaceBox | null, style: EditStyle): TimelineCrop {
  const max = maxScaleFor(face, style);
  const scaleFrom = Math.min(style.zoomSteps[index % style.zoomSteps.length], max);
  const scaleTo = durationMs > style.pushInAfterMs ? Math.min(scaleFrom * style.pushInFactor, Math.max(scaleFrom, max)) : scaleFrom;
  return { ...centerFor(face, scaleTo), scaleFrom: r4(scaleFrom), scaleTo: r4(scaleTo) };
}
```
The centre is clamped at `scaleTo`, the tighter of the two scales, so it is valid for the whole push-in.

Append to `packages/core/src/index.ts`: `export * from "./footage/style";`, `export * from "./footage/face-track";`, `export * from "./footage/shots";`.

- [ ] **Step 8: Verify.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS, including the unchanged `assemble`, `render` and `srt` tests. If a frame number in the `planShots` tests is off by one, recheck it by hand against `Math.round` on the fixture times (for example 850 ms × 30 / 1000 = 25.5 → 26) and fix the **implementation**, not the expectation, unless the expectation's arithmetic is wrong; note any change in the report.

- [ ] **Step 9: Commit** with message `feat(core): timeline speaker clips, caption pages, hook/ending/sfx fields; face track smoothing and shot planning`.

---

### Task 5: Caption paging, `compileFootage` and the footage estimate

**Files:**
- Create: `packages/core/src/footage/captions.ts`, `packages/core/src/footage/compile.ts`
- Modify: `packages/core/src/cost.ts`, `packages/core/src/models.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/footage/captions.test.ts`, `packages/core/src/footage/compile.test.ts` (new), `packages/core/src/cost.test.ts` (extend)

**Interfaces:**
- Consumes: Task 4 (`planShots`, `shotCrop`, `maxScaleFor`, `centerFor`, `faceAt`, `msToFrames`, `framesToMs`, `EditStyle`, Timeline additions), Task 2 schemas.
- Produces:
  - `visibleLength(text: string): number`, `type ReelWord = Word & { idx: number; beatId: string }`, `pageWords(words: ReelWord[], style: Pick<EditStyle, "captionMaxChars" | "captionMaxWords">): ReelWord[][]`
  - `type FootageAssets = { videoSrc: string; voiceSrc?: string; musicSrc?: string; sfx: Partial<Record<SfxName, string>> }`
  - `type VoiceSegment = { inMs: number; outMs: number }`
  - `type CompiledFootage = { timeline: Timeline; voiceSegments: VoiceSegment[]; durationMs: number }`
  - `class EmptyEditError`
  - `compileFootage(plan: EditPlan, transcript: Transcript, faceTrack: FaceTrack | null, assets: FootageAssets, style: EditStyle): CompiledFootage`
  - `footageDurationMs(plan, words: Word[], style): number`
  - `withFootageEstimate(plan: EditPlan, words: Word[], style: EditStyle): EditPlan`
  - `DEFAULT_COST_TABLE` gains `"elevenlabs/scribe_v2"` and `"elevenlabs/music"`; `DEFAULT_MODELS` gains `transcribe` and `music`; `estimateFootageCost(plan: Pick<EditPlan, "music">, durationSec: number, table?): number` (USD)

- [ ] **Step 1: Write the failing captions test** `packages/core/src/footage/captions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { pageWords, visibleLength, type ReelWord } from "./captions";

const rw = (texts: string[], beatId = "b1"): ReelWord[] => texts.map((text, i) => ({ text, startMs: i * 300, endMs: i * 300 + 250, idx: i, beatId }));
const pages = (ws: ReelWord[]) => pageWords(ws, { captionMaxChars: 22, captionMaxWords: 3 }).map((p) => p.map((w) => w.text).join(" "));

describe("visibleLength", () => {
  it("doesn't count niqqud, counts maqaf and emoji as visible", () => {
    expect(visibleLength("שָׁלוֹם")).toBe(4);
    expect(visibleLength("בית־ספר")).toBe(7);
    expect(visibleLength("👇")).toBe(1);
  });
});

describe("pageWords", () => {
  it("makes pages of up to 3 words", () => {
    expect(pages(rw(["אחת", "שתיים", "שלוש", "ארבע", "חמש"]))).toEqual(["אחת שתיים שלוש", "ארבע חמש"]);
  });
  it("breaks at punctuation first", () => {
    expect(pages(rw(["היי", "חברים,", "היום", "אני", "אראה"]))).toEqual(["היי חברים,", "היום אני אראה"]);
    expect(pages(rw(["סוף.", "התחלה", "חדשה"]))).toEqual(["סוף.", "התחלה חדשה"]);
  });
  it("keeps every page within 22 visible characters, niqqud not counted", () => {
    const ws = rw(["אָנֹכִי", "מְדַבֵּר", "עַכְשָׁו", "בְּעִבְרִית", "מְנֻקֶּדֶת"]);
    for (const p of pageWords(ws, { captionMaxChars: 22, captionMaxWords: 3 })) {
      expect(visibleLength(p.map((w) => w.text).join(" "))).toBeLessThanOrEqual(22);
    }
    expect(pages(rw(["אינטרנציונליזציה", "ממש", "ארוכה"]))).toEqual(["אינטרנציונליזציה ממש", "ארוכה"]);
  });
  it("puts a word longer than 22 characters alone on its page and never splits a maqaf word", () => {
    expect(pages(rw(["שלום", "סופרקליפרג׳יליסטיקאקספיאלידושס", "בית־ספר"]))).toEqual(["שלום", "סופרקליפרג׳יליסטיקאקספיאלידושס", "בית־ספר"]);
  });
  it("never puts two beats on one page", () => {
    expect(pages([...rw(["א", "ב"], "b1"), ...rw(["ג", "ד"], "b2")])).toEqual(["א ב", "ג ד"]);
  });
});
```
Run `npx vitest run packages/core/src/footage/captions.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** `packages/core/src/footage/captions.ts`:
```ts
import type { Word } from "../schema/timeline";
import type { EditStyle } from "./style";

export type ReelWord = Word & { idx: number; beatId: string };

/** Characters a viewer sees: combining marks (niqqud, cantillation) don't take width; maqaf and emoji count once. */
export const visibleLength = (text: string) => [...text.normalize("NFC").replace(/\p{M}/gu, "")].length;

const SENTENCE_END = /[.!?…׃]["'״”’)\]]*$/u;
const CLAUSE_END = /[,;:،]["'״”’)\]]*$/u;

/** Caption pages (spec §5.6): about 3 words, at most captionMaxChars, breaking at punctuation first, never across beats. */
export function pageWords(words: ReelWord[], style: Pick<EditStyle, "captionMaxChars" | "captionMaxWords">): ReelWord[][] {
  const pages: ReelWord[][] = [];
  let page: ReelWord[] = [];
  const text = (ws: ReelWord[]) => ws.map((w) => w.text).join(" ");
  for (const w of words) {
    if (page.length && (page[0].beatId !== w.beatId || page.length >= style.captionMaxWords || visibleLength(text([...page, w])) > style.captionMaxChars)) {
      pages.push(page);
      page = [];
    }
    page.push(w);
    if (SENTENCE_END.test(w.text) || (CLAUSE_END.test(w.text) && page.length >= 2)) {
      pages.push(page);
      page = [];
    }
  }
  if (page.length) pages.push(page);
  return pages;
}
```

- [ ] **Step 3: Write the failing compile test** `packages/core/src/footage/compile.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { TimelineSchema } from "../schema/timeline";
import { parseEditPlan, type EditPlan } from "../schema/edit-plan";
import { faceTrackFixture, footageTranscript, testEditStyle, validEditPlan } from "../testing/fixtures";
import { compileFootage, EmptyEditError, footageDurationMs, withFootageEstimate, type FootageAssets } from "./compile";

const style = testEditStyle();
const transcript = footageTranscript();
const ALL_SFX = { whoosh1: "w1.wav", whoosh2: "w2.wav", pop1: "p1.wav", pop2: "p2.wav", tick: "t.wav", riser: "r.wav", ding: "d.wav", swoosh_out: "s.wav" };
const assets: FootageAssets = { videoSrc: "asset:work.mp4", voiceSrc: "asset:voice.wav", sfx: ALL_SFX };
const plan = (over: Partial<EditPlan> = {}) => parseEditPlan({ ...validEditPlan(), ...over });
const compile = (p = plan(), face = faceTrackFixture()) => compileFootage(p, transcript, face, assets, style);

describe("compileFootage", () => {
  it("lays speaker clips back to back on the planned shots", () => {
    const { timeline, durationMs } = compile();
    expect(TimelineSchema.safeParse(timeline).success).toBe(true);
    expect(timeline.clips.map((c) => [c.sceneId, c.kind, c.fromFrame, c.durationInFrames])).toEqual([
      ["b1-1", "speaker", 0, 26], ["b1-2", "speaker", 26, 63], ["b2-1", "speaker", 89, 57], ["b3-1", "speaker", 146, 72],
    ]);
    expect(timeline.durationInFrames).toBe(218);
    expect(durationMs).toBeCloseTo((218 * 1000) / 30, 6);
    expect(timeline.clips.every((c) => c.src === "asset:work.mp4" && c.layout === undefined)).toBe(true);
    expect(timeline.clips[1].source!.inMs).toBeCloseTo(1466.667, 2);
  });

  it("returns the voice segments for the cut audio, without the CTA extension", () => {
    const segs = compile().voiceSegments.map((s) => [Math.round(s.inMs), Math.round(s.outMs)]);
    expect(segs).toEqual([[0, 867], [1467, 3567], [4167, 6067], [6600, 8267]]);
  });

  it("remaps caption words from source time to reel time", () => {
    const words = compile().timeline.captions.words;
    expect(words.map((w) => w.text)).toEqual(["היי", "חברים,", "היום", "אני", "אראה", "לכם", "טריק.", "זה", "חוסך", "שעות", "עבודה.", "תכתבו", "AI", "בתגובות."]);
    expect(words[2].startMs).toBe(900); // "היום": shot b1-2 starts at reel 866.7 ms and source 1466.7 ms
    expect(words[7].startMs).toBe(3000); // "זה"
    for (let i = 1; i < words.length; i++) expect(words[i].startMs).toBeGreaterThanOrEqual(words[i - 1].startMs);
  });

  it("builds pill caption pages with the red word and the emoji", () => {
    const pages = compile().timeline.captions.pages!;
    expect(pages.map((p) => p.words.map((w) => w.text).join(" "))).toEqual(["היי חברים,", "היום אני אראה", "לכם טריק.", "זה חוסך שעות", "עבודה.", "תכתבו AI בתגובות."]);
    expect(pages[2].words.map((w) => w.emphasis)).toEqual([false, true]);
    expect(pages[4].emoji).toBe("👇");
    expect(pages.filter((p) => p.emoji)).toHaveLength(1);
    for (let i = 0; i < pages.length - 1; i++) expect(pages[i].fromFrame + pages[i].durationInFrames).toBe(pages[i + 1].fromFrame);
    expect(pages.at(-1)!.fromFrame + pages.at(-1)!.durationInFrames).toBe(196); // speech ends 22 frames before the end
  });

  it("adds the hook: headline over 0–2 s and a zoom hit on the first shot", () => {
    const { timeline } = compile();
    expect(timeline.hook).toEqual({ patternBreak: "zoom_hit", headline: { small: "הטריק ש", big: "חוסך שעות", fromFrame: 0, durationInFrames: 60 } });
    expect(timeline.clips[0].crop).toMatchObject({ scaleFrom: 1, scaleTo: 1.3, punchFrames: 6 });
  });

  it("zooms by shot, centred on the face", () => {
    const crops = compile().timeline.clips.map((c) => c.crop!);
    expect(crops.slice(1).map((c) => [c.scaleFrom, c.scaleTo, c.cx, c.cy])).toEqual([[1.15, 1.242, 0.5, 0.4026], [1.25, 1.25, 0.5, 0.4], [1, 1.08, 0.5, 0.463]]);
    const centred = compileFootage(plan(), transcript, null, assets, style).timeline.clips.map((c) => [c.crop!.cx, c.crop!.cy]);
    expect(centred.every(([x, y]) => x === 0.5 && y === 0.5)).toBe(true);
  });

  it("CTA: a 2.5 s card at the end", () => {
    expect(compile().timeline.ending).toEqual({ kind: "cta", keyword: "AI", fromFrame: 143, durationInFrames: 75 });
  });

  it("loop: ends on the last word and drops the flash so the replay flows on", () => {
    const { timeline } = compile(plan({ ending: { kind: "loop" }, hook: { patternBreak: "flash", reason: "" } }));
    expect(timeline.ending).toEqual({ kind: "loop" });
    expect(timeline.hook!.patternBreak).toBe("none");
    expect(timeline.durationInFrames).toBe(26 + 63 + 57 + 48);
  });

  it("subtle and lively sound effects, skipping effects that aren't installed", () => {
    const cues = (p: EditPlan, a = assets) => compileFootage(p, transcript, faceTrackFixture(), a, style).timeline.sfx?.map((c) => `${c.name}@${c.frame}`);
    expect(cues(plan())).toEqual(["whoosh1@0", "pop1@12", "pop2@18", "pop1@143"]);
    expect(cues(plan({ sfx: "lively" }))).toEqual(["whoosh1@0", "pop1@12", "pop2@18", "tick@26", "tick@89", "pop1@143"]);
    expect(cues(plan({ sfx: "off" }))).toBeUndefined();
    expect(cues(plan(), { ...assets, sfx: { pop1: "p1.wav" } })).toEqual(["pop1@12", "pop1@143"]);
  });

  it("uses the music bed level and the pill preset", () => {
    const { timeline } = compileFootage(plan(), transcript, null, { ...assets, musicSrc: "asset:m.wav" }, style);
    expect(timeline.audio).toEqual({ voiceUrl: "asset:voice.wav", musicUrl: "asset:m.wav", musicDuckingDb: -12 });
    expect(timeline.style.captionPreset).toBe("pill");
    expect(timeline.direction).toBe("rtl");
  });

  it("refuses an edit with nothing left to show", () => {
    const fillers = { ...transcript, words: [{ text: "אממ", startMs: 0, endMs: 500 }, { text: "אהה", startMs: 900, endMs: 1600 }] };
    const p = plan({ beats: [{ id: "b1", startWordIdx: 0, endWordIdx: 1, keep: true }], hook: { patternBreak: "none", reason: "" } });
    expect(() => compileFootage(p, fillers, null, assets, style)).toThrow(EmptyEditError);
    expect(() => compileFootage(p, fillers, null, assets, style)).toThrow(/Keep at least one beat with speech/);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(compile())).toBe(JSON.stringify(compile()));
  });
});

describe("estimate", () => {
  it("matches the compiled length and prices AI music per second", () => {
    expect(footageDurationMs(plan(), transcript.words, style)).toBeCloseTo(compile().durationMs, 6);
    expect(withFootageEstimate(plan(), transcript.words, style).estimate).toEqual({ durationSec: 7.3, credits: 0 });
    expect(withFootageEstimate(plan({ music: { kind: "ai", prompt: "calm lo-fi" } }), transcript.words, style).estimate).toEqual({ durationSec: 7.3, credits: 0.08 });
  });
});
```
Run `npx vitest run packages/core/src/footage/compile.test.ts`. Expected: FAIL.

- [ ] **Step 4: Add costs.** In `packages/core/src/models.ts` add to `DEFAULT_MODELS`: `transcribe: "elevenlabs/scribe_v2",` and `music: "elevenlabs/music",`. In `packages/core/src/cost.ts`:
```ts
export const DEFAULT_COST_TABLE: CostTable = {
  "higgsfield-ai/soul/v2/standard": { perImage: 0.04 },
  "bytedance/seedance-2.5/image-to-video": { perSecond: 0.08 },
  "elevenlabs/eleven_v4": { per1kChars: 0.3 },
  // Scribe: about $0.40 per hour of audio (spec §4.2).
  "elevenlabs/scribe_v2": { perSecond: 0.4 / 3600 },
  // ElevenLabs Music: a planning number. Check it against the team's ElevenLabs plan before the first paid run.
  "elevenlabs/music": { perSecond: 0.01 },
};
```
and add (import `type EditPlan` from `./schema/edit-plan`):
```ts
/** Generation spend of an approved footage plan, in USD. Plan 1's only paid generation is AI music, fitted to the reel. */
export function estimateFootageCost(plan: Pick<EditPlan, "music">, durationSec: number, table: CostTable = DEFAULT_COST_TABLE): number {
  return plan.music.kind === "ai" ? Math.ceil(durationSec) * price(table, "elevenlabs/music", "perSecond") : 0;
}
```
Extend `cost.test.ts`: `estimateFootageCost({ music: { kind: "ai", prompt: "x" } }, 7.3)` is `0.08` (toBeCloseTo), `{ kind: "none" }` and `{ kind: "library", assetId: <uuid> }` are 0, and a table without `elevenlabs/music` throws `UnknownCostModelError` for AI music.

- [ ] **Step 5: Implement** `packages/core/src/footage/compile.ts`:
```ts
import { FPS } from "../assemble";
import { estimateFootageCost } from "../cost";
import type { EditPlan } from "../schema/edit-plan";
import type { FaceTrack, Transcript } from "../schema/footage";
import { TimelineSchema, type SfxName, type Timeline, type TimelineClip, type Word } from "../schema/timeline";
import { pageWords, type ReelWord } from "./captions";
import { faceAt } from "./face-track";
import { centerFor, framesToMs, maxScaleFor, msToFrames, planShots, shotCrop } from "./shots";
import type { EditStyle } from "./style";

export type FootageAssets = { videoSrc: string; voiceSrc?: string; musicSrc?: string; sfx: Partial<Record<SfxName, string>> };
export type VoiceSegment = { inMs: number; outMs: number };
export type CompiledFootage = { timeline: Timeline; voiceSegments: VoiceSegment[]; durationMs: number };

export class EmptyEditError extends Error {
  constructor() {
    super("Nothing to show: no kept beat has speech left after cutting pauses and fillers. Keep at least one beat with speech.");
    this.name = "EmptyEditError";
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const splitWords = (s: string) => s.trim().split(/\s+/).filter(Boolean);

export function footageDurationMs(plan: Pick<EditPlan, "beats" | "hook" | "ending" | "source">, words: Word[], style: EditStyle): number {
  return framesToMs(planShots(plan, words, style).reduce((n, s) => n + s.frames, 0));
}

/** Fills plan.estimate (spec §5.10): reel length, and generation cost in USD. Never trusted from a client. */
export function withFootageEstimate(plan: EditPlan, words: Word[], style: EditStyle): EditPlan {
  const durationSec = Math.round(footageDurationMs(plan, words, style) / 100) / 10;
  return { ...plan, estimate: { durationSec, credits: Math.round(estimateFootageCost(plan, durationSec) * 100) / 100 } };
}

/** The edit compiler (spec §5): deterministic, no I/O. Plan 1 ignores cutaways (parseEditPlan already rejects them). */
export function compileFootage(plan: EditPlan, transcript: Transcript, faceTrack: FaceTrack | null, assets: FootageAssets, style: EditStyle): CompiledFootage {
  const words = transcript.words;
  const shots = planShots(plan, words, style);
  if (!shots.length) throw new EmptyEditError();
  const total = shots.reduce((n, s) => n + s.frames, 0);
  const requested = plan.hook.patternBreak === "broll" ? "none" : plan.hook.patternBreak;
  const patternBreak = plan.ending.kind === "loop" && requested === "flash" ? "none" : requested;

  const clips: TimelineClip[] = [];
  const reelWords: ReelWord[] = [];
  const voiceSegments: VoiceSegment[] = [];
  let at = 0;
  shots.forEach((shot, i) => {
    const inMs = framesToMs(shot.inFrame);
    const face = faceTrack ? faceAt(faceTrack, framesToMs(shot.inFrame + shot.speechFrames / 2)) : null;
    let crop = shotCrop(i, framesToMs(shot.frames), face, style);
    if (i === 0 && patternBreak === "zoom_hit") {
      const to = r4(Math.max(1, Math.min(style.zoomHitScale, maxScaleFor(face, style))));
      crop = { ...centerFor(face, to), scaleFrom: 1, scaleTo: to, punchFrames: style.zoomHitFrames };
    }
    clips.push({
      sceneId: shot.id, kind: "speaker", src: assets.videoSrc, fromFrame: at, durationInFrames: shot.frames,
      motion: "none", transitionIn: "cut", source: { inMs: r3(inMs), outMs: r3(framesToMs(shot.inFrame + shot.frames)) }, crop,
    });
    voiceSegments.push({ inMs: r3(inMs), outMs: r3(framesToMs(shot.inFrame + shot.speechFrames)) });
    const startMs = framesToMs(at);
    const endMs = framesToMs(at + shot.speechFrames);
    for (const idx of shot.wordIdx) {
      const w = words[idx];
      reelWords.push({
        text: w.text, idx, beatId: shot.beatId,
        startMs: Math.round(clampN(startMs + w.startMs - inMs, startMs, endMs)),
        endMs: Math.round(clampN(startMs + w.endMs - inMs, startMs, endMs)),
      });
    }
    at += shot.frames;
  });

  const lastShot = shots[shots.length - 1];
  const speechEndFrame = total - (lastShot.frames - lastShot.speechFrames);
  const beats = new Map(plan.beats.map((b) => [b.id, b]));
  const groups = pageWords(reelWords, style);
  const pages = groups.map((g, i) => {
    const next = groups[i + 1];
    const fromFrame = msToFrames(g[0].startMs);
    const endFrame = next ? msToFrames(next[0].startMs) : speechEndFrame;
    const beat = beats.get(g[0].beatId)!;
    const lastOfBeat = !next || next[0].beatId !== g[0].beatId;
    return {
      fromFrame,
      durationInFrames: Math.max(1, endFrame - fromFrame),
      words: g.map((w) => ({ text: w.text, emphasis: w.idx === beat.emphasisWordIdx })),
      ...(lastOfBeat && beat.emoji ? { emoji: beat.emoji } : {}),
    };
  });

  const headline = plan.hook.headline;
  const hook = {
    patternBreak,
    ...(headline ? { headline: { small: headline.small, big: headline.big, fromFrame: 0, durationInFrames: Math.min(total, msToFrames(style.headlineMs)) } } : {}),
  };
  const ctaFrames = Math.min(total, msToFrames(style.ctaMs));
  const ending =
    plan.ending.kind === "cta"
      ? { kind: "cta" as const, keyword: plan.ending.keyword, fromFrame: total - ctaFrames, durationInFrames: ctaFrames }
      : { kind: plan.ending.kind };

  const cues: { name: SfxName; frame: number; volumeDb: number }[] = [];
  if (plan.sfx !== "off") {
    const whooshes: SfxName[] = ["whoosh1", "whoosh2"];
    const pops: SfxName[] = ["pop1", "pop2"];
    let pop = 0;
    if (patternBreak !== "none" || headline) cues.push({ name: whooshes[0], frame: 0, volumeDb: style.sfxVolumeDb.whoosh });
    if (headline) {
      const small = splitWords(headline.small).length;
      splitWords(headline.big).forEach((_, j) => cues.push({ name: pops[pop++ % 2], frame: (small + j) * style.headlineWordFrames, volumeDb: style.sfxVolumeDb.pop }));
    }
    if (ending.kind === "cta") cues.push({ name: pops[pop++ % 2], frame: ending.fromFrame, volumeDb: style.sfxVolumeDb.pop });
    if (plan.sfx === "lively") {
      clips.forEach((c, i) => {
        if (i === 0 || c.crop!.scaleFrom === clips[i - 1].crop!.scaleFrom) return;
        if (cues.some((q) => Math.abs(q.frame - c.fromFrame) <= 3)) return;
        cues.push({ name: "tick", frame: c.fromFrame, volumeDb: style.sfxVolumeDb.tick });
      });
    }
  }
  const sfx = cues
    .filter((c) => assets.sfx[c.name] && c.frame < total)
    .sort((a, b) => a.frame - b.frame || a.name.localeCompare(b.name))
    .map((c) => ({ ...c, src: assets.sfx[c.name]! }));

  const timeline = TimelineSchema.parse({
    fps: FPS,
    width: 1080,
    height: 1920,
    durationInFrames: total,
    language: plan.language,
    direction: plan.language === "he" ? "rtl" : "ltr",
    style: { captionPreset: "pill", font: "Heebo", palette: ["#FEE80A", "#000000"] },
    audio: { voiceUrl: assets.voiceSrc, musicUrl: assets.musicSrc, musicDuckingDb: style.musicUnderVoiceDb },
    clips,
    captions: { words: reelWords.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })), pages },
    overlays: [],
    hook,
    ending,
    ...(sfx.length ? { sfx } : {}),
  });
  return { timeline, voiceSegments, durationMs: framesToMs(total) };
}
```
Note on the pop rotation: the test expects the CTA pop to be `pop1` after two headline pops (`pop1`, `pop2`), which the shared `pop` counter gives.

Append `export * from "./footage/captions";` and `export * from "./footage/compile";` to the core index.

- [ ] **Step 6: Verify.** Run `npx vitest run packages && npm run typecheck`. Expected: PASS. The expected numbers in the compile test follow from the Task 4 fixture layout; if `withFootageEstimate`'s `durationSec` rounds differently (218 frames = 7266.7 ms → 7.3 s), fix the rounding, not the test.

- [ ] **Step 7: Commit** with message `feat(core): compileFootage turns an approved edit plan into a timeline; pill caption paging and the footage estimate`.

---

### Task 6: Audio building blocks and the sound-effect pack

**Files:**
- Create: `packages/media/src/footage.ts`, `packages/video/src/sfx.ts`, `packages/engine/scripts/generate-sfx.ts`
- Modify: `packages/media/src/index.ts`, `packages/media/src/testing.ts`, `packages/video/package.json` (exports `"./sfx": "./src/sfx.ts"`), root `package.json` (script `sfx:generate`)
- Test: `packages/media/src/footage.test.ts`, `packages/video/src/sfx.test.ts`

**Interfaces:**
- Produces (media):
  - `sha256File(path: string): Promise<string>`
  - `concatAudioSegments(input: string, segments: { inMs: number; outMs: number }[], output: string, fadeMs?: number): Promise<void>` (48 kHz, sample-exact cuts, 5 ms fades)
  - `fitMusic(input: string, output: string, durationSec: number, fadeOutSec?: number): Promise<void>` (loops short tracks, trims long ones, fades out)
  - testing: `makeSfxPlaceholders(dir: string, names: readonly string[]): Promise<void>` (writes `<name>.wav`), `averageLuma(image: string): Promise<number>` (0–255)
- Produces (video, Node only, `@reel/video/sfx`): `SFX_DIR`, `SFX_PROMPTS: Record<SfxName, { text: string; durationSec: number }>`, `sfxFileIn(dir: string, name: SfxName): string | null` (`.mp3` or `.wav`), `missingSfx(dir: string): SfxName[]`
- Produces (script): `npm run sfx:generate -- --yes` (paid; never run by a task)

- [ ] **Step 1: Write the failing media test** `packages/media/src/footage.test.ts`:
```ts
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { concatAudioSegments, fitMusic, sha256File } from "./footage";
import { probe } from "./probe";
import { averageLuma, makeSfxPlaceholders, makeTestImage, makeTestTone } from "./testing";

const dir = () => mkdtemp(join(tmpdir(), "media-footage-"));

describe("footage audio", () => {
  it("joins segments into one 48 kHz track whose length is the sum of the segments", async () => {
    const d = await dir();
    await makeTestTone(join(d, "src.wav"), { durationSec: 4 });
    const segs = [{ inMs: 0, outMs: 866.667 }, { inMs: 1466.667, outMs: 3566.667 }, { inMs: 3600, outMs: 3700 }];
    await concatAudioSegments(join(d, "src.wav"), segs, join(d, "out.wav"));
    const info = await probe(join(d, "out.wav"));
    expect(info.audio?.sampleRate).toBe(48000);
    expect(info.durationSec).toBeCloseTo((866.667 + 2100 + 100) / 1000, 2);
  });
  it("rejects no segments and reversed segments", async () => {
    const d = await dir();
    await makeTestTone(join(d, "src.wav"), { durationSec: 1 });
    await expect(concatAudioSegments(join(d, "src.wav"), [], join(d, "o.wav"))).rejects.toThrow(/at least one segment/);
    await expect(concatAudioSegments(join(d, "src.wav"), [{ inMs: 500, outMs: 400 }], join(d, "o.wav"))).rejects.toThrow(/outMs/);
  });
  it("loops a short music track and trims a long one to the reel", async () => {
    const d = await dir();
    await makeTestTone(join(d, "short.wav"), { durationSec: 2 });
    await fitMusic(join(d, "short.wav"), join(d, "looped.wav"), 5);
    expect((await probe(join(d, "looped.wav"))).durationSec).toBeCloseTo(5, 1);
    await makeTestTone(join(d, "long.wav"), { durationSec: 10 });
    await fitMusic(join(d, "long.wav"), join(d, "trimmed.wav"), 3);
    expect((await probe(join(d, "trimmed.wav"))).durationSec).toBeCloseTo(3, 1);
  });
  it("hashes a file like createHash does", async () => {
    const d = await dir();
    await writeFile(join(d, "x.bin"), "hello");
    expect(await sha256File(join(d, "x.bin"))).toBe(createHash("sha256").update(await readFile(join(d, "x.bin"))).digest("hex"));
  });
});

describe("test helpers", () => {
  it("writes one short placeholder tone per sound effect", async () => {
    const d = await dir();
    await makeSfxPlaceholders(d, ["pop1", "tick"]);
    const info = await probe(join(d, "pop1.wav"));
    expect(info.durationSec).toBeGreaterThan(0.1);
    expect(info.durationSec).toBeLessThan(0.6);
  });
  it("measures average luma", async () => {
    const d = await dir();
    await makeTestImage(join(d, "white.png"), { width: 64, height: 64, color: "white" });
    await makeTestImage(join(d, "black.png"), { width: 64, height: 64, color: "black" });
    expect(await averageLuma(join(d, "white.png"))).toBeGreaterThan(230);
    expect(await averageLuma(join(d, "black.png"))).toBeLessThan(25);
  });
});
```
Run `npx vitest run packages/media/src/footage.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** `packages/media/src/footage.ts` and export it from `packages/media/src/index.ts` (`export * from "./footage";`):
```ts
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { runFfmpeg } from "./run";

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

const SAMPLE_RATE = 48_000;

/**
 * Cuts the given spans out of the input's audio and joins them, in order. Cuts are sample-exact at 48 kHz (a 30 fps
 * frame is exactly 1600 samples), so the voice stays in sync with the picture over 100+ cuts. Each piece gets a short
 * fade in and out so the joins don't click.
 */
export async function concatAudioSegments(input: string, segments: { inMs: number; outMs: number }[], output: string, fadeMs = 5): Promise<void> {
  if (!segments.length) throw new RangeError("concatAudioSegments needs at least one segment");
  const parts = segments.map((s, i) => {
    if (s.outMs <= s.inMs) throw new RangeError(`segment ${i}: outMs (${s.outMs}) must be greater than inMs (${s.inMs})`);
    const start = Math.round((s.inMs * SAMPLE_RATE) / 1000);
    const end = Math.round((s.outMs * SAMPLE_RATE) / 1000);
    const d = (end - start) / SAMPLE_RATE;
    const fade = Math.min(fadeMs / 1000, d / 4).toFixed(4);
    return `[0:a]aresample=${SAMPLE_RATE},atrim=start_sample=${start}:end_sample=${end},asetpts=PTS-STARTPTS,afade=t=in:d=${fade},afade=t=out:st=${(d - Number(fade)).toFixed(4)}:d=${fade}[a${i}]`;
  });
  const graph = `${parts.join(";")};${segments.map((_, i) => `[a${i}]`).join("")}concat=n=${segments.length}:v=0:a=1[out]`;
  await runFfmpeg(["-i", input, "-filter_complex", graph, "-map", "[out]", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", output]);
}

/** Fits a music track to the reel: loops it if short, trims it if long, and fades out at the end. */
export async function fitMusic(input: string, output: string, durationSec: number, fadeOutSec = 1.5): Promise<void> {
  if (!(durationSec > 0)) throw new RangeError(`durationSec must be > 0, got ${durationSec}`);
  const fade = Math.min(fadeOutSec, durationSec / 2);
  await runFfmpeg([
    "-stream_loop", "-1", "-i", input, "-t", durationSec.toFixed(3), "-vn",
    "-af", `afade=t=out:st=${(durationSec - fade).toFixed(3)}:d=${fade.toFixed(3)},aresample=${SAMPLE_RATE}`,
    "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", output,
  ]);
}
```
For a 3-minute talk the filter graph holds about 100 short segment chains; that is well within FFmpeg's argument limits. If a real run ever hits an argument-length error, write the graph to a file and pass `-/filter_complex <file>` (FFmpeg 7+).

- [ ] **Step 3: Add the test helpers** to `packages/media/src/testing.ts`:
```ts
/** Short sine blips standing in for the sound-effect pack (tests and the fake worker). */
export async function makeSfxPlaceholders(dir: string, names: readonly string[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [i, name] of names.entries()) {
    await runFfmpeg([
      "-f", "lavfi", "-i", `sine=frequency=${600 + i * 120}:sample_rate=48000:duration=0.25`,
      "-af", "volume=-12dB,afade=t=out:st=0.15:d=0.1", "-c:a", "pcm_s16le", join(dir, `${name}.wav`),
    ]);
  }
}

/** Average luma (0–255) of an image, via FFmpeg's signalstats. */
export async function averageLuma(image: string): Promise<number> {
  const { stderr } = await runFfmpeg(["-i", image, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"]);
  const match = stderr.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  if (!match) throw new Error(`no YAVG in ffmpeg output for ${image}`);
  return Number(match[1]);
}
```
with `import { mkdir } from "node:fs/promises";` and `import { join } from "node:path";` at the top. If `metadata=print` writes nothing to stderr with `-hide_banner`, add `"-loglevel", "info"` before `"-i"`.

- [ ] **Step 4: Write the failing sfx test** `packages/video/src/sfx.test.ts`:
```ts
import { SFX_NAMES } from "@reel/core";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingSfx, SFX_DIR, SFX_PROMPTS, sfxFileIn } from "./sfx";

describe("sound-effect pack", () => {
  it("has a prompt for every sound, each 0.5–3 s (ElevenLabs minimum 0.5 s)", () => {
    expect(Object.keys(SFX_PROMPTS).sort()).toEqual([...SFX_NAMES].sort());
    for (const p of Object.values(SFX_PROMPTS)) {
      expect(p.durationSec).toBeGreaterThanOrEqual(0.5);
      expect(p.durationSec).toBeLessThanOrEqual(3);
    }
  });
  it("finds .mp3 or .wav files and lists what is missing", async () => {
    const d = await mkdtemp(join(tmpdir(), "sfx-"));
    await writeFile(join(d, "pop1.mp3"), "x");
    await writeFile(join(d, "tick.wav"), "x");
    expect(sfxFileIn(d, "pop1")).toBe(join(d, "pop1.mp3"));
    expect(sfxFileIn(d, "tick")).toBe(join(d, "tick.wav"));
    expect(sfxFileIn(d, "ding")).toBeNull();
    expect(missingSfx(d)).toEqual(SFX_NAMES.filter((n) => n !== "pop1" && n !== "tick"));
  });
  it("points at packages/video/assets/sfx", () => {
    expect(SFX_DIR.replaceAll("\\", "/")).toMatch(/packages\/video\/assets\/sfx$/);
  });
});
```
Run `npx vitest run packages/video/src/sfx.test.ts`. Expected: FAIL.

- [ ] **Step 5: Implement** `packages/video/src/sfx.ts` and add `"./sfx": "./src/sfx.ts"` to the `@reel/video` exports:
```ts
import { SFX_NAMES, type SfxName } from "@reel/core";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Committed sound-effect pack (generated once with `npm run sfx:generate -- --yes`, checked by ear). */
export const SFX_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets/sfx");

export const SFX_PROMPTS: Record<SfxName, { text: string; durationSec: number }> = {
  whoosh1: { text: "Short fast airy whoosh transition, clean, no music", durationSec: 0.6 },
  whoosh2: { text: "Quick bright swish whoosh, clean, no music", durationSec: 0.5 },
  pop1: { text: "Soft bubbly UI pop, very short, clean", durationSec: 0.5 },
  pop2: { text: "Light plucky click pop, very short, clean", durationSec: 0.5 },
  tick: { text: "Very soft subtle tick, like a quiet clock, very short", durationSec: 0.5 },
  riser: { text: "Short clean tension riser building up", durationSec: 1.2 },
  ding: { text: "Single bright notification ding, clean", durationSec: 0.8 },
  swoosh_out: { text: "Soft swoosh moving away and fading out", durationSec: 0.7 },
};

export function sfxFileIn(dir: string, name: SfxName): string | null {
  for (const ext of ["mp3", "wav"]) {
    const file = path.join(dir, `${name}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

export const missingSfx = (dir: string): SfxName[] => SFX_NAMES.filter((n) => !sfxFileIn(dir, n));
```

- [ ] **Step 6: Write the generation script** `packages/engine/scripts/generate-sfx.ts` (do **not** run it), and add `"sfx:generate": "tsx packages/engine/scripts/generate-sfx.ts"` to the root `package.json` scripts:
```ts
// PAID: calls ElevenLabs sound effects once per sound. Run only with the user's explicit OK, after stating the cost.
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { SFX_NAMES } from "@reel/core";
import { SFX_DIR, SFX_PROMPTS } from "@reel/video/sfx";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvFile } from "../src/config";

const total = SFX_NAMES.reduce((s, n) => s + SFX_PROMPTS[n].durationSec, 0);
console.log(`This generates ${SFX_NAMES.length} sound effects (${total.toFixed(1)} s in total) with ElevenLabs into ${SFX_DIR}.`);
console.log("It spends ElevenLabs credits once; listen to every file before committing it.");
if (!process.argv.includes("--yes")) {
  console.log("Nothing was generated. Re-run with --yes to spend the credits.");
  process.exit(0);
}
loadEnvFile();
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY in .env.local");
const client = new ElevenLabsClient({ apiKey });
await mkdir(SFX_DIR, { recursive: true });
for (const name of SFX_NAMES) {
  const { text, durationSec } = SFX_PROMPTS[name];
  const stream = await client.textToSoundEffects.convert({ text, durationSeconds: durationSec, promptInfluence: 0.6, modelId: "eleven_text_to_sound_v2", outputFormat: "mp3_44100_128" });
  const file = join(SFX_DIR, `${name}.mp3`);
  await writeFile(file, Buffer.from(await new Response(stream).arrayBuffer()));
  console.log(`wrote ${file}`);
}
```
Check the request fields against `node_modules/@elevenlabs/elevenlabs-js/api/resources/textToSoundEffects/client/requests/CreateSoundEffectRequest.d.ts` (2.70.0 has `text`, `durationSeconds`, `promptInfluence`, `modelId`, `outputFormat`, `loop`). Run only `npx tsx packages/engine/scripts/generate-sfx.ts` **without** `--yes` to confirm it prints the notice and exits 0 without a network call.

- [ ] **Step 7: Verify.** Run `npx vitest run packages/media packages/video/src/sfx.test.ts && npm run typecheck`. Expected: PASS.

- [ ] **Step 8: Commit** with message `feat(media): sample-exact audio cuts, music fitting, file hashing; sound-effect pack loader and paid generation script`.

---
### Task 7: Remotion components, `houseStyle` and footage SRT

**Files:**
- Create:
  - `packages/video/src/house-style.ts`
  - `packages/video/src/footage/motion.ts`
  - `packages/video/src/footage/SpeakerShot.tsx`, `PillCaptions.tsx`, `HookHeadline.tsx`, `PatternBreak.tsx`, `CtaCard.tsx`, `SfxCues.tsx`
  - `packages/video/src/sample-footage.ts`
- Modify: `packages/video/src/Reel.tsx`, `packages/video/src/srt.ts`, `packages/video/src/fonts.ts` (no change needed if Heebo 800 is already loaded; it is), `packages/video/package.json` (exports `"./house-style"`, `"./sample-footage"`), `packages/engine/src/pipeline.ts` (SRT via `srtFor`)
- Test: `packages/video/src/footage/motion.test.ts`, `packages/video/src/house-style.test.ts`, `packages/video/src/footage-render.test.ts` (new), `packages/video/src/srt.test.ts` (extend), `packages/engine/src/footage-render.test.ts` (new)

**Interfaces:**
- Consumes: Timeline additions (Task 4), `EditStyleSchema` (Task 4), `averageLuma`, `makeTestVideo` (Task 6 / existing), `serveDir` (engine).
- Produces:
  - `houseStyle` (`@reel/video/house-style`, browser-safe): `{ edit: EditStyle; captions; headline; cta; flash }`
  - `speakerScale`, `speakerTransform(crop, frame, durationInFrames): string`, `popIn(frame, frames, from): number`, `revealedCount(total, frame, wordFrames): number`, `ctaLines(keyword, language)`
  - Components `SpeakerShot({ clip })`, `PillCaptions({ timeline })`, `HookHeadline({ timeline })`, `PatternBreak({ timeline })`, `CtaCard({ timeline })`, `SfxCues({ timeline })`
  - `sampleFootageTimeline(lang: "he" | "en", videoSrc?: string): Timeline` (`@reel/video/sample-footage`)
  - `buildSrtFromPages(pages: CaptionPage[], fps: number): string`, `srtFor(timeline: Timeline): string`

- [ ] **Step 1: Write the failing pure tests.**

`packages/video/src/footage/motion.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ctaLines, popIn, revealedCount, speakerTransform } from "./motion";

describe("speakerTransform", () => {
  const punch = { cx: 0.5, cy: 0.4, scaleFrom: 1, scaleTo: 1.3, punchFrames: 6 };
  it("punches in over punchFrames and holds, moving the face centre to the frame centre", () => {
    expect(speakerTransform(punch, 0, 45)).toBe("scale(1.0000) translate(0.000%, 10.000%)");
    expect(speakerTransform(punch, 3, 45)).toBe("scale(1.1500) translate(0.000%, 10.000%)");
    expect(speakerTransform(punch, 6, 45)).toBe("scale(1.3000) translate(0.000%, 10.000%)");
    expect(speakerTransform(punch, 40, 45)).toBe("scale(1.3000) translate(0.000%, 10.000%)");
  });
  it("pushes in linearly across the clip and resets on the next clip", () => {
    const push = { cx: 0.6, cy: 0.5, scaleFrom: 1, scaleTo: 1.08 };
    expect(speakerTransform(push, 0, 61)).toBe("scale(1.0000) translate(-10.000%, 0.000%)");
    expect(speakerTransform(push, 60, 61)).toBe("scale(1.0800) translate(-10.000%, 0.000%)");
  });
});

describe("caption, headline and CTA helpers", () => {
  it("pops from 90 % to 100 % over 4 frames", () => {
    expect(popIn(0, 4, 0.9)).toBeCloseTo(0.9);
    expect(popIn(4, 4, 0.9)).toBeCloseTo(1);
    expect(popIn(10, 4, 0.9)).toBeCloseTo(1);
  });
  it("reveals one headline word every 6 frames", () => {
    expect([0, 5, 6, 12, 18, 100].map((f) => revealedCount(4, f, 6))).toEqual([1, 1, 2, 3, 4, 4]);
  });
  it("words the CTA per language", () => {
    expect(ctaLines("AI", "he")).toEqual({ before: "תכתבו", keyword: "'AI'", after: "בתגובות" });
    expect(ctaLines("AI", "en")).toEqual({ before: "Comment", keyword: "'AI'", after: "" });
  });
});
```

`packages/video/src/house-style.test.ts`:
```ts
import { EditStyleSchema } from "@reel/core";
import { describe, expect, it } from "vitest";
import { testEditStyle } from "../../core/src/testing/fixtures";
import { houseStyle } from "./house-style";

describe("houseStyle", () => {
  it("is a valid edit style and matches the core test fixture", () => {
    expect(EditStyleSchema.parse(houseStyle.edit)).toEqual(testEditStyle());
  });
  it("uses the reference colours and caption position", () => {
    expect(houseStyle.captions).toMatchObject({ topPct: 45, emphasisColor: "#E5262A", textColor: "#000000", pillColor: "#FFFFFF", popFrames: 4, popFrom: 0.9 });
    expect(houseStyle.headline.bigColor).toBe("#FEE80A");
  });
});
```
Add to `srt.test.ts`:
```ts
import { buildSrtFromPages, srtFor } from "./srt";
import { sampleFootageTimeline } from "./sample-footage";
import { sampleTimeline } from "./sample-timeline";

describe("footage SRT", () => {
  it("uses the pill caption pages (without emoji) when the timeline has them", () => {
    const srt = buildSrtFromPages([
      { fromFrame: 0, durationInFrames: 30, words: [{ text: "היי", emphasis: false }, { text: "חברים,", emphasis: false }] },
      { fromFrame: 30, durationInFrames: 15, words: [{ text: "עבודה.", emphasis: true }], emoji: "👇" },
    ], 30);
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,000\nהיי חברים,\n\n2\n00:00:01,000 --> 00:00:01,500\nעבודה.\n");
    expect(srtFor(sampleFootageTimeline("he"))).toMatch(/^1\n00:00:00,000 --> /);
  });
  it("keeps the old SRT for voice timelines", () => {
    const t = sampleTimeline("he");
    expect(srtFor(t)).toBe(buildSrt(t.captions.words));
  });
});
```
(`buildSrt` is already imported in that file.) Run `npx vitest run packages/video`. Expected: FAIL.

- [ ] **Step 2: Implement `house-style.ts`** (browser-safe: type-only import from core) and add `"./house-style": "./src/house-style.ts"` and `"./sample-footage": "./src/sample-footage.ts"` to the `@reel/video` exports:
```ts
import type { EditStyle } from "@reel/core";

/**
 * The footage look and rhythm in one place (spec §6). Tune the reels here, not in the components.
 * (ref) values come from the reference report; the rest are first guesses to tune after real reels.
 */
export const houseStyle = {
  edit: {
    cutGapMs: 150, // (ref) no pause ≥ 0.15 s survives
    padMs: 50,
    zoomSteps: [1, 1.15, 1.25], // (ref) 1.1–1.25×
    faceMargin: 1.2,
    pushInAfterMs: 2000,
    pushInFactor: 1.08,
    captionMaxChars: 22,
    captionMaxWords: 3, // (ref) median 3 words per page
    headlineMs: 2000,
    headlineWordFrames: 6, // (ref) one element every ≈ 0.2 s
    ctaMs: 2500,
    zoomHitFrames: 6,
    zoomHitScale: 1.3,
    flashFrames: 2,
    musicUnderVoiceDb: -12, // (ref) 10–15 dB under the voice
    sfxVolumeDb: { whoosh: -10, pop: -12, tick: -18 },
    fillerWords: ["אממ", "אמ", "אהה", "אה", "אהמ", "ממ", "umm", "um", "uh", "uhh", "erm", "hmm"],
    noisyLogprob: -0.7,
  } satisfies EditStyle,
  captions: { topPct: 45, fontSize: 66, textColor: "#000000", pillColor: "#FFFFFF", emphasisColor: "#E5262A", radius: 24, padX: 30, padY: 10, maxWidthPct: 86, popFrames: 4, popFrom: 0.9 },
  /** Under the captions (y 45 %) so neither covers the face (eyes sit at y ≈ 0.21–0.28 (ref)). */
  headline: { topPct: 58, smallSize: 62, bigSize: 168, smallColor: "#FFFFFF", bigColor: "#FEE80A", shadow: "0 8px 28px rgba(0,0,0,0.55)", popFrames: 4, popFrom: 0.6 },
  cta: { topPct: 62, smallSize: 64, bigSize: 150, color: "#FFFFFF", keywordColor: "#FEE80A", shadow: "0 8px 28px rgba(0,0,0,0.55)", scrim: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.6) 100%)", popFrames: 6, popFrom: 0.7 },
  flash: { color: "#FFFFFF" },
};
```

- [ ] **Step 3: Implement `footage/motion.ts`:**
```ts
import type { TimelineCrop } from "@reel/core";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

/** Linear across the clip, or within punchFrames then held (zoom hit). Resets on the next clip. */
export function speakerScale(crop: TimelineCrop, frame: number, durationInFrames: number): number {
  const span = crop.punchFrames ?? Math.max(1, durationInFrames - 1);
  return crop.scaleFrom + (crop.scaleTo - crop.scaleFrom) * clamp01(frame / span);
}

/** CSS transform (applied right to left): move (cx, cy) to the centre, then zoom about the centre. */
export function speakerTransform(crop: TimelineCrop, frame: number, durationInFrames: number): string {
  const s = speakerScale(crop, frame, durationInFrames);
  return `scale(${s.toFixed(4)}) translate(${((0.5 - crop.cx) * 100).toFixed(3)}%, ${((0.5 - crop.cy) * 100).toFixed(3)}%)`;
}

export const popIn = (frame: number, frames: number, from: number) => from + (1 - from) * easeOutCubic(clamp01(frame / frames));

export const revealedCount = (total: number, frame: number, wordFrames: number) => (frame < 0 ? 0 : Math.min(total, Math.floor(frame / wordFrames) + 1));

export function ctaLines(keyword: string, language: "he" | "en"): { before: string; keyword: string; after: string } {
  return language === "he"
    ? { before: "תכתבו", keyword: `'${keyword}'`, after: "בתגובות" }
    : { before: "Comment", keyword: `'${keyword}'`, after: "" };
}
```

- [ ] **Step 4: Implement the components.** First confirm the trim prop name on `OffthreadVideo` in `node_modules/remotion/dist/cjs` (search the `OffthreadVideo` props type for `trimBefore`). Remotion 4.0.531 renamed `startFrom` to `trimBefore`; if `OffthreadVideo` only accepts `startFrom`, use that.

`footage/SpeakerShot.tsx`:
```tsx
import type { TimelineClip } from "@reel/core";
import React from "react";
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import { speakerTransform } from "./motion";

/** A segment of the working copy with a face-centred zoom. Muted: the voice is one pre-cut track. */
export const SpeakerShot: React.FC<{ clip: TimelineClip }> = ({ clip }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!clip.src || !clip.source || !clip.crop) return <AbsoluteFill style={{ backgroundColor: "#000000" }} />;
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000000" }}>
      <AbsoluteFill style={{ transform: speakerTransform(clip.crop, frame, clip.durationInFrames) }}>
        <OffthreadVideo src={clip.src} muted trimBefore={Math.round((clip.source.inMs / 1000) * fps)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
```

`footage/PillCaptions.tsx`:
```tsx
import type { CaptionPage, Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { popIn } from "./motion";

const c = houseStyle.captions;

const PillPage: React.FC<{ page: CaptionPage; direction: Timeline["direction"] }> = ({ page, direction }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", top: `${c.topPct}%`, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div
        dir={direction}
        style={{
          transform: `translateY(-50%) scale(${popIn(frame, c.popFrames, c.popFrom).toFixed(4)})`,
          maxWidth: `${c.maxWidthPct}%`,
          background: c.pillColor,
          color: c.textColor,
          borderRadius: c.radius,
          padding: `${c.padY}px ${c.padX}px`,
          fontFamily: HEEBO,
          fontWeight: 800,
          fontSize: c.fontSize,
          lineHeight: 1.25,
          textAlign: "center",
          direction,
        }}
      >
        {page.words.map((w, i) => (
          <React.Fragment key={i}>
            {i > 0 ? " " : null}
            <span style={{ color: w.emphasis ? c.emphasisColor : undefined, unicodeBidi: "isolate" }}>{w.text}</span>
          </React.Fragment>
        ))}
        {page.emoji ? <span style={{ unicodeBidi: "isolate" }}> {page.emoji}</span> : null}
      </div>
    </div>
  );
};

/** The footage caption preset "pill": rendered last in Reel, above every other layer, so it survives cuts. */
export const PillCaptions: React.FC<{ timeline: Timeline }> = ({ timeline }) => (
  <AbsoluteFill>
    {(timeline.captions.pages ?? []).map((page, i) => (
      <Sequence key={i} from={page.fromFrame} durationInFrames={page.durationInFrames} layout="none">
        <PillPage page={page} direction={timeline.direction} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
```

`footage/HookHeadline.tsx`:
```tsx
import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { popIn, revealedCount } from "./motion";

const h = houseStyle.headline;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

const Headline: React.FC<{ small: string; big: string; direction: Timeline["direction"] }> = ({ small, big, direction }) => {
  const frame = useCurrentFrame();
  const smallWords = words(small);
  const bigWords = words(big);
  const all = [...smallWords, ...bigWords];
  const shown = revealedCount(all.length, frame, houseStyle.edit.headlineWordFrames);
  const word = (text: string, i: number, size: number, color: string) => {
    if (i >= shown) return null;
    const scale = popIn(frame - i * houseStyle.edit.headlineWordFrames, h.popFrames, h.popFrom);
    return (
      <span key={i} style={{ display: "inline-block", margin: "0 0.18em", transform: `scale(${scale.toFixed(4)})`, fontSize: size, color, textShadow: h.shadow, unicodeBidi: "isolate" }}>
        {text}
      </span>
    );
  };
  return (
    <div dir={direction} style={{ position: "absolute", top: `${h.topPct}%`, left: 40, right: 40, textAlign: "center", direction, fontFamily: HEEBO, fontWeight: 800, lineHeight: 1.05 }}>
      <div>{smallWords.map((t, i) => word(t, i, h.smallSize, h.smallColor))}</div>
      <div>{bigWords.map((t, j) => word(t, smallWords.length + j, h.bigSize, h.bigColor))}</div>
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

`footage/PatternBreak.tsx`:
```tsx
import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { houseStyle } from "../house-style";

/** "flash": white frames at frame 0. "zoom_hit" lives in the first speaker clip's crop (punchFrames), so nothing to draw. */
export const PatternBreak: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  if (timeline.hook?.patternBreak !== "flash") return null;
  return (
    <Sequence from={0} durationInFrames={houseStyle.edit.flashFrames} layout="none">
      <AbsoluteFill style={{ backgroundColor: houseStyle.flash.color }} />
    </Sequence>
  );
};
```

`footage/CtaCard.tsx`:
```tsx
import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { HEEBO } from "../fonts";
import { houseStyle } from "../house-style";
import { ctaLines, popIn } from "./motion";

const k = houseStyle.cta;

const Card: React.FC<{ keyword: string; timeline: Timeline }> = ({ keyword, timeline }) => {
  const frame = useCurrentFrame();
  const lines = ctaLines(keyword, timeline.language);
  const line = (text: string, size: number, color: string) =>
    text ? <div style={{ fontSize: size, color, textShadow: k.shadow, unicodeBidi: "isolate" }}>{text}</div> : null;
  return (
    <AbsoluteFill style={{ background: k.scrim }}>
      <div
        dir={timeline.direction}
        style={{ position: "absolute", top: `${k.topPct}%`, left: 40, right: 40, textAlign: "center", fontFamily: HEEBO, fontWeight: 800, lineHeight: 1.05, direction: timeline.direction, transform: `scale(${popIn(frame, k.popFrames, k.popFrom).toFixed(4)})` }}
      >
        {line(lines.before, k.smallSize, k.color)}
        {line(lines.keyword, k.bigSize, k.keywordColor)}
        {line(lines.after, k.smallSize, k.color)}
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

`footage/SfxCues.tsx`:
```tsx
import type { Timeline } from "@reel/core";
import React from "react";
import { Audio, Sequence } from "remotion";

export const SfxCues: React.FC<{ timeline: Timeline }> = ({ timeline }) => (
  <>
    {(timeline.sfx ?? []).map((cue, i) => (
      <Sequence key={i} from={cue.frame} layout="none">
        <Audio src={cue.src} volume={Math.pow(10, cue.volumeDb / 20)} />
      </Sequence>
    ))}
  </>
);
```

- [ ] **Step 5: Wire `Reel.tsx`.** Replace the file's body with the version below. For voice timelines (`kind` never `speaker`, no `pages`, `hook`, `ending` or `sfx`) the rendered tree is the same as before:
```tsx
import type { Timeline } from "@reel/core";
import React from "react";
import { AbsoluteFill, Audio, Sequence } from "remotion";
import { Captions } from "./Captions";
import { Clip } from "./Clip";
import { CtaCard } from "./footage/CtaCard";
import { HookHeadline } from "./footage/HookHeadline";
import { PatternBreak } from "./footage/PatternBreak";
import { PillCaptions } from "./footage/PillCaptions";
import { SfxCues } from "./footage/SfxCues";
import { SpeakerShot } from "./footage/SpeakerShot";
import { TRANSITION_FRAMES } from "./motion";
import { Overlays } from "./Overlays";

export type ReelProps = { timeline: Timeline };

export const Reel: React.FC<ReelProps> = ({ timeline }) => {
  const { clips, audio } = timeline;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {clips.map((clip, i) => {
        // Keep the outgoing clip visible while the next one animates in on top, so cuts stay on the audio beat.
        const next = clips[i + 1];
        const overlap = next && next.transitionIn !== "cut" ? TRANSITION_FRAMES : 0;
        return (
          <Sequence key={clip.sceneId} from={clip.fromFrame} durationInFrames={clip.durationInFrames + overlap}>
            {clip.kind === "speaker" ? <SpeakerShot clip={clip} /> : <Clip clip={clip} palette={timeline.style.palette} />}
          </Sequence>
        );
      })}
      <Overlays timeline={timeline} />
      <HookHeadline timeline={timeline} />
      <CtaCard timeline={timeline} />
      <PatternBreak timeline={timeline} />
      {timeline.captions.pages ? <PillCaptions timeline={timeline} /> : <Captions timeline={timeline} />}
      <SfxCues timeline={timeline} />
      {audio.voiceUrl ? <Audio src={audio.voiceUrl} /> : null}
      {audio.musicUrl ? <Audio src={audio.musicUrl} loop volume={Math.pow(10, audio.musicDuckingDb / 20)} /> : null}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 6: SRT from pages.** In `packages/video/src/srt.ts` add:
```ts
import type { CaptionPage, Timeline } from "@reel/core";

/** Footage subtitles: one cue per pill caption page, same timing as the burned-in pages (emoji left out). */
export function buildSrtFromPages(pages: CaptionPage[], fps: number): string {
  return pages
    .map((p, i) => {
      const start = (p.fromFrame / fps) * 1000;
      const end = ((p.fromFrame + p.durationInFrames) / fps) * 1000;
      return `${i + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${twoLines(p.words.map((w) => w.text).join(" "))}\n`;
    })
    .join("\n");
}

export const srtFor = (timeline: Timeline) =>
  timeline.captions.pages ? buildSrtFromPages(timeline.captions.pages, timeline.fps) : buildSrt(timeline.captions.words);
```
In `packages/engine/src/pipeline.ts`, `renderAndExport` writes `srtFor(timeline)` instead of `buildSrt(timeline.captions.words)` (import `srtFor` from `@reel/video/srt`; drop the now-unused `buildSrt` import). Voice reels get identical files.

- [ ] **Step 7: Sample footage timeline** `packages/video/src/sample-footage.ts` (media-free unless a `videoSrc` is given):
```ts
import type { CaptionPage, Timeline, TimelineClip } from "@reel/core";

/** A 5 s footage timeline: flash + headline hook, three pill pages, CTA card. Graphic clips unless videoSrc is given. */
export function sampleFootageTimeline(lang: "he" | "en", videoSrc?: string): Timeline {
  const he = lang === "he";
  const texts = he ? [["היי", "חברים,"], ["היום", "אני", "אראה"], ["לכם", "טריק."]] : [["Hey", "friends,"], ["today", "I'll", "show"], ["you", "a trick."]];
  const pages: CaptionPage[] = texts.map((ws, i) => ({
    fromFrame: i * 30,
    durationInFrames: 30,
    words: ws.map((text, j) => ({ text, emphasis: i === 2 && j === ws.length - 1 })),
    ...(i === 2 ? { emoji: "👇" } : {}),
  }));
  const words = texts.flat().map((text, i) => ({ text, startMs: i * 120, endMs: i * 120 + 100 }));
  const clips: TimelineClip[] = videoSrc
    ? [
        { sceneId: "b1-1", kind: "speaker", src: videoSrc, fromFrame: 0, durationInFrames: 45, motion: "none", transitionIn: "cut", source: { inMs: 0, outMs: 1500 }, crop: { cx: 0.5, cy: 0.4, scaleFrom: 1, scaleTo: 1.3, punchFrames: 6 } },
        { sceneId: "b1-2", kind: "speaker", src: videoSrc, fromFrame: 45, durationInFrames: 105, motion: "none", transitionIn: "cut", source: { inMs: 1800, outMs: 5300 }, crop: { cx: 0.5, cy: 0.42, scaleFrom: 1.15, scaleTo: 1.242 } },
      ]
    : [
        { sceneId: "g1", kind: "graphic", fromFrame: 0, durationInFrames: 45, motion: "none", transitionIn: "cut" },
        { sceneId: "g2", kind: "graphic", fromFrame: 45, durationInFrames: 105, motion: "zoom_in", transitionIn: "cut" },
      ];
  return {
    fps: 30, width: 1080, height: 1920, durationInFrames: 150, language: lang, direction: he ? "rtl" : "ltr",
    style: { captionPreset: "pill", font: "Heebo", palette: ["#3A2E5C", "#9F92C3"] },
    audio: { musicDuckingDb: -12 },
    clips,
    captions: { words, pages },
    overlays: [],
    hook: { patternBreak: "flash", headline: { small: he ? "הטריק ש" : "The trick that", big: he ? "חוסך שעות" : "saves hours", fromFrame: 0, durationInFrames: 60 } },
    ending: { kind: "cta", keyword: "AI", fromFrame: 75, durationInFrames: 75 },
  };
}
```

- [ ] **Step 8: Render tests.**

`packages/video/src/footage-render.test.ts` (stills written to `work/stills/` for a human to open, like `render.test.ts`):
```ts
import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderReelStill } from "./render";
import { sampleFootageTimeline } from "./sample-footage";

const OUT = resolve("work/stills");

describe("footage components (stills)", () => {
  it.each([
    ["headline-and-pill", 20],
    ["pill-emphasis-emoji", 70],
    ["cta-card", 120],
  ] as const)("renders %s for he and en", async (name, frame) => {
    await mkdir(OUT, { recursive: true });
    for (const lang of ["he", "en"] as const) {
      const file = join(OUT, `footage-${name}-${lang}.png`);
      await renderReelStill(sampleFootageTimeline(lang), file, frame);
      expect((await stat(file)).size).toBeGreaterThan(20_000);
    }
  }, 300_000);
});
```

`packages/engine/src/footage-render.test.ts` (the speaker shot needs a real video and the local file server):
```ts
import { averageLuma, makeTestVideo } from "@reel/media";
import { renderReelStill } from "@reel/video/render";
import { sampleFootageTimeline } from "@reel/video/sample-footage";
import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { serveDir } from "./serve";

describe("footage render (speaker shot, flash)", () => {
  it("flashes white at frame 0, then shows the zoomed speaker video", async () => {
    const dir = await mkdtemp(join(tmpdir(), "footage-render-"));
    await makeTestVideo(join(dir, "speaker.mp4"), { durationSec: 6 });
    const server = await serveDir(dir);
    try {
      const timeline = sampleFootageTimeline("he", server.urlFor("speaker.mp4"));
      const out = resolve("work/stills");
      await mkdir(out, { recursive: true });
      await renderReelStill(timeline, join(out, "footage-flash.png"), 0);
      await renderReelStill(timeline, join(out, "footage-speaker.png"), 50);
      expect(await averageLuma(join(out, "footage-flash.png"))).toBeGreaterThan(200);
      expect(await averageLuma(join(out, "footage-speaker.png"))).toBeLessThan(200);
      expect((await stat(join(out, "footage-speaker.png"))).size).toBeGreaterThan(50_000);
    } finally {
      await server.close();
    }
  }, 300_000);
});
```

- [ ] **Step 9: Verify.** Run `npx vitest run packages/video packages/engine/src/footage-render.test.ts packages/engine/src/pipeline.test.ts && npm run typecheck`. Expected: PASS; the existing voice render and pipeline tests are unchanged and pass. Open two of the stills (`work/stills/footage-headline-and-pill-he.png`, `footage-cta-card-he.png`) with the Read tool and describe them in the report: pill centred near the middle, Hebrew right-to-left, red emphasis word, yellow headline/keyword.

- [ ] **Step 10: Commit** with message `feat(video): footage components (speaker shot, pill captions, hook headline, flash, CTA card, sfx cues), houseStyle and page-based SRT`.

---

### Task 8: `face-helper` (Swift + Apple Vision) and its wrapper

**Files:**
- Create: `tools/face-helper/Package.swift`, `tools/face-helper/Sources/face-helper/main.swift`, `packages/media/src/face.ts`
- Modify: `packages/media/src/index.ts`, root `package.json` (script `build:face-helper`), `.gitignore` (`tools/face-helper/.build/`), `docs/RUNNING.md`
- Test: `packages/media/src/face.test.ts`

**Interfaces:**
- Produces (CLI): `face-helper track <video> [--every N]` prints a `RawFaceTrack` JSON to stdout (`box: null` when no face), exits 1 with a message on stderr on failure.
- Produces (media): `FACE_HELPER_DEFAULT`, `faceHelperPath(): string` (`FACE_HELPER_PATH` env or the release build), `faceHelperAvailable(): boolean`, `class FaceHelperError`, `runFaceHelper(video: string, opts?: { every?: number; timeoutMs?: number }): Promise<unknown>`, `FIXTURE_TALKING_HEAD` (absolute path to `packages/media/fixtures/talking-head-he.mp4`).

- [ ] **Step 1: Check the toolchain.** Run `swift --version`. If it prints a Swift version, continue. If the command is missing, still write every file in this task, skip Steps 4 and 6's build, and report `DONE_WITH_CONCERNS: Swift is not installed on this Mac (install Xcode or run xcode-select --install); face tests skip until npm run build:face-helper succeeds`. Do not try to install anything.

- [ ] **Step 2: Write the package.**

`tools/face-helper/Package.swift`:
```swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "face-helper",
  platforms: [.macOS(.v13)],
  targets: [.executableTarget(name: "face-helper", path: "Sources/face-helper")]
)
```

`tools/face-helper/Sources/face-helper/main.swift`:
```swift
import AVFoundation
import Foundation
import Vision

struct Box: Encodable { let x: Double; let y: Double; let w: Double; let h: Double }

struct Sample: Encodable {
  let tMs: Double
  let box: Box?
  enum CodingKeys: String, CodingKey { case tMs, box }
  // Encode a missing face as null (synthesised Encodable would omit the key).
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(tMs, forKey: .tMs)
    try c.encode(box, forKey: .box)
  }
}

struct Track: Encodable { let width: Int; let height: Int; let fps: Double; let sampleEvery: Int; let samples: [Sample] }

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

let args = CommandLine.arguments
guard args.count >= 3, args[1] == "track" else { fail("usage: face-helper track <video> [--every N]") }
let url = URL(fileURLWithPath: args[2])
var every = 3
if let i = args.firstIndex(of: "--every"), i + 1 < args.count, let n = Int(args[i + 1]), n > 0 { every = n }
guard FileManager.default.fileExists(atPath: url.path) else { fail("no such file: \(url.path)") }

do {
  let asset = AVURLAsset(url: url)
  guard let track = try await asset.loadTracks(withMediaType: .video).first else { fail("no video track in \(url.path)") }
  let size = try await track.load(.naturalSize)
  let fps = Double(try await track.load(.nominalFrameRate))
  let reader = try AVAssetReader(asset: asset)
  let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
  output.alwaysCopiesSampleData = false
  reader.add(output)
  guard reader.startReading() else { fail("cannot read \(url.path): \(reader.error?.localizedDescription ?? "unknown error")") }
  var samples: [Sample] = []
  var index = 0
  while let buffer = output.copyNextSampleBuffer() {
    defer { index += 1 }
    guard index % every == 0, let pixels = CMSampleBufferGetImageBuffer(buffer) else { continue }
    let tMs = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer)) * 1000
    let request = VNDetectFaceRectanglesRequest()
    try VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up).perform([request])
    let largest = (request.results ?? []).max { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }
    // Vision boxes are normalised with the origin bottom-left; output top-left.
    let box = largest.map { f in
      Box(x: Double(f.boundingBox.minX), y: Double(1 - f.boundingBox.maxY), w: Double(f.boundingBox.width), h: Double(f.boundingBox.height))
    }
    samples.append(Sample(tMs: (tMs * 10).rounded() / 10, box: box))
  }
  if reader.status == .failed { fail("reading \(url.path) failed: \(reader.error?.localizedDescription ?? "unknown error")") }
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  FileHandle.standardOutput.write(try encoder.encode(Track(width: Int(size.width), height: Int(size.height), fps: fps, sampleEvery: every, samples: samples)))
} catch {
  fail("face-helper: \(error.localizedDescription)")
}
```
It reads the working copy, which is already upright 1080×1920, so `orientation: .up` is right. Largest face = "follows the largest face" (spec §2, §7). Smoothing and gap filling happen in `smoothFaceTrack` (Task 4) so they are unit-tested without the binary.

Add `"build:face-helper": "swift build -c release --package-path tools/face-helper"` to the root `package.json` scripts and `tools/face-helper/.build/` to `.gitignore`.

- [ ] **Step 3: Write the failing test** `packages/media/src/face.test.ts`:
```ts
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { faceHelperAvailable, FIXTURE_TALKING_HEAD, runFaceHelper } from "./face";
import { makeTestVideo } from "./testing";

const HELPER = faceHelperAvailable();
const FIXTURE = existsSync(FIXTURE_TALKING_HEAD);
type Out = { width: number; height: number; fps: number; sampleEvery: number; samples: { tMs: number; box: { x: number; y: number; w: number; h: number } | null }[] };

describe("face-helper", () => {
  it.skipIf(!HELPER)("samples every 3rd frame and reports no face on a synthetic clip (skipped: run npm run build:face-helper)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "face-"));
    await makeTestVideo(join(dir, "t.mp4"), { durationSec: 1, width: 360, height: 640 });
    const out = (await runFaceHelper(join(dir, "t.mp4"))) as Out;
    expect(out).toMatchObject({ width: 360, height: 640, sampleEvery: 3 });
    expect(out.samples).toHaveLength(10);
    expect(out.samples.every((s) => s.box === null)).toBe(true);
  }, 120_000);

  it.skipIf(!HELPER)("fails clearly for a missing file", async () => {
    await expect(runFaceHelper("/no/such/video.mp4")).rejects.toThrow(/no such file/);
  });

  it.skipIf(!HELPER || !FIXTURE)("finds the speaker's face on the fixture clip (skipped: needs the binary and packages/media/fixtures/talking-head-he.mp4)", async () => {
    const out = (await runFaceHelper(FIXTURE_TALKING_HEAD)) as Out;
    const found = out.samples.filter((s) => s.box);
    expect(found.length / out.samples.length).toBeGreaterThan(0.8);
    for (const s of found) {
      expect(s.box!.x).toBeGreaterThanOrEqual(-0.05);
      expect(s.box!.x + s.box!.w).toBeLessThanOrEqual(1.05);
      expect(s.box!.w).toBeGreaterThan(0.05);
    }
  }, 120_000);
});
```
Run `npx vitest run packages/media/src/face.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement** `packages/media/src/face.ts` and export it from the media index:
```ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FACE_HELPER_DEFAULT = path.resolve(HERE, "../../../tools/face-helper/.build/release/face-helper");
/** User-supplied Hebrew talking-head clip (≤ 10 s); committed only with the user's OK. Tests skip without it. */
export const FIXTURE_TALKING_HEAD = path.resolve(HERE, "../fixtures/talking-head-he.mp4");

export const faceHelperPath = () => process.env.FACE_HELPER_PATH || FACE_HELPER_DEFAULT;
export const faceHelperAvailable = () => existsSync(faceHelperPath());

export class FaceHelperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FaceHelperError";
  }
}

/** Runs `face-helper track` and returns its parsed JSON (validate it with RawFaceTrackSchema from @reel/core). */
export function runFaceHelper(video: string, opts: { every?: number; timeoutMs?: number } = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(faceHelperPath(), ["track", video, "--every", String(opts.every ?? 3)], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 15 * 60_000);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c) => (err = (err + c).slice(-4000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new FaceHelperError(`face-helper failed to start (${e.message}). Run "npm run build:face-helper" on the worker Mac.`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new FaceHelperError(err.trim() || `face-helper exited with code ${code}`));
      try {
        resolve(JSON.parse(Buffer.concat(out).toString("utf8")));
      } catch {
        reject(new FaceHelperError("face-helper printed invalid JSON"));
      }
    });
  });
}
```

- [ ] **Step 5: Document it** in `docs/RUNNING.md` under "One-time setup", as new numbered items:
  - `npm run build:face-helper` builds the Swift face tracker (needs Xcode or its command line tools). The real worker refuses footage ingest without it; the fake worker falls back to centred crops.
  - Supabase dashboard → Storage → Settings: raise the global upload limit to 2 GB (needed for video uploads).
  - The sound-effect pack in `packages/video/assets/sfx/` is generated once with `npm run sfx:generate -- --yes` (paid; listen before committing). Without it, real reels render without sound effects and say so.

- [ ] **Step 6: Build and verify.** Run `npm run build:face-helper` (skip if Step 1 found no Swift), then `npx vitest run packages/media && npm run typecheck`. Expected: PASS; with the binary, the synthetic-clip test runs and the fixture test is skipped with its message unless the user has supplied the clip.

- [ ] **Step 7: Commit** with message `feat(media): face-helper Swift CLI (Vision face rectangles) and its Node wrapper`.

---
### Task 9: Scribe and ElevenLabs Music providers, with fakes

**Files:**
- Modify: `packages/engine/src/providers/types.ts`, `packages/engine/src/providers/elevenlabs.ts`, `packages/engine/src/providers/fake.ts`, `packages/engine/src/providers/index.ts`, `packages/engine/src/download.ts` (`json` content type)
- Test: `packages/engine/src/providers/elevenlabs-footage.test.ts` (new), `packages/engine/src/providers/fake.test.ts` (new)

**Interfaces:**
- Consumes: `Transcript`, `TranscriptSchema` (Task 2), `makeTestTone`, `probe` (media).
- Produces:
  - `interface Transcriber { readonly model: string; transcribe(audioPath: string): Promise<{ transcript: Transcript; requestId?: string }> }`
  - `interface MusicGen { readonly model: string; compose(req: { prompt: string; durationMs: number }): Promise<{ audio: Buffer; ext: "mp3" | "wav" }> }`
  - `Providers` gains `transcriber: Transcriber` and `music: MusicGen`
  - `type ScribeResult`, `type ElevenLabsFootageApi = { scribe(audio: Buffer, contentType: string): Promise<ScribeResult>; music(prompt: string, lengthMs: number): Promise<Buffer> }`, `sdkElevenLabsFootage(apiKey): ElevenLabsFootageApi`, `scribeToTranscript(res: ScribeResult): Transcript`, `class ScribeTranscriber` (model `elevenlabs/scribe_v2`), `class ElevenLabsMusic` (model `elevenlabs/music`)
  - fakes: `transcriber` (model `fake/scribe`), `music` (model `fake/music`); `calls.transcribe`, `calls.music`; `FAKE_TALK`
  - `contentTypeFor("x.json") === "application/json"`

- [ ] **Step 1: Check the SDK.** Open `node_modules/@elevenlabs/elevenlabs-js/api/resources/speechToText/client/requests/BodySpeechToTextV1SpeechToTextPost.d.ts` and `music/client/requests/BodyComposeMusicV1MusicPost.d.ts`. In 2.70.0, `speechToText.convert` takes `{ modelId, file, timestampsGranularity, tagAudioEvents }` and returns a union whose chunk variant has `languageCode`, `languageProbability`, `words: { text, start?, end?, type: "word" | "spacing" | "audio_event", logprob }[]`; `music.compose` takes `{ prompt, musicLengthMs (3000–600000), forceInstrumental }` and resolves to a `ReadableStream<Uint8Array>`. If any of these differ, adapt `sdkElevenLabsFootage` only (the `ElevenLabsFootageApi` shape stays) and say so in the report.

- [ ] **Step 2: Write the failing tests.**

`packages/engine/src/providers/elevenlabs-footage.test.ts`:
```ts
import { ElevenLabsError } from "@elevenlabs/elevenlabs-js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ElevenLabsMusic, ScribeTranscriber, scribeToTranscript, type ElevenLabsFootageApi } from "./elevenlabs";

const noSleep = { sleep: async () => {} };
const RES = {
  languageCode: "heb",
  languageProbability: 0.97,
  words: [
    { text: "שלום", start: 0.1, end: 0.4, type: "word", logprob: -0.1 },
    { text: " ", start: 0.4, end: 0.5, type: "spacing", logprob: 0 },
    { text: "(laughs)", start: 0.5, end: 0.9, type: "audio_event", logprob: 0 },
    { text: " עולם ", start: 1.0, end: 1.3, type: "word", logprob: -0.2 },
    { text: "x", type: "word", logprob: 0 },
  ],
};

describe("scribeToTranscript", () => {
  it("keeps timed words in order, sets audio events aside and drops spacing", () => {
    expect(scribeToTranscript(RES)).toEqual({
      languageCode: "heb",
      languageProbability: 0.97,
      words: [{ text: "שלום", startMs: 100, endMs: 400, logprob: -0.1 }, { text: "עולם", startMs: 1000, endMs: 1300, logprob: -0.2 }],
      events: [{ text: "(laughs)", startMs: 500, endMs: 900 }],
    });
  });
});

describe("ScribeTranscriber", () => {
  it("sends the wav and retries a 429", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scribe-"));
    await writeFile(join(dir, "a.wav"), "wav");
    let calls = 0;
    const api: ElevenLabsFootageApi = {
      scribe: vi.fn(async () => {
        if (++calls === 1) throw new ElevenLabsError({ message: "rate limited", statusCode: 429 });
        return RES;
      }),
      music: vi.fn(),
    };
    const t = new ScribeTranscriber(api, noSleep);
    expect(t.model).toBe("elevenlabs/scribe_v2");
    const { transcript } = await t.transcribe(join(dir, "a.wav"));
    expect(transcript.words).toHaveLength(2);
    expect(api.scribe).toHaveBeenCalledWith(expect.any(Buffer), "audio/wav");
    expect(calls).toBe(2);
  });
});

describe("ElevenLabsMusic", () => {
  it("clamps the length to 3–600 s and forwards the prompt", async () => {
    const api: ElevenLabsFootageApi = { scribe: vi.fn(), music: vi.fn(async () => Buffer.from("mp3")) };
    const m = new ElevenLabsMusic(api, noSleep);
    await m.compose({ prompt: "calm lo-fi", durationMs: 1200 });
    await m.compose({ prompt: "calm lo-fi", durationMs: 700_000 });
    expect(vi.mocked(api.music).mock.calls).toEqual([["calm lo-fi", 3000], ["calm lo-fi", 600_000]]);
    expect(m.model).toBe("elevenlabs/music");
  });
  it("rejects empty audio", async () => {
    const api: ElevenLabsFootageApi = { scribe: vi.fn(), music: async () => Buffer.alloc(0) };
    await expect(new ElevenLabsMusic(api, noSleep).compose({ prompt: "x", durationMs: 5000 })).rejects.toThrow(/empty music/);
  });
});
```

`packages/engine/src/providers/fake.test.ts`:
```ts
import { makeTestTone, probe } from "@reel/media";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeProviders } from "./fake";

describe("fake footage providers", () => {
  it("transcribes any audio into the fake Hebrew talk, inside the audio's length", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fake-footage-"));
    const p = createFakeProviders({ workDir: dir });
    await makeTestTone(join(dir, "a.wav"), { durationSec: 6 });
    const { transcript } = await p.transcriber.transcribe(join(dir, "a.wav"));
    expect(p.transcriber.model).toBe("fake/scribe");
    expect(transcript.languageCode).toBe("heb");
    expect(transcript.words.length).toBeGreaterThanOrEqual(5);
    expect(transcript.words.at(-1)!.endMs).toBeLessThanOrEqual(6000);
    expect(p.calls.transcribe).toBe(1);
  });
  it("composes fake music of the requested length", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fake-music-"));
    const p = createFakeProviders({ workDir: dir });
    const { audio, ext } = await p.music.compose({ prompt: "x", durationMs: 4000 });
    expect(ext).toBe("wav");
    expect(audio.length).toBeGreaterThan(1000);
    expect(p.music.model).toBe("fake/music");
    expect(p.calls.music).toBe(1);
  });
});
```
Run `npx vitest run packages/engine/src/providers`. Expected: FAIL.

- [ ] **Step 3: Implement the types** in `providers/types.ts` (import `Transcript` from `@reel/core`):
```ts
export interface Transcriber {
  /** Part of every transcript cache key, so fake and real transcripts never share one. */
  readonly model: string;
  transcribe(audioPath: string): Promise<{ transcript: Transcript; requestId?: string }>;
}

export interface MusicGen {
  readonly model: string;
  compose(req: { prompt: string; durationMs: number }): Promise<{ audio: Buffer; ext: "mp3" | "wav" }>;
}

export type Providers = { image: ImageGen; video: VideoGen; uploader: MediaUploader; voice: VoiceGen; transcriber: Transcriber; music: MusicGen };
```
Add `json: "application/json",` to `CONTENT_TYPES` in `download.ts`.

- [ ] **Step 4: Implement the providers** in `providers/elevenlabs.ts` (new imports: `readFile` from `node:fs/promises`, `TranscriptSchema, type Transcript` from `@reel/core`, `contentTypeFor` from `../download`, `type MusicGen, type Transcriber` from `./types`). The existing `ElevenLabsApi`, `sdkElevenLabs` and `ElevenLabsVoice` stay unchanged:
```ts
export type ScribeWord = { text: string; start?: number; end?: number; type: string; logprob?: number };
export type ScribeResult = { languageCode: string; languageProbability: number; words: ScribeWord[] };

/** Kept apart from ElevenLabsApi so the existing voice tests and stubs don't change. */
export type ElevenLabsFootageApi = {
  scribe(audio: Buffer, contentType: string): Promise<ScribeResult>;
  music(prompt: string, lengthMs: number): Promise<Buffer>;
};

export function sdkElevenLabsFootage(apiKey: string): ElevenLabsFootageApi {
  const client = new ElevenLabsClient({ apiKey });
  return {
    scribe: async (audio, contentType) => {
      // No languageCode: Scribe detects the language, which feeds the language-mismatch warning.
      const res = await client.speechToText.convert({
        modelId: "scribe_v2",
        file: new Blob([new Uint8Array(audio)], { type: contentType }),
        timestampsGranularity: "word",
        tagAudioEvents: true,
      });
      if (!("words" in res)) throw new Error("Unexpected speech-to-text response (no words)");
      return { languageCode: res.languageCode, languageProbability: res.languageProbability, words: res.words };
    },
    music: async (prompt, lengthMs) => {
      const stream = await client.music.compose({ prompt, musicLengthMs: lengthMs, forceInstrumental: true });
      return Buffer.from(await new Response(stream).arrayBuffer());
    },
  };
}

const timed = (w: ScribeWord) => w.start !== undefined && w.end !== undefined && w.text.trim().length > 0;
const ms = (s: number) => Math.round(s * 1000);

export function scribeToTranscript(res: ScribeResult): Transcript {
  return TranscriptSchema.parse({
    languageCode: res.languageCode,
    languageProbability: res.languageProbability,
    words: res.words.filter((w) => w.type === "word" && timed(w)).map((w) => ({ text: w.text.trim(), startMs: ms(w.start!), endMs: ms(w.end!), ...(w.logprob !== undefined ? { logprob: w.logprob } : {}) })),
    events: res.words.filter((w) => w.type === "audio_event" && timed(w)).map((w) => ({ text: w.text.trim(), startMs: ms(w.start!), endMs: ms(w.end!) })),
  });
}

type RetryOpts = { sleep?: (ms: number) => Promise<void> };
const retryWith = (opts: RetryOpts) => ({ attempts: 3, baseDelayMs: 2000, isTransient: isTransientElevenLabsError, sleep: opts.sleep });

export class ScribeTranscriber implements Transcriber {
  readonly model = "elevenlabs/scribe_v2";
  constructor(private readonly api: ElevenLabsFootageApi, private readonly opts: RetryOpts = {}) {}
  async transcribe(audioPath: string) {
    const audio = await readFile(audioPath);
    const res = await withRetry(() => this.api.scribe(audio, contentTypeFor(audioPath)), retryWith(this.opts));
    return { transcript: scribeToTranscript(res) };
  }
}

export class ElevenLabsMusic implements MusicGen {
  readonly model = "elevenlabs/music";
  constructor(private readonly api: ElevenLabsFootageApi, private readonly opts: RetryOpts = {}) {}
  async compose({ prompt, durationMs }: { prompt: string; durationMs: number }) {
    const lengthMs = Math.min(600_000, Math.max(3000, Math.round(durationMs)));
    const audio = await withRetry(() => this.api.music(prompt, lengthMs), retryWith(this.opts));
    if (audio.length === 0) throw new PermanentProviderError("ElevenLabs returned empty music", "elevenlabs");
    return { audio, ext: "mp3" as const };
  }
}
```

- [ ] **Step 5: Implement the fakes** in `providers/fake.ts`. Add `transcribe: 0, music: 0` to `calls`, import `probe` from `@reel/media`, and add to the returned object:
```ts
    transcriber: {
      model: "fake/scribe",
      async transcribe(audioPath: string) {
        calls.transcribe++;
        const durationMs = Math.round((await probe(audioPath)).durationSec * 1000);
        const tokens = FAKE_TALK.split(" ");
        const slot = durationMs / (tokens.length + 1);
        const words = tokens.map((text, i) => ({ text, startMs: Math.round((i + 0.5) * slot), endMs: Math.round((i + 0.5) * slot + slot * 0.85), logprob: -0.05 }));
        return { transcript: { languageCode: "heb", languageProbability: 0.99, words, events: [] } };
      },
    },
    music: {
      model: "fake/music",
      async compose({ durationMs }: { prompt: string; durationMs: number }) {
        calls.music++;
        const out = nextFile("wav");
        await makeTestTone(out, { durationSec: Math.max(1, durationMs / 1000), volumeDb: -24 });
        return { audio: await readFile(out), ext: "wav" as const };
      },
    },
```
with, at module level:
```ts
/** What the fake transcriber "hears" in any upload: three sentences, a filler and a comment keyword. */
export const FAKE_TALK = "היי חברים, אממ היום אני אראה לכם טריק. זה חוסך שעות עבודה. תכתבו AI בתגובות.";
```

- [ ] **Step 6: Wire the real providers** in `providers/index.ts`:
```ts
  const footageApi = sdkElevenLabsFootage(config.elevenlabs.apiKey!);
  return {
    // ...the existing image, video, uploader, voice
    transcriber: new ScribeTranscriber(footageApi),
    music: new ElevenLabsMusic(footageApi),
  };
```

- [ ] **Step 7: Verify.** Run `npx vitest run packages/engine apps/worker && npm run typecheck`. Expected: PASS (existing tests build `Providers` only through `createFakeProviders` and `createProviders`).

- [ ] **Step 8: Commit** with message `feat(engine): Scribe transcriber and ElevenLabs Music providers with free fakes`.

---

### Task 10: Footage planner (Claude) and Re-plan input

**Files:**
- Create: `packages/engine/src/footage-planner.ts`
- Modify: `packages/engine/src/index.ts`, `packages/engine/src/providers/fake.ts`, `packages/engine/src/providers/index.ts`
- Test: `packages/engine/src/footage-planner.test.ts`

**Interfaces:**
- Consumes: `splitBeats` (Task 3), `EditPlanDraftSchema`, `parseEditPlan` (Task 2), `withFootageEstimate` (Task 5), `houseStyle.edit` (Task 7), `LENGTH_TOLERANCE` (existing).
- Produces:
  - `type LibraryTrack = { id: string; title: string; mood: MusicMood; durationSec: number }`
  - `type FootagePlanRequest = { settings: FootageSettings; source: FootageSource; transcript: Transcript; library: LibraryTrack[]; warnings: string[]; instruction?: string; previous?: EditPlan }`
  - `interface FootagePlanner { plan(req: FootagePlanRequest): Promise<EditPlan> }` (returns `version: 1`; the handler sets the real version)
  - `type EditDraftModel`, `claudeEditDraftModel(client, model)`, `footageSystemPrompt()`, `footageUserPrompt(req, beats)`, `buildEditPlan(draft, req, beats, style): EditPlan`, `createFootagePlanner(model, style): FootagePlanner`, `transcriptWarnings(transcript, settings, style): string[]`, `class FootagePlannerRefusedError`
  - `createFakeProviders(...).footagePlanner`; `createFootagePlannerFor(config, workDir): FootagePlanner`

- [ ] **Step 1: Write the failing test** `packages/engine/src/footage-planner.test.ts`:
```ts
import { parseEditPlan, withFootageEstimate, type EditPlanDraft, type Transcript } from "@reel/core";
import { houseStyle } from "@reel/video/house-style";
import { describe, expect, it, vi } from "vitest";
import { footageTranscript, validEditPlan } from "../../core/src/testing/fixtures";
import { buildEditPlan, createFootagePlanner, footageUserPrompt, transcriptWarnings, type EditDraftModel, type FootagePlanRequest } from "./footage-planner";
import { splitBeats } from "@reel/core";

const style = houseStyle.edit;
const TRACK = "3f2c8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
const REQ: FootagePlanRequest = { settings: { language: "he", targetDurationSec: 15, ctaKeyword: "AI" }, source: validEditPlan().source, transcript: footageTranscript(), library: [], warnings: [] };
const draft = (over: Partial<EditPlanDraft> = {}): EditPlanDraft => ({
  title: "טריק שחוסך שעות",
  beats: ["b1", "b2", "b3"].map((id) => ({ id, keep: true, dropReason: "", emphasisWordIdx: id === "b1" ? 7 : -1, emoji: id === "b2" ? "👇" : "" })),
  hook: { coldOpenBeatId: "", headlineSmall: "הטריק ש", headlineBig: "חוסך שעות", patternBreak: "zoom_hit", reason: "A bold promise plus a punch-in." },
  ending: { kind: "cta", keyword: "" },
  music: { kind: "none", trackId: "", prompt: "" },
  sfx: "subtle",
  ...over,
});
const reply = (d: EditPlanDraft | null, stopReason = "end_turn") => ({ stopReason, draft: d, raw: JSON.stringify(d) });

/** 60 words of 300 ms, a sentence every 6 words: ≈ 21 s of speech. */
const longTranscript = (): Transcript => ({
  languageCode: "heb", languageProbability: 0.9, events: [],
  words: Array.from({ length: 60 }, (_, i) => ({ text: i % 6 === 5 ? `מילה${i}.` : `מילה${i}`, startMs: i * 350, endMs: i * 350 + 300 })),
});

describe("buildEditPlan", () => {
  it("turns a draft into the full plan: beat spans, source, keyword, estimate", () => {
    const plan = buildEditPlan(draft(), REQ, splitBeats(REQ.transcript.words), style);
    expect(plan).toEqual(withFootageEstimate(parseEditPlan(validEditPlan()), REQ.transcript.words, style));
    expect(plan.estimate).toEqual({ durationSec: 7.3, credits: 0 });
  });
  it("prices AI music and accepts a library track by id only", () => {
    const beats = splitBeats(REQ.transcript.words);
    expect(buildEditPlan(draft({ music: { kind: "ai", trackId: "", prompt: "calm lo-fi" } }), REQ, beats, style).estimate.credits).toBe(0.08);
    const lib = { ...REQ, library: [{ id: TRACK, title: "Morning", mood: "calm" as const, durationSec: 95 }] };
    expect(buildEditPlan(draft({ music: { kind: "library", trackId: TRACK, prompt: "" } }), lib, beats, style).music).toEqual({ kind: "library", assetId: TRACK });
    expect(() => buildEditPlan(draft({ music: { kind: "library", trackId: "nope", prompt: "" } }), lib, beats, style)).toThrow(/not in the library/);
  });
  it("reports missing and unknown beat ids", () => {
    const d = draft();
    d.beats = [d.beats[0], { ...d.beats[1], id: "b7" }];
    expect(() => buildEditPlan(d, REQ, splitBeats(REQ.transcript.words), style)).toThrow(/missing b2, b3[\s\S]*Unknown beat ids: b7/);
  });
});

describe("footageUserPrompt", () => {
  it("lists beats with word indices, the keyword, the library and plan-1 limits", () => {
    const u = footageUserPrompt({ ...REQ, library: [{ id: TRACK, title: "Morning", mood: "calm", durationSec: 95 }], settings: { ...REQ.settings, notes: "קצר וקולע" } }, splitBeats(REQ.transcript.words));
    expect(u).toMatch(/Reel language: Hebrew\. Target length: 15 seconds\./);
    expect(u).toMatch(/b1 \(3\.5 s\): 0:היי 1:חברים, 2:אממ 3:היום/);
    expect(u).toMatch(/Comment keyword from the user: "AI"/);
    expect(u).toContain(`- ${TRACK} "Morning" (calm, 95 s)`);
    expect(u).toMatch(/Notes from the user: קצר וקולע/);
    expect(u).toMatch(/Cutaways, B-roll and background replacement are not available/);
  });
  it("adds the previous plan and the instruction for a Re-plan", () => {
    const previous = parseEditPlan({ ...validEditPlan(), beats: validEditPlan().beats.map((b) => (b.id === "b2" ? { ...b, keep: false, dropReason: "tangent" } : b)) });
    const u = footageUserPrompt({ ...REQ, previous, instruction: "tighten to 15 s" }, splitBeats(REQ.transcript.words));
    expect(u).toMatch(/Your previous plan: kept b1, b3; dropped b2 \(tangent\)/);
    expect(u).toMatch(/The user asked for this change: tighten to 15 s/);
  });
});

describe("createFootagePlanner", () => {
  it("returns a valid plan from one call", async () => {
    const model = vi.fn<EditDraftModel>(async () => reply(draft()));
    const plan = await createFootagePlanner(model, style).plan(REQ);
    expect(model).toHaveBeenCalledTimes(1);
    expect(plan.beats.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });
  it("repairs once with the error, then succeeds", async () => {
    const bad = draft();
    bad.beats[0].emphasisWordIdx = 9;
    const model = vi.fn<EditDraftModel>().mockResolvedValueOnce(reply(bad)).mockResolvedValueOnce(reply(draft()));
    await createFootagePlanner(model, style).plan(REQ);
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].user).toMatch(/word 9 is outside beat b1/);
  });
  it("throws after two invalid answers", async () => {
    const model = vi.fn<EditDraftModel>(async () => reply(null));
    await expect(createFootagePlanner(model, style).plan(REQ)).rejects.toThrow(/invalid edit plan twice/);
  });
  it("refuses an edit that keeps only fillers", async () => {
    const t = { ...REQ.transcript, words: [{ text: "אממ", startMs: 0, endMs: 900 }, { text: "אהה.", startMs: 1000, endMs: 2400 }] };
    const d = draft({ beats: [{ id: "b1", keep: true, dropReason: "", emphasisWordIdx: -1, emoji: "" }], ending: { kind: "none", keyword: "" }, hook: { ...draft().hook, headlineBig: "" } });
    const model = vi.fn<EditDraftModel>(async () => reply(d));
    await expect(createFootagePlanner(model, style).plan({ ...REQ, transcript: t })).rejects.toThrow(/Keep at least one beat with speech/);
  });
  it("asks once to shorten an over-long plan, then returns it with the length left to the reviewer", async () => {
    const beats = splitBeats(longTranscript().words);
    const keepAll = draft({ beats: beats.map((b) => ({ id: b.id, keep: true, dropReason: "", emphasisWordIdx: -1, emoji: "" })), ending: { kind: "loop", keyword: "" } });
    const model = vi.fn<EditDraftModel>(async () => reply(keepAll));
    const plan = await createFootagePlanner(model, style).plan({ ...REQ, transcript: longTranscript() });
    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1][0].user).toMatch(/drop the weakest beats/);
    expect(plan.beats.every((b) => b.keep)).toBe(true);
  });
  it("turns a refusal into a plain error", async () => {
    const model = vi.fn<EditDraftModel>(async () => reply(null, "refusal"));
    await expect(createFootagePlanner(model, style).plan(REQ)).rejects.toThrow(/declined to plan this edit/);
  });
});

describe("transcriptWarnings", () => {
  it("warns about a language mismatch and noisy audio, and is quiet otherwise", () => {
    expect(transcriptWarnings(footageTranscript(), REQ.settings, style)).toEqual([]);
    const en = { ...footageTranscript(), languageCode: "eng" };
    expect(transcriptWarnings(en, REQ.settings, style)).toEqual(["You picked Hebrew, but the speech sounds like English. Captions follow what was said."]);
    const noisy = { ...footageTranscript(), words: footageTranscript().words.map((w) => ({ ...w, logprob: -1.5 })) };
    expect(transcriptWarnings(noisy, REQ.settings, style)).toEqual(["The audio sounds noisy or unclear, so some caption words may be wrong."]);
  });
});
```
Run `npx vitest run packages/engine/src/footage-planner.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement** `packages/engine/src/footage-planner.ts` and add `export * from "./footage-planner";` to `packages/engine/src/index.ts`:
```ts
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  EditPlanDraftSchema, LENGTH_TOLERANCE, parseEditPlan, splitBeats, withFootageEstimate,
  type BeatSpan, type EditPlan, type EditPlanDraft, type EditStyle, type FootageSettings, type FootageSource, type MusicMood, type Transcript,
} from "@reel/core";

export type LibraryTrack = { id: string; title: string; mood: MusicMood; durationSec: number };
export type FootagePlanRequest = {
  settings: FootageSettings;
  source: FootageSource;
  transcript: Transcript;
  library: LibraryTrack[];
  warnings: string[];
  instruction?: string;
  previous?: EditPlan;
};
export interface FootagePlanner {
  plan(req: FootagePlanRequest): Promise<EditPlan>;
}
export type EditDraftModel = (req: { system: string; user: string }) => Promise<{ stopReason: string | null; draft: EditPlanDraft | null; raw: string }>;

export class FootagePlannerRefusedError extends Error {
  constructor() {
    super("Claude declined to plan this edit. Check the video's content, then use Re-plan.");
    this.name = "FootagePlannerRefusedError";
  }
}

export function claudeEditDraftModel(client: Anthropic, model: string): EditDraftModel {
  return async ({ system, user }) => {
    const res = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: betaZodOutputFormat(EditPlanDraftSchema) },
      system,
      messages: [{ role: "user", content: user }],
    });
    const raw = res.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    return { stopReason: res.stop_reason, draft: res.parsed_output ?? null, raw };
  };
}

export function footageSystemPrompt(): string {
  return [
    "You edit short vertical talking-head reels (Instagram Reels, TikTok) in the style of top creators.",
    "The user filmed themselves talking. Code has already split the transcript into beats (sentences). You decide what stays, and you design the hook and the ending. Code does all micro-editing (pause cuts, zooms, caption timing, audio levels): never describe it.",
    "",
    "House style:",
    "- Tight: drop retakes, false starts, repeated sentences, greetings and weak tangents. When a sentence was said twice, keep the better (usually the later) take.",
    "- Fit the target length: if the talk is longer, drop the weakest beats, never the main point.",
    "- The hook is the first 3 seconds. Combine:",
    "  - coldOpenBeatId: the single most surprising or valuable line, played first and not repeated later. Empty when the first kept beat already hooks.",
    "  - headlineSmall + headlineBig: a small white line (at most 5 words) and a huge yellow word or two (at most 12 characters), in the reel's language. Both empty for no headline.",
    '  - patternBreak: "zoom_hit" (a fast punch-in), "flash" (two white frames) or "none".',
    "  - reason: one sentence explaining the hook, shown to the user.",
    "- emphasisWordIdx: in about one beat in three, the index of its single most important word (shown in red). -1 for none.",
    "- emoji: rarely; 👆 or 👇 when the speaker points, or one emoji that fits the line. Empty otherwise.",
    '- ending: "cta" when there is a comment keyword (the user gave one, or the speaker asks viewers to comment a word: put that word in keyword); "loop" when the last line can flow back into the first; otherwise "none".',
    '- music: a library track whose mood fits (kind "library", trackId); "ai" with a short English instrumental prompt (genre, mood, tempo) only when no library track fits; "none" for serious or emotional talks.',
    '- sfx: "subtle" by default, "lively" for energetic tips, "off" for serious topics.',
    "- dropReason: for every dropped beat, a short English reason (\"retake of b4\", \"false start\", \"tangent\").",
    "- Return every beat id exactly once, in the given order.",
  ].join("\n");
}

const sec = (ms: number) => (ms / 1000).toFixed(1);
const LANGUAGE = { he: "Hebrew", en: "English" } as const;

export function footageUserPrompt(req: FootagePlanRequest, beats: BeatSpan[]): string {
  const w = req.transcript.words;
  const speechMs = beats.reduce((s, b) => s + (w[b.endWordIdx].endMs - w[b.startWordIdx].startMs), 0);
  const lines = [
    `Reel language: ${LANGUAGE[req.settings.language]}. Target length: ${req.settings.targetDurationSec} seconds. The talk has ${sec(speechMs)} s of speech in ${beats.length} beats.`,
    req.settings.ctaKeyword
      ? `Comment keyword from the user: "${req.settings.ctaKeyword}" (use ending "cta").`
      : 'No comment keyword was given: use "cta" only if the speaker asks viewers to comment a specific word, and put that word in ending.keyword.',
    ...(req.settings.notes ? [`Notes from the user: ${req.settings.notes}`] : []),
    "Cutaways, B-roll and background replacement are not available in this version: never mention them.",
    req.library.length ? "Music library:" : "Music library: empty.",
    ...req.library.map((t) => `- ${t.id} "${t.title}" (${t.mood}, ${Math.round(t.durationSec)} s)`),
    "",
    "Beats (id, length, then every word as index:word):",
    ...beats.map((b) => `${b.id} (${sec(w[b.endWordIdx].endMs - w[b.startWordIdx].startMs)} s): ${w.slice(b.startWordIdx, b.endWordIdx + 1).map((x, i) => `${b.startWordIdx + i}:${x.text}`).join(" ")}`),
  ];
  if (req.previous) {
    const p = req.previous;
    const kept = p.beats.filter((b) => b.keep).map((b) => b.id).join(", ") || "none";
    const dropped = p.beats.filter((b) => !b.keep).map((b) => (b.dropReason ? `${b.id} (${b.dropReason})` : b.id)).join(", ") || "none";
    lines.push("", `Your previous plan: kept ${kept}; dropped ${dropped}. Hook: ${p.hook.reason || p.hook.patternBreak}.`);
  }
  if (req.instruction) lines.push(`The user asked for this change: ${req.instruction}`);
  return lines.join("\n");
}

/** Fills in what code owns (beat spans, source, keyword, estimate, warnings) and validates with parseEditPlan. Throws a repair-ready message. */
export function buildEditPlan(draft: EditPlanDraft, req: FootagePlanRequest, beats: BeatSpan[], style: EditStyle): EditPlan {
  const byId = new Map(draft.beats.map((b) => [b.id, b]));
  const missing = beats.filter((b) => !byId.has(b.id)).map((b) => b.id);
  const unknown = draft.beats.filter((d) => !beats.some((b) => b.id === d.id)).map((d) => d.id);
  const idErrors = [
    ...(missing.length ? [`Return every beat id exactly once: missing ${missing.join(", ")}.`] : []),
    ...(unknown.length ? [`Unknown beat ids: ${unknown.join(", ")}.`] : []),
  ];
  if (idErrors.length) throw new Error(idErrors.join("\n"));
  const m = draft.music;
  if (m.kind === "library" && !req.library.some((t) => t.id === m.trackId)) {
    throw new Error(`music.trackId "${m.trackId}" is not in the library. Use a listed id, or "ai" or "none".`);
  }
  const plan = {
    format: "footage",
    version: 1,
    title: draft.title.trim(),
    language: req.settings.language,
    targetDurationSec: req.settings.targetDurationSec,
    source: req.source,
    beats: beats.map((b) => {
      const d = byId.get(b.id)!;
      return {
        id: b.id, startWordIdx: b.startWordIdx, endWordIdx: b.endWordIdx, keep: d.keep,
        ...(!d.keep && d.dropReason.trim() ? { dropReason: d.dropReason.trim().slice(0, 200) } : {}),
        ...(d.emphasisWordIdx >= 0 ? { emphasisWordIdx: d.emphasisWordIdx } : {}),
        ...(d.emoji.trim() ? { emoji: d.emoji.trim() } : {}),
      };
    }),
    hook: {
      ...(draft.hook.coldOpenBeatId.trim() ? { coldOpenBeatId: draft.hook.coldOpenBeatId.trim() } : {}),
      ...(draft.hook.headlineBig.trim() ? { headline: { small: draft.hook.headlineSmall.trim(), big: draft.hook.headlineBig.trim() } } : {}),
      patternBreak: draft.hook.patternBreak,
      reason: draft.hook.reason.trim().slice(0, 300),
    },
    ending: draft.ending.kind === "cta" ? { kind: "cta", keyword: req.settings.ctaKeyword ?? draft.ending.keyword.trim() } : { kind: draft.ending.kind },
    background: { mode: "original" },
    music: m.kind === "library" ? { kind: "library", assetId: m.trackId } : m.kind === "ai" ? { kind: "ai", prompt: m.prompt.trim() } : { kind: "none" },
    sfx: draft.sfx,
    estimate: { durationSec: 0, credits: 0 },
    warnings: req.warnings,
  };
  return withFootageEstimate(parseEditPlan(plan), req.transcript.words, style);
}

type Attempt = { ok: true; plan: EditPlan } | { ok: false; error: string; plan?: EditPlan };

function attempt(result: Awaited<ReturnType<EditDraftModel>>, req: FootagePlanRequest, beats: BeatSpan[], style: EditStyle): Attempt {
  if (result.stopReason === "refusal") throw new FootagePlannerRefusedError();
  if (!result.draft) return { ok: false, error: "The output did not match the edit plan schema." };
  let plan: EditPlan;
  try {
    plan = buildEditPlan(result.draft, req, beats, style);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (plan.estimate.durationSec === 0) return { ok: false, error: "Every kept beat is only fillers. Keep at least one beat with speech." };
  const target = req.settings.targetDurationSec;
  if (plan.estimate.durationSec > target * LENGTH_TOLERANCE) {
    return { ok: false, error: `The kept beats run about ${Math.round(plan.estimate.durationSec)} s but the target is ${target} s: drop the weakest beats until they fit.`, plan };
  }
  return { ok: true, plan };
}

export function createFootagePlanner(model: EditDraftModel, style: EditStyle): FootagePlanner {
  return {
    async plan(req) {
      const beats = splitBeats(req.transcript.words);
      if (!beats.length) throw new Error("No speech found. This editor needs a video of you talking.");
      const system = footageSystemPrompt();
      const user = footageUserPrompt(req, beats);
      const first = await model({ system, user });
      const a1 = attempt(first, req, beats, style);
      if (a1.ok) return a1.plan;
      const repair = [user, "", "Your previous edit plan was rejected:", a1.error, "", "Previous output:", first.raw, "", "Return a corrected edit plan."].join("\n");
      const a2 = attempt(await model({ system, user: repair }), req, beats, style);
      if (a2.ok) return a2.plan;
      // Valid but long: return it; the review page shows the length warning and the user decides.
      const fallback = a2.plan ?? a1.plan;
      if (fallback) return fallback;
      if (/Keep at least one beat with speech/.test(a2.error)) throw new Error(a2.error);
      throw new Error(`Claude returned an invalid edit plan twice:\n${a2.error}`);
    },
  };
}

/** Plan warnings from the transcript (spec §7): language mismatch and noisy audio. */
export function transcriptWarnings(transcript: Transcript, settings: FootageSettings, style: EditStyle): string[] {
  const out: string[] = [];
  const detected = transcript.languageCode.slice(0, 2).toLowerCase();
  if (detected && detected !== settings.language) {
    const name = detected === "he" ? "Hebrew" : detected === "en" ? "English" : transcript.languageCode;
    out.push(`You picked ${LANGUAGE[settings.language]}, but the speech sounds like ${name}. Captions follow what was said.`);
  }
  const probs = transcript.words.flatMap((w) => (w.logprob === undefined ? [] : [w.logprob]));
  if (probs.length && probs.reduce((a, b) => a + b, 0) / probs.length < style.noisyLogprob) {
    out.push("The audio sounds noisy or unclear, so some caption words may be wrong.");
  }
  return out;
}
```
The "fillers only" test: both answers yield the same plan-less error, so the planner throws that error itself (the last `if`), keeping the plain message for the user.

- [ ] **Step 3: Fake and real planner factories.** In `providers/fake.ts` add `footagePlanner` to the returned object (import `createFootagePlanner`, `buildEditPlan` is not needed: the fake model below goes through the real `createFootagePlanner`, so the fake flow exercises validation):
```ts
    footagePlanner: createFootagePlanner(async ({ user }) => {
      calls.plan++;
      const ids = [...user.matchAll(/^(b\d+) \(/gm)].map((m) => m[1]);
      const he = /Reel language: Hebrew/.test(user);
      const keyword = user.match(/Comment keyword from the user: "([^"]+)"/)?.[1];
      const trackId = user.match(/^- ([0-9a-f-]{36}) "/m)?.[1];
      const draft: EditPlanDraft = {
        title: he ? "עריכה לדוגמה" : "Sample edit",
        beats: ids.map((id) => ({ id, keep: true, dropReason: "", emphasisWordIdx: -1, emoji: "" })),
        hook: { coldOpenBeatId: "", headlineSmall: he ? "הטריק ש" : "The trick that", headlineBig: he ? "חוסך שעות" : "saves hours", patternBreak: "zoom_hit", reason: "Fake planner: a headline and a punch-in." },
        ending: { kind: keyword ? "cta" : "loop", keyword: keyword ?? "" },
        music: trackId ? { kind: "library", trackId, prompt: "" } : { kind: "ai", trackId: "", prompt: "calm lo-fi beat" },
        sfx: "subtle",
      };
      return { stopReason: "end_turn", draft, raw: JSON.stringify(draft) };
    }, houseStyle.edit),
```
(imports: `type EditPlanDraft` from `@reel/core`, `houseStyle` from `@reel/video/house-style`, `createFootagePlanner` from `../footage-planner`.)

In `providers/index.ts` add:
```ts
/** Footage planning needs only Claude. */
export function createFootagePlannerFor(config: EngineConfig, workDir: string): FootagePlanner {
  if (config.providers === "fake") return createFakeProviders({ workDir }).footagePlanner;
  return createFootagePlanner(claudeEditDraftModel(new Anthropic(), config.claudeModel), houseStyle.edit);
}
```
Add a test to `fake.test.ts`: the fake footage planner, given `footageTranscript()`, `validEditPlan().source` and `ctaKeyword: "AI"`, returns a plan with all three beats kept, `ending: { kind: "cta", keyword: "AI" }` and `music.kind === "ai"`.

- [ ] **Step 4: Verify.** Run `npx vitest run packages/engine && npm run typecheck`. Expected: PASS. No test calls Claude.

- [ ] **Step 5: Commit** with message `feat(engine): footage planner (beats, hook, ending, music, sfx) with one repair round, Re-plan context and transcript warnings`.

---
### Task 11: Ingest and plan jobs (`ingest_footage`, `plan_footage`)

**Files:**
- Create: `packages/engine/src/footage-ingest.ts`, `packages/engine/src/face-tracker.ts`, `apps/worker/src/handlers/footage.ts`
- Modify: `packages/engine/src/asset-store.ts` (`AssetKind` adds `"data"`), `packages/engine/src/pipeline.ts` (export `cached` and `estUsd`), `packages/engine/src/index.ts`, `packages/db/src/index.ts` (`JobType`), `apps/worker/src/reel-db.ts`, `apps/worker/src/storage.ts` (streaming download), `apps/worker/src/testing/fakes.ts`, `apps/worker/src/handlers/index.ts`, `apps/worker/src/main.ts`, `apps/worker/src/loop.test.ts`
- Test: `packages/engine/src/footage-ingest.test.ts`, `apps/worker/src/handlers/footage.test.ts`, `apps/worker/src/storage.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 1–10 (`IngestFootageJobPayloadSchema`, `PlanFootageJobPayloadSchema`, `FootagePlanner`, `transcriptWarnings`, `Transcriber`, `runFaceHelper`, `smoothFaceTrack`, `sha256File`, `conformVideo`, `extractAudio`).
- Produces:
  - engine: `class FootageInputError`, `type FaceTracker = { readonly model: string; track(videoPath: string): Promise<FaceTrack> }`, `visionFaceTracker()`, `noFaceTracker`, `createFaceTracker(mode: "real" | "fake"): FaceTracker`
  - engine: `footageHashes = { working(originalSha), transcript(model, workingHash), faces(model, workingHash), voice(workingHash, segments), musicFit(trackSha, durationMs), musicAi(model, prompt, durationMs), sfx(fileSha) }`
  - engine: `ingestFootage(originalPath, deps: IngestDeps): Promise<{ source: FootageSource; transcript: Transcript }>`, `loadFootageInputs(store, source): Promise<FootageInputs>` where `FootageInputs = { working: StoredAsset; transcriptAsset: StoredAsset; transcript: Transcript; faceTrack: FaceTrack }`
  - engine: `export async function cached(...)`, `export const estUsd`
  - db: `type JobType = "plan" | "generate" | "ingest_footage" | "plan_footage"` (Task 12 adds `"generate_footage"`)
  - worker: `ReelDb` gains `supersedeDrafts(projectId)`, `listTeamMusic(): Promise<TeamTrack[]>`, `getTeamTrack(id): Promise<TeamTrack | null>`; `insertStoryboard` accepts `Storyboard | EditPlan`; `type TeamTrack = { id; storagePath; title; mood: MusicMood; durationSec }`
  - worker: `createIngestFootageHandler(deps: FootageHandlerDeps)`, `createPlanFootageHandler(deps)`, `type FootageHandlerDeps = { store; blobs; db; transcriber; faceTracker; footagePlanner }`

- [ ] **Step 1: Write the failing engine test** `packages/engine/src/footage-ingest.test.ts`:
```ts
import { makeTestVideo, probe, runFfmpeg } from "@reel/media";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAssetStore } from "./asset-store";
import { noFaceTracker } from "./face-tracker";
import { footageHashes, ingestFootage, loadFootageInputs } from "./footage-ingest";
import { createFakeProviders } from "./providers/fake";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "ingest-"));
  const providers = createFakeProviders({ workDir: dir });
  const deps = { store: new FileAssetStore(join(dir, "cache")), transcriber: providers.transcriber, faceTracker: noFaceTracker, tmpDir: join(dir, "tmp"), log: () => {} };
  return { dir, providers, deps };
}

describe("ingestFootage (real ffmpeg, fake Scribe, no face helper)", () => {
  it("makes a 1080×1920 30 fps working copy from a landscape upload, transcribes it and caches every step", async () => {
    const { dir, providers, deps } = await setup();
    await makeTestVideo(join(dir, "land.mp4"), { durationSec: 4, width: 1280, height: 720, fps: 25, withAudio: true });
    const { source, transcript } = await ingestFootage(join(dir, "land.mp4"), deps);
    const inputs = await loadFootageInputs(deps.store, source);
    const info = await probe(inputs.working.path);
    expect(info.video).toMatchObject({ width: 1080, height: 1920, sar: "1:1" });
    expect(info.video!.fps).toBeCloseTo(30, 3);
    expect(info.audio).toBeDefined();
    expect(source.durationMs).toBeGreaterThan(3900);
    expect(transcript.words.length).toBeGreaterThanOrEqual(5);
    expect(inputs.faceTrack.samples).toEqual([]);
    await ingestFootage(join(dir, "land.mp4"), deps);
    expect(providers.calls.transcribe).toBe(1);
  }, 300_000);

  it("accepts a rotated phone clip", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "raw.mp4"), { durationSec: 2, width: 640, height: 360, withAudio: true });
    await runFfmpeg(["-display_rotation", "90", "-i", join(dir, "raw.mp4"), "-c", "copy", join(dir, "rotated.mp4")]);
    const { source } = await ingestFootage(join(dir, "rotated.mp4"), deps);
    expect((await probe((await loadFootageInputs(deps.store, source)).working.path)).video).toMatchObject({ width: 1080, height: 1920 });
  }, 300_000);

  it.each([
    ["no audio", { durationSec: 2, withAudio: false }, /has no sound/],
    ["over 3:00", { durationSec: 182, width: 64, height: 64, withAudio: true }, /3:02 long/],
  ] as const)("fails plainly for %s", async (_name, opts, message) => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), opts);
    await expect(ingestFootage(join(dir, "v.mp4"), deps)).rejects.toThrow(message);
  }, 300_000);

  it("fails with 'No speech found' under 5 words, after caching the transcript", async () => {
    const { dir, deps } = await setup();
    await makeTestVideo(join(dir, "v.mp4"), { durationSec: 2, width: 360, height: 640, withAudio: true });
    const quiet = { model: "fake/quiet", transcribe: async () => ({ transcript: { languageCode: "heb", languageProbability: 0.5, words: [{ text: "אה", startMs: 0, endMs: 300 }], events: [] } }) };
    await expect(ingestFootage(join(dir, "v.mp4"), { ...deps, transcriber: quiet })).rejects.toThrow(/No speech found/);
  }, 300_000);

  it("keys transcripts and faces by model, so fake data never answers for a real provider", () => {
    const h = "a".repeat(64);
    expect(footageHashes.transcript("fake/scribe", h)).not.toBe(footageHashes.transcript("elevenlabs/scribe_v2", h));
    expect(footageHashes.faces("fake/no-face", h)).not.toBe(footageHashes.faces("vision/face-rectangles-v1", h));
    expect(footageHashes.musicAi("fake/music", "x", 5000)).not.toBe(footageHashes.musicAi("elevenlabs/music", "x", 5000));
  });
});
```
If FFmpeg 8 rejects `-display_rotation` as an input option for stream copy, create the rotated clip with `-metadata:s:v:0 rotate=90` instead and note it. Run `npx vitest run packages/engine/src/footage-ingest.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement the engine side.**
  - `asset-store.ts`: `export type AssetKind = "image" | "video" | "audio" | "data";`
  - `pipeline.ts`: change `const estUsd` and `async function cached` to `export`. No behaviour change.

`packages/engine/src/face-tracker.ts`:
```ts
import { RawFaceTrackSchema, smoothFaceTrack, type FaceTrack } from "@reel/core";
import { faceHelperAvailable, runFaceHelper } from "@reel/media";

export type FaceTracker = { readonly model: string; track(videoPath: string): Promise<FaceTrack> };
const VISION = "vision/face-rectangles-v1";

export const visionFaceTracker = (): FaceTracker => ({
  model: VISION,
  async track(video) {
    return smoothFaceTrack(RawFaceTrackSchema.parse(await runFaceHelper(video)));
  },
});

/** Fake worker without the Swift binary: no faces, so every crop is centred. */
export const noFaceTracker: FaceTracker = { model: "fake/no-face", track: async () => ({ intervalMs: 100, samples: [] }) };

export function createFaceTracker(mode: "real" | "fake"): FaceTracker {
  if (faceHelperAvailable()) return visionFaceTracker();
  if (mode === "fake") return noFaceTracker;
  return {
    model: VISION,
    track: async () => {
      throw new Error('face-helper is not built on this worker. Run "npm run build:face-helper" (needs Xcode command line tools), then retry.');
    },
  };
}
```

`packages/engine/src/footage-ingest.ts`:
```ts
import { FaceTrackSchema, FOOTAGE_MAX_SEC_INGEST, formatMinSec, TranscriptSchema, type FaceTrack, type FootageSource, type PipelineEvent, type Transcript, type VoiceSegment } from "@reel/core";
import { inputHash } from "@reel/core/hash";
import { conformVideo, extractAudio, probe, sha256File } from "@reel/media";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type * as z from "zod";
import type { AssetStore, StoredAsset } from "./asset-store";
import type { FaceTracker } from "./face-tracker";
import { cached, estUsd } from "./pipeline";
import type { Transcriber } from "./providers/types";

/** A problem with the uploaded file itself; the message is shown to the user as is. */
export class FootageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FootageInputError";
  }
}

/** Cache keys. Every provider-made asset includes the provider's model id (fake vs real never mix). */
export const footageHashes = {
  working: (originalSha: string) => inputHash({ step: "footage-working", v: 1, originalSha }),
  transcript: (model: string, workingHash: string) => inputHash({ step: "transcript", v: 1, model, workingHash }),
  faces: (model: string, workingHash: string) => inputHash({ step: "faces", v: 1, model, workingHash }),
  voice: (workingHash: string, segments: VoiceSegment[]) => inputHash({ step: "footage-voice", v: 1, workingHash, segments }),
  musicFit: (trackSha: string, durationMs: number) => inputHash({ step: "music-fit", v: 1, trackSha, durationMs }),
  musicAi: (model: string, prompt: string, durationMs: number) => inputHash({ step: "music-ai", v: 1, model, prompt, durationMs }),
  sfx: (fileSha: string) => inputHash({ step: "sfx", v: 1, fileSha }),
};

export type IngestDeps = { store: AssetStore; transcriber: Transcriber; faceTracker: FaceTracker; tmpDir: string; log: (m: string) => void; onEvent?: (e: PipelineEvent) => void };
export type FootageInputs = { working: StoredAsset; transcriptAsset: StoredAsset; transcript: Transcript; faceTrack: FaceTrack };

async function readJson<T>(asset: StoredAsset, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(JSON.parse(await readFile(asset.path, "utf8")));
}

/** Spec §4.2: probe, working copy, transcript, face track. Every step is a cached asset, so a retry skips finished work. */
export async function ingestFootage(originalPath: string, deps: IngestDeps): Promise<{ source: FootageSource; transcript: Transcript }> {
  const { store, log } = deps;
  const emit = (e: PipelineEvent) => deps.onEvent?.(e);
  await mkdir(deps.tmpDir, { recursive: true });
  const tmp = (name: string) => join(deps.tmpDir, name);

  emit({ type: "step", step: "conform", status: "running" });
  const info = await probe(originalPath).catch(() => {
    throw new FootageInputError("This file isn't a readable video. Upload an MP4 or MOV.");
  });
  if (!info.video) throw new FootageInputError("This file has no video track. Upload an MP4 or MOV video.");
  if (!info.audio) throw new FootageInputError("This video has no sound. Upload a video where you speak.");
  if (info.durationSec > FOOTAGE_MAX_SEC_INGEST) throw new FootageInputError(`This video is ${formatMinSec(info.durationSec)} long. Trim it to 3:00 or less and upload it again.`);
  const originalSha = await sha256File(originalPath);
  const working = await cached(store, footageHashes.working(originalSha), async () => {
    log("ingest: making the 1080×1920 working copy");
    const out = tmp("working.mp4");
    await conformVideo(originalPath, out, { keepAudio: true });
    return { path: out, ext: "mp4", meta: { kind: "video", provider: "ffmpeg", extra: { originalSha } } };
  });
  const durationMs = Math.round((await probe(working.path)).durationSec * 1000);
  emit({ type: "step", step: "conform", status: "done" });

  emit({ type: "step", step: "transcribe", status: "running" });
  const model = deps.transcriber.model;
  const transcriptAsset = await cached(store, footageHashes.transcript(model, working.hash), async () => {
    log("ingest: transcribing");
    const wav = tmp("speech.wav");
    await extractAudio(working.path, wav);
    const { transcript, requestId } = await deps.transcriber.transcribe(wav);
    const file = tmp("transcript.json");
    await writeFile(file, JSON.stringify(TranscriptSchema.parse(transcript)));
    const real = model === "elevenlabs/scribe_v2";
    return { path: file, ext: "json", meta: { kind: "data", provider: real ? "elevenlabs" : "fake", model, requestId, estUsd: real ? estUsd(model, "perSecond", durationMs / 1000) : undefined } };
  });
  const transcript = await readJson(transcriptAsset, TranscriptSchema);
  if (transcript.words.length < 5) throw new FootageInputError("No speech found. This editor needs a video of you talking.");
  emit({ type: "step", step: "transcribe", status: "done" });

  emit({ type: "step", step: "faces", status: "running" });
  const faces = await cached(store, footageHashes.faces(deps.faceTracker.model, working.hash), async () => {
    log("ingest: finding the face");
    const file = tmp("faces.json");
    await writeFile(file, JSON.stringify(FaceTrackSchema.parse(await deps.faceTracker.track(working.path))));
    return { path: file, ext: "json", meta: { kind: "data", provider: "face-helper", model: deps.faceTracker.model } };
  });
  emit({ type: "step", step: "faces", status: "done" });
  return { source: { assetId: working.hash, durationMs, transcriptAssetId: transcriptAsset.hash, faceTrackAssetId: faces.hash }, transcript };
}

export async function loadFootageInputs(store: AssetStore, source: FootageSource): Promise<FootageInputs> {
  const [working, transcriptAsset, facesAsset] = await Promise.all([store.get(source.assetId), store.get(source.transcriptAssetId), store.get(source.faceTrackAssetId)]);
  if (!working || !transcriptAsset || !facesAsset) throw new Error("The prepared video is missing from storage. Upload the video again.");
  return { working, transcriptAsset, transcript: await readJson(transcriptAsset, TranscriptSchema), faceTrack: await readJson(facesAsset, FaceTrackSchema) };
}
```
Export both new modules from `packages/engine/src/index.ts`.

- [ ] **Step 3: Worker DB, storage and fakes.**
  - `packages/db/src/index.ts`: `export type JobType = "plan" | "generate" | "ingest_footage" | "plan_footage";`
  - `apps/worker/src/loop.test.ts`: the `handlers` helper becomes `({ plan: noop, generate: noop, ingest_footage: noop, plan_footage: noop, ...over })`.
  - `apps/worker/src/reel-db.ts`: add to `ReelDb` and `SupabaseReelDb`:
```ts
export type TeamTrack = { id: string; storagePath: string; title: string; mood: MusicMood; durationSec: number };
// interface ReelDb:
  insertStoryboard(input: { projectId: string; version: number; json: Storyboard | EditPlan; createdBy: "agent" | "user" }): Promise<string>;
  /** Marks this project's draft versions superseded (Re-plan keeps them for history). */
  supersedeDrafts(projectId: string): Promise<void>;
  listTeamMusic(): Promise<TeamTrack[]>;
  getTeamTrack(id: string): Promise<TeamTrack | null>;
// SupabaseReelDb:
  async supersedeDrafts(projectId: string) {
    const { error } = await this.sb.from("storyboards").update({ status: "superseded" }).eq("project_id", projectId).eq("status", "draft");
    check("supersede drafts", error);
  }
  async listTeamMusic() {
    const { data, error } = await this.sb.from("team_music").select("id, storage_path, title, mood, duration_sec").order("created_at");
    check("music list", error);
    return (data ?? []).map(toTrack);
  }
  async getTeamTrack(id: string) {
    const { data, error } = await this.sb.from("team_music").select("id, storage_path, title, mood, duration_sec").eq("id", id).maybeSingle();
    check("music lookup", error);
    return data ? toTrack(data) : null;
  }
```
with `const toTrack = (r: { id: string; storage_path: string; title: string; mood: string; duration_sec: number }): TeamTrack => ({ id: r.id, storagePath: r.storage_path, title: r.title, mood: MusicMoodSchema.parse(r.mood), durationSec: Number(r.duration_sec) });`.
  - `InMemoryReelDb` (`testing/fakes.ts`): add `readonly music: TeamTrack[] = [];`, `supersedeDrafts` (sets `status = "superseded"` on this project's drafts), `listTeamMusic` (returns `music`), `getTeamTrack`.
  - `SupabaseBlobStore.download` streams instead of buffering (an upload can be 2 GB):
```ts
  async download(bucket: string, path: string, destPath: string): Promise<void> {
    const { data, error } = await this.sb.storage.from(bucket).createSignedUrl(path, 600);
    if (error || !data) throw new Error(`download ${bucket}/${path} failed: ${error?.message ?? "no signed URL"}`);
    const res = await (this.fetchImpl ?? fetch)(data.signedUrl);
    if (!res.ok || !res.body) throw new Error(`download ${bucket}/${path} failed: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(destPath));
  }
```
with constructor `constructor(private readonly sb: SupabaseClient<Database>, private readonly fetchImpl?: typeof fetch) {}` and imports `createWriteStream` (`node:fs`), `Readable` (`node:stream`), `pipeline` (`node:stream/promises`). Extend `storage.test.ts`: serve a 5 MB file with `serveDir` (from `@reel/engine`), give `SupabaseBlobStore` a stub client `{ storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: server.urlFor("big.bin") }, error: null }) }) } } as never`, download, and compare `sha256File` of source and copy.

- [ ] **Step 4: Write the failing handler test** `apps/worker/src/handlers/footage.test.ts`:
```ts
import { parseEditPlan, type EditPlan } from "@reel/core";
import { createFakeProviders, FileAssetStore, noFaceTracker, type FootagePlanRequest } from "@reel/engine";
import { makeTestVideo } from "@reel/media";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryBlobStore, InMemoryReelDb, makeJob } from "../testing/fakes";
import { createIngestFootageHandler, createPlanFootageHandler } from "./footage";

const PID = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
const PATH = `footage/${PID}/source.mp4`;
const settings = { language: "he", targetDurationSec: 30, ctaKeyword: "AI" };
const ctx = { report: () => {}, log: () => {} };

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "footage-handlers-"));
  const providers = createFakeProviders({ workDir: dir });
  const db = new InMemoryReelDb();
  const blobs = new InMemoryBlobStore();
  await makeTestVideo(join(dir, "upload.mp4"), { durationSec: 6, width: 720, height: 1280, withAudio: true });
  await blobs.upload("assets", PATH, join(dir, "upload.mp4"));
  const requests: FootagePlanRequest[] = [];
  const footagePlanner = { plan: async (r: FootagePlanRequest) => { requests.push(r); return providers.footagePlanner.plan(r); } };
  const deps = { store: new FileAssetStore(join(dir, "cache")), blobs, db, transcriber: providers.transcriber, faceTracker: noFaceTracker, footagePlanner };
  return { db, deps, requests, providers };
}

describe("ingest_footage", () => {
  it("prepares the upload and writes edit plan v1 as a draft", async () => {
    const s = await setup();
    const outcome = await createIngestFootageHandler(s.deps)(makeJob({ type: "ingest_footage", project_id: PID, payload: { storagePath: PATH, settings } }), ctx);
    expect(outcome.status).toBe("done");
    const plan = parseEditPlan(s.db.storyboards[0].json);
    expect(plan).toMatchObject({ format: "footage", version: 1, ending: { kind: "cta", keyword: "AI" } });
    expect(s.db.projectStatus.get(PID)?.status).toBe("draft");
    expect(s.requests[0].warnings).toEqual([]);
  }, 300_000);

  it("refuses a path that belongs to another project and marks the project failed", async () => {
    const s = await setup();
    const other = "11111111-2222-4333-8444-555555555555";
    await expect(createIngestFootageHandler(s.deps)(makeJob({ type: "ingest_footage", project_id: other, payload: { storagePath: PATH, settings } }), ctx)).rejects.toThrow(/another reel/);
    expect(s.db.projectStatus.get(other)?.status).toBe("failed");
  });
});

describe("plan_footage (Re-plan)", () => {
  it("re-plans with the instruction and the previous plan, superseding the old draft", async () => {
    const s = await setup();
    await createIngestFootageHandler(s.deps)(makeJob({ type: "ingest_footage", project_id: PID, payload: { storagePath: PATH, settings } }), ctx);
    const first = s.db.storyboards[0];
    const plan = first.json as EditPlan;
    await createPlanFootageHandler(s.deps)(makeJob({ type: "plan_footage", project_id: PID, payload: { settings, source: plan.source, fromStoryboardId: first.id, instruction: "tighten to 15 s" } }), ctx);
    expect(s.db.storyboards.map((r) => [r.version, r.status])).toEqual([[1, "superseded"], [2, "draft"]]);
    expect(s.requests[1].instruction).toBe("tighten to 15 s");
    expect(s.requests[1].previous?.version).toBe(1);
    expect(s.providers.calls.transcribe).toBe(1);
  }, 300_000);

  it("puts the project back to draft when a Re-plan fails", async () => {
    const s = await setup();
    await createIngestFootageHandler(s.deps)(makeJob({ type: "ingest_footage", project_id: PID, payload: { storagePath: PATH, settings } }), ctx);
    const first = s.db.storyboards[0];
    const failing = { ...s.deps, footagePlanner: { plan: async () => { throw new Error("Claude is down"); } } };
    await expect(createPlanFootageHandler(failing)(makeJob({ type: "plan_footage", project_id: PID, payload: { settings, source: (first.json as EditPlan).source, fromStoryboardId: first.id } }), ctx)).rejects.toThrow(/Claude is down/);
    expect(s.db.projectStatus.get(PID)?.status).toBe("draft");
    expect(s.db.storyboards[0].status).toBe("draft");
  }, 300_000);
});
```
Run `npx vitest run apps/worker/src/handlers/footage.test.ts`. Expected: FAIL.

- [ ] **Step 5: Implement** `apps/worker/src/handlers/footage.ts`:
```ts
import { parseEditPlan, type EditPlan, type FootageSettings, type FootageSource, type PipelineEvent, type Transcript } from "@reel/core";
import { applyPipelineEvent, BUCKETS, emptyProgress, IngestFootageJobPayloadSchema, PlanFootageJobPayloadSchema } from "@reel/db";
import { ingestFootage, loadFootageInputs, transcriptWarnings, type AssetStore, type FaceTracker, type FootagePlanner, type Transcriber } from "@reel/engine";
import { houseStyle } from "@reel/video/house-style";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { JobHandler } from "../loop";
import type { ReelDb } from "../reel-db";
import type { BlobStore } from "../storage";

export type FootageHandlerDeps = { store: AssetStore; blobs: BlobStore; db: ReelDb; transcriber: Transcriber; faceTracker: FaceTracker; footagePlanner: FootagePlanner };

async function planAndSave(deps: FootageHandlerDeps, projectId: string, input: { settings: FootageSettings; source: FootageSource; transcript: Transcript; instruction?: string; previous?: EditPlan }) {
  const library = await deps.db.listTeamMusic();
  const planned = await deps.footagePlanner.plan({
    ...input,
    library: library.map(({ id, title, mood, durationSec }) => ({ id, title, mood, durationSec })),
    warnings: transcriptWarnings(input.transcript, input.settings, houseStyle.edit),
  });
  const version = await deps.db.nextStoryboardVersion(projectId);
  const plan = { ...planned, version };
  await deps.db.supersedeDrafts(projectId);
  await deps.db.insertStoryboard({ projectId, version, json: plan, createdBy: "agent" });
  await deps.db.setProjectStatus(projectId, "draft", plan.title);
}

/**
 * Ingest, then plan in the same job: the queue allows one active job per reel, so a running ingest job can't queue
 * plan_footage. A failed plan step is retried with Re-plan (or Retry), and ingest's cached assets make that free.
 */
export function createIngestFootageHandler(deps: FootageHandlerDeps): JobHandler {
  return async (job, ctx) => {
    let progress = emptyProgress();
    const onEvent = (e: PipelineEvent) => {
      progress = applyPipelineEvent(progress, e);
      ctx.report(progress);
    };
    const tmpDir = await mkdtemp(join(tmpdir(), "reel-ingest-"));
    try {
      const { storagePath, settings } = IngestFootageJobPayloadSchema.parse(job.payload);
      if (!storagePath.startsWith(`footage/${job.project_id}/`)) throw new Error("This upload belongs to another reel.");
      await deps.db.setProjectStatus(job.project_id, "planning");
      const original = join(tmpDir, basename(storagePath));
      ctx.log("ingest: downloading the upload");
      await deps.blobs.download(BUCKETS.assets, storagePath, original);
      const { source, transcript } = await ingestFootage(original, { store: deps.store, transcriber: deps.transcriber, faceTracker: deps.faceTracker, tmpDir, log: ctx.log, onEvent });
      onEvent({ type: "step", step: "plan", status: "running" });
      await planAndSave(deps, job.project_id, { settings, source, transcript });
      onEvent({ type: "step", step: "plan", status: "done" });
      return { status: "done", progress };
    } catch (err) {
      await deps.db.setProjectStatus(job.project_id, "failed").catch(() => {});
      throw err;
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  };
}

export function createPlanFootageHandler(deps: FootageHandlerDeps): JobHandler {
  return async (job) => {
    let hadPlan = false;
    try {
      const payload = PlanFootageJobPayloadSchema.parse(job.payload);
      let previous: EditPlan | undefined;
      if (payload.fromStoryboardId) {
        const record = await deps.db.getStoryboard(payload.fromStoryboardId);
        if (record && record.projectId === job.project_id) {
          hadPlan = true;
          try {
            previous = parseEditPlan(record.json);
          } catch {
            previous = undefined;
          }
        }
      }
      await deps.db.setProjectStatus(job.project_id, "planning");
      const { transcript } = await loadFootageInputs(deps.store, payload.source);
      await planAndSave(deps, job.project_id, { settings: payload.settings, source: payload.source, transcript, instruction: payload.instruction, previous });
      return { status: "done" };
    } catch (err) {
      // A failed Re-plan leaves the previous draft as it was.
      await deps.db.setProjectStatus(job.project_id, hadPlan ? "draft" : "failed").catch(() => {});
      throw err;
    }
  };
}
```
`supersedeDrafts` runs only after a successful plan, so the failure test's draft stays `draft`. Add `"@reel/video": "*"` to `apps/worker/package.json` dependencies (for `@reel/video/house-style`) and run `npm install`.

- [ ] **Step 6: Wire the handlers.** In `handlers/index.ts`, `BuildHandlersDeps` gains `transcriber`, `faceTracker` and `footagePlanner`; `buildHandlers` returns
```ts
    ingest_footage: createIngestFootageHandler(footage),
    plan_footage: createPlanFootageHandler(footage),
```
with `const footage = { store: deps.store, blobs: deps.blobs, db: deps.db, transcriber: deps.transcriber, faceTracker: deps.faceTracker, footagePlanner: deps.footagePlanner };`. In `main.ts`, build `const providers = createProviders(config, workDir, { log });` once and pass `providers`, `transcriber: providers.transcriber`, `faceTracker: createFaceTracker(fake ? "fake" : "real")`, `footagePlanner: createFootagePlannerFor(config, workDir)`. Update `handlers/index.test.ts`'s `buildHandlers` call with `transcriber: providers.transcriber, faceTracker: noFaceTracker, footagePlanner: providers.footagePlanner`.

- [ ] **Step 7: Verify.** Run `npm install && npx vitest run packages/engine apps/worker && npm run typecheck`. Expected: PASS.

- [ ] **Step 8: Integration test with the fixture (skips without it).** Add to `footage-ingest.test.ts`:
```ts
import { existsSync } from "node:fs";
import { faceHelperAvailable, FIXTURE_TALKING_HEAD } from "@reel/media";
import { visionFaceTracker } from "./face-tracker";

it.skipIf(!existsSync(FIXTURE_TALKING_HEAD) || !faceHelperAvailable())(
  "ingests the Hebrew fixture with real FFmpeg and face-helper, fake Scribe (skipped: needs packages/media/fixtures/talking-head-he.mp4 and npm run build:face-helper)",
  async () => {
    const { deps } = await setup();
    const { source } = await ingestFootage(FIXTURE_TALKING_HEAD, { ...deps, faceTracker: visionFaceTracker() });
    const { faceTrack } = await loadFootageInputs(deps.store, source);
    expect(faceTrack.samples.filter((s) => s.box).length / faceTrack.samples.length).toBeGreaterThan(0.8);
  },
  300_000,
);
```
Run `npx vitest run packages/engine/src/footage-ingest.test.ts`. Expected: PASS (the fixture test reports as skipped unless the user supplied the clip).

- [ ] **Step 9: Commit** with message `feat(worker): ingest_footage (working copy, transcript, face track, first plan) and plan_footage (Re-plan); streaming downloads`.

---

### Task 12: Generate job (`generate_footage`) and the full fake flow

**Files:**
- Create: `packages/engine/src/footage-generate.ts`, `apps/worker/src/handlers/generate-footage.ts`
- Modify: `packages/engine/src/pipeline.ts` (extract `renderTimeline`), `packages/engine/src/index.ts`, `packages/db/src/index.ts` (`JobType` adds `"generate_footage"`), `apps/worker/src/handlers/index.ts`, `apps/worker/src/main.ts`, `apps/worker/src/loop.test.ts`, `docs/RUNNING.md`
- Test: `packages/engine/src/footage-generate.test.ts`, `apps/worker/src/handlers/generate-footage.test.ts`

**Interfaces:**
- Consumes: `compileFootage`, `estimateFootageCost` (Task 5), `concatAudioSegments`, `fitMusic`, `normalizeLoudness`, `SOCIAL_LOUDNESS`, `sha256File` (Task 6 / existing), `SFX_DIR`, `sfxFileIn`, `missingSfx` (Task 6), `loadFootageInputs`, `footageHashes` (Task 11), `MusicGen` (Task 9).
- Produces:
  - `renderTimeline(timeline, deps: Pick<PipelineDeps, "log" | "onEvent">, outDir, onProgress?): Promise<RenderOutputs>` (used by `renderAndExport`, unchanged behaviour)
  - `type LibraryFetch = (trackId: string, destDir: string) => Promise<string | null>`
  - `type FootageGenDeps = { music: MusicGen; store: AssetStore; tmpDir: string; log; onEvent?; library: LibraryFetch; sfxDir: string | null; style: EditStyle }`
  - `type FootageGenerated = { inputs: FootageInputs; voice: StoredAsset; music?: StoredAsset; sfx: Partial<Record<SfxName, StoredAsset>>; notes: string[] }`
  - `generateFootageAssets(plan, deps): Promise<FootageGenerated>`, `buildFootageTimeline(plan, gen, urlFor, style): Timeline`, `renderFootage(plan, gen, deps, outDir, onProgress?): Promise<RenderOutputs>`
  - `resolveSfxDir(mode: "real" | "fake", cacheDir: string): Promise<string | null>`
  - worker: `createGenerateFootageHandler(deps: { music; store; blobs; db; sfxDir; spendCapUsd; forbidFakeInputs?: boolean })`

- [ ] **Step 1: Extract `renderTimeline`** in `pipeline.ts`: move everything inside `renderAndExport`'s `try` after `buildTimeline(...)` into
```ts
export async function renderTimeline(timeline: Timeline, deps: Pick<PipelineDeps, "log" | "onEvent">, outDir: string, onProgress?: (p: number) => void): Promise<RenderOutputs>
```
(it writes `timeline.json`, renders, exports, makes the thumbnail and writes `srtFor(timeline)`). `renderAndExport` becomes `mkdir` + `serveDir` + `renderTimeline(buildTimeline(sb, gen, server.urlFor), deps, outDir, onProgress)` + `server.close()`. The existing pipeline tests must pass unchanged.

- [ ] **Step 2: Write the failing engine test** `packages/engine/src/footage-generate.test.ts`:
```ts
import { parseEditPlan, SFX_NAMES, type EditPlan } from "@reel/core";
import { makeSfxPlaceholders, makeTestTone, makeTestVideo, probe } from "@reel/media";
import { houseStyle } from "@reel/video/house-style";
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAssetStore } from "./asset-store";
import { noFaceTracker } from "./face-tracker";
import { buildFootageTimeline, generateFootageAssets, renderFootage } from "./footage-generate";
import { ingestFootage } from "./footage-ingest";
import { createFakeProviders } from "./providers/fake";

async function prepared(music: EditPlan["music"] = { kind: "none" }) {
  const dir = await mkdtemp(join(tmpdir(), "footage-gen-"));
  const providers = createFakeProviders({ workDir: dir });
  const store = new FileAssetStore(join(dir, "cache"));
  await makeTestVideo(join(dir, "up.mp4"), { durationSec: 6, width: 720, height: 1280, withAudio: true });
  const { source, transcript } = await ingestFootage(join(dir, "up.mp4"), { store, transcriber: providers.transcriber, faceTracker: noFaceTracker, tmpDir: join(dir, "t"), log: () => {} });
  const planned = await providers.footagePlanner.plan({ settings: { language: "he", targetDurationSec: 15, ctaKeyword: "AI" }, source, transcript, library: [], warnings: [] });
  const plan = parseEditPlan({ ...planned, music });
  await makeSfxPlaceholders(join(dir, "sfx"), SFX_NAMES);
  const deps = { music: providers.music, store, tmpDir: join(dir, "g"), log: () => {}, library: async () => null, sfxDir: join(dir, "sfx"), style: houseStyle.edit };
  return { dir, providers, plan, deps };
}

describe("generateFootageAssets + renderFootage (fake music, placeholder sfx, real ffmpeg + Remotion)", () => {
  it("renders a 1080×1920 reel whose length matches the plan, then reuses every cached asset", async () => {
    const { dir, providers, plan: p, deps } = await prepared({ kind: "ai", prompt: "calm lo-fi" });
    const plan = parseEditPlan({ ...p, estimate: { ...p.estimate, credits: 1 } });
    const gen = await generateFootageAssets(plan, deps);
    expect(gen.notes).toEqual([]);
    expect(gen.music).toBeDefined();
    const out = await renderFootage(plan, gen, deps, join(dir, "out"));
    const info = await probe(out.reel);
    expect(info.video).toMatchObject({ width: 1080, height: 1920 });
    expect(Math.abs(info.durationSec - out.timeline.durationInFrames / 30)).toBeLessThan(0.1);
    expect(out.timeline.sfx?.length).toBeGreaterThan(0);
    const before = providers.calls.music;
    await generateFootageAssets(plan, deps);
    expect(providers.calls.music).toBe(before);
  }, 900_000);

  it("skips AI music that would exceed the approved estimate, with a note, and still renders", async () => {
    const { plan, deps, providers } = await prepared({ kind: "ai", prompt: "calm lo-fi" });
    const gen = await generateFootageAssets(parseEditPlan({ ...plan, estimate: { ...plan.estimate, credits: 0 } }), deps);
    expect(gen.music).toBeUndefined();
    expect(gen.notes).toEqual(["AI music was skipped: it would cost more than the approved estimate. Use Edit as new version and approve again to update it."]);
    expect(providers.calls.music).toBe(0);
  }, 300_000);

  it("skips music that fails twice, with a note", async () => {
    const { plan, deps } = await prepared({ kind: "ai", prompt: "calm lo-fi" });
    let calls = 0;
    const broken = { model: "fake/broken", compose: async () => { calls++; throw new Error("service down"); } };
    const gen = await generateFootageAssets(parseEditPlan({ ...plan, estimate: { ...plan.estimate, credits: 1 } }), { ...deps, music: broken });
    expect(calls).toBe(2);
    expect(gen.notes).toEqual(["AI music failed twice (service down), so the reel has no music."]);
  }, 300_000);

  it("loops a short library track; a removed track and a missing sfx pack become notes", async () => {
    const { dir, plan, deps } = await prepared({ kind: "library", assetId: "3f2c8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e" });
    await makeTestTone(join(dir, "short.wav"), { durationSec: 1 });
    const library = async (_id: string, dest: string) => { await copyFile(join(dir, "short.wav"), join(dest, "track.wav")); return join(dest, "track.wav"); };
    const gen = await generateFootageAssets(plan, { ...deps, library });
    expect((await probe(gen.music!.path)).durationSec).toBeGreaterThan(2);
    const gone = await generateFootageAssets(plan, { ...deps, library: async () => null, sfxDir: null });
    expect(gone.notes).toEqual(["The library track was removed, so the reel has no music.", "Sound effects aren't installed on this worker yet, so the reel has none."]);
    expect(buildFootageTimeline(plan, gone, (f) => `asset:${f}`, houseStyle.edit).sfx).toBeUndefined();
  }, 300_000);
});
```
Run `npx vitest run packages/engine/src/footage-generate.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `packages/engine/src/footage-generate.ts` and export it from the engine index:
```ts
import { compileFootage, estimateFootageCost, SFX_NAMES, type EditPlan, type EditStyle, type PipelineEvent, type SfxName, type Timeline } from "@reel/core";
import { concatAudioSegments, fitMusic, makeSfxPlaceholders, normalizeLoudness, sha256File, SOCIAL_LOUDNESS } from "@reel/media";
import { missingSfx, SFX_DIR, sfxFileIn } from "@reel/video/sfx";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { AssetStore, StoredAsset } from "./asset-store";
import { footageHashes, loadFootageInputs, type FootageInputs } from "./footage-ingest";
import { cached, estUsd, renderTimeline, type PipelineDeps, type RenderOutputs } from "./pipeline";
import type { MusicGen } from "./providers/types";
import { serveDir } from "./serve";

export type LibraryFetch = (trackId: string, destDir: string) => Promise<string | null>;
export type FootageGenDeps = { music: MusicGen; store: AssetStore; tmpDir: string; log: (m: string) => void; onEvent?: (e: PipelineEvent) => void; library: LibraryFetch; sfxDir: string | null; style: EditStyle };
export type FootageGenerated = { inputs: FootageInputs; voice: StoredAsset; music?: StoredAsset; sfx: Partial<Record<SfxName, StoredAsset>>; notes: string[] };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Spec §4.4 for plan 1: cut voice, music (library, AI or none), sound effects. A failed optional element is a note, never a failure. */
export async function generateFootageAssets(plan: EditPlan, deps: FootageGenDeps): Promise<FootageGenerated> {
  const { store, log } = deps;
  const emit = (e: PipelineEvent) => deps.onEvent?.(e);
  await mkdir(deps.tmpDir, { recursive: true });
  const tmp = (name: string) => join(deps.tmpDir, name);
  const inputs = await loadFootageInputs(store, plan.source);
  const draft = compileFootage(plan, inputs.transcript, inputs.faceTrack, { videoSrc: "draft", sfx: {} }, deps.style);
  const notes: string[] = [];

  emit({ type: "step", step: "voice", status: "running" });
  const voice = await cached(store, footageHashes.voice(inputs.working.hash, draft.voiceSegments), async () => {
    log(`voice: cutting ${draft.voiceSegments.length} segments`);
    const cut = tmp("voice-cut.wav");
    await concatAudioSegments(inputs.working.path, draft.voiceSegments, cut);
    const out = tmp("voice.wav");
    await normalizeLoudness(cut, out, SOCIAL_LOUDNESS);
    return { path: out, ext: "wav", meta: { kind: "audio", provider: "ffmpeg" } };
  });
  emit({ type: "step", step: "voice", status: "done" });

  emit({ type: "step", step: "music", status: "running" });
  const durationSec = draft.durationMs / 1000;
  const fitted = async (file: string, trackSha: string) =>
    cached(store, footageHashes.musicFit(trackSha, Math.round(draft.durationMs)), async () => {
      const fit = tmp("music-fit.wav");
      await fitMusic(file, fit, durationSec);
      const out = tmp("music.wav");
      await normalizeLoudness(fit, out, SOCIAL_LOUDNESS);
      return { path: out, ext: "wav", meta: { kind: "audio", provider: "ffmpeg" } };
    });
  let music: StoredAsset | undefined;
  if (plan.music.kind === "library") {
    try {
      const file = await deps.library(plan.music.assetId, deps.tmpDir);
      if (!file) notes.push("The library track was removed, so the reel has no music.");
      else music = await fitted(file, await sha256File(file));
    } catch (err) {
      notes.push(`Library music failed (${message(err)}), so the reel has no music.`);
    }
  } else if (plan.music.kind === "ai") {
    const prompt = plan.music.prompt;
    if (estimateFootageCost(plan, durationSec) > plan.estimate.credits + 1e-9) {
      notes.push("AI music was skipped: it would cost more than the approved estimate. Use Edit as new version and approve again to update it.");
    } else {
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2 && !music; attempt++) {
        try {
          const raw = await cached(store, footageHashes.musicAi(deps.music.model, prompt, Math.round(draft.durationMs)), async () => {
            log(`music: composing (attempt ${attempt})`);
            const res = await deps.music.compose({ prompt, durationMs: draft.durationMs });
            const file = tmp(`music-ai.${res.ext}`);
            await writeFile(file, res.audio);
            return { path: file, ext: res.ext, meta: { kind: "audio", provider: deps.music.model.split("/")[0], model: deps.music.model, estUsd: estUsd(deps.music.model, "perSecond", Math.ceil(durationSec)) } };
          });
          music = await fitted(raw.path, raw.hash);
        } catch (err) {
          lastError = err;
        }
      }
      if (!music) notes.push(`AI music failed twice (${message(lastError)}), so the reel has no music.`);
    }
  }
  emit({ type: "step", step: "music", status: "done" });

  const sfx: Partial<Record<SfxName, StoredAsset>> = {};
  if (plan.sfx !== "off") {
    if (!deps.sfxDir) notes.push("Sound effects aren't installed on this worker yet, so the reel has none.");
    else {
      for (const name of SFX_NAMES) {
        const file = sfxFileIn(deps.sfxDir, name);
        if (!file) continue;
        sfx[name] = await cached(store, footageHashes.sfx(await sha256File(file)), async () => ({ path: file, ext: extname(file).slice(1), meta: { kind: "audio", provider: "sfx-pack" } }));
      }
    }
  }
  for (const n of notes) emit({ type: "note", message: n });
  return { inputs, voice, music, sfx, notes };
}

export function buildFootageTimeline(plan: EditPlan, gen: FootageGenerated, urlFor: (fileName: string) => string, style: EditStyle): Timeline {
  const sfx = Object.fromEntries(Object.entries(gen.sfx).map(([name, a]) => [name, urlFor(a!.fileName)]));
  return compileFootage(plan, gen.inputs.transcript, gen.inputs.faceTrack, {
    videoSrc: urlFor(gen.inputs.working.fileName),
    voiceSrc: urlFor(gen.voice.fileName),
    ...(gen.music ? { musicSrc: urlFor(gen.music.fileName) } : {}),
    sfx,
  }, style).timeline;
}

export async function renderFootage(plan: EditPlan, gen: FootageGenerated, deps: Pick<FootageGenDeps, "store" | "log" | "onEvent" | "style">, outDir: string, onProgress?: (p: number) => void): Promise<RenderOutputs> {
  await mkdir(outDir, { recursive: true });
  const server = await serveDir(deps.store.root);
  try {
    return await renderTimeline(buildFootageTimeline(plan, gen, server.urlFor, deps.style), deps, outDir, onProgress);
  } finally {
    await server.close();
  }
}

/** Real workers use the committed pack (or none, with a note); fake workers fall back to placeholder blips. */
export async function resolveSfxDir(mode: "real" | "fake", cacheDir: string): Promise<string | null> {
  if (missingSfx(SFX_DIR).length === 0) return SFX_DIR;
  if (mode === "real") return null;
  const dir = join(cacheDir, "sfx-placeholders");
  if (missingSfx(dir).length) await makeSfxPlaceholders(dir, SFX_NAMES);
  return dir;
}
```
The `cached` callback for sfx copies the pack file into the store; `putFile` copies, so passing the pack path is safe.

- [ ] **Step 4: Write the failing handler test** `apps/worker/src/handlers/generate-footage.test.ts`. It runs the whole fake flow (upload → ingest+plan → approve → generate) on the in-memory DB:
```ts
import { SFX_NAMES } from "@reel/core";
import { createFakeProviders, FileAssetStore, noFaceTracker } from "@reel/engine";
import { makeSfxPlaceholders, makeTestVideo } from "@reel/media";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryBlobStore, InMemoryReelDb, makeJob } from "../testing/fakes";
import { createIngestFootageHandler } from "./footage";
import { createGenerateFootageHandler } from "./generate-footage";

const PID = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
const PATH = `footage/${PID}/source.mp4`;
const ctx = { report: () => {}, log: () => {} };

async function approvedPlan() {
  const dir = await mkdtemp(join(tmpdir(), "gen-footage-"));
  const providers = createFakeProviders({ workDir: dir });
  const db = new InMemoryReelDb();
  const blobs = new InMemoryBlobStore();
  const store = new FileAssetStore(join(dir, "cache"));
  await makeTestVideo(join(dir, "up.mp4"), { durationSec: 6, width: 720, height: 1280, withAudio: true });
  await blobs.upload("assets", PATH, join(dir, "up.mp4"));
  await createIngestFootageHandler({ store, blobs, db, transcriber: providers.transcriber, faceTracker: noFaceTracker, footagePlanner: providers.footagePlanner })(
    makeJob({ type: "ingest_footage", project_id: PID, payload: { storagePath: PATH, settings: { language: "he", targetDurationSec: 15, ctaKeyword: "AI" } } }), ctx);
  const record = db.storyboards[0];
  record.status = "approved";
  await makeSfxPlaceholders(join(dir, "sfx"), SFX_NAMES);
  const deps = { music: providers.music, store, blobs, db, sfxDir: join(dir, "sfx"), spendCapUsd: 10 };
  return { record, deps, db, blobs, providers };
}

describe("generate_footage", () => {
  it("renders the approved plan, uploads the files and records the render", async () => {
    const s = await approvedPlan();
    const outcome = await createGenerateFootageHandler(s.deps)(makeJob({ type: "generate_footage", project_id: PID, payload: { storyboardId: s.record.id } }), ctx);
    expect(outcome.status).toBe("done");
    expect([...s.blobs.objects.keys()].filter((k) => k.startsWith("renders/")).sort()).toEqual([`renders/${PID}/v1/preview.mp4`, `renders/${PID}/v1/reel.mp4`, `renders/${PID}/v1/reel.srt`, `renders/${PID}/v1/thumbnail.jpg`]);
    expect(s.db.renders[0].timeline.clips.every((c) => c.kind === "speaker" && c.src?.startsWith("asset:"))).toBe(true);
    expect(s.db.projectStatus.get(PID)?.status).toBe("rendered");
  }, 900_000);

  it("a real worker refuses a plan built on a fake transcript, before any spend", async () => {
    const s = await approvedPlan();
    const handler = createGenerateFootageHandler({ ...s.deps, forbidFakeInputs: true });
    await expect(handler(makeJob({ type: "generate_footage", project_id: PID, payload: { storyboardId: s.record.id } }), ctx)).rejects.toThrow(/made by the fake worker/);
    expect(s.providers.calls.music).toBe(0);
    expect(s.db.projectStatus.get(PID)?.status).toBe("failed");
  }, 300_000);

  it("refuses an unapproved plan and one over the spend cap", async () => {
    const s = await approvedPlan();
    s.record.status = "draft";
    await expect(createGenerateFootageHandler(s.deps)(makeJob({ type: "generate_footage", project_id: PID, payload: { storyboardId: s.record.id } }), ctx)).rejects.toThrow(/not approved/);
    s.record.status = "approved";
    s.record.json = { ...(s.record.json as object), estimate: { durationSec: 5, credits: 50 } };
    await expect(createGenerateFootageHandler(s.deps)(makeJob({ type: "generate_footage", project_id: PID, payload: { storyboardId: s.record.id } }), ctx)).rejects.toThrow(/exceeds the per-reel cap/);
  }, 300_000);
});
```
Run `npx vitest run apps/worker/src/handlers/generate-footage.test.ts`. Expected: FAIL.

- [ ] **Step 5: Implement** `apps/worker/src/handlers/generate-footage.ts`:
```ts
import { assetSrc, parseEditPlan, SpendCapError, type PipelineEvent } from "@reel/core";
import { applyPipelineEvent, BUCKETS, emptyProgress, GenerateJobPayloadSchema, renderPaths } from "@reel/db";
import { buildFootageTimeline, generateFootageAssets, loadFootageInputs, renderFootage, type AssetStore, type MusicGen } from "@reel/engine";
import { houseStyle } from "@reel/video/house-style";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { JobHandler } from "../loop";
import type { ReelDb } from "../reel-db";
import type { BlobStore } from "../storage";

export type GenerateFootageHandlerDeps = {
  music: MusicGen; store: AssetStore; blobs: BlobStore; db: ReelDb; sfxDir: string | null; spendCapUsd: number;
  /** Real workers: refuse plans whose transcript came from the fake transcriber. */
  forbidFakeInputs?: boolean;
};

export function createGenerateFootageHandler(deps: GenerateFootageHandlerDeps): JobHandler {
  const style = houseStyle.edit;
  return async (job, ctx) => {
    const { storyboardId } = GenerateJobPayloadSchema.parse(job.payload);
    const record = await deps.db.getStoryboard(storyboardId);
    if (!record || record.projectId !== job.project_id) throw new Error(`edit plan ${storyboardId} not found for this project`);
    if (record.status !== "approved") throw new Error("edit plan is not approved; approve it before generating");
    let progress = emptyProgress();
    if (await deps.db.hasRender(storyboardId)) {
      await deps.db.setProjectStatus(job.project_id, "rendered");
      return { status: "done", progress };
    }
    const tmpDir = await mkdtemp(join(tmpdir(), "reel-footage-"));
    try {
      const plan = parseEditPlan(record.json);
      if (plan.version !== record.version) throw new Error(`edit plan JSON version ${plan.version} does not match stored version ${record.version}`);
      if (plan.estimate.credits > deps.spendCapUsd) throw new SpendCapError(plan.estimate.credits, deps.spendCapUsd);
      if (deps.forbidFakeInputs) {
        const { transcriptAsset } = await loadFootageInputs(deps.store, plan.source);
        if (transcriptAsset.meta.model?.startsWith("fake/")) throw new Error("This edit plan was made by the fake worker (fake transcript). Upload the video again with the real worker running.");
      }
      await deps.db.setProjectStatus(job.project_id, "generating");
      const onEvent = (e: PipelineEvent) => {
        progress = applyPipelineEvent(progress, e);
        ctx.report(progress);
      };
      const library = async (trackId: string, destDir: string) => {
        const track = await deps.db.getTeamTrack(trackId);
        if (!track) return null;
        const dest = join(destDir, `library-${track.id}${extname(track.storagePath)}`);
        await deps.blobs.download(BUCKETS.assets, track.storagePath, dest);
        return dest;
      };
      const genDeps = { music: deps.music, store: deps.store, tmpDir, log: ctx.log, onEvent, library, sfxDir: deps.sfxDir, style };
      const gen = await generateFootageAssets(plan, genDeps);
      const out = await renderFootage(plan, gen, genDeps, join(tmpDir, "out"));
      const paths = renderPaths(job.project_id, record.version);
      await deps.blobs.upload(BUCKETS.renders, paths.reel, out.reel, "video/mp4");
      await deps.blobs.upload(BUCKETS.renders, paths.preview, out.preview, "video/mp4");
      await deps.blobs.upload(BUCKETS.renders, paths.thumbnail, out.thumbnail, "image/jpeg");
      await deps.blobs.upload(BUCKETS.renders, paths.srt, out.srt, "application/x-subrip");
      await deps.db.insertRender({ projectId: job.project_id, storyboardId, storyboardVersion: record.version, paths, timeline: buildFootageTimeline(plan, gen, assetSrc, style) });
      await deps.db.setProjectStatus(job.project_id, "rendered");
      return { status: "done", progress };
    } catch (err) {
      await deps.db.setProjectStatus(job.project_id, "failed").catch(() => {});
      throw err;
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  };
}
```

- [ ] **Step 6: Wire it.**
  - `packages/db/src/index.ts`: `JobType` adds `"generate_footage"`; `loop.test.ts`'s helper adds `generate_footage: noop`.
  - `handlers/index.ts`: `BuildHandlersDeps` gains `sfxDir: string | null`; add `generate_footage: createGenerateFootageHandler({ music: deps.providers.music, store: deps.store, blobs: deps.blobs, db: deps.db, sfxDir: deps.sfxDir, spendCapUsd: deps.spendCapUsd, ...(fake ? {} : { forbidFakeInputs: true }) })`. Update `handlers/index.test.ts` (`sfxDir: null`).
  - `main.ts`: `sfxDir: await resolveSfxDir(env.providers, config.cacheDir)`; log `sound effects: <dir>` or `sound effects: not installed (reels render without them)`.
  - `docs/RUNNING.md`, under "Fake worker note": the fake worker also edits uploaded videos for free (fake transcript text, fake music, placeholder sound effects, centred crops without face-helper); real workers refuse edit plans made from a fake transcript, so upload again with the real worker for real reels.

- [ ] **Step 7: Verify.** Run `npx vitest run packages apps/worker && npm run typecheck`. Expected: PASS; all earlier voice-reel tests unchanged.

- [ ] **Step 8: Commit** with message `feat: generate_footage renders approved edit plans (cut voice, music, sfx) with skip notes; fake worker covers the whole footage flow`.

---
### Task 13: "Edit my video" card, form and resumable upload

**Files:**
- Create: `apps/web/lib/footage-upload.ts`, `apps/web/lib/create-footage.ts`, `apps/web/lib/footage-form.ts`, `apps/web/app/new/footage/page.tsx`, `apps/web/app/new/footage/footage-form.tsx`, `apps/web/app/new/footage/actions.ts`
- Modify: `apps/web/package.json` (`"tus-js-client": "4.3.1"`), `apps/web/app/new/page.tsx`, `apps/web/app/page.tsx`, `apps/web/app/projects/[id]/page.tsx` (uploading state only), `apps/web/app/globals.css` (progress bar)
- Test: `apps/web/lib/footage-upload.test.ts`, `apps/web/lib/create-footage.test.ts`, `apps/web/lib/footage-form.test.ts`

**Interfaces:**
- Consumes: `checkFootageFile`, `footageExt`, `footageStoragePath`, `FOOTAGE_PATH_RE`, `FootageSettingsSchema` (Task 1), `IngestFootagePayload` (Task 1), migration policies (Task 1).
- Produces:
  - `storageEndpoint(supabaseUrl: string): string`, `tusUploadOptions(input): TusOptions`, `uploadIncomplete(createdAt: string, now: Date): boolean`, `projectStatusLabel(p: { status: string; format: string; created_at: string }, now: Date): string`, `readVideoDuration(file: File): Promise<number | null>` (browser), `uploadFootageFile(...)` (browser)
  - `parseFootageSettings(fd: FormData): { ok: true; settings: FootageSettings } | { ok: false; errors: string[] }`
  - `interface FootageDeps`, `startFootage(deps, input)`, `finishFootage(deps, input)`, `footageTitle(fileName): string`
  - server actions `startFootageUpload(input)`, `finishFootageUpload(input)`

- [ ] **Step 1: Check tus.** Run `npm install tus-js-client@4.3.1 -w @reel/web`, then open `node_modules/tus-js-client/lib/index.d.ts` and confirm `UploadOptions` has `endpoint`, `retryDelays`, `headers`, `metadata`, `chunkSize`, `uploadDataDuringCreation`, `removeFingerprintOnSuccess`, `onBeforeRequest(req: HttpRequest): void | Promise<void>` (with `req.setHeader(name, value)`), `onProgress`, `onSuccess`, `onError`, and `Upload#findPreviousUploads()` / `resumeFromPreviousUpload()`. If `onBeforeRequest` is not allowed to return a promise, refresh the token in `onProgress`/`onAfterResponse` instead and keep the test's intent (each request carries the newest token). Supabase's resumable endpoint requires `chunkSize` of exactly 6 MB.

- [ ] **Step 2: Write the failing tests.**

`apps/web/lib/footage-upload.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { projectStatusLabel, storageEndpoint, tusUploadOptions, uploadIncomplete } from "./footage-upload";

describe("storageEndpoint", () => {
  it("uses the direct storage host for hosted projects", () => {
    expect(storageEndpoint("https://abcd.supabase.co")).toBe("https://abcd.storage.supabase.co/storage/v1/upload/resumable");
    expect(storageEndpoint("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321/storage/v1/upload/resumable");
  });
});

describe("tusUploadOptions", () => {
  it("sends 6 MB chunks with the bucket metadata and a fresh token on every request", async () => {
    const tokens = ["t1", "t2"];
    const progress: number[] = [];
    const o = tusUploadOptions({
      supabaseUrl: "https://abcd.supabase.co", bucket: "assets", objectName: "footage/x/source.mov", contentType: "video/quicktime",
      getToken: async () => tokens.shift()!, onProgress: (f) => progress.push(f),
    });
    expect(o.chunkSize).toBe(6 * 1024 * 1024);
    expect(o.metadata).toEqual({ bucketName: "assets", objectName: "footage/x/source.mov", contentType: "video/quicktime", cacheControl: "3600" });
    expect(o.headers).toEqual({ "x-upsert": "true" });
    const set: [string, string][] = [];
    const req = { setHeader: (k: string, v: string) => set.push([k, v]) };
    await o.onBeforeRequest(req);
    await o.onBeforeRequest(req);
    expect(set).toEqual([["authorization", "Bearer t1"], ["authorization", "Bearer t2"]]);
    o.onProgress(50, 200);
    expect(progress).toEqual([0.25]);
    expect(o.retryDelays.length).toBeGreaterThanOrEqual(5);
  });
});

describe("upload status", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  it("calls an uploading project older than 1 hour incomplete", () => {
    expect(uploadIncomplete("2026-10-12T11:30:00Z", now)).toBe(false);
    expect(uploadIncomplete("2026-10-12T10:59:00Z", now)).toBe(true);
    expect(projectStatusLabel({ status: "uploading", format: "footage", created_at: "2026-10-12T10:00:00Z" }, now)).toBe("Upload incomplete");
    expect(projectStatusLabel({ status: "uploading", format: "footage", created_at: "2026-10-12T11:55:00Z" }, now)).toBe("Uploading");
    expect(projectStatusLabel({ status: "draft", format: "footage", created_at: "2026-10-12T10:00:00Z" }, now)).toBe("Awaiting approval");
  });
});
```

`apps/web/lib/footage-form.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseFootageSettings } from "./footage-form";

const fd = (e: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(e)) f.set(k, v); return f; };

describe("parseFootageSettings", () => {
  it("reads language, target, keyword and notes, dropping empty optionals", () => {
    expect(parseFootageSettings(fd({ language: "he", targetDurationSec: "90", ctaKeyword: " AI ", notes: "" }))).toEqual({ ok: true, settings: { language: "he", targetDurationSec: 90, ctaKeyword: "AI" } });
  });
  it("reports bad values", () => {
    const r = parseFootageSettings(fd({ language: "fr", targetDurationSec: "20" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBe(2);
  });
});
```

`apps/web/lib/create-footage.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { finishFootage, footageTitle, startFootage, type FootageDeps } from "./create-footage";

const ID = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
const settings = { language: "he" as const, targetDurationSec: 30 as const };
const deps = (over: Partial<FootageDeps> = {}): FootageDeps => ({
  insertProject: vi.fn(async () => ({ id: ID })),
  getProject: vi.fn(async () => ({ status: "uploading", format: "footage" })),
  objectExists: vi.fn(async () => true),
  insertIngestJob: vi.fn(async () => ({ ok: true as const })),
  setStatus: vi.fn(async () => {}),
  ...over,
});

describe("startFootage", () => {
  it("creates an uploading footage project and returns its storage path", async () => {
    const d = deps();
    expect(await startFootage(d, { settings, fileName: "My Talk.MOV", size: 1000, durationSec: 95 })).toEqual({ ok: true, projectId: ID, storagePath: `footage/${ID}/source.mov` });
    expect(d.insertProject).toHaveBeenCalledWith({ title: "My Talk", language: "he" });
  });
  it("re-checks the file on the server and creates nothing when it fails", async () => {
    const d = deps();
    expect(await startFootage(d, { settings, fileName: "x.avi", size: 1000, durationSec: 200 })).toEqual({ ok: false, errors: ["Upload an MP4 or MOV video.", "This video is 3:20 long. Trim it to 3:00 or less."] });
    expect(d.insertProject).not.toHaveBeenCalled();
  });
  it("titles from the file name", () => {
    expect(footageTitle(".mp4")).toBe("My video");
    expect(footageTitle(`${"א".repeat(200)}.mp4`)).toHaveLength(120);
  });
});

describe("finishFootage", () => {
  const input = { projectId: ID, storagePath: `footage/${ID}/source.mov`, settings };
  it("queues ingest and moves the project to planning", async () => {
    const d = deps();
    expect(await finishFootage(d, input)).toEqual({ ok: true });
    expect(d.insertIngestJob).toHaveBeenCalledWith(ID, { storagePath: input.storagePath, settings });
    expect(d.setStatus).toHaveBeenCalledWith(ID, "planning");
  });
  it.each([
    ["another project's path", { storagePath: "footage/11111111-2222-4333-8444-555555555555/source.mov" }, deps(), /doesn't belong to this reel/],
    ["a project already submitted", {}, deps({ getProject: async () => ({ status: "planning", format: "footage" }) }), /already submitted/],
    ["an unfinished upload", {}, deps({ objectExists: async () => false }), /didn't finish/],
    ["an active job", {}, deps({ insertIngestJob: async () => ({ error: "dup", code: "23505" }) }), /already queued or running/],
  ] as const)("refuses %s", async (_n, over, d, message) => {
    const r = await finishFootage(d, { ...input, ...over });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(message);
  });
});
```
Run `npx vitest run apps/web/lib`. Expected: FAIL.

- [ ] **Step 3: Implement the pure helpers.**

`apps/web/lib/footage-form.ts`:
```ts
import { FootageSettingsSchema, type FootageSettings } from "@reel/core";

export function parseFootageSettings(fd: FormData): { ok: true; settings: FootageSettings } | { ok: false; errors: string[] } {
  const str = (k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string).trim() : "");
  const parsed = FootageSettingsSchema.safeParse({
    language: str("language"),
    targetDurationSec: Number(str("targetDurationSec")),
    ...(str("ctaKeyword") ? { ctaKeyword: str("ctaKeyword") } : {}),
    ...(str("notes") ? { notes: str("notes") } : {}),
  });
  return parsed.success ? { ok: true, settings: parsed.data } : { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`) };
}
```

`apps/web/lib/create-footage.ts`:
```ts
import { checkFootageFile, footageExt, footageStoragePath, FOOTAGE_PATH_RE, FootageSettingsSchema, type FootageSettings } from "@reel/core";
import type { IngestFootagePayload } from "@reel/db";

export interface FootageDeps {
  /** Inserts a projects row with format 'footage' and status 'uploading'. */
  insertProject(input: { title: string; language: "he" | "en" }): Promise<{ id: string } | { error: string }>;
  getProject(id: string): Promise<{ status: string; format: string } | null>;
  objectExists(path: string): Promise<boolean>;
  insertIngestJob(projectId: string, payload: IngestFootagePayload): Promise<{ ok: true } | { error: string; code?: string }>;
  setStatus(projectId: string, status: "planning"): Promise<void>;
}
type Result<T = object> = ({ ok: true } & T) | { ok: false; errors: string[] };

export function footageTitle(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, "").trim();
  return base ? Array.from(base).slice(0, 120).join("") : "My video";
}

export async function startFootage(deps: FootageDeps, input: { settings: FootageSettings; fileName: string; size: number; durationSec: number | null }): Promise<Result<{ projectId: string; storagePath: string }>> {
  const errors = checkFootageFile({ name: input.fileName, size: input.size, durationSec: input.durationSec });
  if (errors.length) return { ok: false, errors };
  const project = await deps.insertProject({ title: footageTitle(input.fileName), language: input.settings.language });
  if ("error" in project) return { ok: false, errors: [`Couldn't create the reel: ${project.error}`] };
  return { ok: true, projectId: project.id, storagePath: footageStoragePath(project.id, footageExt(input.fileName)!) };
}

export async function finishFootage(deps: FootageDeps, input: { projectId: string; storagePath: string; settings: unknown }): Promise<Result> {
  const fail = (m: string): Result => ({ ok: false, errors: [m] });
  if (!FOOTAGE_PATH_RE.test(input.storagePath) || !input.storagePath.startsWith(`footage/${input.projectId}/`)) return fail("This upload doesn't belong to this reel.");
  const settings = FootageSettingsSchema.safeParse(input.settings);
  if (!settings.success) return fail("The reel settings are invalid. Start again.");
  const project = await deps.getProject(input.projectId);
  if (!project || project.format !== "footage") return fail("This upload doesn't belong to this reel.");
  if (project.status !== "uploading") return fail("This video was already submitted.");
  if (!(await deps.objectExists(input.storagePath))) return fail("The upload didn't finish. Upload the video again.");
  const job = await deps.insertIngestJob(input.projectId, { storagePath: input.storagePath, settings: settings.data });
  if ("error" in job) return fail(job.code === "23505" ? "A job for this reel is already queued or running." : `Couldn't start: ${job.error}`);
  await deps.setStatus(input.projectId, "planning");
  return { ok: true };
}
```

`apps/web/lib/footage-upload.ts` (pure parts first; the browser-only functions at the end are not unit-tested):
```ts
import * as tus from "tus-js-client";

const STATUS_LABEL: Record<string, string> = {
  uploading: "Uploading", planning: "Planning", draft: "Awaiting approval", generating: "Generating", needs_attention: "Needs attention", rendered: "Rendered", failed: "Failed",
};
export const UPLOAD_STALE_MS = 60 * 60 * 1000;

/** Supabase recommends the direct storage host for large uploads. */
export function storageEndpoint(supabaseUrl: string): string {
  const u = new URL(supabaseUrl);
  if (u.hostname.endsWith(".supabase.co") && !u.hostname.includes(".storage.")) u.hostname = u.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  return `${u.origin}/storage/v1/upload/resumable`;
}

export function tusUploadOptions(input: { supabaseUrl: string; bucket: string; objectName: string; contentType: string; getToken: () => Promise<string>; onProgress: (fraction: number) => void }) {
  return {
    endpoint: storageEndpoint(input.supabaseUrl),
    retryDelays: [0, 3000, 5000, 10_000, 20_000, 60_000],
    headers: { "x-upsert": "true" },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6 MB
    metadata: { bucketName: input.bucket, objectName: input.objectName, contentType: input.contentType, cacheControl: "3600" },
    /** Fresh token on every request: a 2 GB upload can outlive the 1-hour access token. */
    async onBeforeRequest(req: { setHeader(name: string, value: string): void }) {
      req.setHeader("authorization", `Bearer ${await input.getToken()}`);
    },
    onProgress(sent: number, total: number) {
      input.onProgress(total ? sent / total : 0);
    },
  };
}

export const uploadIncomplete = (createdAt: string, now: Date) => now.getTime() - new Date(createdAt).getTime() > UPLOAD_STALE_MS;

export function projectStatusLabel(p: { status: string; format: string; created_at: string }, now: Date): string {
  if (p.status === "uploading" && uploadIncomplete(p.created_at, now)) return "Upload incomplete";
  return STATUS_LABEL[p.status] ?? p.status;
}

/** Browser only: the video's duration from its metadata, or null when the browser can't read it (ingest re-checks). */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (v: number | null) => { URL.revokeObjectURL(url); resolve(v); };
    const timer = setTimeout(() => done(null), 10_000);
    video.preload = "metadata";
    video.onloadedmetadata = () => { clearTimeout(timer); done(Number.isFinite(video.duration) ? video.duration : null); };
    video.onerror = () => { clearTimeout(timer); done(null); };
    video.src = url;
  });
}

/** Browser only: resumable upload; resumes a previous attempt of the same file to the same path. */
export function uploadFootageFile(file: File, opts: Parameters<typeof tusUploadOptions>[0]): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, { ...tusUploadOptions(opts), onError: reject, onSuccess: () => resolve() });
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }, reject);
  });
}
```

- [ ] **Step 4: Server actions** `apps/web/app/new/footage/actions.ts`:
```ts
"use server";
import type { FootageSettings } from "@reel/core";
import { BUCKETS } from "@reel/db";
import { finishFootage, startFootage, type FootageDeps } from "@/lib/create-footage";
import { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

function deps(sb: Client): FootageDeps {
  return {
    async insertProject(input) {
      const { data, error } = await sb.from("projects").insert({ title: input.title, language: input.language, format: "footage", status: "uploading" }).select("id").single();
      return error || !data ? { error: error?.message ?? "unknown error" } : { id: data.id };
    },
    async getProject(id) {
      const { data } = await sb.from("projects").select("status, format").eq("id", id).maybeSingle();
      return data;
    },
    async objectExists(path) {
      const { data } = await sb.storage.from(BUCKETS.assets).exists(path);
      return data === true;
    },
    async insertIngestJob(projectId, payload) {
      const { error } = await sb.from("jobs").insert({ project_id: projectId, type: "ingest_footage", payload });
      return error ? { error: error.message, code: error.code } : { ok: true };
    },
    async setStatus(projectId, status) {
      await sb.from("projects").update({ status }).eq("id", projectId);
    },
  };
}

async function signedIn() {
  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  return data?.claims ? sb : null;
}

export async function startFootageUpload(input: { settings: FootageSettings; fileName: string; size: number; durationSec: number | null }) {
  const sb = await signedIn();
  if (!sb) return { ok: false as const, errors: ["Your session expired. Sign in again."] };
  return startFootage(deps(sb), input);
}

export async function finishFootageUpload(input: { projectId: string; storagePath: string; settings: FootageSettings }) {
  const sb = await signedIn();
  if (!sb) return { ok: false as const, errors: ["Your session expired. Sign in again."] };
  return finishFootage(deps(sb), input);
}
```
Check `exists` in `node_modules/@supabase/storage-js/dist/index.d.mts` (2.117.2 has `exists(path)` returning `{ data: boolean, error }`); if it differs, use `info(path)` and treat a non-error as "exists".

- [ ] **Step 5: Pages.**
  - **`app/new/page.tsx`:** before the style cards, add an "Edit my video" card linking `/new/footage`: `<Link className="card style-card" href="/new/footage"><strong>Edit my video</strong><span className="muted">Upload a video of you talking (up to 3 minutes). The agent cuts it like a top creator: jump cuts, captions, hook, music.</span></Link>`. The static `/new/footage` route wins over `/new/[styleId]`.
  - **`app/new/footage/page.tsx`:** server component; auth check like `/new`; `<h1>Edit my video</h1>`, `<p className="muted">MP4 or MOV, up to 3 minutes and 2 GB. Nothing is generated until you approve the edit plan.</p>`, `<FootageForm supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL!} />`.
  - **`app/new/footage/footage-form.tsx`** (`"use client"`):
    - Fields: language select (`he` default, `en`), target length select (15, 30 default, 45, 60, 90), CTA keyword input (`dir="auto"`, `maxLength={30}`, hint "Viewers comment this word, e.g. AI"), notes textarea (`dir="auto"`, `maxLength={2000}`), file input `accept="video/mp4,video/quicktime,.mp4,.mov"`.
    - On file change: `const durationSec = await readVideoDuration(file)`; show `checkFootageFile({ name, size, durationSec })` errors immediately and disable submit while there are any.
    - On submit: `parseFootageSettings(new FormData(form))`; `startFootageUpload(...)`; then `uploadFootageFile(file, { supabaseUrl, bucket: "assets", objectName: storagePath, contentType: file.type || (ext === "mov" ? "video/quicktime" : "video/mp4"), getToken: async () => (await createClient().auth.getSession()).data.session?.access_token ?? "", onProgress: setProgress })`; then `finishFootageUpload({ projectId, storagePath, settings })` and `router.push(`/projects/${projectId}`)`.
    - While uploading: `<progress value={progress} max={1} />` with `Uploading… {Math.round(progress * 100)}%. Keep this tab open.`
    - On an upload error: `Upload interrupted: {message}. Check your connection and press Resume upload: it continues where it stopped.` The Resume button calls `uploadFootageFile` again with the same `projectId`/`storagePath` (tus finds the previous upload).
    - Errors render as `<ul role="alert" className="error">`.
  - **`app/page.tsx`:** select `created_at` too in `listProjects` (`apps/web/lib/queries.ts`) and show `projectStatusLabel(p, new Date())` instead of `STATUS_LABEL[...]`; delete the local `STATUS_LABEL`.
  - **`app/projects/[id]/page.tsx`:** when `project.format === "footage" && project.status === "uploading"`, render only the title and either `<p className="error">Upload incomplete: <Link href="/new/footage">upload again</Link>.</p>` (when `uploadIncomplete(project.created_at, new Date())`) or `<p className="muted">Uploading… keep the upload tab open.</p>`.
  - **`globals.css`:** `progress { width: 100%; height: 10px; }`.

- [ ] **Step 6: Verify.** Run `npx vitest run apps/web && npm run typecheck && npm run build -w @reel/web`. Expected: PASS; the build lists `/new/footage`.

- [ ] **Step 7: Commit** with message `feat(web): Edit my video card and form with resumable TUS upload, upload checks and Upload incomplete state`.

---

### Task 14: Footage review page, job progress and team music settings

**Files:**
- Create: `apps/web/lib/edit-plan-edit.ts`, `apps/web/lib/approve-plan.ts`, `apps/web/lib/transcript.ts`, `apps/web/lib/music-form.ts`, `apps/web/components/FootagePlanEditor.tsx`, `apps/web/app/projects/[id]/footage-actions.ts`, `apps/web/app/settings/music/page.tsx`, `apps/web/app/settings/music/music-upload-form.tsx`, `apps/web/app/settings/music/actions.ts`
- Modify: `apps/web/app/projects/[id]/page.tsx`, `apps/web/lib/progress-view.ts`, `apps/web/components/JobPanel.tsx`, `apps/web/lib/retry-visibility.ts`, `apps/web/app/layout.tsx` (Music link)
- Test: `apps/web/lib/edit-plan-edit.test.ts`, `apps/web/lib/approve-plan.test.ts`, `apps/web/lib/music-form.test.ts` (new), `apps/web/lib/progress-view.test.ts`, `apps/web/lib/retry-visibility.test.ts` (extend)

**Interfaces:**
- Consumes: `parseEditPlan`, `withFootageEstimate`, `footageDurationMs`, `LENGTH_TOLERANCE`, `NOT_IN_PLAN_ONE` (core), `houseStyle` (`@reel/video/house-style`), `PlanFootagePayload` (db).
- Produces:
  - `type PlanAction` and `editPlan(plan, action): EditPlan`, `normalizePlanForSave(plan): EditPlan`, `checkEditPlan(input): { ok: true; plan } | { ok: false; errors }`, `describeFootageLength(plan, words, style): { text: string; tooLong: boolean }`
  - `interface PlanWriteDeps`, `savePlan`, `approvePlan`, `replan`, `retryIngest`, `retryFootageGenerate`, `newPlanVersion` (all `Promise<Result>`)
  - `loadTranscript(sb, hash): Promise<Transcript>`
  - `MusicTrackInputSchema`, `checkMusicFile(file): string[]`, `musicStoragePath(id, ext): string`
  - `describeJob` handles `ingest_footage`, `plan_footage`, `generate_footage` and returns `notes: string[]`

- [ ] **Step 1: Write the failing tests.**

`apps/web/lib/edit-plan-edit.test.ts`:
```ts
import { parseEditPlan } from "@reel/core";
import { houseStyle } from "@reel/video/house-style";
import { describe, expect, it } from "vitest";
import { footageTranscript, validEditPlan } from "../../../packages/core/src/testing/fixtures";
import { checkEditPlan, describeFootageLength, editPlan, normalizePlanForSave } from "./edit-plan-edit";

const plan = () => parseEditPlan(validEditPlan());

describe("editPlan", () => {
  it("toggles keep and clears a cold open on a dropped beat", () => {
    const withCold = editPlan(plan(), { type: "setColdOpen", beatId: "b2" });
    const dropped = editPlan(withCold, { type: "toggleKeep", beatId: "b2" });
    expect(dropped.beats[1].keep).toBe(false);
    expect(dropped.hook.coldOpenBeatId).toBeUndefined();
  });
  it("sets and clears the red word, only inside the beat", () => {
    expect(editPlan(plan(), { type: "setEmphasis", beatId: "b2", wordIdx: 9 }).beats[1].emphasisWordIdx).toBe(9);
    expect(editPlan(plan(), { type: "setEmphasis", beatId: "b2", wordIdx: 2 }).beats[1].emphasisWordIdx).toBeUndefined();
    expect(editPlan(plan(), { type: "setEmphasis", beatId: "b1", wordIdx: null }).beats[0].emphasisWordIdx).toBeUndefined();
  });
  it("edits hook, ending, music and sfx", () => {
    let p = editPlan(plan(), { type: "setHeadline", small: " ", big: "" });
    p = editPlan(p, { type: "setPatternBreak", value: "flash" });
    p = editPlan(p, { type: "setEnding", ending: { kind: "loop" } });
    p = editPlan(p, { type: "setMusic", music: { kind: "ai", prompt: "upbeat pop" } });
    p = editPlan(p, { type: "setSfx", sfx: "lively" });
    const saved = normalizePlanForSave(p);
    expect(saved.hook.headline).toBeUndefined();
    expect(saved).toMatchObject({ hook: { patternBreak: "flash" }, ending: { kind: "loop" }, music: { kind: "ai", prompt: "upbeat pop" }, sfx: "lively" });
  });
});

describe("checkEditPlan", () => {
  it("refuses unticking every beat with a plain message", () => {
    let p = plan();
    for (const id of ["b1", "b2", "b3"]) p = editPlan(p, { type: "toggleKeep", beatId: id });
    const r = checkEditPlan(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/Keep at least one beat/);
  });
  it("refuses plan-2/3 fields a crafted client might send", () => {
    const r = checkEditPlan({ ...plan(), background: { mode: "replace", sections: [{ fromBeatId: "b1", source: { kind: "ai", prompt: "x" } }] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/Background replacement arrives in a later update/);
  });
});

describe("describeFootageLength", () => {
  it("warns when the kept beats run over the target", () => {
    const words = footageTranscript().words;
    expect(describeFootageLength(plan(), words, houseStyle.edit)).toEqual({ text: "Length ≈ 7 s (target 15 s)", tooLong: false });
    expect(describeFootageLength({ ...plan(), source: { ...plan().source, durationMs: 40_000 } }, words.map((w) => ({ ...w, startMs: w.startMs * 4, endMs: w.endMs * 4 })), houseStyle.edit).tooLong).toBe(true);
  });
});
```

`apps/web/lib/approve-plan.test.ts`:
```ts
import { parseEditPlan, type EditPlan } from "@reel/core";
import { describe, expect, it, vi } from "vitest";
import { footageTranscript, validEditPlan } from "../../../packages/core/src/testing/fixtures";
import { approvePlan, replan, retryIngest, savePlan, type PlanWriteDeps } from "./approve-plan";

const SB = "9a1b2c3d-1111-4222-8333-444455556666";
const stored = () => parseEditPlan(validEditPlan());
function deps(over: Partial<PlanWriteDeps> = {}): PlanWriteDeps & { queued: unknown[]; written: EditPlan[] } {
  const queued: unknown[] = [];
  const written: EditPlan[] = [];
  return {
    queued, written,
    getStoryboard: vi.fn(async () => ({ projectId: "p1", version: 1, status: "draft" as const, json: stored() })),
    loadWords: vi.fn(async () => footageTranscript().words),
    updateDraft: vi.fn(async (_p, _id, json) => { written.push(json); return 1; }),
    queueJob: vi.fn(async (_p, type, payload) => { queued.push([type, payload]); }),
    setProjectStatus: vi.fn(async () => {}),
    activeJobCount: vi.fn(async () => 0),
    maxVersion: vi.fn(async () => 1),
    ingestPayload: vi.fn(async () => ({ storagePath: "footage/x/source.mp4", settings: { language: "he" as const, targetDurationSec: 15 as const, notes: "קצר" } })),
    insertDraft: vi.fn(async () => {}),
    ...over,
  };
}

describe("savePlan / approvePlan", () => {
  it("keeps server-owned fields and recomputes the estimate (never trusts the client)", async () => {
    const d = deps();
    const client = { ...stored(), source: { ...stored().source, assetId: "f".repeat(64) }, estimate: { durationSec: 1, credits: 0 }, music: { kind: "ai", prompt: "lofi" } };
    expect(await savePlan(d, { projectId: "p1", storyboardId: SB, json: client })).toEqual({ ok: true });
    expect(d.written[0].source.assetId).toBe("a".repeat(64));
    expect(d.written[0].estimate).toEqual({ durationSec: 7.3, credits: 0.08 });
  });
  it("approves and queues generate_footage", async () => {
    const d = deps();
    expect(await approvePlan(d, { projectId: "p1", storyboardId: SB, json: stored() })).toEqual({ ok: true });
    expect(d.queued).toEqual([["generate_footage", { storyboardId: SB }]]);
    expect(d.setProjectStatus).toHaveBeenCalledWith("p1", "generating");
  });
  it("refuses while a job is running", async () => {
    const r = await approvePlan(deps({ activeJobCount: async () => 1 }), { projectId: "p1", storyboardId: SB, json: stored() });
    expect(r).toEqual({ ok: false, errors: ["A job for this reel is already queued or running."] });
  });
});

describe("replan / retryIngest", () => {
  it("queues plan_footage with the original settings, the source and the instruction", async () => {
    const d = deps();
    expect(await replan(d, { projectId: "p1", storyboardId: SB, instruction: " tighten to 15 s " })).toEqual({ ok: true });
    expect(d.queued).toEqual([["plan_footage", { settings: { language: "he", targetDurationSec: 15, notes: "קצר" }, source: stored().source, fromStoryboardId: SB, instruction: "tighten to 15 s" }]]);
    expect(d.setProjectStatus).toHaveBeenCalledWith("p1", "planning");
  });
  it("refuses a Re-plan of an old version", async () => {
    const r = await replan(deps({ maxVersion: async () => 2 }), { projectId: "p1", storyboardId: SB, instruction: "" });
    expect(r.ok).toBe(false);
  });
  it("re-queues the last ingest payload after a failed ingest", async () => {
    const d = deps();
    expect(await retryIngest(d, { projectId: "p1" })).toEqual({ ok: true });
    expect(d.queued[0]).toEqual(["ingest_footage", { storagePath: "footage/x/source.mp4", settings: { language: "he", targetDurationSec: 15, notes: "קצר" } }]);
  });
});
```

`apps/web/lib/music-form.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { checkMusicFile, MusicTrackInputSchema, musicStoragePath } from "./music-form";

const ID = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
describe("music form", () => {
  it("accepts mp3/wav/m4a/aac up to 100 MB and 15 minutes", () => {
    expect(checkMusicFile({ name: "beat.MP3", size: 5_000_000, durationSec: 120 })).toEqual([]);
    expect(checkMusicFile({ name: "beat.flac", size: 5_000_000, durationSec: 120 })).toEqual(["Upload an MP3, WAV, M4A or AAC file."]);
    expect(checkMusicFile({ name: "a.mp3", size: 101 * 1024 * 1024, durationSec: 120 })).toEqual(["This track is over 100 MB."]);
    expect(checkMusicFile({ name: "a.mp3", size: 1000, durationSec: 901 })).toEqual(["This track is over 15 minutes."]);
  });
  it("validates the row the server inserts", () => {
    expect(musicStoragePath(ID, "mp3")).toBe(`music/${ID}.mp3`);
    expect(MusicTrackInputSchema.parse({ storagePath: `music/${ID}.mp3`, title: " Lo-fi ", mood: "calm", durationSec: 95.4 }).title).toBe("Lo-fi");
    expect(() => MusicTrackInputSchema.parse({ storagePath: "footage/x.mp3", title: "x", mood: "calm", durationSec: 9 })).toThrow();
    expect(() => MusicTrackInputSchema.parse({ storagePath: `music/${ID}.mp3`, title: "x", mood: "sad", durationSec: 9 })).toThrow();
  });
});
```
Add to `progress-view.test.ts`:
```ts
it("describes footage jobs with their steps and notes", () => {
  const ingest = describeJob({ type: "ingest_footage", status: "running", progress: { steps: { conform: "done", transcribe: "running" }, scenes: {} }, error: null }, []);
  expect(ingest!.headline).toBe("Preparing your video: transcribing and planning the edit…");
  expect(ingest!.steps.map((s) => `${s.label}:${s.state}`)).toEqual(["Prepare video:done", "Transcribe:running", "Find face:pending", "Plan the edit:pending"]);
  const gen = describeJob({ type: "generate_footage", status: "done", progress: { steps: {}, scenes: {}, notes: ["AI music failed twice (x), so the reel has no music."] }, error: null }, []);
  expect(gen!.headline).toBe("Your reel is ready. Some parts were skipped:");
  expect(gen!.notes).toEqual(["AI music failed twice (x), so the reel has no music."]);
  expect(describeJob({ type: "plan_footage", status: "running", progress: {}, error: null }, [])!.headline).toBe("Claude is re-planning the edit…");
});
```
Add to `retry-visibility.test.ts`: an approved storyboard whose last job is a done `generate_footage` for the same id cannot retry.

Run `npx vitest run apps/web/lib`. Expected: FAIL.

- [ ] **Step 2: Implement `edit-plan-edit.ts`:**
```ts
import { footageDurationMs, LENGTH_TOLERANCE, parseEditPlan, type EditPlan, type EditStyle, type Word } from "@reel/core";

export type PlanAction =
  | { type: "toggleKeep"; beatId: string }
  | { type: "setEmphasis"; beatId: string; wordIdx: number | null }
  | { type: "setEmoji"; beatId: string; emoji: string }
  | { type: "setColdOpen"; beatId: string | null }
  | { type: "setHeadline"; small: string; big: string }
  | { type: "setPatternBreak"; value: "zoom_hit" | "flash" | "none" }
  | { type: "setReason"; reason: string }
  | { type: "setEnding"; ending: EditPlan["ending"] }
  | { type: "setMusic"; music: EditPlan["music"] }
  | { type: "setSfx"; sfx: EditPlan["sfx"] };

const withBeat = (p: EditPlan, id: string, f: (b: EditPlan["beats"][number]) => EditPlan["beats"][number]): EditPlan => ({ ...p, beats: p.beats.map((b) => (b.id === id ? f(b) : b)) });
const without = <T extends object, K extends keyof T>(o: T, k: K): Omit<T, K> => { const { [k]: _drop, ...rest } = o; return rest; };

export function editPlan(plan: EditPlan, a: PlanAction): EditPlan {
  switch (a.type) {
    case "toggleKeep": {
      const next = withBeat(plan, a.beatId, (b) => ({ ...b, keep: !b.keep }));
      const cold = next.hook.coldOpenBeatId;
      return cold && !next.beats.find((b) => b.id === cold)?.keep ? { ...next, hook: without(next.hook, "coldOpenBeatId") } : next;
    }
    case "setEmphasis":
      return withBeat(plan, a.beatId, (b) => (a.wordIdx !== null && a.wordIdx >= b.startWordIdx && a.wordIdx <= b.endWordIdx ? { ...b, emphasisWordIdx: a.wordIdx } : without(b, "emphasisWordIdx")));
    case "setEmoji":
      return withBeat(plan, a.beatId, (b) => (a.emoji.trim() ? { ...b, emoji: a.emoji.trim() } : without(b, "emoji")));
    case "setColdOpen":
      return { ...plan, hook: a.beatId ? { ...plan.hook, coldOpenBeatId: a.beatId } : without(plan.hook, "coldOpenBeatId") };
    case "setHeadline":
      return { ...plan, hook: { ...plan.hook, headline: { small: a.small, big: a.big } } };
    case "setPatternBreak":
      return { ...plan, hook: { ...plan.hook, patternBreak: a.value } };
    case "setReason":
      return { ...plan, hook: { ...plan.hook, reason: a.reason } };
    case "setEnding":
      return { ...plan, ending: a.ending };
    case "setMusic":
      return { ...plan, music: a.music };
    case "setSfx":
      return { ...plan, sfx: a.sfx };
  }
}

/** Trims text and turns an empty headline into "no headline". */
export function normalizePlanForSave(plan: EditPlan): EditPlan {
  const h = plan.hook.headline;
  const hook = h && h.big.trim() ? { ...plan.hook, headline: { small: h.small.trim(), big: h.big.trim() } } : without(plan.hook, "headline");
  return { ...plan, hook: { ...hook, reason: plan.hook.reason.trim() } };
}

export function checkEditPlan(input: unknown): { ok: true; plan: EditPlan } | { ok: false; errors: string[] } {
  try {
    const raw = input && typeof input === "object" && "hook" in input ? normalizePlanForSave(input as EditPlan) : input;
    return { ok: true, plan: parseEditPlan(raw) };
  } catch (err) {
    const lines = (err instanceof Error ? err.message : String(err)).split("\n").slice(1).map((l) => l.replace(/^\s*-\s*/, ""));
    return { ok: false, errors: lines.length ? lines : ["Invalid edit plan."] };
  }
}

export function describeFootageLength(plan: EditPlan, words: Word[], style: EditStyle): { text: string; tooLong: boolean } {
  const seconds = Math.round(footageDurationMs(plan, words, style) / 1000);
  const tooLong = seconds > plan.targetDurationSec * LENGTH_TOLERANCE;
  const base = `Length ≈ ${seconds} s (target ${plan.targetDurationSec} s)`;
  return { text: tooLong ? `${base}: over the target; drop beats to shorten it.` : base, tooLong };
}
```

- [ ] **Step 3: Implement `approve-plan.ts`:**
```ts
import { parseEditPlan, withFootageEstimate, type EditPlan, type FootageSettings, type Word } from "@reel/core";
import type { IngestFootagePayload, PlanFootagePayload } from "@reel/db";
import { houseStyle } from "@reel/video/house-style";
import { checkEditPlan } from "./edit-plan-edit";

export type Result = { ok: true } | { ok: false; errors: string[] };
type Row = { projectId: string; version: number; status: "draft" | "approved" | "superseded"; json: unknown };

export interface PlanWriteDeps {
  getStoryboard(id: string): Promise<Row | null>;
  loadWords(transcriptAssetId: string): Promise<Word[]>;
  updateDraft(projectId: string, id: string, json: EditPlan, status: "draft" | "approved"): Promise<number>;
  queueJob(projectId: string, type: "generate_footage" | "plan_footage" | "ingest_footage", payload: object): Promise<void>;
  setProjectStatus(projectId: string, status: "draft" | "generating" | "planning"): Promise<void>;
  activeJobCount(projectId: string): Promise<number>;
  maxVersion(projectId: string): Promise<number>;
  /** Payload of the project's latest ingest_footage job (the user's original settings). */
  ingestPayload(projectId: string): Promise<IngestFootagePayload | null>;
  insertDraft(projectId: string, version: number, json: EditPlan): Promise<void>;
}

const ACTIVE = "A job for this reel is already queued or running.";
const fail = (m: string): Result => ({ ok: false, errors: [m] });

type Prepared = { ok: true; row: Row; json: EditPlan } | { ok: false; errors: string[] };

/** Validates the client's plan; identity fields come from the stored row and the estimate is recomputed on the server. */
async function prepare(deps: PlanWriteDeps, projectId: string, storyboardId: string, clientJson: unknown): Promise<Prepared> {
  const row = await deps.getStoryboard(storyboardId);
  if (!row || row.projectId !== projectId) return { ok: false, errors: ["This edit plan doesn't belong to this reel. Refresh the page."] };
  const checked = checkEditPlan(clientJson);
  if (!checked.ok) return checked;
  let stored: EditPlan;
  try {
    stored = parseEditPlan(row.json);
  } catch {
    return { ok: false, errors: ["The stored edit plan is invalid and can't be edited."] };
  }
  const merged: EditPlan = {
    ...checked.plan, format: "footage", version: row.version, source: stored.source, language: stored.language,
    targetDurationSec: stored.targetDurationSec, warnings: stored.warnings,
    beats: checked.plan.beats.map((b, i) => ({ ...b, id: stored.beats[i]?.id ?? b.id, startWordIdx: stored.beats[i]?.startWordIdx ?? b.startWordIdx, endWordIdx: stored.beats[i]?.endWordIdx ?? b.endWordIdx })),
  };
  if (merged.beats.length !== stored.beats.length) return { ok: false, errors: ["Beats can't be added or removed; untick a beat to drop it."] };
  return { ok: true, row, json: withFootageEstimate(parseEditPlan(merged), await deps.loadWords(stored.source.transcriptAssetId), houseStyle.edit) };
}

export async function savePlan(deps: PlanWriteDeps, input: { projectId: string; storyboardId: string; json: unknown }): Promise<Result> {
  const p = await prepare(deps, input.projectId, input.storyboardId, input.json);
  if (!p.ok) return p;
  return (await deps.updateDraft(input.projectId, input.storyboardId, p.json, "draft")) ? { ok: true } : fail("Only drafts can be edited. Use “Edit as new version”.");
}

export async function approvePlan(deps: PlanWriteDeps, input: { projectId: string; storyboardId: string; json: unknown }): Promise<Result> {
  const p = await prepare(deps, input.projectId, input.storyboardId, input.json);
  if (!p.ok) return p;
  if ((await deps.activeJobCount(input.projectId)) > 0) return fail(ACTIVE);
  if (!(await deps.updateDraft(input.projectId, input.storyboardId, p.json, "approved"))) return fail("This edit plan was already approved. Refresh the page.");
  try {
    await deps.queueJob(input.projectId, "generate_footage", { storyboardId: input.storyboardId });
    await deps.setProjectStatus(input.projectId, "generating");
  } catch {
    return fail("Approved, but queuing failed — use “Retry generation”.");
  }
  return { ok: true };
}

export async function retryFootageGenerate(deps: PlanWriteDeps, input: { projectId: string; storyboardId: string }): Promise<Result> {
  if ((await deps.activeJobCount(input.projectId)) > 0) return fail(ACTIVE);
  const row = await deps.getStoryboard(input.storyboardId);
  if (!row || row.projectId !== input.projectId || row.status !== "approved") return fail("Only an approved edit plan can be generated.");
  await deps.queueJob(input.projectId, "generate_footage", { storyboardId: input.storyboardId });
  await deps.setProjectStatus(input.projectId, "generating");
  return { ok: true };
}

export async function replan(deps: PlanWriteDeps, input: { projectId: string; storyboardId: string; instruction: string }): Promise<Result> {
  if ((await deps.activeJobCount(input.projectId)) > 0) return fail(ACTIVE);
  const row = await deps.getStoryboard(input.storyboardId);
  if (!row || row.projectId !== input.projectId) return fail("This edit plan doesn't belong to this reel. Refresh the page.");
  if (row.version !== (await deps.maxVersion(input.projectId))) return fail("A newer version exists. Re-plan from that one.");
  const stored = parseEditPlan(row.json);
  const fallback: FootageSettings = { language: stored.language, targetDurationSec: stored.targetDurationSec, ...(stored.ending.kind === "cta" ? { ctaKeyword: stored.ending.keyword } : {}) };
  const settings = (await deps.ingestPayload(input.projectId))?.settings ?? fallback;
  const instruction = input.instruction.trim().slice(0, 500);
  const payload: PlanFootagePayload = { settings, source: stored.source, fromStoryboardId: input.storyboardId, ...(instruction ? { instruction } : {}) };
  await deps.queueJob(input.projectId, "plan_footage", payload);
  await deps.setProjectStatus(input.projectId, "planning");
  return { ok: true };
}

/** After a failed ingest (or a failed first plan): run ingest again. Finished steps are cached, so this costs nothing again. */
export async function retryIngest(deps: PlanWriteDeps, input: { projectId: string }): Promise<Result> {
  if ((await deps.activeJobCount(input.projectId)) > 0) return fail(ACTIVE);
  const payload = await deps.ingestPayload(input.projectId);
  if (!payload) return fail("There is no uploaded video to retry. Upload it again.");
  await deps.queueJob(input.projectId, "ingest_footage", payload);
  await deps.setProjectStatus(input.projectId, "planning");
  return { ok: true };
}

export async function newPlanVersion(deps: PlanWriteDeps, input: { projectId: string; storyboardId: string }): Promise<Result> {
  if ((await deps.activeJobCount(input.projectId)) > 0) return fail("Wait for the current job to finish before editing.");
  const row = await deps.getStoryboard(input.storyboardId);
  if (!row || row.projectId !== input.projectId) return fail("This edit plan doesn't belong to this reel. Refresh the page.");
  const version = (await deps.maxVersion(input.projectId)) + 1;
  await deps.insertDraft(input.projectId, version, { ...parseEditPlan(row.json), version });
  await deps.setProjectStatus(input.projectId, "draft");
  return { ok: true };
}
```
The migration's `storyboards` update policy only lets users change drafts; `newPlanVersion` inserts a new user draft (allowed by "team adds user drafts").

- [ ] **Step 4: Implement `transcript.ts`, `music-form.ts`, progress view and retry visibility.**

`apps/web/lib/transcript.ts` (server only):
```ts
import { TranscriptSchema, type Transcript } from "@reel/core";
import { BUCKETS, type Database } from "@reel/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Transcript assets are stored as <hash>.json in the assets bucket (FileAssetStore naming, mirrored by the worker). */
export async function loadTranscript(sb: SupabaseClient<Database>, hash: string): Promise<Transcript> {
  const { data, error } = await sb.storage.from(BUCKETS.assets).download(`${hash}.json`);
  if (error || !data) throw new Error(`The transcript is missing from storage (${error?.message ?? "no data"}).`);
  return TranscriptSchema.parse(JSON.parse(await data.text()));
}
```

`apps/web/lib/music-form.ts`:
```ts
import { MusicMoodSchema } from "@reel/core";
import * as z from "zod";

export const MUSIC_EXTS = ["mp3", "wav", "m4a", "aac"] as const;
export const musicExt = (name: string) => (MUSIC_EXTS as readonly string[]).find((e) => name.toLowerCase().endsWith(`.${e}`)) ?? null;
export const musicStoragePath = (id: string, ext: string) => `music/${id}.${ext}`;

export function checkMusicFile(f: { name: string; size: number; durationSec: number | null }): string[] {
  const errors: string[] = [];
  if (!musicExt(f.name)) errors.push("Upload an MP3, WAV, M4A or AAC file.");
  if (f.size > 100 * 1024 * 1024) errors.push("This track is over 100 MB.");
  if (f.durationSec !== null && f.durationSec > 900) errors.push("This track is over 15 minutes.");
  return errors;
}

export const MusicTrackInputSchema = z.object({
  storagePath: z.string().regex(/^music\/[0-9a-f-]{36}\.(mp3|wav|m4a|aac)$/),
  title: z.string().trim().min(1).max(80),
  mood: MusicMoodSchema,
  durationSec: z.number().positive().max(900),
});
```
(Add `"zod": "^4.6.5"` to `apps/web/package.json` if it isn't already resolvable from the web app.)

`progress-view.ts`: widen `StepView["key"]` to `string`; add `notes: string[]` to `ProgressView` (filled from `progress.notes ?? []`); replace the two-way headline choice with a per-type table:
```ts
const STEPS: Record<string, [string, string][]> = {
  generate: [["voice", "Voice"], ["visuals", "Visuals"], ["render", "Render"], ["export", "Export"]],
  ingest_footage: [["conform", "Prepare video"], ["transcribe", "Transcribe"], ["faces", "Find face"], ["plan", "Plan the edit"]],
  generate_footage: [["voice", "Cut audio"], ["music", "Music"], ["render", "Render"], ["export", "Export"]],
};
const HEADLINES: Record<string, Record<string, [string, ProgressView["tone"]]>> = {
  plan: PLAN_HEADLINES,
  generate: GENERATE_HEADLINES,
  ingest_footage: {
    queued: ["Waiting for a worker…", "info"],
    running: ["Preparing your video: transcribing and planning the edit…", "info"],
    done: ["Edit plan ready: review and approve it below.", "success"],
    failed: ["Preparing the video failed.", "error"],
  },
  plan_footage: {
    queued: ["Waiting for a worker…", "info"],
    running: ["Claude is re-planning the edit…", "info"],
    done: ["New edit plan ready: review and approve it below.", "success"],
    failed: ["Re-planning failed. Your previous plan is unchanged.", "error"],
  },
  generate_footage: {
    queued: ["Queued: waiting for a worker…", "info"],
    running: ["Editing your reel…", "info"],
    done: ["Your reel is ready.", "success"],
    failed: ["Generation failed.", "error"],
  },
};
```
`describeJob` looks up `HEADLINES[job.type] ?? GENERATE_HEADLINES`; for `generate_footage` done with notes the headline is `Your reel is ready. Some parts were skipped:` and tone `warning`; steps come from `STEPS[job.type] ?? []`; scenes stay generate-only. Existing tests must keep passing.

`JobPanel.tsx`: after the steps, render `{view.notes.length > 0 && <><ul className="warn">{view.notes.map((n, i) => <li key={i}>{n}</li>)}</ul><p className="muted">To retry them, use “Edit as new version” and approve again; finished parts are not charged again.</p></>}`.

`retry-visibility.ts`: treat `job?.type === "generate" || job?.type === "generate_footage"` the same.

- [ ] **Step 5: Server actions** `app/projects/[id]/footage-actions.ts` (`"use server"`), mirroring `actions.ts`'s `run()` wrapper:
  - `depsFor(sb): PlanWriteDeps`: `getStoryboard`, `updateDraft`, `activeJobCount`, `maxVersion`, `insertDraft`, `setProjectStatus` as in `actions.ts`; `queueJob(projectId, type, payload)` inserts into `jobs` (`23505` → throw `A job for this reel is already queued or running.`); `loadWords(hash)` = `(await loadTranscript(sb, hash)).words`; `ingestPayload(projectId)` selects the latest `jobs` row with `type = 'ingest_footage'` and parses its payload with `IngestFootageJobPayloadSchema.safeParse` (null when absent or invalid).
  - Exports: `savePlanAction(projectId, storyboardId, json)`, `approvePlanAction(...)`, `replanAction(projectId, storyboardId, instruction)`, `retryIngestAction(projectId)`, `retryFootageGenerateAction(projectId, storyboardId)`, `newPlanVersionAction(projectId, storyboardId)`; each revalidates `/projects/<id>`.

- [ ] **Step 6: Review page.**
  - **`app/projects/[id]/page.tsx`:** after the uploading branch (Task 13), when `project.format === "footage"`:
    - `JobPanel` with `sceneIds={[]}`.
    - If the latest storyboard exists and `checkEditPlan(storyboard.json).ok`: load `words = (await loadTranscript(supabase, plan.source.transcriptAssetId)).words` (on error show `<p className="error">{message}</p>`), the music list (`team_music` id, title, mood ordered by title), and render `<FootagePlanEditor key={`${storyboard.id}:${storyboard.updated_at}`} projectId storyboardId={storyboard.id} initial={plan} words={words} library={tracks} editable={storyboard.status === "draft"} canRetry={canRetryGenerate(storyboard, job)} />`.
    - No storyboard: `project.status === "failed"` → `<p className="error">Preparing the video failed{job?.error ? `: ${job.error}` : ""}.</p>` plus a "Retry" button (form action calling `retryIngestAction`); otherwise `<p className="muted">Preparing your video…</p>`.
    - The render preview (`ReelPreview`) works unchanged: footage timelines play in the Player through `Reel`.
  - **`components/FootagePlanEditor.tsx`** (`"use client"`), using `useReducer(editPlan, initial)` and the same `act()`/errors pattern as `StoryboardEditor`:
    - Header: `Edit plan v{n}`, `describeFootageLength(plan, words, houseStyle.edit)` (class `warn` when too long), `Estimated cost: $x.xx` from `withFootageEstimate(...)` computed in `useMemo` (display only; the server recomputes), and `plan.warnings` as a `warn` list.
    - **Hook card:** cold-open select (`None` + each kept beat as `b3: <first 6 words>…`), headline small (`maxLength={40}`, `dir="auto"`) and big (`maxLength={24}`, `dir="auto"`) inputs, pattern-break select with exactly `Zoom hit`, `Flash`, `None`, reason textarea.
    - **Beats list:** one card per beat: a "Keep" checkbox, id and length (`(last.endMs - first.startMs)/1000` s), the beat's words as buttons (`dir={plan.language === "he" ? "rtl" : "ltr"}`) where clicking toggles `setEmphasis` and the red word is styled `color: #E5262A; font-weight: 700`, an emoji input (`maxLength={8}`), and the drop reason in `muted` when dropped. Dropped beats are shown at 55 % opacity.
    - **Settings:** Background select with `Original` and a disabled option `Replace background (coming later)`; Music select `None` / `AI music` / each library track (`title · mood`), with a prompt input when AI is chosen (`maxLength={300}`) and the muted note `Upload tracks on the Music page.` when the library is empty; Sound effects select `Off` / `Subtle` / `Lively`; Ending select `CTA` / `Loop` / `None` with a keyword input for CTA (`maxLength={30}`).
    - **Buttons** (draft): Save draft, `Approve & render` (disabled while `!checkEditPlan(plan).ok`, errors listed in `warn`), muted note `Approving may spend ElevenLabs credits for AI music.`, and a Re-plan row: instruction input (`maxLength={500}`, placeholder `e.g. tighten to 45 s`) + `Re-plan` button. Not editable: `Edit as new version`, and `Retry generation` when `canRetry`.
  - **Music settings** `app/settings/music/page.tsx` (server, auth check): `<h1>Music</h1>`, a table of tracks (title, mood, `m:ss`), and `<MusicUploadForm />`. `music-upload-form.tsx` (`"use client"`): file input (`accept=".mp3,.wav,.m4a,.aac,audio/*"`), title input (`maxLength={80}`, `dir="auto"`), mood select (calm, upbeat, dramatic); reads duration with an `<audio>` element (same pattern as `readVideoDuration`); shows `checkMusicFile` errors; uploads with `createClient().storage.from("assets").upload(musicStoragePath(crypto.randomUUID(), ext), file, { contentType: file.type })`; then calls `addMusicTrack({ storagePath, title, mood, durationSec })`. `actions.ts` (`"use server"`): auth check, `MusicTrackInputSchema.safeParse`, insert into `team_music` (`storage_path`, `title`, `mood`, `duration_sec`), `revalidatePath("/settings/music")`.
  - **`app/layout.tsx`:** when signed in, add `<Link href="/settings/music">Music</Link>` next to the email.

- [ ] **Step 7: Verify.** Run `npx vitest run apps/web && npm run typecheck && npm run build -w @reel/web`. Expected: PASS; the build lists `/settings/music`.

- [ ] **Step 8: Commit** with message `feat(web): footage review page (hook, beats, settings, estimate, approve, Re-plan), footage job progress with skip notes, team music settings`.

---

## After the tasks (controller)

1. **Final whole-branch review** (most capable model), then one fix wave.
2. **Migration.** Show the user `supabase/migrations/20261012150000_footage_editor.sql`. After their OK, apply it to the hosted project (Supabase MCP `apply_migration`) and check the regenerated types match Task 1's hand edits. The web app must not run the new code before this (inserts with status `uploading` would fail).
3. **User prerequisites:** global storage upload limit raised to 2 GB; `npm run build:face-helper` on the worker Mac; optionally the fixture clip (commit only with the user's OK).
4. **Fake worker end to end in the browser:** `npm run worker:fake` + `npm run web`; upload a short clip on "Edit my video", watch ingest progress, edit the plan (untick a beat, change music to a library track uploaded on the Music page), Re-plan once, approve, check the rendered reel, the SRT and the skip notes. Also check an `uploading` project older than an hour shows "Upload incomplete".
5. **Sound-effect pack (paid, only with the user's explicit OK and the cost stated first):** `npm run sfx:generate -- --yes`; the user listens; commit the 8 files.
6. **Paid smoke test (only with the user's explicit OK and the cost stated first):** one real run on a user clip: Scribe (≈ $0.02 for 3 min), Claude planning, and AI music only if chosen (check the `elevenlabs/music` price in `cost.ts` against the plan first).
7. **Merge, then restart the worker and web.**
