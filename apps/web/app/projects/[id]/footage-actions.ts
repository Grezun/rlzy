"use server";
import type { EditPlan } from "@reel/core";
import { IngestFootageJobPayloadSchema, type ProjectStatus } from "@reel/db";
import { approvePlan, newPlanVersion, replan, retryFootageGenerate, retryIngest, savePlan, type PlanWriteDeps } from "@/lib/approve-plan";
import { insertJob, runProjectAction, storyboardDeps } from "@/lib/storyboard-deps";
import { loadTranscript } from "@/lib/transcript";

type Client = Parameters<typeof storyboardDeps>[0];

function deps(sb: Client): PlanWriteDeps {
  const { queueGenerate: _viaQueueJob, ...base } = storyboardDeps<EditPlan>(sb, "generate_footage");
  return {
    ...base,
    queueJob: (projectId, type, payload) => insertJob(sb, projectId, type, payload),
    loadWords: async (hash) => (await loadTranscript(sb, hash)).words,
    async ingestPayload(projectId) {
      const { data, error } = await sb.from("jobs").select("payload").eq("project_id", projectId).eq("type", "ingest_footage").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(`job lookup: ${error.message}`);
      const parsed = IngestFootageJobPayloadSchema.safeParse(data?.payload);
      return parsed.success ? parsed.data : null;
    },
    async getCharacter(id) {
      const { data, error } = await sb.from("soul_characters").select("id, name").eq("id", id).maybeSingle();
      if (error) throw new Error(`character lookup: ${error.message}`);
      return data;
    },
    async projectStatus(projectId) {
      const { data, error } = await sb.from("projects").select("status").eq("id", projectId).maybeSingle();
      if (error) throw new Error(`project lookup: ${error.message}`);
      return (data?.status as ProjectStatus | undefined) ?? null;
    },
  };
}

export async function savePlanAction(projectId: string, storyboardId: string, json: unknown) {
  return runProjectAction(projectId, deps, (d) => savePlan(d, { projectId, storyboardId, json }));
}
export async function approvePlanAction(projectId: string, storyboardId: string, json: unknown) {
  return runProjectAction(projectId, deps, (d) => approvePlan(d, { projectId, storyboardId, json }));
}
export async function replanAction(projectId: string, storyboardId: string, instruction: string) {
  return runProjectAction(projectId, deps, (d) => replan(d, { projectId, storyboardId, instruction: String(instruction ?? "") }));
}
export async function retryIngestAction(projectId: string) {
  return runProjectAction(projectId, deps, (d) => retryIngest(d, { projectId }));
}
export async function retryFootageGenerateAction(projectId: string, storyboardId: string) {
  return runProjectAction(projectId, deps, (d) => retryFootageGenerate(d, { projectId, storyboardId }));
}
export async function newPlanVersionAction(projectId: string, storyboardId: string) {
  return runProjectAction(projectId, deps, (d) => newPlanVersion(d, { projectId, storyboardId }));
}
