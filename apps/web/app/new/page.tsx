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
