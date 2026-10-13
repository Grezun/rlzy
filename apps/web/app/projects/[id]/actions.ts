"use server";
import type { Storyboard } from "@reel/core";
import { approveStoryboard, newDraftFrom, retryGenerate, saveDraft, type StoryboardWriteDeps } from "@/lib/approve";
import { runProjectAction, storyboardDeps } from "@/lib/storyboard-deps";

const deps = (sb: Parameters<typeof storyboardDeps>[0]): StoryboardWriteDeps => storyboardDeps<Storyboard>(sb, "generate");

export async function saveStoryboardAction(projectId: string, storyboardId: string, json: unknown) {
  return runProjectAction(projectId, deps, (d) => saveDraft(d, { projectId, storyboardId, json }));
}
export async function approveStoryboardAction(projectId: string, storyboardId: string, json: unknown) {
  return runProjectAction(projectId, deps, (d) => approveStoryboard(d, { projectId, storyboardId, json }));
}
export async function retryGenerateAction(projectId: string, storyboardId: string) {
  return runProjectAction(projectId, deps, (d) => retryGenerate(d, { projectId, storyboardId }));
}
export async function editAsNewVersionAction(projectId: string, storyboardId: string) {
  return runProjectAction(projectId, deps, (d) => newDraftFrom(d, { projectId, sourceStoryboardId: storyboardId }));
}
