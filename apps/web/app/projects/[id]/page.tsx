import type { EditPlan } from "@reel/core";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { JobPanel } from "@/components/JobPanel";
import { FootagePlanEditor, RetryIngestButton, type LibraryTrack } from "@/components/FootagePlanEditor";
import { ReelPreview } from "@/components/ReelPreview";
import { StoryboardEditor } from "@/components/StoryboardEditor";
import { uploadIncomplete } from "@/lib/footage-upload";
import { checkEditPlan } from "@/lib/edit-plan-edit";
import { canRetryGenerate } from "@/lib/retry-visibility";
import { getProjectView } from "@/lib/queries";
import { signRender, supabaseSigningClient } from "@/lib/render-urls";
import { checkStoryboard } from "@/lib/storyboard-edit";
import { createClient } from "@/lib/supabase/server";
import { loadTranscript } from "@/lib/transcript";

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
  const signed =
    view.render && project.status === "rendered"
      ? await signRender(supabaseSigningClient(supabase), view.render).catch((err: Error) => ({ error: err.message }))
      : null;
  const header = (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <h1 dir="auto" style={{ margin: 0 }}>{project.title}</h1>
      <span className="badge">{project.status}</span>
    </div>
  );
  const preview = (
    <>
      {signed && "error" in signed && <p className="error">{signed.error}</p>}
      {signed && !("error" in signed) && <ReelPreview timeline={signed.timeline} reelUrl={signed.reelUrl} srtUrl={signed.srtUrl} />}
    </>
  );

  if (project.format === "footage") {
    const planCheck = storyboard ? checkEditPlan(storyboard.json) : null;
    return (
      <main className="stack">
        {header}
        <JobPanel projectId={project.id} initialJob={job} sceneIds={[]} />
        {preview}
        {storyboard && planCheck?.ok && (
          <FootageReview
            supabase={supabase}
            projectId={project.id}
            storyboard={storyboard}
            plan={planCheck.plan}
            canReplan={storyboard.status === "draft" && project.status === "draft"}
            canRetry={canRetryGenerate(storyboard, job)}
          />
        )}
        {storyboard && planCheck && !planCheck.ok && <p className="error">This edit plan can't be displayed: {planCheck.errors.join("; ")}</p>}
        {!storyboard && (
          project.status === "failed"
            ? (
              <div className="stack">
                <p className="error">Preparing the video failed{job?.error ? `: ${job.error}` : ""}.</p>
                <RetryIngestButton projectId={project.id} />
              </div>
            )
            : <p className="muted">Preparing your video…</p>
        )}
      </main>
    );
  }

  const parsed = storyboard ? checkStoryboard(storyboard.json) : null;
  const canRetry = storyboard ? canRetryGenerate(storyboard, job) : false;
  const sceneIds = parsed?.ok ? parsed.storyboard.scenes.filter((s) => s.visual.kind !== "graphic").map((s) => s.id) : [];

  return (
    <main className="stack">
      {header}
      <JobPanel projectId={project.id} initialJob={job} sceneIds={sceneIds} />
      {preview}
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

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Loads what the edit plan editor needs (the transcript's words and the team music library). */
async function FootageReview({ supabase, projectId, storyboard, plan, canReplan, canRetry }: {
  supabase: Supabase;
  projectId: string;
  storyboard: { id: string; status: string; updated_at: string };
  plan: EditPlan;
  canReplan: boolean;
  canRetry: boolean;
}) {
  const [words, tracks, chars] = await Promise.all([
    loadTranscript(supabase, plan.source.transcriptAssetId).then((t) => t.words, (err: Error) => ({ error: err.message })),
    supabase.from("team_music").select("id, title, mood").order("title"),
    supabase.from("soul_characters").select("id, name").order("name"),
  ]);
  if ("error" in words) return <p className="error">{words.error}</p>;
  if (tracks.error) return <p className="error">Couldn't load the music library: {tracks.error.message}</p>;
  if (chars.error) return <p className="error">Couldn't load the characters: {chars.error.message}</p>;
  const library: LibraryTrack[] = tracks.data;
  return (
    <FootagePlanEditor
      key={`${storyboard.id}:${storyboard.updated_at}`}
      projectId={projectId}
      storyboardId={storyboard.id}
      initial={plan}
      words={words}
      library={library}
      characters={chars.data}
      editable={storyboard.status === "draft"}
      canReplan={canReplan}
      canRetry={canRetry}
    />
  );
}
