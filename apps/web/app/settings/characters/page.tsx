import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CharacterForm } from "./character-form";

export default async function CharactersPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");
  const { data: characters, error } = await supabase.from("soul_characters").select("id, name, reference_id").order("name");
  return (
    <main className="stack">
      <h1>Characters</h1>
      <p className="muted">A character is a Soul ID trained once on 5–20 photos of a person. Train it with the Higgsfield Soul ID flow (it costs Higgsfield credits: ask before training), then paste its reference id here. Edit plans use it for AI shots of that person.</p>
      {error && <p className="error">Couldn&apos;t load the characters: {error.message}</p>}
      {characters && characters.length === 0 && <p className="muted">No characters yet. Add the first one below.</p>}
      {characters && characters.length > 0 && (
        <table>
          <thead><tr><th>Name</th><th>Reference id</th></tr></thead>
          <tbody>
            {characters.map((c) => (
              <tr key={c.id}><td dir="auto">{c.name}</td><td>{c.reference_id}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <CharacterForm />
    </main>
  );
}
