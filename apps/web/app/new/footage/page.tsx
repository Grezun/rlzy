import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FootageForm } from "./footage-form";

export default async function NewFootagePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  const { data: characters } = await supabase.from("soul_characters").select("id, name").order("name");
  return (
    <main className="stack">
      <h1>Edit my video</h1>
      <p className="muted">MP4 or MOV, up to 3 minutes and 2 GB. Add up to 6 photos or clips to use as cutaways. Nothing is generated until you approve the edit plan.</p>
      <FootageForm supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL!} characters={characters ?? []} />
    </main>
  );
}
