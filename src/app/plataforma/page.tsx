import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { getPlataformaSession } from "@/lib/plataforma-auth";
import { listarEmpresas } from "@/modules/plataforma/empresas";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PlataformaTopbar } from "./_components/plataforma-topbar";
import { EmpresasTable } from "./_components/empresas-table";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!(await getPlataformaSession())) redirect("/plataforma/login");
  const empresas = await listarEmpresas();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PlataformaTopbar />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {empresas.length === 0
                ? "Nenhuma empresa cadastrada ainda."
                : `${empresas.length} empresa${empresas.length > 1 ? "s" : ""} no Atlas Seller.`}
            </p>
          </div>
          <Button asChild>
            <Link href="/plataforma/empresas/nova">
              <Plus className="mr-2 h-4 w-4" />
              Nova empresa
            </Link>
          </Button>
        </div>

        <div className="mt-6">
          {empresas.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Building2 className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium">Comece criando a primeira empresa</p>
                  <p className="text-sm text-muted-foreground">
                    Cada empresa tem seu próprio admin, usuários e conexões Amazon.
                  </p>
                </div>
                <Button asChild className="mt-1">
                  <Link href="/plataforma/empresas/nova">
                    <Plus className="mr-2 h-4 w-4" />
                    Criar empresa
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-2 sm:p-4">
                <EmpresasTable empresas={empresas} />
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
