import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { EsqueciSenhaForm } from "./form";

export const dynamic = "force-dynamic";

export default async function EsqueciSenhaPage() {
  const session = await getSession();
  if (session) redirect("/home");
  return <EsqueciSenhaForm />;
}
