import { FOOTAGE_PATH_RE, FootageSettingsSchema, PlanFormSchema, type PipelineEvent } from "@reel/core";
import * as z from "zod";
import type { Database } from "./database.types";

export type { Database, Json } from "./database.types";

export const BUCKETS = { assets: "assets", renders: "renders" } as const;

export type JobType = "plan" | "generate";
export type JobStatus = "queued" | "running" | "needs_attention" | "done" | "failed";
export type ProjectStatus = "uploading" | "planning" | "draft" | "generating" | "needs_attention" | "rendered" | "failed";

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type JobRow = Tables<"jobs">;
export type ProjectRow = Tables<"projects">;
export type StoryboardRow = Tables<"storyboards">;
export type RenderRow = Tables<"renders">;
export type AssetRow = Tables<"assets">;

export const PlanJobPayloadSchema = PlanFormSchema;
export const GenerateJobPayloadSchema = z.object({ storyboardId: z.uuid() });
export const IngestFootageJobPayloadSchema = z.object({ storagePath: z.string().regex(FOOTAGE_PATH_RE), settings: FootageSettingsSchema });
export type IngestFootagePayload = z.infer<typeof IngestFootageJobPayloadSchema>;

const StepStatusSchema = z.enum(["running", "done"]);
export const JobProgressSchema = z.object({
  steps: z.partialRecord(z.enum(["voice", "visuals", "render", "export", "conform", "transcribe", "faces", "plan", "music"]), StepStatusSchema).default({}),
  scenes: z
    .record(z.string(), z.object({ status: z.enum(["running", "done", "failed"]), reason: z.string().optional() }))
    .default({}),
  renderProgress: z.number().min(0).max(1).optional(),
  notes: z.array(z.string()).optional(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

export const emptyProgress = (): JobProgress => ({ steps: {}, scenes: {} });

export function applyPipelineEvent(progress: JobProgress, event: PipelineEvent): JobProgress {
  switch (event.type) {
    case "step":
      return { ...progress, steps: { ...progress.steps, [event.step]: event.status } };
    case "scene":
      return {
        ...progress,
        scenes: {
          ...progress.scenes,
          [event.sceneId]: event.reason === undefined ? { status: event.status } : { status: event.status, reason: event.reason },
        },
      };
    case "render-progress":
      return { ...progress, renderProgress: Math.min(1, Math.max(0, event.progress)) };
    case "note":
      return { ...progress, notes: [...(progress.notes ?? []), event.message] };
  }
}

export function renderPaths(projectId: string, version: number) {
  const base = `${projectId}/v${version}`;
  return { reel: `${base}/reel.mp4`, preview: `${base}/preview.mp4`, thumbnail: `${base}/thumbnail.jpg`, srt: `${base}/reel.srt` };
}
