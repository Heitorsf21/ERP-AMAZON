import { redirect } from "next/navigation";
import { getPlataformaSession } from "@/lib/plataforma-auth";
import { NovaEmpresaForm } from "./form";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!(await getPlataformaSession())) redirect("/plataforma/login");
  return (
    <div style={{ maxWidth: 480, margin: "40px auto", padding: 16 }}>
      <h1>Nova empresa</h1>
      <NovaEmpresaForm />
    </div>
  );
}
