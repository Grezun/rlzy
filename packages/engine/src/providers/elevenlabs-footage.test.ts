import { ElevenLabsError } from "@elevenlabs/elevenlabs-js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ElevenLabsMusic, ScribeTranscriber, scribeToTranscript, type ElevenLabsFootageApi } from "./elevenlabs";

const noSleep = { sleep: async () => {} };
const RES = {
  languageCode: "heb",
  languageProbability: 0.97,
  words: [
    { text: "שלום", start: 0.1, end: 0.4, type: "word", logprob: -0.1 },
    { text: " ", start: 0.4, end: 0.5, type: "spacing", logprob: 0 },
    { text: "(laughs)", start: 0.5, end: 0.9, type: "audio_event", logprob: 0 },
    { text: " עולם ", start: 1.0, end: 1.3, type: "word", logprob: -0.2 },
    { text: "x", type: "word", logprob: 0 },
  ],
};

describe("scribeToTranscript", () => {
  it("keeps timed words in order, sets audio events aside and drops spacing", () => {
    expect(scribeToTranscript(RES)).toEqual({
      languageCode: "heb",
      languageProbability: 0.97,
      words: [{ text: "שלום", startMs: 100, endMs: 400, logprob: -0.1 }, { text: "עולם", startMs: 1000, endMs: 1300, logprob: -0.2 }],
      events: [{ text: "(laughs)", startMs: 500, endMs: 900 }],
    });
  });
});

describe("ScribeTranscriber", () => {
  it("sends the wav and retries a 429", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scribe-"));
    await writeFile(join(dir, "a.wav"), "wav");
    let calls = 0;
    const api: ElevenLabsFootageApi = {
      scribe: vi.fn(async () => {
        if (++calls === 1) throw new ElevenLabsError({ message: "rate limited", statusCode: 429 });
        return RES;
      }),
      music: vi.fn(),
    };
    const t = new ScribeTranscriber(api, noSleep);
    expect(t.model).toBe("elevenlabs/scribe_v2");
    const { transcript } = await t.transcribe(join(dir, "a.wav"));
    expect(transcript.words).toHaveLength(2);
    expect(api.scribe).toHaveBeenCalledWith(expect.any(Buffer), "audio/wav");
    expect(calls).toBe(2);
  });
});

describe("ElevenLabsMusic", () => {
  it("clamps the length to 3–600 s and forwards the prompt", async () => {
    const api: ElevenLabsFootageApi = { scribe: vi.fn(), music: vi.fn(async () => Buffer.from("mp3")) };
    const m = new ElevenLabsMusic(api, noSleep);
    await m.compose({ prompt: "calm lo-fi", durationMs: 1200 });
    await m.compose({ prompt: "calm lo-fi", durationMs: 700_000 });
    expect(vi.mocked(api.music).mock.calls).toEqual([["calm lo-fi", 3000], ["calm lo-fi", 600_000]]);
    expect(m.model).toBe("elevenlabs/music");
  });
  it("rejects empty audio", async () => {
    const api: ElevenLabsFootageApi = { scribe: vi.fn(), music: async () => Buffer.alloc(0) };
    await expect(new ElevenLabsMusic(api, noSleep).compose({ prompt: "x", durationMs: 5000 })).rejects.toThrow(/empty music/);
  });
  it("never retries a 5xx (generation may already be billed): exactly one call", async () => {
    const api: ElevenLabsFootageApi = { scribe: vi.fn(), music: vi.fn(async () => { throw new ElevenLabsError({ message: "gateway timeout", statusCode: 504 }); }) };
    await expect(new ElevenLabsMusic(api, noSleep).compose({ prompt: "x", durationMs: 5000 })).rejects.toThrow(/gateway timeout/);
    expect(api.music).toHaveBeenCalledTimes(1);
  });
  it("never retries a dropped connection: exactly one call", async () => {
    const api: ElevenLabsFootageApi = { scribe: vi.fn(), music: vi.fn(async () => { throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }); }) };
    await expect(new ElevenLabsMusic(api, noSleep).compose({ prompt: "x", durationMs: 5000 })).rejects.toThrow(/socket hang up/);
    expect(api.music).toHaveBeenCalledTimes(1);
  });
  it("still retries a 429 (request not served)", async () => {
    let calls = 0;
    const api: ElevenLabsFootageApi = {
      scribe: vi.fn(),
      music: vi.fn(async () => {
        if (++calls === 1) throw new ElevenLabsError({ message: "rate limited", statusCode: 429 });
        return Buffer.from("mp3");
      }),
    };
    await new ElevenLabsMusic(api, noSleep).compose({ prompt: "x", durationMs: 5000 });
    expect(api.music).toHaveBeenCalledTimes(2);
  });
});
