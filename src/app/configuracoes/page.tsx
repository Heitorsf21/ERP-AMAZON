import { PageHeader } from "@/components/ui/page-header";
import { GmailSection } from "./gmail-section";
import { PreferenciasSection } from "./preferencias-section";
import Link from "next/link";
import { Globe, ArrowRight } from "lucide-react";
import { Suspense } from "react";

export default function ConfiguracoesPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Configurações"
        description="Integrações, automações e preferências do sistema."
      />

      {/* Email Automático */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground/60">
          Email &amp; Importação Automática
        </h2>
        <Suspense fallback={<div className="h-40 rounded-xl border bg-card" />}>
          <GmailSection />
        </Suspense>
      </section>

      {/* Integrações */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground/60">
          Integrações
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/amazon"
            className="group rounded-xl border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-md"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Globe className="h-5 w-5" />
            </div>
            <h3 className="mb-1 flex items-center gap-1 text-sm font-semibold">
              Conector Amazon
              <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </h3>
            <p className="text-xs text-muted-foreground">
              Credenciais SP-API, sincronização de pedidos e estoque.
            </p>
          </Link>
        </div>
      </section>

      {/* Aparência */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground/60">
          Aparência
        </h2>
        <PreferenciasSection />
      </section>
    </div>
  );
}
