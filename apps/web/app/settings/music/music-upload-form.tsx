"use client";
import { MusicMoodSchema } from "@reel/core";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { readMediaDuration } from "@/lib/footage-upload";
import { checkMusicFile, musicExt, musicStoragePath } from "@/lib/music-form";
import { createClient } from "@/lib/supabase/client";
import { addMusicTrack } from "./actions";

const MOODS = MusicMoodSchema.options;

export function MusicUploadForm() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function onFileChange(f: File | null) {
    setFile(f);
    setDurationSec(null);
    if (!f) return setErrors([]);
    setBusy(true);
    const sec = await readMediaDuration(f, "audio");
    setDurationSec(sec);
    setErrors(checkMusicFile({ name: f.name, size: f.size, durationSec: sec }));
    setBusy(false);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return setErrors(["Choose a track to upload."]);
    const ext = musicExt(file.name);
    const fileErrors = checkMusicFile({ name: file.name, size: file.size, durationSec });
    if (!ext || fileErrors.length) return setErrors(fileErrors);
    if (durationSec === null) return setErrors(["Couldn't read the track's length in this browser. Try an MP3 or WAV file."]);
    const data = new FormData(e.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    if (!title) return setErrors(["Give the track a title."]);
    setErrors([]);
    setBusy(true);
    try {
      const storagePath = musicStoragePath(crypto.randomUUID(), ext);
      const { error } = await createClient().storage.from("assets").upload(storagePath, file, { contentType: file.type || undefined });
      if (error) return setErrors([`The upload failed: ${error.message}`]);
      const r = await addMusicTrack({ storagePath, title, mood: String(data.get("mood")), durationSec });
      if (!r.ok) return setErrors(r.errors);
      form.current?.reset();
      setFile(null);
      setDurationSec(null);
      router.refresh();
    } catch (err) {
      setErrors([`The upload failed: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={onSubmit} className="stack card">
      <h2 style={{ margin: 0 }}>Add a track</h2>
      <fieldset disabled={busy} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <label>
          Track (MP3, WAV, M4A or AAC, up to 100 MB and 15 minutes)
          <input name="file" type="file" accept=".mp3,.wav,.m4a,.aac,audio/*" required onChange={(e) => void onFileChange(e.currentTarget.files?.[0] ?? null)} />
        </label>
        <div className="row">
          <label>Title<input name="title" dir="auto" maxLength={80} required autoComplete="off" /></label>
          <label>Mood
            <select name="mood" defaultValue="calm">{MOODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          </label>
        </div>
      </fieldset>
      {errors.length > 0 && <ul role="alert" className="error">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
      <div className="row">
        <button type="submit" className="primary" disabled={busy || !file}>{busy ? "Uploading…" : "Upload track"}</button>
      </div>
    </form>
  );
}
