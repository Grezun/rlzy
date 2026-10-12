import { describe, expect, it, vi } from "vitest";
import { projectStatusLabel, storageEndpoint, tusUploadOptions, uploadFootageFile, uploadIncomplete } from "./footage-upload";

const tusMock = vi.hoisted(() => ({ previous: [] as { metadata: Record<string, string> }[], resumed: [] as unknown[], started: 0 }));
vi.mock("tus-js-client", () => ({
  Upload: class {
    constructor(_file: unknown, private options: { onSuccess: () => void }) {}
    findPreviousUploads = async () => tusMock.previous;
    resumeFromPreviousUpload = (p: unknown) => tusMock.resumed.push(p);
    start = () => { tusMock.started++; this.options.onSuccess(); };
  },
}));

describe("storageEndpoint", () => {
  it("uses the direct storage host for hosted projects", () => {
    expect(storageEndpoint("https://abcd.supabase.co")).toBe("https://abcd.storage.supabase.co/storage/v1/upload/resumable");
    expect(storageEndpoint("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321/storage/v1/upload/resumable");
  });
});

describe("tusUploadOptions", () => {
  it("sends 6 MB chunks with the bucket metadata and a fresh token on every request", async () => {
    const tokens = ["t1", "t2"];
    const progress: number[] = [];
    const o = tusUploadOptions({
      supabaseUrl: "https://abcd.supabase.co", bucket: "assets", objectName: "footage/x/source.mov", contentType: "video/quicktime",
      getToken: async () => tokens.shift()!, onProgress: (f) => progress.push(f),
    });
    expect(o.chunkSize).toBe(6 * 1024 * 1024);
    expect(o.metadata).toEqual({ bucketName: "assets", objectName: "footage/x/source.mov", contentType: "video/quicktime", cacheControl: "3600" });
    expect(o.headers).toEqual({ "x-upsert": "true" });
    const set: [string, string][] = [];
    const req = { setHeader: (k: string, v: string) => set.push([k, v]) };
    await o.onBeforeRequest(req);
    await o.onBeforeRequest(req);
    expect(set).toEqual([["authorization", "Bearer t1"], ["authorization", "Bearer t2"]]);
    o.onProgress(50, 200);
    expect(progress).toEqual([0.25]);
    expect(o.retryDelays.length).toBeGreaterThanOrEqual(5);
  });
});

describe("upload status", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  it("calls an uploading project older than 1 hour incomplete", () => {
    expect(uploadIncomplete("2026-10-12T11:30:00Z", now)).toBe(false);
    expect(uploadIncomplete("2026-10-12T10:59:00Z", now)).toBe(true);
    expect(projectStatusLabel({ status: "uploading", format: "footage", created_at: "2026-10-12T10:00:00Z" }, now)).toBe("Upload incomplete");
    expect(projectStatusLabel({ status: "uploading", format: "footage", created_at: "2026-10-12T11:55:00Z" }, now)).toBe("Uploading");
    expect(projectStatusLabel({ status: "draft", format: "footage", created_at: "2026-10-12T10:00:00Z" }, now)).toBe("Awaiting approval");
  });
});

describe("uploadFootageFile", () => {
  it("resumes the earlier attempt to the same object, never one to another reel", async () => {
    const mine = { metadata: { objectName: "footage/b/source.mp4" } };
    tusMock.previous = [{ metadata: { objectName: "footage/a/source.mp4" } }, mine];
    await uploadFootageFile({} as File, {
      supabaseUrl: "https://abcd.supabase.co", bucket: "assets", objectName: "footage/b/source.mp4", contentType: "video/mp4",
      getToken: async () => "t", onProgress: () => {},
    });
    expect(tusMock.resumed).toEqual([mine]);
    expect(tusMock.started).toBe(1);
  });
});
