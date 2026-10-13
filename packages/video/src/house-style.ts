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
    // Pill ≈ 66 px × 1.25 + 2 × 10 px padding ≈ 103 px = 5.4 % of 1920 → half 2.8 %. 3 % (≈ 58 px) clears chin and beard.
    // 55 %: always below mid-frame, so the pill never crosses a face in the upper half. 72 %: the pill's bottom
    // (74.8 %) stays above Instagram's caption/username/audio rows (the lowest ≈ 22 %). 50 %: the split seam (ref).
    captionPlacement: { minTopPct: 55, maxTopPct: 72, chinGapPct: 3, pillHalfPct: 2.8, holdPct: 3, noFaceTopPct: 60, seamTopPct: 50 },
    // One visible break every ≈ 10 s (8–12 s): the first reel had a single break at 0 s and read as static.
    breaks: { everyMs: 10_000, minMs: 8000, maxMs: 12_000, minShotFrames: 12, kinds: ["zoom_blur", "zoom_hit", "zoom_blur", "flash"], hitFactor: 1.2, zoomBlurFrames: 6 },
    snapFrames: 4,
    // spec §5.5: ≥ 40 % shows the speaker; §5.7: B-roll break 1 s; §6: stills +6 % Ken Burns
    cutaways: { minMs: 1000, minSpeakerShare: 0.4, brollBreakMs: 1000, kenBurns: 1.06, contentFitRatio: 1.3 },
  } satisfies EditStyle,
  captions: {
    topPct: 45, fontSize: 66, textColor: "#000000", pillColor: "#FFFFFF", emphasisColor: "#E5262A", radius: 24, padX: 30, padY: 10, maxWidthPct: 86,
    // Bouncier than plan 1's 0.9 → 1 over 4 frames, which read as no animation in the first real reel.
    popFrames: 6, popFrom: 0.8,
    minVisibleFrames: 8,
    activeWord: { peak: 1.12, popFrames: 3, highlight: "#FEE80A", padX: 8, radius: 12 },
    emoji: { popFrames: 8, overshoot: 1.35 },
  },
  motion: { snapScale: 1.06, zoomBlurScale: 1.22, zoomBlurPx: 16 },
  /** Under the captions (y 45 %) so neither covers the face (eyes sit at y ≈ 0.21–0.28 (ref)). */
  headline: { topPct: 58, smallSize: 62, bigSize: 168, smallColor: "#FFFFFF", bigColor: "#FEE80A", shadow: "0 8px 28px rgba(0,0,0,0.55)", popFrames: 4, popFrom: 0.6 },
  cta: { topPct: 62, smallSize: 64, bigSize: 150, color: "#FFFFFF", keywordColor: "#FEE80A", shadow: "0 8px 28px rgba(0,0,0,0.55)", scrim: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.6) 100%)", popFrames: 6, popFrom: 0.7 },
  flash: { color: "#FFFFFF" },
};
