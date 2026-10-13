import Link from "next/link";
import { redirect } from "next/navigation";
import { projectStatusLabel } from "@/lib/footage-upload";
import { listProjects } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");
  const projects = await listProjects(supabase);
  const now = new Date();
  return (
    <main className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Reels</h1>
        <Link className="button primary" href="/new">New reel</Link>
      </div>
      {projects.length === 0 ? (
        <p className="muted">No reels yet. Start one from a short brief.</p>
      ) : (
        <table>
          <thead><tr><th>Title</th><th>Language</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/projects/${p.id}`} dir="auto">{p.title}</Link></td>
                <td>{p.language === "he" ? "עברית" : "English"}</td>
                <td><span className="badge">{projectStatusLabel(p, now)}</span></td>
                <td className="muted">{new Date(p.updated_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
