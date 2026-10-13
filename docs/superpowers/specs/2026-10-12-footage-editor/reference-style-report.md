# Reference reels: editing style analysis

Source: 6 screen recordings in `work/references/` (764×1346, 60 fps). Analysis was local only: ffmpeg scene scores at 30 fps, contact sheets, the macOS Vision face detector and English OCR (through small Swift tools compiled in the scratch dir), and numpy envelope analysis. No transcription: whisper is not installed, and Vision OCR has no Hebrew.

| ID | File | Recording | Language / creator (as seen) |
|---|---|---|---|
| R1 | `…17.05.42.mov` | 31.1 s | English, Paulo (beanie), CapCut-sponsored |
| R2 | `…17.06.31.mov` | 36.4 s | English, Paulo, Topview / "GPT-6 Astra" plugin |
| R3 | `…17.08.04.mov` | 62.7 s | Hebrew talking head (purple wall), on-device AI (Gemma / Edge Gallery) |
| R4 | `…17.09.31.mov` | 69.0 s | Hebrew talking head (same set as R3), AI video (Seedance 2.5) |
| R5 | `…17.10.55.mov` | 135.7 s | Hebrew, **faceless** motion-graphics explainer (Claude Code + HyperFrames editing pipeline) |
| R6 | `…17.13.37.mov` | 169.6 s | Hebrew, **faceless** motion-graphics explainer (how a card payment works) |

**Recording artefacts (UI chrome, loops):**
- The recordings show the full-screen reel player. The only chrome is a small sound icon at bottom-right and a person/tag icon at bottom-left (about 24 px). There are no like/comment rails or caption text, so cropping wasn't needed.
- No recording contains two different reels. Several wrap around the reel loop:
  - R1 loops back to its opening at **30.47 s**, so the reel is about 30.4 s long.
  - R2 starts about 1 s into its reel. The reel's real first frame (speaker with a "GPT-6 Astra" app-icon sticker) shows at 35.67 s, so the reel is about 36–37 s.
  - R3 restarts at **54.43 s**, so the reel is about 54.5 s. R3 was also **muted for the first ~6 s** of the recording (mute icon visible), so its audio stats exclude 0–6 s.
  - R4 starts on the reel's last shot. The loop points are 0.37 s and 68.70 s, so the reel is about 68.3 s.
  - R5 starts about 2 s in and is cut off before the end (≥136 s).
  - R6 starts about 1.2 s in and loops at 168.43 s, so the reel is about 170 s (2:50).
- **Attribution caveat.** Only R1 and R2 are clearly @pauloshimas. R3–R6 are all Hebrew. I assume they are the second account (@_castimedia), but nothing on screen confirms it. R3 and R4 share one presenter and set; R5 and R6 share a gold-on-black motion-design system. R5 shows an Instagram profile "ofir.ai / Ofir Asher" (about 122 s) and a raw clip of a different man (about 7 s). Treat R3/R4 and R5/R6 as two "Hebrew sub-styles".

---

## 1. Per-reel breakdown

### R1: Paulo, "CapCut PC for Marketing" (≈30.4 s)
- **Hook (0–1.8 s), cold open.** A selfie-style extreme close-up shot on a different camera: face fills the frame (face width 0.69–0.72 of frame width), warm orange light, dark background. An emoji-equation sticker builds piece by piece at mid-frame (y≈0.52): CapCut logo, "+", BLACK FRIDAY badge, "=", then 🤑🤑🤑. One element appears roughly every 0.2 s (hook sheet 0–1.6 s). No subtitles.
- **Transition (1.65–2.05 s).** A dip to light grey/white over about 0.3 s that fades into the main layout. It is the only non-hard transition in the reel.
- **Body (2.0–27.9 s): permanent split layout.**
  - Speaker panel: bottom ≈45% of the frame (y 0.545–1.0), real studio, face width ≈0.28 of frame, steady.
  - Top half on black: a persistent "CapCut PC for Marketing" logo header (y≈0.10, cyan/white, gently pulsing) over product showcase cards. Each card has a product photo on the left, a generated video tile on the right (loading spinner, then reveal), and a white "feature chip" below (e.g. "Wireframe reveal maker").
  - Card changes: 2.0 (sneaker), 5.4 (bottle), 8.0 (bag), 11.0 (palette), 13.4 (watch). That is about every 2.7 s, while the speaker stays the same.
  - 16.0–18.0 s: a title card "YOUR BLACK FRIDAY / CHEAT CODE" (white, then cyan words) over a strip of 5 product thumbnails.
  - 18–27.9 s: a screen recording of CapCut UI under a breadcrumb "CapCut PC › Video Studio › Skills › Marketing".
- **CTA (27.9–30.4 s).** The top panel dims to grey and a "COMMENT / “CapCut PC” / and I'll send you the link" card appears (white + large cyan quoted keyword).
- **No running subtitles at all.** Confirmed by OCR every 0.5 s.

### R2: Paulo, Topview plugin (≈36–37 s)
- **Hook.**
  - (Probably about 1 s missed): speaker with a "GPT-6 Astra" app-icon sticker on his chest (35.67–36.4 s).
  - 0–0.8 s: full-screen AI-generated UGC clip (jetski woman) with "BE A FULLY / AUTOMATED".
  - 0.8–2.5 s: AI skydiver, "CONTENT / MACHINE".
  - 2.5–4.4 s: split screen, AI snow-girl clip on top and speaker below, "WITH ONE / PLUGIN" then "WATCH THIS" on the speaker's chest.
  - Captions build word by word: at 2.5 s "WITH", at 2.7 s "WITH ONE", at 3.1 s "PLUGIN".
  - Hard cuts every 0.8–1.9 s through the hook (0.80, 2.50, 4.47).
- **Body.**
  - 4.5–5.6 s: full-frame speaker with a logo pop (Topview icon morphs into the Topview wordmark).
  - 5.6–8.2 s: a giant OpenAI-style logo card "GPT-6 Astra" on black, speaker below.
  - 8.2–17.9 s: top half shows a ChatGPT screen recording (typing prompt, long answer scrolling) with small seam subtitles.
  - 17.9–19.0 s: **pattern interrupt.** Full-frame speaker with a big caption "But here's the / crazy part".
  - 19–25.7 s: Topview canvas, side-by-side outfit-swap images ("The shoes ARE the outfit."), and a prompt-typing close-up ("remake the ad in spanish").
  - 25.7–30 s: plugin web page (zoom/pan across it).
  - 30–32.9 s: "SEEDANCE 2.5 1080P" promo card.
- **CTA (32.9–35.6 s).** Full-frame speaker; "So comment" (small white), then a huge yellow “AI”, then "and I'll you the link." (sic). Built line by line.

### R3: Hebrew talking head, on-device AI (≈54.5 s)
- **Hook (0–2.9 s), no cold open.**
  - Mid-shot of the speaker against a lavender wall with a synthwave monitor behind him.
  - Caption pill "יש לכם AI על המכשיר" ("You have AI on your device").
  - A 3-item icon list builds beside his torso: "בלי חיבור לאינטרנט" with a Wi-Fi icon, "בחינם" with a no-money icon (spinner draws it), "בלי הגבלה" with an infinity icon. White text with soft shadow, no box, one item every ≈0.8 s (hook sheet 0–2.0 s).
- **Body.**
  - 2.9–5.9 s: talking head with punch-ins.
  - 5.9–9.0 s: **AI-generated b-roll of the presenter himself** (on a plane, then on a ship in a storm), full screen with the caption still on.
  - 9–10.5 s: a stock/AI image of a server room as a **rounded inset card** under the caption.
  - 10.5–13.3 s: white outline "?" boxes and a "Closed Source" box drawn over the speaker.
  - 13.3–16.5 s: **full-screen explainer panel.** Black with thin purple wavy lines; white line-art diagram (box, dotted line, user icon; G / OpenAI / Anthropic monochrome logos).
  - 16.5–35 s: speaker, monochrome brand-logo stickers (Gemini ✦, OpenAI, Claude ✳) popping in above his hands, more panels (server, phone, laptop icon diagram), Open-Source / Closed-Source box labels.
  - ≈35–51 s: **iPhone mockup** on a navy/purple wavy background containing a screen recording of the App Store and the Edge Gallery app. Zoom-ins on parts of the phone screen; at several points the phone UI fills the frame (white). Caption pill stays on top.
- **Ending (51–54.4 s).** Talking head CTA-like close: "תגיבו לסרטון", "הזה והבוט שלי", "יטפל בכם 👇" (≈61 s in the recording, i.e. the second loop).

### R4: Hebrew talking head, AI video (≈68.3 s)
- **Hook (0.37–3.0 s).** Split screen: AI clip of a sobbing woman on top (y 0–0.5), presenter below pointing up. Caption pill on the seam (y=0.50): "זה סרטון AI מלפני 👆" ("This is an AI video from before 👆"), then "כמה חודשים וזה". At ≈1.2 s it hard-cuts to a newer version of the same AI scene, labelled "Seedance 2.5 👇".
- **Body.**
  - About 51% of the time is full-screen AI clips: street fight, concert, cat, barber, baby, old man selfie, man running at a car, "Wisp Crisps" UGC girl, etc. Each clip lasts 1–3 s and carries the caption pill.
  - About 28% is full-frame talking head with punch-in jump cuts.
  - About 21% is split screen (AI clip top / speaker bottom).
  - Overlays include glowing "?" cards (3 blue gradient tiles, ≈19–20 s), iPhone mockups of an Instagram profile and of Google search (≈34–36 s), and tilted white **news-headline cards** with black Hebrew bold text (rotated ≈ −5°) on a navy wavy background (≈48–50 s).
  - Keyword colour highlight: "שלכם **עכשיו** על" with "עכשיו" in red inside the white pill (29.5 s).
- **Ending (≈63–68.7 s).** Talking head plus an AI clip of a screaming driver, ending "והנה הוא הגיע רשמית..." ("and here it officially arrived..."). The trailing ellipsis loops seamlessly into the hook. This is a deliberate **loop ending, not a comment CTA**.

### R5: faceless Hebrew explainer, "how Claude Code edits video" (≥136 s)
- **Look.** Pure black frame with a warm gold radial glow. Each beat is a centred "card": terminal window, raw-clip thumbnail with a waveform, a Premiere Pro icon, a GitHub repo card, a timeline-block diagram, code editor tabs, a design-system card ("Aa / אבג", Inter 700 / Heebo 800).
- **HUD.** A fake timecode in the top-left ("● 00:14:06 f0426") throughout.
- **Captions.** One line of white heavy Hebrew, no box, centred at y≈0.60, about 2–4 words, changing every 1.1 s (median; p10 0.7 s, p90 1.6 s). Caption visible 82% of the time.
- **Hook.** A question: "...ברמה כל כך גבוהה / למרות שהוא בכלל לא / תוכנת עריכת וידאו?" ("...at such a high level, even though it's not a video editor at all?"), then "בשבועות האחרונים" ("In recent weeks").
- **Motion.** Graphics change about 7.6 times per 10 s. Changes are cross-fades and eased slides/scales rather than hard cuts (only 37 scene spikes in 136 s).

### R6: faceless Hebrew explainer, card payment flow (≈170 s)
- Same black-and-gold system, with 3D-ish product renders (phone, POS terminal, credit cards, "Secure Element" chip, VISA card, bank icons).
- A **5-step progress stepper** sits at the top (y≈0.06–0.09): הטלפון → המסוף → בנק העסק → ויזה → הבנק שלכם. The active node is gold and completed nodes turn green near the end (≈150 s). The stepper acts as a chapter bar.
- **Captions.** Saturated red heavy Hebrew with a dark glow, no box, y≈0.60, page every 1.2 s (p10 0.8, p90 1.7).
- **Numbers as heroes.** "257.5 מיליארד עסקאות" with "FY2025" label, "500+", a radial timer "0.62, then 1.50, then <2 שניות".
- Only 8 hard cuts in 170 s. Everything else is continuous eased motion design (morphs, scale-downs into network diagrams, ≈12.4–12.8 s). About 5 graphic change events per 10 s.
- **Hook.** "אתם מצמידים את הטלפון / למסוף כדי לשלם על קפה" ("You tap your phone on the terminal to pay for a coffee") over the phone+terminal render, then a timer counting up to "<2 seconds".
- **Ending.** Loops back to the phone+terminal image.

---

## 2. Pacing (numbers)

"Change events" means a hard cut, a jump cut, a big zoom step, or an insert entering or leaving. They are counted as local spikes (more than 6× the local median) in 30 fps scene scores and spot-checked visually. Expect ±20% error: screen-recording scrolls and caption flips add a few false events, and very similar jump cuts are missed.

| Reel | Length | Change events | Per 10 s | Avg shot (s) | Hard cuts (scene>0.3) | Notes |
|---|---|---|---|---|---|---|
| R1 | 30.4 | 26 | 8.4 | 1.15 | 2 | Jump cuts in the speaker panel every ≈1.2 s; top panel changes every ≈2.7 s |
| R2 | ~36.5 | 56 | 15.4 | 0.64 | 13 | Hook clips 0.8–1.9 s; screen-recording beats every 0.3–0.6 s (inflated) |
| R3 | 54.5 | 50/62.7 s | 8.0 | 1.23 | 16 | b-roll/graphics 47% of runtime, in 3–16 s stretches |
| R4 | 68.3 | 84 | 12.2 | 0.81 | 47 | Fastest; AI clips 1–3 s each |
| R5 | ≥136 | 103 graphic changes | 7.6 | — | 37 | Faceless; eased transitions |
| R6 | ~170 | 84 graphic changes | 5.0 | — | 8 | Faceless; continuous motion |

- **Talking-head reels: one visual change every 0.65–1.25 s (8–15 per 10 s).** The hook is denser: R2 has 3 cuts in the first 4.5 s, R4 has 4 in the first 3 s, R1 has 1 cut plus a 5-step sticker build.
- **Silence removal is aggressive in all reels.**
  - Measured in 20 ms windows, there is not a single pause of 0.15 s or more inside R2's body.
  - R1: 2 pauses ≥0.15 s; R4: 2; R5: 2; R6: 2 (≤0.24 s, apart from the 0.48 s tail at the loop point).
  - R3's only long "pauses" (0–6 s) are the muted part of the recording.
- **Speech rate.** About **3.8 words/s** in R2: 46 words in 12.2 s, 20.6–32.8 s, from OCR'd subtitles. Hebrew can't be measured without ASR; its caption pages run ≈3 words / 0.7–0.8 s, consistent with a similarly fast delivery.

## 3. Talking-head framing

- **Background: always real, never keyed or removed.**
  - Paulo: a dark, moody room with practical lights, framed posters, a red oni mask, a boom-arm mic and shallow depth of field.
  - Hebrew presenter: lavender wall (≈#9F92C3) with an RGB synthwave monitor and orange lamp behind.
- **Crop.**
  - Paulo in split panels: chest-up, face width ≈0.28 of frame (R1 2–30 s), face centre y≈0.70.
  - Paulo full-frame: face width 0.33–0.51 (R2 33–36 s).
  - Hebrew presenter full-frame: medium close-up, face width 0.32–0.42 of frame, face centre y 0.21–0.28 (eyes in the upper third), small headroom, hands in frame.
- **Punch-in jump cuts** (face-size ratio across speaker-to-speaker cuts, Vision face detector at 10 fps):
  - R1: only 9% of jump cuts change scale. Framing is locked; cuts are pure jump cuts.
  - R2: 33% change scale, by ×1.08–1.43 (in) or ×0.72–0.92 (out).
  - **R3: 70% change scale, alternating ≈×1.10–1.20 in and ×0.80–0.89 out.** The face toggles between about 0.32 and 0.40 of frame width (e.g. 2.0→2.1 s .400→.340, 12.1 s ×0.80, 19.3 s ×0.79).
  - R4: 82% change scale. This includes layout switches between full frame and split, so it overstates zoom.
  - All of these are instant (on the cut), not animated.
- **Slow push-in inside shots.** About a third of the Hebrew speaker shots carry a slow linear zoom of +5–25% over 1.5–3 s (R3 0.6→2.0 s: .335→.400; 16.5→19.3 s: .335→.413; R4 36.0→38.6 s: .282→.397). It resets on the next cut. The others are static. Paulo's shots are static.
- **AI-generated "self" b-roll.** In R3 (5.9–9.0 s) the presenter's own likeness is placed in cinematic AI scenes (airplane, stormy ship deck). R4 uses AI scenes of him too (barber chair ≈17 s, gym ≈43 s, car at night ≈41 s).

## 4. Captions

| | Paulo R1 | Paulo R2 | Hebrew talking head R3/R4 | Faceless R5 | Faceless R6 |
|---|---|---|---|---|---|
| Running subtitles | **none** | Small white sentence-case line, ≈2% of height, no box, on the split seam (y≈0.49) | **White rounded pill** (#FBF9FD, radius ≈8–10 px at 764 w), **black bold rounded Hebrew sans** (Heebo/Rubik-Bold-like) | White heavy Hebrew, no box | **Red** (≈#D93A36) heavy Hebrew with dark glow, no box |
| Position | — | Seam y 0.49 | R3: centre **y=0.43** (chest); R4: centre **y=0.50** (seam), fixed even in full-frame shots | y≈0.60 | y≈0.60 |
| Size | — | ≈26 px cap height / 1346 | Pill ≈75 px tall (5.5% of H), auto width, median 37–40% of W | ≈4% H | ≈4% H |
| Words per page | — | 2–5 (≈3) | Median 3 (R3 distribution 1–5; R4 1–6) | 2–4 | 2–4 |
| Page duration | — | 0.6–1.4 s | Median 0.8 s (R3), 0.7 s (R4); p10 0.3–0.4, p90 1.2–1.3 | Median 1.1 s | Median 1.2 s |
| Coverage | 0% | ≈70% | 79% (R3), 93% (R4) | 82% | ≈80% |
| Active-word highlight | — | No (the hook uses **word-by-word build**) | No | No | No |
| Keyword emphasis | Sticker | **Two-tier headline**: small white uppercase line plus **huge yellow (#FEE80A) heavy uppercase/condensed word** with a soft dark drop shadow (hook, "crazy part", CTA “AI”) | Occasional single word in **red** inside the pill (R4 29.5 s "עכשיו") | — | Whole line red |
| Emoji | 🤑 in hook sticker | — | 👆 / 👇 at the end of the line (R4 0.6 s, R3 ≈61 s) | — | — |
| Animation | Sticker builds | Words appear one at a time (snap/pop, ≈0.2 s apart) | Hard page swaps; pill persists across cuts (no visible in/out animation at 30 fps) | Fade | Fade |

Captions sit **in the middle of the frame, never the lower third**. That keeps them clear of the IG caption/UI zone, and in split layouts they sit on the seam.

## 5. B-roll and inserts

- **Paulo (R1, R2).** Mostly **product/tool proof**: screen recordings of the actual tool (ChatGPT-style UI, CapCut, Topview canvas, plugin web page), AI-generated sample outputs (UGC clips, product shots), logo cards, and promo cards (SEEDANCE 2.5 1080P, discount line).
  - Placement: **split screen, insert on top and speaker on the bottom ≈45–50%**. That is ≈90% of R1's runtime and ≈70% of R2's.
  - Full-screen inserts appear only in R2's hook (AI clips, 0–2.5 s).
  - Insert durations: R1 cards ≈2.7 s each; R2 UI beats 0.3–2 s, sub-segments 2–6 s.
- **Hebrew talking head (R3, R4).**
  - (a) **AI-generated cinematic clips** (Seedance/Veo-style), including the presenter's own likeness, **full screen 1–3 s**.
  - (b) **Split screen** (AI clip top / speaker bottom, seam at y=0.50), in 2–6 s blocks.
  - (c) **iPhone mockups** with screen recordings on a dark navy wavy-line background, zooming into regions (R3 35–51 s; R4 34–36 s).
  - (d) **Line-art explainer panels** (white stroke icons on black with purple wavy lines, R3 13.3–16.5, 23–30 s).
  - (e) **Rounded inset image card** under the caption (R3 9–10.5 s).
  - (f) **Tilted news-headline cards** (R4 ≈48–50 s).
  - (g) Web-app screenshots (R4 ≈44–46 s).
  - Share of runtime: R3 47% non-speaker; R4 51% full-screen b-roll plus 21% split.
- **Transitions into inserts are hard cuts** (R3 5.87 s, 13.30 s; R4 0.37 s, 8.53 s). The caption pill stays put across the cut (30 fps strips).

## 6. Graphics and motion

- **R1.**
  - A persistent brand header (logo plus breadcrumb).
  - Product cards with a loading spinner that resolves into the generated video.
  - "Feature chips" styled like notifications (white rounded rect, icon plus two lines).
  - A title card in white and cyan.
  - A CTA card over a dimmed background.
  - Palette: black, white, CapCut cyan.
- **R2.**
  - Logo pops (app icon morphs into the wordmark, ≈4.5–5.6 s).
  - A giant logo card.
  - Two-tier yellow/white headline type.
  - A promo banner (white bold uppercase plus a smaller yellow offer line).
  - Palette: warm tungsten room, yellow #FEE80A, white, dark UI.
- **R3/R4.**
  - Monochrome white line icons and outlined rectangles drawn over the speaker; boxes with a "?" or a label (≈10.5–12 s).
  - White monochrome brand logos popping in one by one (R3 ≈16–18 s).
  - Animated icon list (R3 hook).
  - Glowing gradient "?" cards (R4 ≈19 s).
  - Tilted headline cards.
  - Phone mockups.
  - Palette: lavender #9F92C3 set, black/navy panels with violet wavy lines, white, red keyword accent.
- **R5/R6 (motion-design sub-style).**
  - Black background, warm **gold radial glow** (≈#A39370 → #594733 falloff, bright gold accents), gold glowing borders.
  - 3D-ish device/card renders; network diagrams with animated dotted connectors.
  - Big numeric heroes and a radial countdown ring (R6 "0.62 → 1.50 → <2").
  - Top progress stepper (R6), fake timecode HUD (R5).
  - Green check states (#3CCB6A-like) and VISA blue as the only cool colours.
- **None of the reels use progress bars** (except R6's chapter stepper), arrows, or meme stickers. Emoji are rare.

## 7. Transitions

- **Hard cuts dominate the talking-head reels: >95% of changes.**
- Exceptions:
  - R1 hook-to-body dip to light grey/white, ≈0.3 s (1.65–2.05 s).
  - Logo morph in R2 (4.5–5.6 s).
  - Zooms into the phone screen in R3 (inside the insert, eased).
- No whips, glitches, flashes, or zoom-blur transitions were seen.
- Faceless R5/R6 instead use **eased cross-fades, scale/slide morphs and element re-layouts**. R6 has only 8 hard cuts in 170 s; R5 about 37 in 136 s (most are fades).

## 8. Audio

- The recorded loudness is about −27 to −29 LUFS integrated, because the recording was made at reduced system volume. Only relative values are meaningful.
- **A continuous bed under the voice in every reel.** The 1-s-window floor sits 8–13 dB below the speech median in R1 (−45.7 vs −34.7), R2, R4 (−41.9 vs −34.2) and R6 (−44.4 vs −33.5). Frames under −50 dB make up only 0.3–2%. R3 and R5 have a lower floor (≈−50 to −52 dB, about 17 dB under).
- **Uncertain: is the bed music?** Low-band onset autocorrelation shows **no clear beat** in any reel (peak strength ≤0.05). So the bed is either a quiet ambient/pad track or simply room tone plus heavy compression, not a rhythmic music track. I could not confirm music by ear.
- **No consistent SFX on cuts or pop-ins.** High-band (>5 kHz) peaks within ±0.15 s of cuts are no higher than at random times (4–12% of cuts exceed the random p90, against 10% expected by chance). There may be occasional individual SFX, but there is no whoosh/pop-per-cut pattern.
- **Silences are fully removed** (see §2). This is the strongest audio signature.

## 9. Differences between the creators / sub-styles

| | Paulo (R1, R2) | Hebrew talking head (R3, R4) | Hebrew faceless (R5, R6) |
|---|---|---|---|
| Layout | Split screen (insert top, speaker bottom) most of the time | Full-frame speaker ≈30–50%, full-screen b-roll ≈50%, split ≈0–20% | 100% motion graphics on black |
| Captions | None (R1), or tiny seam subtitles plus big yellow two-tier headlines at key beats (R2) | Always-on white pill, 3 words, 0.7–0.8 s, fixed mid-frame | One-line white or red, 1.1–1.2 s, y 0.60 |
| B-roll | Tool screen recordings and AI outputs as proof | Cinematic AI clips (incl. self), phone mockups, line-art diagrams | Designed 3D/2D renders |
| Zoom | Static framing | Alternating 1.1–1.25× punch-ins plus occasional slow push-in | Eased camera/element moves |
| Hook | Cold open: selfie close-up with sticker (R1), or fast AI-clip montage plus headline (R2) | Direct claim to camera with list/visual (R3), or AI clip plus "this is AI 👆" (R4) | Question / everyday scenario |
| Ending | "Comment KEYWORD and I'll send you the link" CTA card | Comment CTA with 👇 (R3), or seamless loop (R4) | Loop |
| Length | 30–37 s | 54–68 s | 136–170 s |

## 10. The 10 techniques that most define the look, prioritised for a Remotion + FFmpeg pipeline

1. **Tight silence and breath removal with jump cuts**: no gaps ≥0.15–0.25 s, a speaker shot every ≈1.2–1.5 s. Difficulty **easy–medium**. Needs: VAD or word timestamps from ASR (e.g. whisper/ivrit-ai for Hebrew), a cut list, FFmpeg concat. Use about 40–80 ms padding around words to avoid clipped consonants.
2. **Mid-frame boxed caption pages**: white rounded pill, black heavy Hebrew (Heebo 800 / Rubik Bold), 2–4 words, 0.6–1.2 s per page, fixed at y≈0.43–0.50, persisting across cuts, optional red keyword and end-of-line 👆/👇. Difficulty **easy**. Needs: word-level timestamps, RTL text layout in Remotion, a page-splitting rule (≤ ~22 characters per line, break on punctuation).
3. **Punch-in/out alternation on jump cuts** (×1.10–1.25 in, then back), plus an optional slow linear push-in (+5–15% over the shot) that resets on the cut. Difficulty **easy**, or **medium** with face-centred scaling. Needs: a face box per shot to centre the scale (Vision / MediaPipe), and a Remotion `scale` keyed per segment.
4. **B-roll ≈40–50% of runtime, in 1–3 s full-screen inserts**, hard-cut, with the caption kept on top. Difficulty **medium**. Needs: an asset source per beat (AI video/image generation or a stock library), LLM beat-to-visual planning from the transcript, and duration fitting.
5. **Split-screen layout**: insert in the top half and speaker in the bottom half (seam at y 0.50; Paulo uses the bottom ≈45%), caption on the seam. Difficulty **easy**. Needs: a speaker crop to 9:8 using the face box so the face sits centred in the bottom panel.
6. **Hook package in the first 0–3 s**: (a) a claim plus a visual proof clip, (b) word-by-word big headline (white small line + huge yellow #FEE80A word), or (c) an animated icon/benefit list beside the speaker. 2–4 visual changes in 3 s. Difficulty **medium**. Needs: a hook-line selector (LLM), an animated text/sticker component, an emoji/icon set.
7. **Screen-recording / product-proof panels**: UI captures, phone mockups with zoom into regions, logo pop and morph cards. Difficulty **medium–hard**. Needs: the user's own screen captures or generated UI screenshots, an iPhone mockup frame, keyframed crop-zoom. Fully automatic "screenshot generation" (headless browser) is the hard part.
8. **Line-art explainer overlays and panels**: white outline boxes, "?" tiles, monochrome icons/logos popping in over the speaker or on a black/violet wavy background. Difficulty **medium**. Needs: an icon library (e.g. Lucide/Tabler plus brand SVGs), an LLM to choose the diagram for a beat, a few Remotion templates (2-box compare, list, node→node).
9. **Keyword CTA ending**: "Comment ‘X’ and I'll send you the link" with a giant quoted keyword. Alternatively a seamless loop ending, where the last line runs into the first shot. Difficulty **easy**. Needs: a CTA keyword field and an end-card template; for the loop, a last-shot/first-shot matching rule.
10. **Quiet constant bed plus loudness normalisation**: voice clearly on top, bed about 10–15 dB under, no SFX spam. Difficulty **easy**. Needs: a royalty-free ambient track, sidechain ducking or a fixed −12 to −15 dB bed, loudnorm to −14 LUFS. Optional premium layer: R5/R6-style gold-on-black motion-design explainers, which are **hard** to automate (custom 3D/2D renders, stepper, number heroes).

Further notes:
- **AI "self" b-roll** (the presenter's likeness in cinematic scenes, R3 5.9–9 s, R4 ≈17, 41, 43 s) is a strong differentiator. It is **hard** and costs money: it needs identity-consistent image/video generation, e.g. a Soul ID-style character plus image-to-video.
- Background removal and green screen are **not** needed. None of the references use them.

**Uncertainties:**
- The creator mapping for R3–R6 isn't confirmed.
- Whether the audio bed is music or room tone wasn't confirmed by ear, since there was no beat.
- Hebrew words per second and exact words per page are inferred from pill width/word gaps (no Hebrew OCR or ASR available locally).
- Change counts are ±20%.
- Caption in/out animations shorter than one 30 fps frame (≈33 ms) would be invisible to this method.
- R5's true length and opening are unknown (the recording is truncated at both ends).
