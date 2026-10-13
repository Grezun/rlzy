import { loadFont } from "@remotion/google-fonts/Heebo";

// Heebo covers Hebrew and Latin. Look pass: SemiBold 600 for captions, 700/800 for headline, CTA, diagrams and callouts.
// Timeline.style.font is reserved for more fonts later; all text uses Heebo for now.
export const { fontFamily: HEEBO } = loadFont("normal", { weights: ["600", "700", "800"], subsets: ["hebrew", "latin"] });
