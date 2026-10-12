import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getStyle } from "@reel/styles";
import { createClient } from "@/lib/supabase/server";
import { StyleReelForm } from "./style-reel-form";

export default async function NewStyleReelPage({ params }: { params: Promise<{ styleId: string }> }) {
  const { styleId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");
  const def = getStyle(styleId);
  if (!def) notFound();
  if (def.id === "custom") redirect("/new/custom");
  if (def.status !== "available") {
    return (
      <main className="stack">
        <h1>{def.name}</h1>
        <p className="muted">Coming soon: {def.comingSoonReason}.</p>
        <Link href="/new">Back to styles</Link>
      </main>
    );
  }
  return (
    <main className="stack">
      <h1>{def.name}</h1>
      <p className="muted">{def.description}</p>
      <StyleReelForm style={def} />
    </main>
  );
}
