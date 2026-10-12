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
