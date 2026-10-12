import { createFakeProviders, FileAssetStore, generateAssets, serveDir, type PlanRequest } from "@reel/engine";
import { sha256File } from "@reel/media";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MirroredAssetStore, SupabaseBlobStore } from "./storage";
import { InMemoryAssetIndex, InMemoryBlobStore } from "./testing/fakes";

const HASH = "a".repeat(64);
const meta = { kind: "audio" as const, provider: "elevenlabs", model: "eleven_v4", requestId: "r1", estUsd: 0.01, extra: { words: [{ text: "hi", startMs: 0, endMs: 100 }] } };

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "mirror-"));
  const src = join(dir, "voice.wav");
  await writeFile(src, "wav-bytes");
  return { dir, src, blobs: new InMemoryBlobStore(), index: new InMemoryAssetIndex() };
}

describe("MirroredAssetStore", () => {
  it("putFile stores locally, uploads to the assets bucket, then indexes", async () => {
    const { dir, src, blobs, index } = await setup();
    const store = new MirroredAssetStore(new FileAssetStore(join(dir, "a")), blobs, index);
    const stored = await store.putFile(HASH, src, "wav", meta);
    expect(stored.fileName).toBe(`${HASH}.wav`);
    expect(blobs.objects.get(`assets/${HASH}.wav`)?.toString()).toBe("wav-bytes");
    expect(index.records.get(HASH)).toMatchObject({
      inputHash: HASH, kind: "audio", fileName: `${HASH}.wav`, storagePath: `${HASH}.wav`, provider: "elevenlabs", model: "eleven_v4", requestId: "r1",
      meta: { estUsd: 0.01, extra: meta.extra },
    });
  });

  it("a local hit checks the index once per process", async () => {
    const { dir, src, blobs, index } = await setup();
    const store = new MirroredAssetStore(new FileAssetStore(join(dir, "a")), blobs, index);
    await store.putFile(HASH, src, "wav", meta);
    index.finds = 0;
    expect(await store.get(HASH)).not.toBeNull();
    expect(await store.get(HASH)).not.toBeNull();
    expect(index.finds).toBe(0);
  });

  it("heals an asset whose upload failed", async () => {
    const { dir, src, blobs, index } = await setup();
    let failed = false;
    const flaky = {
      upload: async (...a: Parameters<InMemoryBlobStore["upload"]>) => {
        if (!failed) {
          failed = true;
          throw new Error("storage down");
        }
        return blobs.upload(...a);
      },
      download: (...a: Parameters<InMemoryBlobStore["download"]>) => blobs.download(...a),
    };
    const store = new MirroredAssetStore(new FileAssetStore(join(dir, "a")), flaky, index);
    await expect(store.putFile(HASH, src, "wav", meta)).rejects.toThrow(/storage down/);
    expect(await store.get(HASH)).not.toBeNull();
    expect(blobs.objects.get(`assets/${HASH}.wav`)?.toString()).toBe("wav-bytes");
    expect(index.records.has(HASH)).toBe(true);
    const finds = index.finds;
    await store.get(HASH);
    expect(index.finds).toBe(finds);
  });

  it("backfills an asset cached locally before mirroring", async () => {
    const { dir, src, blobs, index } = await setup();
    await new FileAssetStore(join(dir, "a")).putFile(HASH, src, "wav", meta);
    const store = new MirroredAssetStore(new FileAssetStore(join(dir, "a")), blobs, index);
    expect(await store.get(HASH)).not.toBeNull();
    expect(blobs.objects.has(`assets/${HASH}.wav`)).toBe(true);
    expect(index.records.has(HASH)).toBe(true);
  });

  it("a mirror failure on read still returns the local asset", async () => {
    const { dir, src, index } = await setup();
    await new FileAssetStore(join(dir, "a")).putFile(HASH, src, "wav", meta);
    const broken = { upload: async () => { throw new Error("nope"); }, download: async () => { throw new Error("nope"); } };
    const logs: string[] = [];
    const store = new MirroredAssetStore(new FileAssetStore(join(dir, "a")), broken, index, (m) => logs.push(m));
    expect(await store.get(HASH)).not.toBeNull();
    expect(logs.join("\n")).toMatch(/mirror failed/);
  });

  it("restores an asset made on another machine from Storage, metadata included", async () => {
    const { dir, src, blobs, index } = await setup();
    await new MirroredAssetStore(new FileAssetStore(join(dir, "machineA")), blobs, index).putFile(HASH, src, "wav", meta);
    const b = new MirroredAssetStore(new FileAssetStore(join(dir, "machineB")), blobs, index);
    const restored = await b.get(HASH);
    expect(restored).toMatchObject({ hash: HASH, fileName: `${HASH}.wav`, meta: { kind: "audio", provider: "elevenlabs", extra: meta.extra } });
    expect((await readFile(restored!.path)).toString()).toBe("wav-bytes");
  });

  it("returns null when the index has no record", async () => {
    const { dir, blobs, index } = await setup();
    expect(await new MirroredAssetStore(new FileAssetStore(join(dir, "a")), blobs, index).get(HASH)).toBeNull();
  });

  it("returns null (and logs) when the indexed object is missing from Storage", async () => {
    const { dir, src, blobs, index } = await setup();
    await new MirroredAssetStore(new FileAssetStore(join(dir, "a")), blobs, index).putFile(HASH, src, "wav", meta);
    blobs.objects.clear();
    const logs: string[] = [];
    const b = new MirroredAssetStore(new FileAssetStore(join(dir, "b")), blobs, index, (m) => logs.push(m));
    expect(await b.get(HASH)).toBeNull();
    expect(logs.join("\n")).toMatch(/restore failed/);
  });

  it("a second machine regenerates nothing for the same storyboard", async () => {
    const { dir, blobs, index } = await setup();
    const providers = createFakeProviders({ workDir: dir });
    const req: PlanRequest = { brief: "3 tips", language: "he", targetDurationSec: 15, pacing: "punchy", captionPreset: "bold_pop", palette: ["#FFE14D", "#111111"], voice: { voiceId: "fake-voice", modelId: "eleven_v4" } };
    const sb = await providers.planner.plan(req);
    const log = () => {};
    await generateAssets(sb, { providers, store: new MirroredAssetStore(new FileAssetStore(join(dir, "A")), blobs, index), tmpDir: join(dir, "tA"), log });
    const before = { ...providers.calls };
    await generateAssets(sb, { providers, store: new MirroredAssetStore(new FileAssetStore(join(dir, "B")), blobs, index), tmpDir: join(dir, "tB"), log });
    expect(providers.calls).toEqual(before);
  }, 300_000);
});

describe("SupabaseBlobStore.download", () => {
  const stub = (signedUrl: string) =>
    ({ storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl }, error: null }) }) } }) as never;

  it("streams a large object from a signed URL to disk, byte for byte", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blob-dl-"));
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src", "big.bin"), randomBytes(5 * 1024 * 1024));
    const server = await serveDir(join(dir, "src"));
    try {
      await new SupabaseBlobStore(stub(server.urlFor("big.bin"))).download("assets", "footage/x/source.mp4", join(dir, "copy.bin"));
      expect(await sha256File(join(dir, "copy.bin"))).toBe(await sha256File(join(dir, "src", "big.bin")));
    } finally {
      await server.close();
    }
  });

  it("fails with the HTTP status and without the signed token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blob-dl-"));
    const server = await serveDir(dir);
    try {
      const store = new SupabaseBlobStore(stub(`${server.urlFor("missing.bin")}?token=secret`));
      const err = await store.download("assets", "footage/x/source.mp4", join(dir, "copy.bin")).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/download assets\/footage\/x\/source\.mp4 failed: HTTP 404/);
      expect((err as Error).message).not.toMatch(/secret/);
    } finally {
      await server.close();
    }
  });
});

describe("SupabaseBlobStore.upload", () => {
  it("streams the file from disk with its length (supabase-js sends a stream body, never a buffer)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "blob-up-"));
    const file = join(dir, "working.mp4");
    await writeFile(file, randomBytes(3 * 1024 * 1024 + 7));
    const received: { url: string; length?: string; type?: string; sha: string }[] = [];
    const server = createServer((req, res) => {
      const hash = createHash("sha256");
      req.on("data", (c: Buffer) => hash.update(c));
      req.on("end", () => {
        received.push({ url: req.url ?? "", length: req.headers["content-length"], type: req.headers["content-type"], sha: hash.digest("hex") });
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ Key: "assets/x", Id: "1" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const bodies: unknown[] = [];
    const spyFetch: typeof fetch = (input, init) => {
      bodies.push(init?.body);
      return fetch(input, init);
    };
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const sb = createClient(url, "test-key", { global: { fetch: spyFetch }, auth: { persistSession: false, autoRefreshToken: false } });
      await new SupabaseBlobStore(sb as never).upload("assets", "abc.mp4", file, "video/mp4");
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toBeInstanceOf(ReadableStream);
      expect(received).toEqual([{ url: "/storage/v1/object/assets/abc.mp4", length: String(3 * 1024 * 1024 + 7), type: "video/mp4", sha: await sha256File(file) }]);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

describe("MirroredAssetStore best-effort mirroring", () => {
  const failing = (blobs: InMemoryBlobStore) => ({
    upload: async () => { throw new Error("object too large"); },
    download: (...a: Parameters<InMemoryBlobStore["download"]>) => blobs.download(...a),
  });

  it("keeps a reproducible asset locally and logs when its mirror fails", async () => {
    const { dir, src, blobs, index } = await setup();
    const logs: string[] = [];
    const store = new MirroredAssetStore(new FileAssetStore(join(dir, "a")), failing(blobs), index, (m) => logs.push(m));
    const stored = await store.putFile(HASH, src, "mp4", { kind: "video", provider: "ffmpeg", reproducible: true });
    expect(await readFile(stored.path, "utf8")).toBe("wav-bytes");
    expect(index.records.has(HASH)).toBe(false);
    expect(logs.join("\n")).toMatch(new RegExp(`mirror failed for ${HASH}.*object too large.*kept locally`));
  });

  it("still fails when a non-reproducible asset can't be mirrored", async () => {
    const { dir, src, blobs, index } = await setup();
    const store = new MirroredAssetStore(new FileAssetStore(join(dir, "a")), failing(blobs), index);
    await expect(store.putFile(HASH, src, "data", { kind: "data", provider: "elevenlabs" })).rejects.toThrow(/object too large/);
  });
});
