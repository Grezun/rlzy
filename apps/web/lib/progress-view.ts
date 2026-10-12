import { emptyProgress, JobProgressSchema } from "@reel/db";

export type StepView = { key: string; label: string; state: "pending" | "running" | "done" };
export type SceneView = { id: string; state: "pending" | "running" | "done" | "failed"; reason?: string };
export type ProgressView = {
  headline: string;
  tone: "info" | "success" | "warning" | "error";
  steps: StepView[];
  scenes: SceneView[];
  renderPercent?: number;
  error?: string;
  /** Parts a footage reel skipped (e.g. AI music that failed); the reel itself still rendered. */
  notes: string[];
};

type JobLike = { type: string; status: string; progress: unknown; error: string | null };

type StepKey = keyof ReturnType<typeof emptyProgress>["steps"];
const STEPS: Record<string, [StepKey, string][]> = {
  generate: [["voice", "Voice"], ["visuals", "Visuals"], ["render", "Render"], ["export", "Export"]],
  ingest_footage: [["conform", "Prepare video"], ["transcribe", "Transcribe"], ["faces", "Find face"], ["plan", "Plan the edit"]],
  generate_footage: [["voice", "Cut audio"], ["music", "Music"], ["render", "Render"], ["export", "Export"]],
};

const PLAN_HEADLINES: Record<string, [string, ProgressView["tone"]]> = {
  queued: ["Waiting for a worker…", "info"],
  running: ["Claude is writing the storyboard…", "info"],
  done: ["Storyboard ready: review and approve it below.", "success"],
  failed: ["Planning failed.", "error"],
};
const GENERATE_HEADLINES: Record<string, [string, ProgressView["tone"]]> = {
  queued: ["Queued: waiting for a worker…", "info"],
  running: ["Generating your reel…", "info"],
  done: ["Your reel is ready.", "success"],
  needs_attention: ["Some scenes failed. Use “Edit as new version”, fix their prompts, then approve again — finished scenes won't be charged again.", "warning"],
  failed: ["Generation failed.", "error"],
};
const HEADLINES: Record<string, Record<string, [string, ProgressView["tone"]]>> = {
  plan: PLAN_HEADLINES,
  generate: GENERATE_HEADLINES,
  ingest_footage: {
    queued: ["Waiting for a worker…", "info"],
    running: ["Preparing your video: transcribing and planning the edit…", "info"],
    done: ["Edit plan ready: review and approve it below.", "success"],
    failed: ["Preparing the video failed.", "error"],
  },
  plan_footage: {
    queued: ["Waiting for a worker…", "info"],
    running: ["Claude is re-planning the edit…", "info"],
    done: ["New edit plan ready: review and approve it below.", "success"],
    failed: ["Re-planning failed. Your previous plan is unchanged.", "error"],
  },
  generate_footage: {
    queued: ["Queued: waiting for a worker…", "info"],
    running: ["Editing your reel…", "info"],
    done: ["Your reel is ready.", "success"],
    failed: ["Generation failed.", "error"],
  },
};

export function describeJob(job: JobLike | null, sceneIds: string[]): ProgressView | null {
  if (!job) return null;
  const progress = JobProgressSchema.catch(emptyProgress()).parse(job.progress);
  const notes = progress.notes ?? [];
  let [headline, tone] = (HEADLINES[job.type] ?? GENERATE_HEADLINES)[job.status] ?? [job.status, "info"];
  if (job.type === "generate_footage" && job.status === "done" && notes.length > 0) [headline, tone] = ["Your reel is ready. Some parts were skipped:", "warning"];
  const view: ProgressView = { headline, tone, steps: [], scenes: [], notes, ...(job.error ? { error: job.error } : {}) };
  view.steps = (STEPS[job.type] ?? []).map(([key, label]) => ({ key, label, state: progress.steps[key] ?? "pending" }));
  if (progress.steps.render === "running" && progress.renderProgress !== undefined) view.renderPercent = Math.round(progress.renderProgress * 100);
  if (job.type !== "generate") return view;
  view.scenes = sceneIds.map((id) => {
    const s = progress.scenes[id];
    if (!s) return { id, state: "pending" as const };
    return s.reason ? { id, state: s.status, reason: s.reason } : { id, state: s.status };
  });
  return view;
}
