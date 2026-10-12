import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FootageForm } from "./footage-form";

export default async function NewFootagePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  return (
    <main className="stack">
      <h1>Edit my video</h1>
      <p className="muted">MP4 or MOV, up to 3 minutes and 2 GB. Nothing is generated until you approve the edit plan.</p>
      <FootageForm supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL!} />
    </main>
  );
}
