import * as z from "zod";

export const CharacterInputSchema = z.object({
  name: z.string().trim().min(1, "Give the character a name.").max(40, "Keep the name to 40 characters."),
  referenceId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/, "Paste the Soul ID reference id (8–64 letters, digits, - or _)."),
});
