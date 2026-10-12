"use client";
import { checkFootageFile, footageExt, type FootageSettings } from "@reel/core";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { parseFootageSettings } from "@/lib/footage-form";
import { readVideoDuration, uploadFootageFile } from "@/lib/footage-upload";
import { createClient } from "@/lib/supabase/client";
import { finishFootageUpload, startFootageUpload } from "./actions";

type Started = { projectId: string; storagePath: string; settings: FootageSettings };
type Phase = "idle" | "checking" | "starting" | "uploading" | "finishing" | "interrupted" | "failed";

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

  /** Uploads (resuming any earlier attempt to the same object), then records the upload. */
  async function send(f: File, s: Started) {
    setErrors([]);
    setPhase("uploading");
    try {
      await uploadFootageFile(f, {
        supabaseUrl,
        bucket: "assets",
        objectName: s.storagePath,
        contentType: f.type || (footageExt(f.name) === "mov" ? "video/quicktime" : "video/mp4"),
        getToken: async () => (await createClient().auth.getSession()).data.session?.access_token ?? "",
        onProgress: setProgress,
      });
    } catch (err) {
      setErrors([`Upload interrupted: ${message(err)}. Check your connection and press Resume upload: it continues where it stopped.`]);
      return setPhase("interrupted");
    }
    setPhase("finishing");
    try {
      const done = await finishFootageUpload(s);
      if (!done.ok) {
        setErrors(done.errors);
        return setPhase("failed");
      }
    } catch (err) {
      setErrors([`Couldn't record the upload: ${message(err)}`]);
      return setPhase("failed");
    }
    router.push(`/projects/${s.projectId}`);
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
      await send(file, s);
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
      {(phase === "uploading" || phase === "finishing" || phase === "interrupted") && (
        <div className="stack">
          <progress value={progress} max={1} />
          {phase === "uploading" && <p className="muted">Uploading… {Math.round(progress * 100)}%. Keep this tab open.</p>}
          {phase === "finishing" && <p className="muted">Upload finished. Starting the edit…</p>}
        </div>
      )}
      {errors.length > 0 && <ul role="alert" className="error">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
      <div className="row">
        {started && file && (phase === "interrupted" || phase === "failed") ? (
          <button type="button" className="primary" onClick={() => void send(file, started)}>{phase === "interrupted" ? "Resume upload" : "Try again"}</button>
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
