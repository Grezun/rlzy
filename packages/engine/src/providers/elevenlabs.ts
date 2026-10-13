import { ElevenLabsClient, ElevenLabsError } from "@elevenlabs/elevenlabs-js";
import { alignmentToWords, MUSIC_MAX_MS, MUSIC_MIN_MS, PermanentProviderError, TranscriptSchema, type CharacterAlignment, type Transcript, type Word } from "@reel/core";
import { readFile } from "node:fs/promises";
import { contentTypeFor } from "../download";
import { withRetry } from "../retry";
import type { MusicGen, Transcriber, VoiceGen, VoiceRequest, VoiceResult } from "./types";

export type TtsBody = {
  text: string;
  modelId: string;
  languageCode: string;
  outputFormat: "mp3_44100_128";
  voiceSettings?: { stability?: number; style?: number };
};

export type ElevenLabsApi = {
  tts(voiceId: string, body: TtsBody): Promise<{ audioBase64: string; alignment?: CharacterAlignment | null }>;
  stt(audio: Buffer, languageCode: string): Promise<Word[]>;
};

export function sdkElevenLabs(apiKey: string): ElevenLabsApi {
  const client = new ElevenLabsClient({ apiKey });
  return {
    tts: async (voiceId, body) => await client.textToSpeech.convertWithTimestamps(voiceId, body),
    stt: async (audio, languageCode) => {
      const res = await client.speechToText.convert({
        modelId: "scribe_v2",
        file: new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }),
        languageCode,
        timestampsGranularity: "word",
      });
      if (!("words" in res)) throw new Error("Unexpected speech-to-text response (no words)");
      return res.words
        .filter((w) => w.type === "word" && w.start !== undefined && w.end !== undefined)
        .map((w) => ({ text: w.text.trim(), startMs: Math.round(w.start! * 1000), endMs: Math.round(w.end! * 1000) }))
        .filter((w) => w.text.length > 0);
    },
  };
}

const NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "EPIPE"]);

export function isTransientElevenLabsError(err: unknown): boolean {
  if (err instanceof ElevenLabsError) {
    // If statusCode is undefined, the error wraps a network/fetch failure; check the cause
    if (err.statusCode === undefined) {
      return NETWORK_CODES.has((err.cause as { code?: string } | undefined)?.code ?? "");
    }
    // Otherwise, retry only on rate limit (429) or server errors (5xx)
    return err.statusCode === 429 || err.statusCode >= 500;
  }
  return NETWORK_CODES.has((err as { code?: string } | null)?.code ?? "");
}

export class ElevenLabsVoice implements VoiceGen {
  constructor(private readonly api: ElevenLabsApi, private readonly opts: { sleep?: (ms: number) => Promise<void> } = {}) {}

  async synthesize(req: VoiceRequest): Promise<VoiceResult> {
    const retry = { attempts: 3, baseDelayMs: 2000, isTransient: isTransientElevenLabsError, sleep: this.opts.sleep };
    const body: TtsBody = {
      text: req.text,
      modelId: req.modelId, // always explicit: the API default model has no Hebrew
      languageCode: req.language,
      outputFormat: "mp3_44100_128",
    };
    if (req.stability !== undefined || req.style !== undefined) body.voiceSettings = { stability: req.stability, style: req.style };

    const res = await withRetry(() => this.api.tts(req.voiceId, body), retry);
    const audio = Buffer.from(res.audioBase64, "base64");
    if (audio.length === 0) throw new PermanentProviderError("ElevenLabs returned empty audio", "elevenlabs");

    if (res.alignment && res.alignment.characters.length > 0) {
      return { audio, ext: "mp3", words: alignmentToWords(res.alignment), timingSource: "alignment" };
    }
    const words = await withRetry(() => this.api.stt(audio, req.language), retry);
    if (words.length === 0) throw new PermanentProviderError("ElevenLabs returned no word timings (alignment and transcription both empty)", "elevenlabs");
    return { audio, ext: "mp3", words, timingSource: "transcription" };
  }
}

export type ScribeWord = { text: string; start?: number; end?: number; type: string; logprob?: number };
export type ScribeResult = { languageCode: string; languageProbability: number; words: ScribeWord[] };

/** Kept apart from ElevenLabsApi so the existing voice tests and stubs don't change. */
export type ElevenLabsFootageApi = {
  scribe(audio: Buffer, contentType: string): Promise<ScribeResult>;
  music(prompt: string, lengthMs: number): Promise<Buffer>;
};

export function sdkElevenLabsFootage(apiKey: string): ElevenLabsFootageApi {
  const client = new ElevenLabsClient({ apiKey });
  return {
    scribe: async (audio, contentType) => {
      // No languageCode: Scribe detects the language, which feeds the language-mismatch warning.
      const res = await client.speechToText.convert({
        modelId: "scribe_v2",
        file: new Blob([new Uint8Array(audio)], { type: contentType }),
        timestampsGranularity: "word",
        tagAudioEvents: true,
      });
      if (!("words" in res)) throw new Error("Unexpected speech-to-text response (no words)");
      return { languageCode: res.languageCode, languageProbability: res.languageProbability, words: res.words };
    },
    music: async (prompt, lengthMs) => {
      const stream = await client.music.compose({ prompt, musicLengthMs: lengthMs, forceInstrumental: true });
      return Buffer.from(await new Response(stream).arrayBuffer());
    },
  };
}

const timed = (w: ScribeWord) => w.start !== undefined && w.end !== undefined && w.text.trim().length > 0;
const ms = (s: number) => Math.round(s * 1000);

export function scribeToTranscript(res: ScribeResult): Transcript {
  return TranscriptSchema.parse({
    languageCode: res.languageCode,
    languageProbability: res.languageProbability,
    words: res.words.filter((w) => w.type === "word" && timed(w)).map((w) => ({ text: w.text.trim(), startMs: ms(w.start!), endMs: ms(w.end!), ...(w.logprob !== undefined ? { logprob: w.logprob } : {}) })),
    events: res.words.filter((w) => w.type === "audio_event" && timed(w)).map((w) => ({ text: w.text.trim(), startMs: ms(w.start!), endMs: ms(w.end!) })),
  });
}

type RetryOpts = { sleep?: (ms: number) => Promise<void> };
const retryWith = (opts: RetryOpts) => ({ attempts: 3, baseDelayMs: 2000, isTransient: isTransientElevenLabsError, sleep: opts.sleep });

export class ScribeTranscriber implements Transcriber {
  readonly model = "elevenlabs/scribe_v2";
  constructor(private readonly api: ElevenLabsFootageApi, private readonly opts: RetryOpts = {}) {}
  async transcribe(audioPath: string) {
    const audio = await readFile(audioPath);
    const res = await withRetry(() => this.api.scribe(audio, contentTypeFor(audioPath)), retryWith(this.opts));
    return { transcript: scribeToTranscript(res) };
  }
}

const isRateLimited = (err: unknown) => err instanceof ElevenLabsError && err.statusCode === 429;

export class ElevenLabsMusic implements MusicGen {
  readonly model = "elevenlabs/music";
  constructor(private readonly api: ElevenLabsFootageApi, private readonly opts: RetryOpts = {}) {}
  async compose({ prompt, durationMs }: { prompt: string; durationMs: number }) {
    const lengthMs = Math.min(MUSIC_MAX_MS, Math.max(MUSIC_MIN_MS, Math.round(durationMs)));
    // Music is paid per generation: a 5xx or dropped connection may arrive after it was billed,
    // so only a 429 (request not served) is retried. Everything else fails after one call.
    const audio = await withRetry(() => this.api.music(prompt, lengthMs), { ...retryWith(this.opts), isTransient: isRateLimited });
    if (audio.length === 0) throw new PermanentProviderError("ElevenLabs returned empty music", "elevenlabs");
    return { audio, ext: "mp3" as const };
  }
}
