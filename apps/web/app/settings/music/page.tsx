import { formatMinSec } from "@reel/core";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MusicUploadForm } from "./music-upload-form";

export default async function MusicPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");
  const { data: tracks, error } = await supabase.from("team_music").select("id, title, mood, duration_sec").order("title");
  return (
    <main className="stack">
      <h1>Music</h1>
      <p className="muted">The team&apos;s music library. Edit plans can use these tracks instead of AI music; a track shorter than the reel loops.</p>
      {error && <p className="error">Couldn&apos;t load the music library: {error.message}</p>}
      {tracks && tracks.length === 0 && <p className="muted">No tracks yet. Upload the first one below.</p>}
      {tracks && tracks.length > 0 && (
        <table>
          <thead><tr><th>Title</th><th>Mood</th><th>Length</th></tr></thead>
          <tbody>
            {tracks.map((t) => (
              <tr key={t.id}><td dir="auto">{t.title}</td><td>{t.mood}</td><td>{formatMinSec(Number(t.duration_sec))}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <MusicUploadForm />
    </main>
  );
}
