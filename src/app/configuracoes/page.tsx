"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Bell, Plug, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GmailSection } from "./gmail-section";
import { AmazonSection } from "@/components/configuracoes/amazon-section";
import { AmazonAdsSection } from "@/components/configuracoes/amazon-ads-section";
import { NotificacoesSection } from "@/components/configuracoes/notificacoes-section";
import { ImpostoSimplesSection } from "@/components/configuracoes/imposto-simples-section";
import { WhatsappEstoqueSection } from "@/components/configuracoes/whatsapp-estoque-section";
import { AssinaturaSection } from "@/components/configuracoes/assinatura-section";

const TABS_VALIDAS = new Set(["geral", "integracoes", "notificacoes"]);

/**
 * Lê `?tab=` (deep-link usado pelos callbacks OAuth) e o resultado da conexão
 * (`?amazon=` / `?ads=`) para dar feedback via toast. Precisa de Suspense por
 * causa do useSearchParams — o wrapper é o default export abaixo.
 */
function ConfiguracoesTabs() {
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab") ?? "";
  // O callback do Gmail redireciona sem ?tab= — os params dele implicam Integrações.
  const veioDoGmail =
    searchParams.has("gmail_ok") || searchParams.has("gmail_erro");
  const defaultTab = TABS_VALIDAS.has(tabParam)
    ? tabParam
    : veioDoGmail
      ? "integracoes"
      : "geral";

  const amazonParam = searchParams.get("amazon");
  const adsParam = searchParams.get("ads");

  React.useEffect(() => {
    if (amazonParam === "conectado") {
      toast.success("Conta Amazon conectada. A sincronização começa automaticamente.");
    } else if (amazonParam === "erro") {
      toast.error("Não foi possível conectar a conta Amazon. Tente novamente.");
    }
    if (adsParam === "conectado") {
      toast.success("Amazon Ads conectado.");
    } else if (adsParam === "profile_required") {
      toast.info("Amazon Ads conectado — selecione o profile do anunciante.");
    } else if (adsParam === "erro") {
      toast.error("Não foi possível conectar o Amazon Ads. Tente novamente.");
    }
  }, [amazonParam, adsParam]);

  return (
    <Tabs defaultValue={defaultTab} className="space-y-4">
      <TabsList className="flex h-auto flex-wrap">
        <TabsTrigger value="geral" className="gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Geral
        </TabsTrigger>
        <TabsTrigger value="integracoes" className="gap-2">
          <Plug className="h-4 w-4" />
          Integracoes
        </TabsTrigger>
        <TabsTrigger value="notificacoes" className="gap-2">
          <Bell className="h-4 w-4" />
          Notificacoes
        </TabsTrigger>
      </TabsList>

      {/* ---- Geral ---- */}
      <TabsContent value="geral" className="space-y-4">
        <ImpostoSimplesSection />

        <AssinaturaSection />
      </TabsContent>

      {/* ---- Integracoes ---- */}
      <TabsContent value="integracoes" className="space-y-4">
        <AmazonSection />
        <AmazonAdsSection />
        <GmailSection />
        <WhatsappEstoqueSection />
      </TabsContent>

      {/* ---- Notificacoes ---- */}
      <TabsContent value="notificacoes" className="space-y-4">
        <NotificacoesSection />
      </TabsContent>
    </Tabs>
  );
}

export default function ConfiguracoesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuracoes"
        description="Preferencias gerais, integracoes externas e notificacoes."
      />

      <Suspense fallback={<div className="h-40 rounded-xl border bg-card" />}>
        <ConfiguracoesTabs />
      </Suspense>
    </div>
  );
}
