// PAID: calls ElevenLabs sound effects once per sound. Run only with the user's explicit OK, after stating the cost.
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { SFX_NAMES } from "@reel/core";
import { SFX_DIR, SFX_PROMPTS } from "@reel/video/sfx";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvFile } from "../src/config";

const total = SFX_NAMES.reduce((s, n) => s + SFX_PROMPTS[n].durationSec, 0);
console.log(`This generates ${SFX_NAMES.length} sound effects (${total.toFixed(1)} s in total) with ElevenLabs into ${SFX_DIR}.`);
console.log("It spends ElevenLabs credits once; listen to every file before committing it.");
if (!process.argv.includes("--yes")) {
  console.log("Nothing was generated. Re-run with --yes to spend the credits.");
  process.exit(0);
}
loadEnvFile();
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY in .env.local");
const client = new ElevenLabsClient({ apiKey });
await mkdir(SFX_DIR, { recursive: true });
for (const name of SFX_NAMES) {
  const { text, durationSec } = SFX_PROMPTS[name];
  const stream = await client.textToSoundEffects.convert({ text, durationSeconds: durationSec, promptInfluence: 0.6, modelId: "eleven_text_to_sound_v2", outputFormat: "mp3_44100_128" });
  const file = join(SFX_DIR, `${name}.mp3`);
  await writeFile(file, Buffer.from(await new Response(stream).arrayBuffer()));
  console.log(`wrote ${file}`);
}
