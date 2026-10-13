# Footage Editor (talking head): Design

**Date:** 2026-10-12
**Status:** approved in chat, section by section; awaiting review of this written spec
**Amended:** 2026-10-13, look pass (plan 2b, see §11): iOS glass captions in white and red, red-sticker headline and CTA, about one cutaway every 3 s, cutaway transitions, Ken Burns drift, iOS diagram cards, keyword callouts and a progress bar. The edits below are marked *(look pass)*.
**Builds on:** `2026-09-30-social-reel-agent-design.md` (the "footage" format and Phase 4 "own footage") and `2026-10-01-reel-styles-design.md` (merged to main at 825ef42)
**Reference analysis:** `2026-10-12-footage-editor/reference-style-report.md`. It measures six reference reels the user supplied (@pauloshimas and Hebrew creators in the same style). Every number marked *(ref)* below comes from that report.

## 1. Goal

The user uploads a video of themselves talking. The app returns a finished 9:16 reel edited like a top Instagram creator would edit it: tight jump cuts, a strong hook, animated Hebrew captions, B-roll and images, an optional replaced background, music, sound effects and a CTA ending.

### Understanding

**What the user said:**
- "Upload a video, and it will automatically edit my video like a real Instagram influencer with background, B-rolls, captions in Hebrew, animations, images, hooks, everything that will make the video viral."
- Footage will be all kinds: talking head, long recordings, and no-speech/mixed footage.
- The look to match is @pauloshimas and @_castimedia. The user supplied six screen recordings of reels.

**Decided in brainstorming:**
- "All footage kinds" splits into three sub-projects, built in order, each with its own spec:
  1. **Talking-head editor**: this spec.
  2. Long-recording clipper: picks the best 30–60 s moments, then hands them to editor 1.
  3. No-speech, music-driven editor, which also covers the faceless gold-on-black motion style seen in references R5 and R6.
- **Control:** the agent produces an **edit plan** that the user reviews, edits and approves before anything paid runs. This is the same pattern as storyboards.
- **Hooks:** all three techniques are available: big text headline, best line first (cold open), and a visual pattern break. The agent picks the combination for each video and explains why.
- **B-roll sources:** AI-generated (Higgsfield) and the user's own extra uploads. No stock libraries.
- **Music:** a team music library, AI-generated music, or no music (the user adds trending audio in Instagram), chosen per reel. Sound effects are included.
- **Background:** replacing the user's real background is a **per-reel option**. The new background can be an AI-generated scene or a team brand backdrop, and it can **change per section**. The references themselves never replace the background (ref). This is a user addition.
- **Architecture:** approach A. Extend the existing storyboard, job and render pipeline. Rejected: a separate FFmpeg-first engine, and outsourcing to a third-party auto-editor.

### Success criteria

1. A raw 1–3 minute Hebrew talking-head upload becomes a reviewable edit plan without manual work. After approval it becomes a rendered reel.
2. The reel matches the measured house style:
   - no internal pause of 0.15 s or more (ref)
   - a visual change every 0.65–1.25 s on average (ref)
   - mid-frame pill captions of about 3 words (ref)
   - 2–4 visual changes in the first 3 s (ref)
   - a CTA or loop ending
3. Nothing paid runs before approval. Credits spent never exceed the estimate shown at approval.
4. A failed paid generation never fails the whole reel. The reel renders without that element and says what was skipped.
5. Existing formats (faceless, Custom, styles) behave exactly as before.

## 2. Scope

The work is delivered as **three implementation plans**, plus a look pass (2b) added after the first real reels. Each ends in a usable, merged state.

| Plan | Contents |
|---|---|
| **1. Core edit** | Upload, ingest (working copy, transcription, face track), beat splitting, edit-plan schema and planner, edit compiler, pill captions, punch-in zooms, hook (headline, cold open, pattern break), CTA and loop ending, music (library, AI, none), sound-effect pack, plan review page, fake providers |
| **2. Cutaways** | Higgsfield B-roll cutaways, AI shots of the user (Soul ID character, built on the existing `higgsfield-soul-id` flow), user's extra uploads, split-screen layout, three line-art diagram card templates |
| **2b. Look pass** *(look pass)* | iOS glass-pill captions (white, red, Heebo), red-sticker headline and CTA, denser B-roll budget, cutaway transitions and Ken Burns drift, iOS diagram cards, keyword callouts, progress bar (§11) |
| **3. Background replacement** | Person segmentation (Swift/Vision helper), speaker-plate compositing, AI and brand backgrounds, per-section changes. Gated on a free spike (§9). |

**Out of scope:**
- Long-recording clipping and no-speech editing (sub-projects 2 and 3).
- Noise removal and colour grading.
- Stock footage.
- Automatic screenshots of websites or apps.
- Multi-speaker editing (the editor follows the largest face).
- Publishing to Instagram.
- Uploads over 3 minutes or 2 GB.

## 3. The edit plan

The edit plan is what the user reviews. It is stored in the existing `storyboards` table: same versioning, same approve flow, same realtime job progress. A new discriminator separates it from voice storyboards: the JSON's `format` is `"footage"` and it validates against `EditPlanSchema`. This is not the voice `StoryboardSchema`. Footage reels need 50–100 cuts, and the storyboard's 20-scene, script-first model does not fit.

**Split of responsibilities:**
- Claude decides the **creative choices at sentence level** (beats).
- Code decides all **micro-editing**: silence cuts, zoom alternation, caption paging, audio levels. Micro-editing is never part of the review.

```ts
EditPlan {
  format: "footage"
  version, title, language: "he" | "en", targetDurationSec: 15 | 30 | 45 | 60 | 90   // 90 is footage-only: raw talks run longer
  source: { assetId, durationMs, transcriptAssetId, faceTrackAssetId, extras: FootageExtra[] }   // extras: plan 2, the conformed extra uploads
  beats: Beat[]                                // in source order; code splits them, Claude annotates
  hook: {
    coldOpenBeatId?: string                    // beat played first, then the reel continues from the start
    headline?: { small: string; big: string }  // small white line on glass + huge white word(s) on a red sticker (look pass; was yellow)
    patternBreak: "zoom_hit" | "flash" | "broll" | "none"
    reason: string                             // Claude's one-line explanation, shown in review
  }
  ending: { kind: "cta"; keyword: string } | { kind: "loop" } | { kind: "none" }
  background: { mode: "original" }
            | { mode: "replace"; sections: { fromBeatId: string; source: { kind: "ai"; prompt: string } | { kind: "brand"; assetId: string } }[] }   // plan 3
  music: { kind: "library"; assetId: string } | { kind: "ai"; prompt: string } | { kind: "none" }
  sfx: "off" | "subtle" | "lively"
  estimate: { durationSec: number; credits: number }   // computed by code, not Claude
  character?: { id: string; name: string }     // plan 2: the Soul ID character for ai_self cutaways (a soul_characters row)
}

Beat {
  id, startWordIdx, endWordIdx                 // span in the transcript (word indices)
  keep: boolean                                // Claude drops retakes, false starts, weak tangents; user can override
  dropReason?: string
  emphasisWordIdx?: number                     // caption word shown white on a red capsule (look pass)
  emoji?: "👆" | "👇" | string                 // optional, at line end
  callout?: { text: string }                   // look pass: a sticker badge, a number ("1/5") or 1–3 words, ≤ 16 chars
  cutaway?: {                                  // plan 2
    source: { kind: "ai_broll"; prompt: string; media: "image" | "video" } | { kind: "ai_self"; prompt: string; media: "image" | "video" }
          | { kind: "upload"; assetId: string }   // one of source.extras
          | { kind: "diagram"; template: "compare" | "list" | "flow"; items: string[] }   // compare 2, list 2–4, flow 2–3; items ≤ 40 chars
    layout: "full" | "split"
    atMs: number; durationMs: number           // within the beat; 1000–3000 ms
  }
}
```

**Claude writes a draft schema** without min/max constraints, the same as `StoryboardDraftSchema` today. Code fills in `source` and `estimate`, then validates the result against the full `EditPlanSchema`. Schema errors get one repair round.

**Review page.** For a footage project, the project page shows these parts, top to bottom:
- **Hook card:** the cold-open line, the headline, the pattern break and the reason. All are editable.
- **Beats list:**
  - each beat's transcript text, with the red word highlighted
  - a keep toggle, with the drop reason when Claude dropped the beat
  - a cutaway card with its prompt or file, layout and credit cost
  - a callout field (text, and a remove button) *(look pass)*
- **Settings:** background, music, sound effects and ending.
- **Estimate:** length against target, with a warning when over, plus total credits.
- **Approve.**

Edits save as a new version. A **Re-plan** button reruns `plan_footage` with an optional instruction (for example "tighten to 45 s" or "more cutaways"). It is new in this spec, since the app has no Claude revision flow yet. The previous plan is kept as a superseded version.

## 4. Pipeline

### 4.1 Upload (web)
- A new project type, "Edit my video", sits on the `/new` picker as a style card. Its form fields:
  - language
  - target length
  - optional CTA keyword
  - optional notes to the agent
  - the video file
  - optional extra files (plan 2): at most 6; photos JPG/JPEG/PNG/WEBP ≤ 25 MB (HEIC is refused with a "convert to JPG" hint), clips MP4/MOV ≤ 500 MB, stored at `footage/<projectId>/extra-<n>.<ext>` by the same resumable upload. Ingest re-encodes photos upright (EXIF orientation applied) and fits clips inside 1080×1920 (no crop, no audio, first 10 s).
  - optional Soul ID character (plan 2), picked from the team's `soul_characters`
- **Upload path:**
  - The browser uploads directly to Supabase Storage with resumable uploads (TUS) into the `assets` bucket, at `footage/<projectId>/source.<ext>`.
  - The Next.js server only signs and records the upload.
- **Client checks before upload:**
  - MOV or MP4 only.
  - At most 2 GB.
  - At most 3:00, read from the file's metadata in the browser.
  - Plain error messages.
- An interrupted upload resumes. If the tab is closed, the project shows "Upload incomplete: upload again".
- **One-time setup:** raise the project's global storage upload limit from the 50 MB default to 2 GB in the Supabase dashboard. The org is on the Pro plan, which allows this.

### 4.2 Ingest job (`ingest_footage`, worker)
1. `ffprobe` the file. Fail clearly when it is unreadable, has no audio track, or is longer than 3:00.
2. **Working copy:** FFmpeg makes a 1080×1920, 30 fps constant-frame-rate, H.264, SAR 1 file with rotation applied, using the existing `conformVideo`. The original is kept.
3. **Audio:** `extractAudio` (mono 16 kHz) feeds ElevenLabs Scribe `scribe_v2` with word timestamps and audio-event tagging. The transcript is stored as an asset. Cost is about $0.40 per hour of audio.
4. **Face track:** `face-helper` is a small Swift CLI in a new `tools/face-helper` directory, built with `swift build`. It uses Apple Vision `VNDetectFaceRectanglesRequest`:
   - samples every 3rd frame
   - picks the largest face
   - smooths with a short moving average
   - fills gaps of up to 1 s by interpolation; longer gaps are marked "no face"

   Output is JSON of `{ tMs, x, y, w, h }`, normalised, stored as an asset.
5. If Scribe returns fewer than 5 words, fail with "No speech found". That video belongs to the future no-speech editor.

### 4.3 Plan job (`plan_footage`)
- **Beat splitting (code).** Beats are split at sentence-ending punctuation and at pauses of 600 ms or more. A beat over 10 s is split at its longest internal pause. A beat under 1.2 s merges with its neighbour.
- **Claude's input:** the beats with their text and word indices, the target length, the user's notes and CTA keyword, the house-style rules, and the cutaway budget.
- **Cutaway budget (plan 2, raised by the look pass), per target length T seconds:** at most `round(T/3)` cutaways (about one every 3 s), `floor(T/7.5)` of them video (30 s: 10 cutaways, 4 clips); `ai_self` only with a character, at most `max(1, floor(T/20))`. Claude is told to plan close to the maximum (the first real reel used 5 of 6). Code enforces it after Claude (drops extras in beat order, turns surplus clips into stills) and adds warnings. *(Was `round(T/5)` and `floor(T/15)`.)*
- **Callout budget (look pass):** at most `floor(T/5)` callouts; code removes extras in beat order with a warning, and removes a callout over 16 characters or 3 words with a warning (no repair round).
- **Claude's output:** the draft edit plan, then code validates it as in §3.
- **Language check:** a mismatch between the selected and detected language adds a warning to the plan. It does not fail the job.

### 4.4 Generate job (`generate_footage`, after approval)
1. **Assets, all reused and cached by input hash:**
   - B-roll and `ai_self` shots: Higgsfield, using the existing submit/wait/resume. Each is a still (`media: "image"`) or a still animated into a short clip (`media: "video"`). `ai_self` uses the plan's Soul ID character: it is trained once outside the app and its reference id is saved on a Characters settings page (table `soul_characters`). A shot whose character no longer exists is skipped with a note.
   - AI background images: Higgsfield image model.
   - AI music: ElevenLabs Music, length fitted to the reel.
   - Library music: downloaded from the team library.
2. **Background replacement (plan 3):**
   - `face-helper segment` runs Vision `VNGeneratePersonSegmentationRequest` at quality `.accurate` and writes a grayscale mask video.
   - FFmpeg composites the working copy over each section's background, using `alphamerge` then `overlay`, with mask edges feathered by about 3 px and the background slightly blurred.
   - The result is a **speaker plate** video. Everything downstream uses the plate instead of the working copy.
3. **Edit compiler** (§5) produces the `Timeline`.
4. **Render and export:** the existing Remotion render and FFmpeg export, producing the reel MP4, preview, thumbnail and SRT.

## 5. Edit compiler (pure function)

`compileFootage(plan, transcript, faceTrack, assets, houseStyle) → Timeline`. It is deterministic, uses no I/O, and has the most tests in the project.

1. **Order.** The cold-open beat comes first (if set), then all kept beats in source order. The cold-open beat is not repeated.
2. **Speech cuts.**
   - Inside each kept beat, keep word spans. Cut every gap of 150 ms or more between words (ref: no pause ≥ 0.15 s survives). Pad each span by 50 ms on both sides.
   - Remove filler words that Scribe tags and that a small list covers, such as "אממ" and "אהה".
   - Each resulting span is a **shot**.
3. **Zoom per shot.**
   - Alternate 1.0× → 1.15× → 1.25× (ref: 1.1–1.25×), centred on the face box at the shot's midpoint.
   - The crop is clamped so the face is never cut off. With no face, the crop is centred.
   - Shots over 2 s get a linear push-in of +8% that resets at the next cut.
4. **Cutaways (plan 2).**
   - Each cutaway is placed at `beat start + atMs` for `durationMs`, clipped to the beat.
   - `full`: replaces the speaker picture; the speaker's audio continues.
   - `split`: the cutaway fills the top half. The speaker is cropped 9:8 around the face into the bottom half, with the seam at y = 0.50 (ref).
   - **Transitions (look pass, replacing hard cuts):**
     - Full cutaways alternate a whip (a slide moving forward in reading order, with blur) and a zoom blur (in from 1.25×, out to 1.15× with a fade).
     - Split cutaways slide down from the top and back up.
     - Entry is 6 frames and exit 5, inside the cutaway's own frames, so no timing changes.
     - The B-roll opening cuts in at frame 0.
     - A cutaway followed by another within 6 frames leaves with a cut, so the speaker never flickers between them.
5. **Hard rules**, applied in reel order:
   - Cutaways never overlap.
   - Cutaways never run under the CTA card.
   - An upload clip's cutaway is no longer than the clip.
   - At least 40% of the reel shows the speaker (split counts as speaker).
   - Any cutaway that breaks a rule is trimmed. If it ends up under 1 s, it is dropped. Every trim or drop adds a warning, shown on the review page and as a generation note.
6. **Captions.**
   - Pages of about 3 words and at most 22 characters, breaking at punctuation first. Each page shows from its first word's start to the next page's start.
   - The `emphasisWordIdx` word is rendered white on a red capsule *(look pass)*, and the emoji goes at the end of its page's line.
   - Times are remapped from source time to reel time, so captions stay in sync after cuts.
   - **Placement (tuned in plan 2 after the first real reel):** each page sits below the face: on-screen chin + 3% + 2.8% (half the pill), clamped to 55–72% of the height, constant within a page, kept from the previous page when it would move less than 3%. A page with no face keeps the previous position (60% when the reel has no face at all). Pages over a split cutaway sit on the seam (50%).
   - Pills are hidden while the hook headline or the CTA card is on screen; a page left with fewer than 8 visible frames is dropped (the SRT keeps every page).
   - **Callouts (look pass).**
     - Timing comes from the plan alone, so the review page shows the same warnings: the first free stretch of the beat of at least 0.8 s, shown for at most 1.6 s.
     - Not free: the hook headline, the CTA card, and every placed cutaway plus 6 frames after it.
     - No free stretch: dropped, with a warning.
     - Position: centred just above the on-screen face when its top edge stays below the 9 % top safe area; otherwise in the top band on the side with room beside the face; otherwise left out, with a generation note. With no face, centred at 20 %.
     - Captions sit below the face, so callouts never meet them.
     - Pattern breaks never start during a callout.
7. **Hook.**
   - The headline shows over 0–2 s, word by word.
   - The pattern break happens at frame 0:
     - `zoom_hit`: 1.0× → 1.3× over 6 frames
     - `flash`: 2 white frames
     - `broll`: the first cutaway is pulled to 0 s, full screen, 1 s long
   - **Recurring breaks (plan 2, after the first real reel read as static):** after the hook, a break about every 10 s (window 8–12 s, counted again from each cutaway) at a cut, never under the CTA card or a cutaway. Kinds cycle `zoom_blur`, `zoom_hit`, `zoom_blur`, `flash`, each with a whoosh. `zoom_blur`: the clip enters at 1.22× with a 16 px blur, settling over 6 frames. `zoom_hit` here punches 1.2× over the shot's zoom.
   - Cuts to a larger zoom step snap in from 1.06× over 4 frames.
8. **Ending.**
   - `cta`: a 2.5 s card over the last shot.
   - `loop`: the last shot is trimmed to end on a word boundary. The first shot starts without the hook flash, so the replay flows on.
9. **Audio.**
   - Voice is normalised to −14 LUFS.
   - Music sits 12 dB under the voice as a fixed bed (ref: 10–15 dB under). Sidechain ducking is not needed.
   - Sound-effect cues follow the `sfx` level:
     - `subtle`: a whoosh on the hook and on every cutaway that enters with a transition (−14 dB; look pass, was full cutaways only), and a pop on headline words, callouts (look pass) and the CTA keyword
     - `lively`: subtle, plus a soft tick on every zoom change
     - `off`: no effects
10. **Estimate.** Duration is the sum of shot lengths plus the CTA card. Credits are summed from per-model costs in the existing `cost.ts`.

The `Timeline` schema gains these fields: shot source in/out and crop per clip, `layout`, caption pages with emphasis, `hook`, `ending`, and `sfx` cues. Existing fields keep their meaning, so voice reels compile and render unchanged.

## 6. Look (Remotion components)

All values sit in one `houseStyle` config in `@reel/video`. Tuning the look means editing that config, not the components.

| Component | Spec |
|---|---|
| `PillCaptions` (caption preset `pill`, default for footage) | *Look pass:* iOS glass pill: dark frosted glass (`rgba(22,22,24,0.62)`, backdrop blur 28 px), radius 48 px, white Heebo 600 text at 64 px. The spoken word turns iOS red `#FF3B30` and pulses 1 → 1.08 → 1. The emphasis word is white on a red capsule. White text stays ≥ 4.5:1 over any flat frame. No yellow or orange. Placed per page below the face (§5.6; 45 % when a page has no position, ref 43–50 %). Max 22 chars per line. Each page pops 85 % → 100 % with a slight overshoot over 6 frames and fades in. The emoji pops 0 → 1.35 → 1 over 8 frames when the page's last word is spoken. Rendered above the clips, cutaways and callouts, but hidden under the hook headline and the CTA card (§5.6). *(Was black text in a white pill with a `#FEE80A` marker.)* |
| `SpeakerShot` | Working copy (or speaker plate) segment with a face-centred zoom and the optional push-in. |
| `SplitLayout` | Cutaway in the top half; speaker cropped 9:8 in the bottom half; captions on the seam. |
| `Cutaway` | Video or still. *Look pass:* stills zoom +12 % (ease-out) and drift 3 % in a direction that changes per still (right, up, left, down), clamped so no edge shows. A misfit upload's blurred fill drifts the other way (parallax). Whip, zoom or slide transitions in and out (§5.4). |
| `HookHeadline` | *Look pass:* the small line in white on the caption glass, then the big word or words in white Heebo 800 on a red `#FF3B30` sticker (radius 36, tilted −2°), popping in word by word. *(Was a huge yellow `#FEE80A` word.)* |
| `PatternBreak` | `zoom_hit`, `flash` or `broll` at frame 0, plus the recurring breaks, as described in §5.7. Zoom hits and zoom blurs live on the speaker clips; this layer draws the flashes. |
| `CtaCard` | "תכתבו '<KEYWORD>' בתגובות" ("write '<KEYWORD>' in the comments") with a huge quoted keyword. English: "Comment '<KEYWORD>'". *Look pass:* white lines, with the keyword in white on the red sticker (no yellow). |
| `DiagramCard` (plan 2) | *Look pass:* an iOS card: white, radius 56, on `#F2F2F7`, filling its slot (no empty dark area). Items spring in staggered. `compare`: 2 grey tiles and a red VS badge. `list` (up to 4 items): rows with a red check circle that draws itself. `flow` (2–3 steps, top to bottom, so 40-character Hebrew steps fit the width): numbered red circles joined by a red line that draws downward. Long items shrink. *(Was white line art on near-black with violet waves.)* |
| `Callouts` (look pass) | A white sticker badge with red Heebo 800 text at 52 px, tilted −4°. It springs in and shrinks out, placed per §5.6. |
| `ProgressBar` (look pass) | 8 px red bar along the top edge of footage reels, filling from the reading-start side. |

English reels use the same components. RTL and LTR handling follows the existing captions code.

**Sound-effect pack.** About 8 sounds (whoosh ×2, pop ×2, tick, riser, ding, swoosh-out). They are generated **once** with ElevenLabs sound effects, checked by ear and committed under `packages/video/assets/sfx/`, so there is no cost per reel. Generating them is a paid call, so it runs only with the user's OK.

**Team music library.** Tracks are uploaded on a settings page and tagged by mood (calm, upbeat, dramatic). Claude picks a track by mood tag.

**Brand backdrops (plan 3).** Brand backdrops are uploaded on the same settings page.

## 7. Errors and edge cases

| Case | Behaviour |
|---|---|
| File too long, too big or the wrong type | Rejected in the browser before upload. Re-checked in ingest. |
| Interrupted upload | Resumes. A closed tab leaves the project in "Upload incomplete". |
| No or too little speech | Ingest fails with "No speech found". |
| Language mismatch | Warning in the plan. |
| Noisy audio | Processed as is, with a note. |
| No face in a shot | Centred crop. Never fails. |
| Several faces | Follows the largest. |
| Plan breaks schema | One repair round, then a failed plan with the reason, as today. |
| Plan breaks compiler rules | Auto-trim or drop, with warnings shown in review. |
| Kept beats over target length | Warning with the actual length. Nothing is dropped silently. |
| B-roll, AI self, AI background or AI music fails | One attempt per element, never resubmitted inside the job (no repeat paid calls; the gateway's own submit retries cover transient errors before a job exists). The element is skipped (speaker stays on screen, real background, no music) and the result page lists what was skipped. To retry, the user uses "Edit as new version" and approves again; finished elements come from the cache. A per-element retry button is deferred (not in plans 1–2). |
| Spend | Capped at the approved estimate. A generation that would exceed it is skipped, with a note. |
| Segmentation fails | The render uses the real background and says so. |
| Worker crash | Existing heartbeat and requeue (3 attempts). Each step's outputs are cached assets, so a restart skips finished work. |

## 8. Data and code changes

**Database (one migration per plan, applied to the hosted project only after the user approves).**
- Plan 1 (constraints checked on the hosted DB on 2026-10-12):
  - `projects.format` already allows `footage`. No change.
  - `projects_status_check` gains `uploading`. The project stays in this status until the upload is recorded; "Upload incomplete" is shown for an `uploading` project older than 1 hour.
  - `jobs_type_check` gains `ingest_footage`, `plan_footage` and `generate_footage`.
  - `assets_kind_check` gains `data`, for the transcript and face-track JSON.
  - New `team_music` table: id, storage path, title, mood, duration, created_by.
- Plan 2: the footage storage policies also allow `footage/<projectId>/extra-[1-6].<ext>`; new `soul_characters` table (id, name 1–40, unique `reference_id`, created_by), readable by the team, insert-only for members.
- Plan 3: new `brand_backdrops` table.

**Packages:**
- `@reel/core`:
  - `EditPlanSchema` and its draft schema
  - beat splitting
  - `compileFootage`
  - Timeline additions
- `@reel/media`: reuses `conformVideo` and `extractAudio`, and adds mask compositing for plan 3.
- `@reel/engine`:
  - Scribe provider
  - ElevenLabs Music provider
  - footage planner
  - fake providers for each new provider
- `@reel/video`: the components from §6, `houseStyle`, and the sound-effect assets.
- `apps/worker`: the three handlers.
- `apps/web`:
  - "Edit my video" card and upload form
  - footage review page
  - team music settings page
  - (plan 3) brand backdrops
- `tools/face-helper`: the Swift CLI. It runs on macOS only, which suits the worker, since renders already run on the team Mac.

## 9. Testing

- **Unit (Vitest):**
  - `compileFootage`:
    - cuts and padding
    - filler removal
    - zoom alternation
    - face clamping and no-face fallback
    - Hebrew caption paging (niqqud, maqaf, punctuation, ≤22 chars)
    - remapping of time after cuts
    - cutaway placement and rules
    - cold open, CTA and loop
    - determinism
  - Beat splitting.
  - Schema and repair.
  - Upload checks.
- **Fixtures:**
  - **Speech fixture:** a short Hebrew talking clip (≤10 s, small) is committed. Ingest runs with fake Scribe and Claude, and real FFmpeg and `face-helper`.
  - **Render tests:** one per new component, with stored snapshot frames.
  - **`face-helper` tests:** it finds the face on the fixture, and (plan 3) the mask covers it.
- **Fake worker:** fake Scribe, Music and sound-effect providers make the whole flow (upload → plan → approve → render) free to click through.
- **Look preview (look pass):** `npm run preview:look` renders stills and a contact sheet of the whole look from a sample timeline. No keys, no cost.
- **Paid smoke tests, only with the user's explicit OK and with the cost stated first:** one real run per plan on a user clip.
- **Per plan:**
  - per-task review and a whole-branch review
  - `npm test`, typecheck and the web build pass
  - a browser check of the new screens
  - merge
- **Spike before plan 3 (free, local, throwaway):** run Vision person segmentation on one user clip. Judge hair edges and movement, and measure seconds of processing per second of footage. If quality is not good enough, choose another matting approach before plan 3 is written.

## 10. Risks and notes

- **Scribe Hebrew filler tagging** may be incomplete. The filler word list in §5.2 is the backstop.
- **Pacing targets** from the references are averages with about ±20% error (ref). The `houseStyle` config makes them easy to tune after the first real reels.
- **Soul ID costs and consistency** for `ai_self` cutaways are verified in the plan 2 paid smoke test.
- **Unknown creators for references R3–R6** (ref). This doesn't affect the design.
- **Licensing:** the user uploads the team music library and is responsible for its rights. AI music and sound effects are generated under the team's ElevenLabs plan.

## 11. Amendment 2026-10-13: look pass (plan 2b)

**What the user said** after the first real reel with cutaways, which had white caption pills with a yellow word, a dark and mostly empty diagram card, still B-roll with hard cuts, and the speaker on their own background:
> "much better, but missing a background for the person, more graphic motion and animation, captions with better font and less orange color, white and red colors, the captions need to look more like iOS app design, more B-rolls."

The background is plan 3. The rest is decided as follows. The values live in `houseStyle` and `EditStyle`.

1. **Captions:**
   - An iOS glass pill with white Heebo 600 text, the spoken word in iOS red `#FF3B30` popping 1 → 1.08, and Claude's emphasis word white on a red capsule.
   - No yellow or orange anywhere.
   - The hook headline and the CTA match: white text, with the big words on a red sticker.
   - Placement rules are unchanged.
2. **B-roll density:** about one cutaway every 3 s (`round(T/3)`), one clip every 7.5 s (`floor(T/7.5)`). Claude is told to plan close to the maximum. Prices and the spend cap are unchanged.
3. **Motion graphics:**
   - iOS diagram cards that fill their slot, with springs and drawn icons.
   - Whip, zoom and slide transitions into and out of cutaways, with whooshes.
   - Ken Burns zoom plus drift on stills.
   - Keyword callouts (a new `Beat.callout`, at most one per 5 s, never over the face, never with a cutaway, the headline or the CTA card).
   - A thin red progress bar.
   - Effects never stack on one moment: pattern breaks keep off callouts and cutaways, and back-to-back cutaways leave with a cut.

