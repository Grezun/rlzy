"use client";
import { checkExtraFiles, checkFootageFile, extraExt, extraLabel, footageExt, type FootageSettings } from "@reel/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseFootageSettings } from "@/lib/footage-form";
import { extraContentType, forgetUploadsAfter, retryLabel, sendFootage, uploadAll, type SendOutcome } from "@/lib/footage-send";
import { readVideoDuration, uploadFootageFile } from "@/lib/footage-upload";
import { createClient } from "@/lib/supabase/client";
import { finishFootageUpload, startFootageUpload } from "./actions";

type Started = { projectId: string; storagePath: string; settings: FootageSettings; extras: { storagePath: string; label: string }[] };
type Phase = "idle" | "checking" | "starting" | "uploading" | "finishing" | "stopped";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function FootageForm({ supabaseUrl, characters }: { supabaseUrl: string; characters: { id: string; name: string }[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [extras, setExtras] = useState<{ file: File; label: string }[]>([]);
  /** Object names already uploaded in full: "Resume upload" skips them. */
  const doneRef = useRef(new Set<string>());
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [started, setStarted] = useState<Started | null>(null);
  /** The file is in storage: a retry only records it, it never sends the file again. */
  const [uploaded, setUploaded] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const busy = phase === "checking" || phase === "starting" || phase === "uploading" || phase === "finishing";

  // Closing the tab mid-upload leaves the reel in "Upload incomplete": warn first.
  useEffect(() => {
    if (phase !== "uploading") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  async function onFileChange(f: File | null) {
    setFile(f);
    setErrors([]);
    if (!f) return setFileErrors([]);
    setPhase("checking");
    const sec = await readVideoDuration(f);
    setDurationSec(sec);
    setFileErrors(checkFootageFile({ name: f.name, size: f.size, durationSec: sec }));
    setPhase("idle");
  }

  /** Uploads (resuming any earlier attempt to the same object) unless already uploaded, then records the upload. */
  async function send(f: File, s: Started, alreadyUploaded: boolean) {
    setErrors([]);
    setOutcome(null);
    setPhase(alreadyUploaded ? "finishing" : "uploading");
    const getToken = async () => (await createClient().auth.getSession()).data.session?.access_token ?? "";
    const o = await sendFootage({
      upload: () => uploadAll(
        [
          { objectName: s.storagePath, size: f.size, file: f, contentType: f.type || (footageExt(f.name) === "mov" ? "video/quicktime" : "video/mp4") },
          ...s.extras.map((x, i) => ({ objectName: x.storagePath, size: extras[i].file.size, file: extras[i].file, contentType: extras[i].file.type || extraContentType(extraExt(extras[i].file.name)!) })),
        ],
        doneRef.current,
        (item, onFraction) => uploadFootageFile(item.file, { supabaseUrl, bucket: "assets", objectName: item.objectName, contentType: item.contentType, getToken, onProgress: onFraction }),
        setProgress,
      ),
      onUploaded: () => { setUploaded(true); setPhase("finishing"); },
      finish: () => finishFootageUpload(s),
    }, alreadyUploaded);
    forgetUploadsAfter(doneRef.current, o);
    if (o.kind === "done") return router.push(`/projects/${s.projectId}`);
    if (o.kind === "failed") setUploaded(o.uploaded);
    setErrors(o.errors);
    setOutcome(o);
    setPhase("stopped");
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return setErrors(["Choose a video to upload."]);
    const parsed = parseFootageSettings(new FormData(e.currentTarget));
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors([]);
    setPhase("starting");
    try {
      const r = await startFootageUpload({ settings: parsed.settings, fileName: file.name, size: file.size, durationSec, extras: extras.map((x) => ({ name: x.file.name, size: x.file.size })) });
      if (!r.ok) {
        setErrors(r.errors);
        return setPhase("idle");
      }
      const s = { projectId: r.projectId, storagePath: r.storagePath, settings: parsed.settings, extras: r.extraPaths.map((p, i) => ({ storagePath: p, label: extras[i].label.trim() })) };
      setStarted(s);
      await send(file, s, false);
    } catch (err) {
      setErrors([`Couldn't create the reel: ${message(err)}`]);
      setPhase("idle");
    }
  }

  const extraErrors = checkExtraFiles(extras.map((x) => ({ name: x.file.name, size: x.file.size })));
  const blankLabel = extras.some((x) => !x.label.trim());
  const locked = busy || started !== null;
  return (
    <form onSubmit={onSubmit} className="stack card">
      <fieldset disabled={locked} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <label>
          Video
          <input name="file" type="file" accept="video/mp4,video/quicktime,.mp4,.mov" required onChange={(e) => void onFileChange(e.currentTarget.files?.[0] ?? null)} />
        </label>
        <div className="row">
          <label>Language<select name="language" defaultValue="he"><option value="he">עברית</option><option value="en">English</option></select></label>
          <label>Length<select name="targetDurationSec" defaultValue="30">{[15, 30, 45, 60, 90].map((s) => <option key={s} value={s}>{s}s</option>)}</select></label>
          <label>
            CTA keyword (optional)
            <input name="ctaKeyword" dir="auto" maxLength={30} autoComplete="off" />
            <span className="muted">Viewers comment this word, e.g. AI</span>
          </label>
        </div>
        <label>
          Notes for the editor (optional)
          <textarea name="notes" dir="auto" maxLength={2000} rows={3} />
        </label>
        <label>
          Extra photos or clips (optional, up to 6)
          <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
            onChange={(e) => setExtras(Array.from(e.currentTarget.files ?? []).map((file) => ({ file, label: extraLabel(file.name) })))} />
          <span className="muted">Screenshots, product shots or clips. The editor places them where your words fit their labels.</span>
        </label>
        {extras.map((x, i) => (
          <label key={i}>Label for {x.file.name}
            <input dir="auto" maxLength={80} value={x.label} onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
          </label>
        ))}
        <label>
          Character for AI shots of you (optional)
          <select name="characterId" defaultValue="">
            <option value="">None</option>
            {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {characters.length === 0 && <span className="muted">Add one on the Characters page to get AI shots of you.</span>}
        </label>
      </fieldset>
      {(fileErrors.length > 0 || extraErrors.length > 0) && <ul role="alert" className="error">{[...fileErrors, ...extraErrors].map((m) => <li key={m}>{m}</li>)}</ul>}
      {(phase === "uploading" || phase === "finishing" || outcome?.kind === "interrupted") && (
        <div className="stack">
          <progress value={progress} max={1} />
          {phase === "uploading" && <p className="muted">Uploading… {Math.round(progress * 100)}%. Keep this tab open.</p>}
          {phase === "finishing" && <p className="muted">Upload finished. Starting the edit…</p>}
        </div>
      )}
      {errors.length > 0 && <ul role="alert" className="error">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
      <div className="row">
        {started && outcome?.kind === "queued" ? (
          <Link className="button primary" href={`/projects/${started.projectId}`}>Open the reel</Link>
        ) : started && file && outcome && retryLabel(outcome) ? (
          <button type="button" className="primary" onClick={() => void send(file, started, uploaded)}>{retryLabel(outcome)}</button>
        ) : (
          <button type="submit" className="primary" disabled={locked || fileErrors.length > 0 || extraErrors.length > 0 || blankLabel}>
            {phase === "checking" ? "Checking the video…" : busy ? "Uploading…" : "Upload and plan"}
          </button>
        )}
        <span className="muted">Planning uses Claude only; nothing is generated until you approve.</span>
      </div>
    </form>
  );
}
