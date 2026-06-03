import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPlataformaSession } from "@/lib/plataforma-auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PlataformaTopbar } from "../../_components/plataforma-topbar";
import { NovaEmpresaForm } from "./form";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!(await getPlataformaSession())) redirect("/plataforma/login");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PlataformaTopbar />

      <main className="mx-auto max-w-lg px-4 py-8">
        <Link
          href="/plataforma"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para empresas
        </Link>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Nova empresa</CardTitle>
            <CardDescription>
              Cria a empresa e convida o administrador por e-mail. Ele define a
              senha pelo link de convite.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NovaEmpresaForm />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
