import { MusicMoodSchema, type EditPlan, type MusicMood, type Storyboard, type Timeline } from "@reel/core";
import type { Database, Json, ProjectStatus } from "@reel/db";
import type { SupabaseClient } from "@supabase/supabase-js";

export type StoryboardRecord = { id: string; projectId: string; version: number; json: unknown; status: "draft" | "approved" | "superseded" };
export type SoulCharacter = { id: string; name: string; referenceId: string };
export type TeamTrack = { id: string; storagePath: string; title: string; mood: MusicMood; durationSec: number };

export interface ReelDb {
  nextStoryboardVersion(projectId: string): Promise<number>;
  insertStoryboard(input: { projectId: string; version: number; json: Storyboard | EditPlan; createdBy: "agent" | "user" }): Promise<string>;
  /** Marks this project's drafts superseded, except `keepId` (the draft that replaces them). Re-plan keeps them for history. */
  supersedeDrafts(projectId: string, keepId: string): Promise<void>;
  listTeamMusic(): Promise<TeamTrack[]>;
  getTeamTrack(id: string): Promise<TeamTrack | null>;
  getStoryboard(id: string): Promise<StoryboardRecord | null>;
  getCharacter(id: string): Promise<SoulCharacter | null>;
  setProjectStatus(projectId: string, status: ProjectStatus, title?: string): Promise<void>;
  hasRender(storyboardId: string): Promise<boolean>;
  insertRender(input: {
    projectId: string;
    storyboardId: string;
    storyboardVersion: number;
    paths: { reel: string; preview: string; thumbnail: string; srt: string };
    timeline: Timeline;
  }): Promise<void>;
}

const TRACK_COLUMNS = "id, storage_path, title, mood, duration_sec";
const toTrack = (r: { id: string; storage_path: string; title: string; mood: string; duration_sec: number }): TeamTrack => ({
  id: r.id, storagePath: r.storage_path, title: r.title, mood: MusicMoodSchema.parse(r.mood), durationSec: Number(r.duration_sec),
});

const check = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what} failed: ${error.message}`);
};

export class SupabaseReelDb implements ReelDb {
  constructor(private readonly sb: SupabaseClient<Database>) {}

  async nextStoryboardVersion(projectId: string) {
    const { data, error } = await this.sb.from("storyboards").select("version").eq("project_id", projectId)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    check("storyboard version lookup", error);
    return (data?.version ?? 0) + 1;
  }

  async insertStoryboard(input: Parameters<ReelDb["insertStoryboard"]>[0]) {
    const { data, error } = await this.sb.from("storyboards").insert({
      project_id: input.projectId, version: input.version, json: input.json as unknown as Json, status: "draft", created_by: input.createdBy,
    }).select("id").single();
    check("storyboard insert", error);
    return data!.id;
  }

  async getStoryboard(id: string) {
    const { data, error } = await this.sb.from("storyboards").select("id, project_id, version, json, status").eq("id", id).maybeSingle();
    check("storyboard lookup", error);
    return data ? { id: data.id, projectId: data.project_id, version: data.version, json: data.json, status: data.status as StoryboardRecord["status"] } : null;
  }

  async getCharacter(id: string) {
    const { data, error } = await this.sb.from("soul_characters").select("id, name, reference_id").eq("id", id).maybeSingle();
    check("character lookup", error);
    return data ? { id: data.id, name: data.name, referenceId: data.reference_id } : null;
  }

  async supersedeDrafts(projectId: string, keepId: string) {
    const { error } = await this.sb.from("storyboards").update({ status: "superseded" }).eq("project_id", projectId).eq("status", "draft").neq("id", keepId);
    check("supersede drafts", error);
  }

  async listTeamMusic() {
    const { data, error } = await this.sb.from("team_music").select(TRACK_COLUMNS).order("created_at");
    check("music list", error);
    return (data ?? []).map(toTrack);
  }

  async getTeamTrack(id: string) {
    const { data, error } = await this.sb.from("team_music").select(TRACK_COLUMNS).eq("id", id).maybeSingle();
    check("music lookup", error);
    return data ? toTrack(data) : null;
  }

  async setProjectStatus(projectId: string, status: ProjectStatus, title?: string) {
    const { error } = await this.sb.from("projects").update({ status, ...(title ? { title: title.slice(0, 120) } : {}) }).eq("id", projectId);
    check("project status update", error);
  }

  async hasRender(storyboardId: string) {
    const { count, error } = await this.sb.from("renders").select("id", { count: "exact", head: true }).eq("storyboard_id", storyboardId);
    check("render lookup", error);
    return (count ?? 0) > 0;
  }

  async insertRender(input: Parameters<ReelDb["insertRender"]>[0]) {
    const { error } = await this.sb.from("renders").insert({
      project_id: input.projectId,
      storyboard_id: input.storyboardId,
      storyboard_version: input.storyboardVersion,
      reel_path: input.paths.reel,
      preview_path: input.paths.preview,
      thumbnail_path: input.paths.thumbnail,
      srt_path: input.paths.srt,
      timeline: input.timeline as unknown as Json,
    });
    check("render insert", error);
  }
}
