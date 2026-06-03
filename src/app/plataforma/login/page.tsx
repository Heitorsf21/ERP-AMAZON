import { redirect } from "next/navigation";
import { getPlataformaSession } from "@/lib/plataforma-auth";
import { PlataformaLoginForm } from "./form";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (await getPlataformaSession()) redirect("/plataforma");
  return <PlataformaLoginForm />;
}
