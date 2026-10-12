import { type Database, type Json, type JobType } from "@reel/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { ACTIVE_JOB_ERROR, type DraftWriteDeps, type Result, type StoryboardRow } from "./approve";
import { createClient } from "./supabase/server";

type Client = SupabaseClient<Database>;

const must = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what}: ${error.message}`);
};

/** Inserts a job; the one-active-job index turns a second one into the plain "already queued" message. */
export async function insertJob(sb: Client, projectId: string, type: JobType, payload: object): Promise<void> {
  const { error } = await sb.from("jobs").insert({ project_id: projectId, type, payload: payload as Json });
  if (error?.code === "23505") throw new Error(ACTIVE_JOB_ERROR);
  must(`queue ${type}`, error);
}

/** Server-side storyboard storage, shared by faceless storyboards and footage edit plans. */
export function storyboardDeps<J>(sb: Client, generateType: "generate" | "generate_footage"): DraftWriteDeps<J> {
  return {
    async getStoryboard(id) {
      const { data, error } = await sb.from("storyboards").select("project_id, version, status, json").eq("id", id).maybeSingle();
      must("storyboard lookup", error);
      return data ? { projectId: data.project_id, version: data.version, status: data.status as StoryboardRow["status"], json: data.json } : null;
    },
    async hasDoneGenerate(storyboardId) {
      const { count, error } = await sb.from("jobs").select("id", { count: "exact", head: true }).in("type", ["generate", "generate_footage"]).eq("status", "done").eq("payload->>storyboardId", storyboardId);
      must("job lookup", error);
      return (count ?? 0) > 0;
    },
    async updateDraft(projectId, id, json, status) {
      const { data, error } = await sb.from("storyboards").update({ json: json as unknown as Json, status }).eq("id", id).eq("project_id", projectId).eq("status", "draft").select("id");
      must("storyboard update", error);
      return data?.length ?? 0;
    },
    async queueGenerate(projectId, storyboardId) {
      await insertJob(sb, projectId, generateType, { storyboardId });
    },
    async setProjectStatus(projectId, status) {
      const { error } = await sb.from("projects").update({ status }).eq("id", projectId);
      must("project status", error);
    },
    async activeJobCount(projectId) {
      const { count, error } = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("project_id", projectId).in("status", ["queued", "running"]);
      must("job lookup", error);
      return count ?? 0;
    },
    async insertDraft(projectId, version, json) {
      const { error } = await sb.from("storyboards").insert({ project_id: projectId, version, json: json as unknown as Json, status: "draft", created_by: "user" });
      if (error) throw new Error(`${error.code}: ${error.message}`);
    },
    async maxVersion(projectId) {
      const { data, error } = await sb.from("storyboards").select("version").eq("project_id", projectId).order("version", { ascending: false }).limit(1).maybeSingle();
      must("version lookup", error);
      return data?.version ?? 0;
    },
  };
}

/** Runs a project action as the signed-in user, turns thrown errors into messages and refreshes the project page. */
export async function runProjectAction<D>(projectId: string, makeDeps: (sb: Client) => D, fn: (deps: D) => Promise<Result>): Promise<Result> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { ok: false, errors: ["Your session expired. Sign in again."] };
  try {
    return await fn(makeDeps(supabase));
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)] };
  } finally {
    revalidatePath(`/projects/${projectId}`);
  }
}
