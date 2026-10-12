export type FieldDef = {
  key: string;
  label: string;
  kind: "line" | "text" | "select";
  required: boolean;
  options?: string[];
  default?: string;
  maxLength: number;
};
export type StyleDef = {
  id: string;
  name: string;
  description: string;
  status: "available" | "coming_soon";
  comingSoonReason?: string;
  fields: FieldDef[];
  scriptVar?: "SCRIPT" | "COPY";
  assetVars: string[];
  titleField?: string;
  engineNotes: string[];
  defaultDurationSec: 15 | 30 | 45 | 60;
};

export const SHARED_VARS = ["LANGUAGE", "DURATION", "DURATION_SECONDS", "ACCENT_COLOR", "VOICE", "VOICE_STYLE"] as const;
export const ASSET_PLACEHOLDER = "not provided (file uploads are not available yet; use generated visuals)";

const line = (key: string, label: string, required = false): FieldDef => ({ key, label, kind: "line", required, maxLength: 2000 });
const text = (key: string, label: string, required = false): FieldDef => ({ key, label, kind: "text", required, maxLength: 2000 });

export const STYLES: StyleDef[] = [
  {
    id: "presenter", name: "Presenter-Led (Avatar)", description: "A presenter speaks to camera, with demonstrations and labels.",
    status: "coming_soon", comingSoonReason: "Needs the talking-avatar feature",
    fields: [line("TOPIC", "Topic", true), line("TARGET_AUDIENCE", "Audience"), text("MAIN_MESSAGE", "Main message", true), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["PRESENTER_REFERENCE", "SUPPORTING_ASSETS"], titleField: "TOPIC", engineNotes: [], defaultDurationSec: 30,
  },
  {
    id: "faceless", name: "Faceless + Voiceover", description: "Voiceover over footage, close-ups and motion graphics. No host.",
    status: "available",
    fields: [line("TOPIC", "Topic", true), line("AUDIENCE", "Audience"), text("MAIN_MESSAGE", "Main takeaway", true), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["IMAGES_VIDEOS_SCREENSHOTS"], titleField: "TOPIC", defaultDurationSec: 30,
    engineNotes: [
      "No people speaking to camera.",
      "Change the visual about every 2-4 seconds, within the scene limits.",
      "Prefer concrete demonstrations; use graphic scenes with an overlay for numbers and key terms.",
    ],
  },
  {
    id: "screen-tutorial", name: "Screen Tutorial", description: "Teach one task with a clear screen demonstration.",
    status: "coming_soon", comingSoonReason: "Needs file uploads",
    fields: [line("TASK", "Task", true), line("APP_OR_WEBSITE", "App or website", true), line("AUDIENCE", "Audience"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["SCREEN_ASSETS"], titleField: "TASK", engineNotes: [], defaultDurationSec: 30,
  },
  {
    id: "product-demo", name: "Product Demonstration", description: "Show how a product solves one clear problem.",
    status: "available",
    fields: [line("PRODUCT", "Product", true), line("AUDIENCE", "Audience"), text("PROBLEM", "Problem", true), text("BENEFIT", "Primary benefit", true), text("VERIFIED_FACTS", "Verified features and claims"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["PRODUCT_ASSETS"], titleField: "PRODUCT", defaultDurationSec: 30,
    engineNotes: [
      "Scene order: problem, product, how it works, benefit, final product shot with the call to action.",
      "Describe the product in visual prompts only as the user described it; never invent logos or packaging details. If no description was given, describe it generically.",
      "Use only claims from the verified features and the primary benefit.",
    ],
  },
  {
    id: "before-after", name: "Before and After", description: "Show a clear transformation and what caused it.",
    status: "available",
    fields: [line("SUBJECT", "Subject", true), text("BEFORE_STATE", "Starting state", true), text("AFTER_STATE", "Final state", true), text("METHOD", "What caused the change", true), text("VERIFIED_DETAILS", "Evidence and context"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["ASSETS"], titleField: "SUBJECT", defaultDurationSec: 30,
    engineNotes: [
      "Scene 1 previews the final result.",
      'Before scenes carry an overlay "לפני" (Hebrew reels) or "Before" (English reels); after scenes carry "אחרי" or "After".',
      'These visuals are generated, not documented: every before or after scene also carries a short overlay "המחשה" (Hebrew) or "Illustration" (English).',
      "Use the same framing words (angle, distance, setting) in matching before and after visual prompts. There is no split-screen; alternate matched shots instead.",
    ],
  },
  {
    id: "mini-story", name: "Mini Story", description: "A short story with a challenge, a turning point and a payoff.",
    status: "available",
    fields: [line("SUBJECT", "Main subject or character", true), line("SETTING", "Setting"), text("CHALLENGE", "Challenge", true), text("TURNING_POINT", "Turning point"), text("RESOLUTION", "Resolution", true), text("TAKEAWAY", "Main takeaway"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["ASSETS"], titleField: "SUBJECT", defaultDurationSec: 30,
    engineNotes: [
      "Follow the five moments of the brief.",
      "Describe the main character identically in every visual prompt (same age, clothing and setting words).",
      "The narration is a narrator's voice; nobody speaks on screen.",
      'If the story is invented, the final scene carries a short overlay "סיפור להמחשה" (Hebrew) or "Illustrative story" (English).',
    ],
  },
  {
    id: "listicle", name: "Listicle", description: "A short numbered list of tips, mistakes, tools or ideas.",
    status: "available",
    fields: [
      line("TOPIC", "Topic", true), line("AUDIENCE", "Audience"),
      { key: "TIPS_MISTAKES_TOOLS_OR_IDEAS", label: "List type", kind: "select", required: true, options: ["tips", "mistakes", "tools", "ideas"], default: "tips", maxLength: 20 },
      { key: "NUMBER", label: "Number of items", kind: "select", required: true, options: ["3", "4", "5", "6", "7"], default: "3", maxLength: 1 },
      text("ITEMS", "Approved items"), line("CTA", "Call to action"),
    ],
    scriptVar: "SCRIPT", assetVars: ["ASSETS"], titleField: "TOPIC", defaultDurationSec: 30,
    engineNotes: [
      "Open with a promise scene, then exactly the requested number of item scenes, then a takeaway and call-to-action scene.",
      'Each item scene has an overlay "N. <short title>" in the reel\'s language.',
      "If no items were provided, choose them yourself.",
    ],
  },
  {
    id: "myth-fact", name: "Myth vs Fact", description: "Correct one misconception and give a practical takeaway.",
    status: "available",
    fields: [line("TOPIC", "Topic", true), line("AUDIENCE", "Audience"), text("MYTH", "Misconception", true), text("FACT", "Accurate explanation", true), text("SOURCES_OR_EVIDENCE", "Supporting evidence"), text("EXAMPLE", "Practical example"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["ASSETS"], titleField: "TOPIC", defaultDurationSec: 30,
    engineNotes: [
      'The first scene states the myth with an overlay "מיתוס" (Hebrew) or "Myth" (English); then the missing context.',
      'The fact reveal has an overlay "עובדה" (Hebrew) or "Fact" (English), followed by one example scene and a call-to-action scene.',
      "Mark the correction with a graphic scene or a change of transition.",
    ],
  },
  {
    id: "text-led", name: "Text-Led, Music Only", description: "The whole message in on-screen text and visuals, no narration.",
    status: "coming_soon", comingSoonReason: "Needs music and reels without a voiceover",
    fields: [line("TOPIC", "Topic", true), line("AUDIENCE", "Audience"), text("MAIN_MESSAGE", "Main message", true), line("CTA", "Call to action"), line("MOOD", "Mood")],
    scriptVar: "COPY", assetVars: ["ASSETS", "MUSIC_ASSET"], titleField: "TOPIC", engineNotes: [], defaultDurationSec: 15,
  },
  {
    id: "customer-story", name: "Customer Story", description: "A case study: problem, action taken, documented outcome.",
    status: "available",
    fields: [line("NAME", "Customer or project", true), line("AUDIENCE", "Audience"), text("PROBLEM", "Initial problem", true), text("ACTION", "Solution or action", true), text("RESULT", "Verified outcome", true), text("QUOTES", "Approved quotes"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["ASSETS"], titleField: "NAME", defaultDurationSec: 30,
    engineNotes: [
      "Open with the strongest outcome from the verified outcome.",
      'Quotes appear only as overlays in quotation marks, only if quotes were provided, and word for word (shorten with "…" to fit the overlay limit).',
      "Never invent numbers, names or endorsements. Generated visuals are illustrative.",
    ],
  },
  {
    id: "process", name: "Process / Behind the Scenes", description: "How something is made, prepared or completed.",
    status: "available",
    fields: [line("PROCESS", "Process", true), line("AUDIENCE", "Audience"), text("RESULT", "Finished result", true), text("STEPS", "Essential stages"), text("TAKEAWAY", "Main takeaway"), line("CTA", "Call to action")],
    scriptVar: "SCRIPT", assetVars: ["ASSETS"], titleField: "PROCESS", defaultDurationSec: 30,
    engineNotes: [
      "Open with the finished result, then the stages in the order given, each with a short stage-label overlay.",
      "Return to the finished result for the call to action.",
    ],
  },
  {
    id: "loop-asmr", name: "Looping Visual / ASMR", description: "One satisfying repeating action with detailed sound.",
    status: "coming_soon", comingSoonReason: "Needs music and sound effects",
    fields: [line("SUBJECT", "Subject or product", true), line("ACTION", "Main action", true), line("MOOD", "Mood"), line("HOOK_TEXT", "Hook text"), line("CTA", "Optional call to action")],
    assetVars: ["ASSETS", "AUDIO_ASSETS"], titleField: "SUBJECT", engineNotes: [], defaultDurationSec: 15,
  },
  {
    id: "custom", name: "Custom", description: "Write your own brief.",
    status: "available", fields: [], assetVars: [], engineNotes: [], defaultDurationSec: 30,
  },
];

export const getStyle = (id: string) => STYLES.find((s) => s.id === id);
