"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { addCharacter } from "./actions";

export function CharacterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors([]);
    setBusy(true);
    try {
      const r = await addCharacter({ name, referenceId });
      if (!r.ok) return setErrors(r.errors);
      setName("");
      setReferenceId("");
      router.refresh();
    } catch (err) {
      setErrors([`Couldn't add the character: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack card">
      <div className="row">
        <label>Name<input dir="auto" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Soul ID reference id<input maxLength={64} autoComplete="off" value={referenceId} onChange={(e) => setReferenceId(e.target.value)} required /></label>
      </div>
      {errors.length > 0 && <ul role="alert" className="error">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
      <div className="row"><button type="submit" className="primary" disabled={busy}>{busy ? "Adding…" : "Add character"}</button></div>
    </form>
  );
}
