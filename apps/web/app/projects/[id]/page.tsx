import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { JobPanel } from "@/components/JobPanel";
import { ReelPreview } from "@/components/ReelPreview";
import { StoryboardEditor } from "@/components/StoryboardEditor";
import { uploadIncomplete } from "@/lib/footage-upload";
import { canRetryGenerate } from "@/lib/retry-visibility";
import { getProjectView } from "@/lib/queries";
import { signRender, supabaseSigningClient } from "@/lib/render-urls";
import { checkStoryboard } from "@/lib/storyboard-edit";
import { createClient } from "@/lib/supabase/server";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");
  const view = await getProjectView(supabase, id);
  if (!view) notFound();
  const { project, storyboard, job } = view;
  if (project.format === "footage" && project.status === "uploading") {
    return (
      <main className="stack">
        <h1 dir="auto" style={{ margin: 0 }}>{project.title}</h1>
        {uploadIncomplete(project.created_at, new Date())
          ? <p className="error">Upload incomplete: <Link href="/new/footage">upload again</Link>.</p>
          : <p className="muted">Uploading… keep the upload tab open.</p>}
      </main>
    );
  }
  const parsed = storyboard ? checkStoryboard(storyboard.json) : null;
  const canRetry = storyboard ? canRetryGenerate(storyboard, job) : false;
  const sceneIds = parsed?.ok ? parsed.storyboard.scenes.filter((s) => s.visual.kind !== "graphic").map((s) => s.id) : [];
  const signed =
    view.render && project.status === "rendered"
      ? await signRender(supabaseSigningClient(supabase), view.render).catch((err: Error) => ({ error: err.message }))
      : null;

  return (
    <main className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 dir="auto" style={{ margin: 0 }}>{project.title}</h1>
        <span className="badge">{project.status}</span>
      </div>
      <JobPanel projectId={project.id} initialJob={job} sceneIds={sceneIds} />
      {signed && "error" in signed && <p className="error">{signed.error}</p>}
      {signed && !("error" in signed) && <ReelPreview timeline={signed.timeline} reelUrl={signed.reelUrl} srtUrl={signed.srtUrl} />}
      {storyboard && parsed?.ok && (
        <StoryboardEditor
          key={`${storyboard.id}:${storyboard.updated_at}`}
          projectId={project.id}
          storyboardId={storyboard.id}
          initial={parsed.storyboard}
          editable={storyboard.status === "draft"}
          canRetry={canRetry}
        />
      )}
      {storyboard && parsed && !parsed.ok && <p className="error">This storyboard can't be displayed: {parsed.errors.join("; ")}</p>}
      {!storyboard && (
        project.status === "failed"
          ? <p className="error">Planning failed. Start a new reel from the Reels list.</p>
          : <p className="muted">Claude is writing the storyboard…</p>
      )}
    </main>
  );
}
