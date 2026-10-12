import { describe, expect, it, vi } from "vitest";
import { finishFootage, footageTitle, startFootage, type FootageDeps } from "./create-footage";

const ID = "0b5f8f9e-5c1d-4a43-9d4e-2f1c3b4a5d6e";
const settings = { language: "he" as const, targetDurationSec: 30 as const };
const deps = (over: Partial<FootageDeps> = {}): FootageDeps => ({
  insertProject: vi.fn(async () => ({ id: ID })),
  getProject: vi.fn(async () => ({ status: "uploading", format: "footage" })),
  objectExists: vi.fn(async () => true),
  insertIngestJob: vi.fn(async () => ({ ok: true as const })),
  setStatus: vi.fn(async () => {}),
  ...over,
});

describe("startFootage", () => {
  it("creates an uploading footage project and returns its storage path", async () => {
    const d = deps();
    expect(await startFootage(d, { settings, fileName: "My Talk.MOV", size: 1000, durationSec: 95 })).toEqual({ ok: true, projectId: ID, storagePath: `footage/${ID}/source.mov` });
    expect(d.insertProject).toHaveBeenCalledWith({ title: "My Talk", language: "he" });
  });
  it("re-checks the file on the server and creates nothing when it fails", async () => {
    const d = deps();
    expect(await startFootage(d, { settings, fileName: "x.avi", size: 1000, durationSec: 200 })).toEqual({ ok: false, errors: ["Upload an MP4 or MOV video.", "This video is 3:20 long. Trim it to 3:00 or less."] });
    expect(d.insertProject).not.toHaveBeenCalled();
  });
  it("refuses invalid settings", async () => {
    const d = deps();
    const r = await startFootage(d, { settings: { language: "fr" } as never, fileName: "a.mp4", size: 1000, durationSec: 10 });
    expect(r.ok).toBe(false);
    expect(d.insertProject).not.toHaveBeenCalled();
  });
  it("titles from the file name", () => {
    expect(footageTitle(".mp4")).toBe("My video");
    expect(footageTitle(`${"א".repeat(200)}.mp4`)).toHaveLength(120);
  });
});

describe("finishFootage", () => {
  const input = { projectId: ID, storagePath: `footage/${ID}/source.mov`, settings };
  it("queues ingest and moves the project to planning", async () => {
    const d = deps();
    expect(await finishFootage(d, input)).toEqual({ ok: true });
    expect(d.insertIngestJob).toHaveBeenCalledWith(ID, { storagePath: input.storagePath, settings });
    expect(d.setStatus).toHaveBeenCalledWith(ID, "planning");
  });
  it("says the video is queued when only the status update fails", async () => {
    const d = deps({ setStatus: async () => { throw new Error("timeout"); } });
    const r = await finishFootage(d, input);
    expect(r.ok).toBe(false);
    expect(r).toEqual({ ok: false, errors: [expect.stringMatching(/queued, but .*timeout/)], queued: true });
  });
  it.each([
    ["another project's path", { storagePath: "footage/11111111-2222-4333-8444-555555555555/source.mov" }, deps(), /doesn't belong to this reel/],
    ["a project already submitted", {}, deps({ getProject: async () => ({ status: "planning", format: "footage" }) }), /already submitted/],
    ["an unfinished upload", {}, deps({ objectExists: async () => false }), /didn't finish/],
    ["an active job", {}, deps({ insertIngestJob: async () => ({ error: "dup", code: "23505" }) }), /already queued or running/],
  ] as const)("refuses %s", async (_n, over, d, message) => {
    const r = await finishFootage(d, { ...input, ...over });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(message);
    // Only a job that already exists makes a retry pointless.
    if (!r.ok) expect(r.queued ?? false).toBe(/submitted|queued/.test(String(message)));
  });
});
