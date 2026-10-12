import { describe, expect, it } from "vitest";
import { footageTranscript } from "../../../packages/core/src/testing/fixtures";
import type { Database } from "@reel/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTranscript } from "./transcript";

const HASH = "b".repeat(64);

function fakeClient(row: { storage_path: string } | null, body: string) {
  const downloaded: string[] = [];
  const fake = {
    from: () => ({
      select: () => ({
        eq: (_col: string, value: string) => ({
          maybeSingle: async () => ({ data: value === HASH ? row : null, error: null }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        download: async (path: string) => {
          downloaded.push(path);
          return { data: new Blob([body]), error: null };
        },
      }),
    },
  };
  return { sb: fake as unknown as SupabaseClient<Database>, downloaded };
}

describe("loadTranscript", () => {
  it("downloads the file the asset index names (a .data file, not <hash>.json)", async () => {
    const { sb, downloaded } = fakeClient({ storage_path: `${HASH}.data` }, JSON.stringify(footageTranscript()));
    expect((await loadTranscript(sb, HASH)).words).toHaveLength(15);
    expect(downloaded).toEqual([`${HASH}.data`]);
  });
  it("says plainly when the transcript was never indexed", async () => {
    const { sb } = fakeClient(null, "");
    await expect(loadTranscript(sb, HASH)).rejects.toThrow(/transcript is missing/);
  });
});
