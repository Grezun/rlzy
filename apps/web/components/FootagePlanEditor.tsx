"use client";
import { CALLOUT_MAX_CHARS, EmptyEditError, footageDurationMs, withFootageEstimate, type EditPlan, type Word } from "@reel/core";
import { houseStyle } from "@reel/video/house-style";
import { useRouter } from "next/navigation";
import { useMemo, useReducer, useState, useTransition } from "react";
import {
  approvePlanAction, newPlanVersionAction, replanAction, retryFootageGenerateAction, retryIngestAction, savePlanAction,
} from "@/app/projects/[id]/footage-actions";
import { CutawayEditor } from "@/components/CutawayEditor";
import { placementWarnings } from "@/lib/cutaway-edit";
import { checkEditPlan, describeFootageLength, editPlan, normalizePlanForSave } from "@/lib/edit-plan-edit";

export type LibraryTrack = { id: string; title: string; mood: string };
type Result = { ok: true } | { ok: false; errors: string[] };

const PATTERN_BREAKS = [["zoom_hit", "Zoom hit"], ["flash", "Flash"], ["broll", "B-roll (first cutaway)"], ["none", "None"]] as const;
const SFX = [["off", "Off"], ["subtle", "Subtle"], ["lively", "Lively"]] as const;
const ENDINGS = [["cta", "CTA"], ["loop", "Loop"], ["none", "None"]] as const;
const RED = "#FF3B30"; // iOS red, as in the reel
const REPLAN_MAX = 500;

type Props = {
  projectId: string;
  storyboardId: string;
  initial: EditPlan;
  words: Word[];
  library: LibraryTrack[];
  characters: { id: string; name: string }[];
  editable: boolean;
  canReplan: boolean;
  canRetry: boolean;
};

/** Runs a server action, shows its errors and refreshes the page on success. */
function useAction() {
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const act = (fn: () => Promise<Result>, onOk?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      setErrors(result.ok ? [] : result.errors);
      if (result.ok) {
        onOk?.();
        router.refresh();
      }
    });
  return { errors, pending, act };
}

const musicValue = (m: EditPlan["music"]) => (m.kind === "library" ? `lib:${m.assetId}` : m.kind);

export function FootagePlanEditor({ projectId, storyboardId, initial, words, library, characters, editable, canReplan, canRetry }: Props) {
  const [plan, dispatch] = useReducer(editPlan, initial);
  const [instruction, setInstruction] = useState("");
  // Remembered so switching music or ending away and back doesn't lose what the user typed.
  const [aiPrompt, setAiPrompt] = useState(initial.music.kind === "ai" ? initial.music.prompt : "");
  const [keyword, setKeyword] = useState(initial.ending.kind === "cta" ? initial.ending.keyword : "");
  const { errors, pending, act } = useAction();
  const textDir = plan.language === "he" ? "rtl" : "ltr";
  const style = houseStyle.edit;

  const check = useMemo(() => checkEditPlan(plan), [plan]);
  const length = useMemo(() => describeFootageLength(plan, words, style), [plan, words, style]);
  const empty = useMemo(() => footageDurationMs(plan, words, style) === 0, [plan, words, style]);
  // Display only: the server recomputes the estimate on save and approve.
  const estimate = useMemo(() => {
    try {
      return withFootageEstimate(normalizePlanForSave(plan), words, style).estimate.credits;
    } catch {
      return null;
    }
  }, [plan, words, style]);
  const placement = useMemo(() => placementWarnings(normalizePlanForSave(plan), words, style), [plan, words, style]);
  const problems = [...(check.ok ? [] : check.errors), ...(empty ? [new EmptyEditError().message] : [])];
  const beatWords = (b: EditPlan["beats"][number]) => words.slice(b.startWordIdx, b.endWordIdx + 1);
  const preview = (b: EditPlan["beats"][number]) => {
    const w = beatWords(b).map((x) => x.text);
    return `${b.id}: ${w.slice(0, 6).join(" ")}${w.length > 6 ? "…" : ""}`;
  };
  const headline = plan.hook.headline ?? { small: "", big: "" };
  const knownTrack = plan.music.kind !== "library" || library.some((t) => plan.music.kind === "library" && t.id === plan.music.assetId);

  function onMusicChange(value: string) {
    if (value === "none") dispatch({ type: "setMusic", music: { kind: "none" } });
    else if (value === "ai") dispatch({ type: "setMusic", music: { kind: "ai", prompt: aiPrompt } });
    else dispatch({ type: "setMusic", music: { kind: "library", assetId: value.slice("lib:".length) } });
  }
  function onEndingChange(kind: EditPlan["ending"]["kind"]) {
    dispatch({ type: "setEnding", ending: kind === "cta" ? { kind, keyword } : { kind } });
  }

  return (
    <section className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Edit plan v{plan.version}</h2>
        <div className="stack" style={{ alignItems: "flex-end", gap: "0.5em" }}>
          <span className="muted">{estimate === null ? "Estimate unavailable" : `Estimated cost: $${estimate.toFixed(2)}`}</span>
          <span className={length.tooLong ? "warn" : "muted"}>{length.text}</span>
        </div>
      </div>
      {plan.warnings.length > 0 && <ul className="warn">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {placement.length > 0 && (
        <div className="warn">
          <strong>Cutaways and callouts:</strong>
          <ul>{placement.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      <fieldset disabled={!editable} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <article className="card stack">
          <strong>Hook</strong>
          <div className="row">
            <label>Cold open
              <select value={plan.hook.coldOpenBeatId ?? ""} onChange={(e) => dispatch({ type: "setColdOpen", beatId: e.target.value || null })}>
                <option value="">None</option>
                {plan.beats.filter((b) => b.keep).map((b) => <option key={b.id} value={b.id}>{preview(b)}</option>)}
              </select>
            </label>
            <label>Pattern break
              <select value={plan.hook.patternBreak} onChange={(e) => dispatch({ type: "setPatternBreak", value: e.target.value as "zoom_hit" | "flash" | "broll" | "none" })}>
                {PATTERN_BREAKS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
          </div>
          <div className="row">
            <label>Headline (small line)
              <input dir="auto" maxLength={40} value={headline.small} onChange={(e) => dispatch({ type: "setHeadline", small: e.target.value, big: headline.big })} />
            </label>
            <label>Headline (big words)
              <input dir="auto" maxLength={24} value={headline.big} onChange={(e) => dispatch({ type: "setHeadline", small: headline.small, big: e.target.value })} />
            </label>
          </div>
          <label>Why this hook
            <textarea dir="auto" maxLength={300} value={plan.hook.reason} onChange={(e) => dispatch({ type: "setReason", reason: e.target.value })} />
          </label>
        </article>

        {plan.beats.map((beat) => {
          const bw = beatWords(beat);
          const seconds = bw.length ? (bw[bw.length - 1].endMs - bw[0].startMs) / 1000 : 0;
          return (
            <article key={beat.id} className="card stack" style={beat.keep ? undefined : { opacity: 0.55 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={beat.keep} onChange={() => dispatch({ type: "toggleKeep", beatId: beat.id })} />
                  Keep
                </label>
                <span className="muted">{beat.id} · {seconds.toFixed(1)} s</span>
              </div>
              <div className="row" dir={textDir} style={{ gap: 4 }}>
                {bw.map((w, k) => {
                  const idx = beat.startWordIdx + k;
                  const red = beat.emphasisWordIdx === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      aria-pressed={red}
                      title={red ? "Remove the red word" : "Make this the red word"}
                      onClick={() => dispatch({ type: "setEmphasis", beatId: beat.id, wordIdx: red ? null : idx })}
                      style={{ padding: "2px 6px", border: 0, background: "transparent", ...(red ? { color: RED, fontWeight: 700 } : {}) }}
                    >
                      {w.text}
                    </button>
                  );
                })}
              </div>
              <div className="row">
                <label>Emoji
                  <input maxLength={8} value={beat.emoji ?? ""} onChange={(e) => dispatch({ type: "setEmoji", beatId: beat.id, emoji: e.target.value })} style={{ width: 80 }} />
                </label>
                <label>Callout
                  <input
                    dir="auto"
                    maxLength={CALLOUT_MAX_CHARS}
                    value={beat.callout?.text ?? ""}
                    placeholder="e.g. 1/5"
                    title="A number or 1–3 words that pops up above you"
                    onChange={(e) => dispatch({ type: "setCallout", beatId: beat.id, text: e.target.value })}
                    style={{ width: 160 }}
                  />
                </label>
                {beat.callout && <button type="button" onClick={() => dispatch({ type: "setCallout", beatId: beat.id, text: "" })}>Remove callout</button>}
                {!beat.keep && beat.dropReason && <span className="muted" dir="auto">Dropped: {beat.dropReason}</span>}
              </div>
              <CutawayEditor plan={plan} cutaway={beat.cutaway} onChange={(c) => dispatch({ type: "setCutaway", beatId: beat.id, cutaway: c })} />
            </article>
          );
        })}

        <article className="card stack">
          <strong>Settings</strong>
          <p className="muted" style={{ margin: 0 }}>Background: original</p>
          <div className="row">
            <label>Character
              <select
                value={plan.character?.id ?? ""}
                onChange={(e) => {
                  const c = characters.find((x) => x.id === e.target.value);
                  dispatch({ type: "setCharacter", character: c ? { id: c.id, name: c.name } : null });
                }}
              >
                <option value="">None</option>
                {plan.character && !characters.some((c) => c.id === plan.character?.id) && <option value={plan.character.id}>{plan.character.name}</option>}
                {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          {characters.length === 0 && <span className="muted">Add a character on the Characters page for AI shots of you.</span>}
          <div className="row">
            <label>Music
              <select value={musicValue(plan.music)} onChange={(e) => onMusicChange(e.target.value)}>
                <option value="none">None</option>
                <option value="ai">AI music</option>
                {library.map((t) => <option key={t.id} value={`lib:${t.id}`}>{t.title} · {t.mood}</option>)}
                {!knownTrack && <option value={musicValue(plan.music)}>Unknown track</option>}
              </select>
            </label>
            <label>Sound effects
              <select value={plan.sfx} onChange={(e) => dispatch({ type: "setSfx", sfx: e.target.value as EditPlan["sfx"] })}>
                {SFX.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
            <label>Ending
              <select value={plan.ending.kind} onChange={(e) => onEndingChange(e.target.value as EditPlan["ending"]["kind"])}>
                {ENDINGS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </label>
            {plan.ending.kind === "cta" && (
              <label>CTA keyword
                <input dir="auto" maxLength={30} value={plan.ending.keyword} onChange={(e) => { setKeyword(e.target.value); dispatch({ type: "setEnding", ending: { kind: "cta", keyword: e.target.value } }); }} />
              </label>
            )}
          </div>
          {plan.music.kind === "ai" && (
            <label>Music prompt
              <input dir="auto" maxLength={300} value={plan.music.prompt} placeholder="e.g. calm lo-fi beat" onChange={(e) => { setAiPrompt(e.target.value); dispatch({ type: "setMusic", music: { kind: "ai", prompt: e.target.value } }); }} />
            </label>
          )}
          {library.length === 0 && <span className="muted">Upload tracks on the Music page.</span>}
        </article>
      </fieldset>

      {editable && problems.length > 0 && <ul className="warn">{problems.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {errors.length > 0 && <ul role="alert" className="error">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}

      {editable ? (
        <>
          <div className="row">
            <button type="button" disabled={pending} onClick={() => act(() => savePlanAction(projectId, storyboardId, plan))}>Save draft</button>
            <button type="button" className="primary" disabled={pending || problems.length > 0} onClick={() => act(() => approvePlanAction(projectId, storyboardId, plan))}>
              Approve &amp; render
            </button>
            <span className="muted">Approving may spend Higgsfield credits for AI cutaways and ElevenLabs credits for AI music, up to the estimate above.</span>
          </div>
          {canReplan && (
            <div className="row">
              <input
                dir="auto"
                maxLength={REPLAN_MAX}
                value={instruction}
                placeholder="e.g. tighten to 45 s"
                aria-label="Re-plan instruction"
                onChange={(e) => setInstruction(e.target.value)}
                style={{ flex: 1, minWidth: 220 }}
              />
              <button type="button" disabled={pending} onClick={() => act(() => replanAction(projectId, storyboardId, instruction), () => setInstruction(""))}>Re-plan</button>
            </div>
          )}
        </>
      ) : (
        <div className="row">
          <button type="button" disabled={pending} onClick={() => act(() => newPlanVersionAction(projectId, storyboardId))}>Edit as new version</button>
          {canRetry && (
            <button type="button" className="primary" disabled={pending} onClick={() => act(() => retryFootageGenerateAction(projectId, storyboardId))}>
              Retry generation
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Shown when preparing the video failed before any edit plan existed. */
export function RetryIngestButton({ projectId }: { projectId: string }) {
  const { errors, pending, act } = useAction();
  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="primary" disabled={pending} onClick={() => act(() => retryIngestAction(projectId))}>Retry</button>
      </div>
      {errors.length > 0 && <ul role="alert" className="error">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </div>
  );
}
