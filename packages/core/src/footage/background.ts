import type { EditPlan } from "../schema/edit-plan";
import type { Word } from "../schema/timeline";

/**
 * Source time (ms) at which each background section starts: the first at 0, the others padMs before their beat's first
 * word. The speaker plate is composited in source time, so a cold open or a dropped beat never shifts a section.
 * Plan 3 plans have one section.
 */
export function backgroundStarts(plan: Pick<EditPlan, "background" | "beats">, words: Word[], padMs: number): number[] {
  if (plan.background.mode !== "replace") return [];
  const beats = new Map(plan.beats.map((b) => [b.id, b]));
  return plan.background.sections.map((s, i) => {
    if (i === 0) return 0;
    const beat = beats.get(s.fromBeatId);
    const w = beat ? words[beat.startWordIdx] : undefined;
    return w ? Math.max(0, Math.round(w.startMs - padMs)) : 0;
  });
}
