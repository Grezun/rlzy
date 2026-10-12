"use client";
import { checkFootageFile, footageExt, type FootageSettings } from "@reel/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { parseFootageSettings } from "@/lib/footage-form";
import { retryLabel, sendFootage, type SendOutcome } from "@/lib/footage-send";
import { readVideoDuration, uploadFootageFile } from "@/lib/footage-upload";
import { createClient } from "@/lib/supabase/client";
import { finishFootageUpload, startFootageUpload } from "./actions";

type Started = { projectId: string; storagePath: string; settings: FootageSettings };
type Phase = "idle" | "checking" | "starting" | "uploading" | "finishing" | "stopped";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function FootageForm({ supabaseUrl }: { supabaseUrl: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
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
    const o = await sendFootage({
      upload: () => uploadFootageFile(f, {
        supabaseUrl,
        bucket: "assets",
        objectName: s.storagePath,
        contentType: f.type || (footageExt(f.name) === "mov" ? "video/quicktime" : "video/mp4"),
        getToken: async () => (await createClient().auth.getSession()).data.session?.access_token ?? "",
        onProgress: setProgress,
      }),
      onUploaded: () => { setUploaded(true); setPhase("finishing"); },
      finish: () => finishFootageUpload(s),
    }, alreadyUploaded);
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
      const r = await startFootageUpload({ settings: parsed.settings, fileName: file.name, size: file.size, durationSec });
      if (!r.ok) {
        setErrors(r.errors);
        return setPhase("idle");
      }
      const s = { projectId: r.projectId, storagePath: r.storagePath, settings: parsed.settings };
      setStarted(s);
      await send(file, s, false);
    } catch (err) {
      setErrors([`Couldn't create the reel: ${message(err)}`]);
      setPhase("idle");
    }
  }

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
      </fieldset>
      {fileErrors.length > 0 && <ul role="alert" className="error">{fileErrors.map((m) => <li key={m}>{m}</li>)}</ul>}
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
          <button type="submit" className="primary" disabled={locked || fileErrors.length > 0}>
            {phase === "checking" ? "Checking the video…" : busy ? "Uploading…" : "Upload and plan"}
          </button>
        )}
        <span className="muted">Planning uses Claude only; nothing is generated until you approve.</span>
      </div>
    </form>
  );
}
