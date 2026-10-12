import Link from "next/link";
import { redirect } from "next/navigation";
import { STYLES } from "@reel/styles";
import { createClient } from "@/lib/supabase/server";

export default async function NewReelPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  return (
    <main className="stack">
      <h1>New reel</h1>
      <p className="muted">Pick a style. Planning uses Claude only; nothing is generated until you approve.</p>
      <div className="style-grid">
        <Link className="card style-card" href="/new/footage">
          <strong>Edit my video</strong>
          <span className="muted">Upload a video of you talking (up to 3 minutes). The agent cuts it like a top creator: jump cuts, captions, hook, music.</span>
        </Link>
        {STYLES.map((s) =>
          s.status === "available" ? (
            <Link key={s.id} className="card style-card" href={`/new/${s.id}`}>
              <strong>{s.name}</strong>
              <span className="muted">{s.description}</span>
            </Link>
          ) : (
            <div key={s.id} className="card style-card disabled" aria-disabled="true">
              <strong>{s.name}</strong>
              <span className="muted">{s.description}</span>
              <span className="badge">Coming soon</span>
              <span className="muted">{s.comingSoonReason}</span>
            </div>
          ),
        )}
      </div>
    </main>
  );
}
