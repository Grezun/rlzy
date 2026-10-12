"use server";
import type { FootageSettings } from "@reel/core";
import { BUCKETS } from "@reel/db";
import { finishFootage, startFootage, type FootageDeps } from "@/lib/create-footage";
import { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;
type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; errors: string[] };

function deps(sb: Client): FootageDeps {
  return {
    async insertProject(input) {
      const { data, error } = await sb.from("projects").insert({ title: input.title, language: input.language, format: "footage", status: "uploading" }).select("id").single();
      return error || !data ? { error: error?.message ?? "unknown error" } : { id: data.id };
    },
    async getProject(id) {
      const { data, error } = await sb.from("projects").select("status, format").eq("id", id).maybeSingle();
      if (error) throw new Error(`Couldn't read the reel: ${error.message}`);
      return data;
    },
    async objectExists(path) {
      // exists() returns data false (with its 400/404 error) only for a missing object; any other failure throws,
      // and the actions below turn it into a message.
      const { data } = await sb.storage.from(BUCKETS.assets).exists(path);
      return data === true;
    },
    async insertIngestJob(projectId, payload) {
      const { error } = await sb.from("jobs").insert({ project_id: projectId, type: "ingest_footage", payload });
      return error ? { error: error.message, code: error.code } : { ok: true };
    },
    async setStatus(projectId, status) {
      const { error } = await sb.from("projects").update({ status }).eq("id", projectId);
      if (error) throw new Error(error.message);
    },
  };
}

async function signedIn() {
  const sb = await createClient();
  const { data } = await sb.auth.getClaims();
  return data?.claims ? sb : null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const expired = { ok: false as const, errors: ["Your session expired. Sign in again."] };

export async function startFootageUpload(input: { settings: FootageSettings; fileName: string; size: number; durationSec: number | null }): Promise<ActionResult<{ projectId: string; storagePath: string }>> {
  const sb = await signedIn();
  if (!sb) return expired;
  try {
    return await startFootage(deps(sb), input);
  } catch (err) {
    return { ok: false, errors: [`Couldn't create the reel: ${message(err)}`] };
  }
}

export async function finishFootageUpload(input: { projectId: string; storagePath: string; settings: FootageSettings }): Promise<ActionResult> {
  const sb = await signedIn();
  if (!sb) return expired;
  try {
    return await finishFootage(deps(sb), input);
  } catch (err) {
    return { ok: false, errors: [message(err)] };
  }
}
