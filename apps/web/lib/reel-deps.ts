import type { Database } from "@reel/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateReelDeps } from "./create-reel";

export function reelDeps(supabase: SupabaseClient<Database>): CreateReelDeps {
  return {
    async insertProject(input) {
      const { data, error } = await supabase
        .from("projects")
        .insert({ title: input.title, language: input.language, format: "faceless", status: "planning", ...(input.styleId ? { style_id: input.styleId } : {}) })
        .select("id")
        .single();
      if (error || !data) return { error: error?.message ?? "unknown error" };
      return { id: data.id };
    },
    async insertPlanJob(projectId, payload) {
      const { error } = await supabase.from("jobs").insert({ project_id: projectId, type: "plan", payload });
      return error ? { error: error.message, code: error.code } : { ok: true };
    },
    async markProjectFailed(projectId) {
      await supabase.from("projects").update({ status: "failed" }).eq("id", projectId);
    },
  };
}
