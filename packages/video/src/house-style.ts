import type { EditStyle } from "@reel/core";

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
    // Pill ≈ 66 px × 1.25 + 2 × 10 px padding ≈ 103 px = 5.4 % of 1920 → half 2.8 %. 3 % (≈ 58 px) clears chin and beard.
    // 55 %: always below mid-frame, so the pill never crosses a face in the upper half. 72 %: the pill's bottom
    // (74.8 %) stays above Instagram's caption/username/audio rows (the lowest ≈ 22 %). 50 %: the split seam (ref).
    captionPlacement: { minTopPct: 55, maxTopPct: 72, chinGapPct: 3, pillHalfPct: 2.8, holdPct: 3, noFaceTopPct: 60, seamTopPct: 50 },
    // One visible break every ≈ 10 s (8–12 s): the first reel had a single break at 0 s and read as static.
    breaks: { everyMs: 10_000, minMs: 8000, maxMs: 12_000, minShotFrames: 12, kinds: ["zoom_blur", "zoom_hit", "zoom_blur", "flash"], hitFactor: 1.2, zoomBlurFrames: 6 },
    snapFrames: 4,
    // spec §5.5: ≥ 40 % shows the speaker; §5.7: B-roll break 1 s; look pass: stills +12 % with a 3 % drift, whip/zoom entries, quieter whooshes
    cutaways: { minMs: 1000, minSpeakerShare: 0.4, brollBreakMs: 1000, kenBurns: 1.12, driftPct: 3, contentFitRatio: 1.3, transitions: ["whip", "zoom"], backToBackFrames: 6, whooshDb: -14 },
  } satisfies EditStyle,
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
  motion: { snapScale: 1.06, zoomBlurScale: 1.22, zoomBlurPx: 16 },
  /** Uploads that don't fit their slot: shown whole over a blurred, dimmed, zoomed copy. Look pass: entries 6 frames, exits 5, inside the cutaway. */
  cutaway: { blurPx: 40, dim: 0.35, fillScale: 1.15, transition: { inFrames: 6, outFrames: 5, whipBlurPx: 22, zoomFrom: 1.25, zoomTo: 1.15, zoomBlurPx: 18 } },
  /** Spec §6 DiagramCard: white line art on near-black with violet wavy lines (ref R3 panels). */
  diagram: { bg: "#0B0A12", line: "#FFFFFF", wave: "#8B6CFF", waveOpacity: 0.35, stroke: 6, radius: 28, fontSize: 64, compactScale: 0.62, itemFrames: 8, popFrames: 6, iconSize: 64 },
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
};
