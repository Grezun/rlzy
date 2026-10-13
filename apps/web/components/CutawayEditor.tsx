"use client";
import type { Cutaway, EditPlan } from "@reel/core";
import { CUTAWAY_CHOICES, CUTAWAY_MAX_MS, CUTAWAY_MIN_MS, cutawayChoice, cutawayLengthMs, cutawayPriceLabel, defaultCutaway, type CutawayChoice } from "@/lib/cutaway-edit";

const TEMPLATES = [["list", "List (2–4)"], ["compare", "Compare (2)"], ["flow", "Steps (2–3)"]] as const;
const MAX_ITEMS = { list: 4, compare: 2, flow: 3 } as const;

/** One beat's cutaway (spec §3 review page): type, prompt or file or diagram, layout, timing and price. */
export function CutawayEditor({ plan, cutaway, onChange }: { plan: EditPlan; cutaway?: Cutaway; onChange: (c: Cutaway | null) => void }) {
  const choice = cutawayChoice(cutaway);
  const disabled = (c: CutawayChoice) => (c.startsWith("ai_self") && !plan.character) || (c === "upload" && plan.source.extras.length === 0);
  const set = (patch: Partial<Cutaway>) => cutaway && onChange({ ...cutaway, ...patch });
  const s = cutaway?.source;
  return (
    <div className="stack" style={{ gap: "0.5em" }}>
      <div className="row">
        <label>Cutaway
          <select value={choice} onChange={(e) => onChange(defaultCutaway(e.target.value as CutawayChoice, plan, cutaway))}>
            {CUTAWAY_CHOICES.map(([v, label]) => <option key={v} value={v} disabled={disabled(v) && v !== choice}>{label}</option>)}
          </select>
        </label>
        {cutaway && (
          <>
            <label>Layout
              <select value={cutaway.layout} onChange={(e) => set({ layout: e.target.value as Cutaway["layout"] })}>
                <option value="full">Full screen</option>
                <option value="split">Split (you below)</option>
              </select>
            </label>
            <label>Starts after (s)
              <input type="number" min={0} step={0.1} value={cutaway.atMs / 1000} onChange={(e) => set({ atMs: Math.max(0, Math.round(Number(e.target.value) * 1000)) })} style={{ width: 80 }} />
            </label>
            <label>Length (s)
              <input type="number" min={CUTAWAY_MIN_MS / 1000} max={CUTAWAY_MAX_MS / 1000} step={0.1} value={cutaway.durationMs / 1000} onChange={(e) => set({ durationMs: cutawayLengthMs(e.target.value, cutaway.durationMs) })} style={{ width: 80 }} />
            </label>
            <span className="muted">{cutawayPriceLabel(cutaway)}</span>
          </>
        )}
      </div>
      {s && (s.kind === "ai_broll" || s.kind === "ai_self") && (
        <label>{s.kind === "ai_self" ? `Prompt (AI shot of ${plan.character?.name ?? "you"})` : "Prompt"}
          <textarea dir="auto" maxLength={1500} rows={2} value={s.prompt} placeholder="e.g. a laptop on a wooden desk, morning light" onChange={(e) => set({ source: { ...s, prompt: e.target.value } })} />
        </label>
      )}
      {s?.kind === "upload" && (
        <label>File
          <select value={s.assetId} onChange={(e) => set({ source: { kind: "upload", assetId: e.target.value } })}>
            {plan.source.extras.map((x) => <option key={x.assetId} value={x.assetId}>{x.label} ({x.kind === "image" ? "photo" : "clip"})</option>)}
          </select>
        </label>
      )}
      {s?.kind === "diagram" && (
        <div className="stack" style={{ gap: "0.5em" }}>
          <label>Diagram
            <select value={s.template} onChange={(e) => { const t = e.target.value as typeof s.template; set({ source: { ...s, template: t, items: s.items.slice(0, MAX_ITEMS[t]) } }); }}>
              {TEMPLATES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
          {s.items.map((t, i) => (
            <input key={i} dir="auto" maxLength={40} value={t} aria-label={`Item ${i + 1}`} onChange={(e) => set({ source: { ...s, items: s.items.map((x, j) => (j === i ? e.target.value : x)) } })} />
          ))}
          {s.items.length < MAX_ITEMS[s.template] && <button type="button" onClick={() => set({ source: { ...s, items: [...s.items, ""] } })}>Add item</button>}
        </div>
      )}
    </div>
  );
}
