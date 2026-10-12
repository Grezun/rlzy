"use client";
import { useActionState, useState } from "react";
import type { StyleDef } from "@reel/styles";
import { describeScriptLength } from "@/lib/script-estimate";
import type { NewReelState } from "../actions";
import { createStyleReel } from "./actions";

export function StyleReelForm({ style }: { style: StyleDef }) {
  const [state, action, pending] = useActionState<NewReelState, FormData>(createStyleReel.bind(null, style.id), {});
  const [script, setScript] = useState("");
  const [language, setLanguage] = useState<"he" | "en">("he");
  const [target, setTarget] = useState(style.defaultDurationSec);
  const estimate = describeScriptLength(script, language, target);
  return (
    <form action={action} className="stack card">
      {style.fields.map((f) => {
        const name = `field.${f.key}`;
        return (
          <label key={f.key}>
            {f.label}{f.required ? " *" : ""}
            {f.kind === "line" && <input name={name} dir="auto" maxLength={f.maxLength} required={f.required} />}
            {f.kind === "text" && <textarea name={name} dir="auto" maxLength={f.maxLength} required={f.required} rows={3} />}
            {f.kind === "select" && (
              <select name={name} defaultValue={f.default}>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </label>
        );
      })}
      {style.scriptVar && (
        <label>
          Script (optional)
          <textarea name="script" dir="auto" maxLength={5000} rows={6} value={script} onChange={(e) => setScript(e.target.value)} />
          <span className="muted">Leave empty and the agent drafts one for you to review. If you paste a script, it is used word for word.</span>
          {estimate && <span className={estimate.tooLong ? "warn" : "muted"}>{estimate.text}</span>}
        </label>
      )}
      <div className="row">
        <label>Language<select name="language" value={language} onChange={(e) => setLanguage(e.target.value as "he" | "en")}><option value="he">עברית</option><option value="en">English</option></select></label>
        <label>Length<select name="targetDurationSec" value={String(target)} onChange={(e) => setTarget(Number(e.target.value) as StyleDef["defaultDurationSec"])}>{[15, 30, 45, 60].map((s) => <option key={s} value={s}>{s}s</option>)}</select></label>
        <label>Pacing<select name="pacing" defaultValue="punchy"><option value="punchy">Punchy</option><option value="calm">Calm</option></select></label>
        <label>Captions<select name="captionPreset" defaultValue="bold_pop"><option value="bold_pop">Bold pop</option><option value="clean">Clean</option></select></label>
        <label>Accent<input name="color1" type="color" defaultValue="#ffe14d" /></label>
        <label>Background<input name="color2" type="color" defaultValue="#111111" /></label>
      </div>
      <label>
        ElevenLabs voice ID (optional; defaults to the team voice for the language)
        <input name="voiceId" dir="ltr" autoComplete="off" />
      </label>
      {state.errors && <ul role="alert" className="error">{state.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="row">
        <button type="submit" className="primary" disabled={pending}>{pending ? "Creating…" : "Create storyboard"}</button>
        <span className="muted">Planning uses Claude only; nothing is generated until you approve.</span>
      </div>
    </form>
  );
}
