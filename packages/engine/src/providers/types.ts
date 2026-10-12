import type { Language, Storyboard, Transcript, Word } from "@reel/core";

export type GenResult = { url: string; requestId: string };

export interface ImageGen {
  readonly model: string;
  generate(req: { prompt: string; resumeKey?: string }): Promise<GenResult>;
}

export interface VideoGen {
  readonly model: string;
  readonly resolution: string;
  imageToVideo(req: { imageUrl: string; prompt: string; durationSec: number; resumeKey?: string }): Promise<GenResult>;
}

export interface MediaUploader {
  /** Uploads bytes and returns a public HTTPS URL a provider can read. */
  upload(data: Buffer, contentType: string): Promise<string>;
}

export type VoiceRequest = { text: string; voiceId: string; modelId: string; language: Language; stability?: number; style?: number };
export type VoiceResult = { audio: Buffer; ext: "mp3" | "wav"; words: Word[]; requestId?: string; timingSource: "alignment" | "transcription" };

export interface VoiceGen {
  synthesize(req: VoiceRequest): Promise<VoiceResult>;
}

export type PlanRequest = {
  brief: string;
  language: Language;
  targetDurationSec: 15 | 30 | 45 | 60;
  pacing: "calm" | "punchy";
  captionPreset: "bold_pop" | "clean";
  palette: string[];
  voice: { voiceId: string; modelId: string };
  /** Present for style reels: the filled style template, its engine notes and the user's exact script (if any). */
  style?: { name: string; brief: string; engineNotes: string[]; script?: string };
};

export interface Planner {
  plan(req: PlanRequest): Promise<Storyboard>;
}

export interface Transcriber {
  /** Part of every transcript cache key, so fake and real transcripts never share one. */
  readonly model: string;
  transcribe(audioPath: string): Promise<{ transcript: Transcript; requestId?: string }>;
}

export interface MusicGen {
  readonly model: string;
  compose(req: { prompt: string; durationMs: number }): Promise<{ audio: Buffer; ext: "mp3" | "wav" }>;
}

export type Providers = { image: ImageGen; video: VideoGen; uploader: MediaUploader; voice: VoiceGen; transcriber: Transcriber; music: MusicGen };
