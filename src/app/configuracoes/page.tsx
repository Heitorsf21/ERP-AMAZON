"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, Layers, LayoutList, Plug, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GmailSection } from "./gmail-section";
import { AmazonSection } from "@/components/configuracoes/amazon-section";
import { AmazonAdsSection } from "@/components/configuracoes/amazon-ads-section";
import { NotificacoesSection } from "@/components/configuracoes/notificacoes-section";
import { NesteCelularSection } from "@/components/configuracoes/neste-celular-section";
import { ImpostoSimplesSection } from "@/components/configuracoes/imposto-simples-section";
import { WhatsappEstoqueSection } from "@/components/configuracoes/whatsapp-estoque-section";
import { AssinaturaSection } from "@/components/configuracoes/assinatura-section";
import { MenuSection } from "@/components/configuracoes/menu-section";
import { LojasSection } from "@/components/configuracoes/lojas-section";
import { fetchJSON } from "@/lib/fetcher";
import { UsuarioRole } from "@/modules/shared/domain";

const TABS_VALIDAS = new Set(["geral", "integracoes", "notificacoes", "menu", "lojas"]);

// Menu, o aviso de venda "neste celular" e as lojas vinculadas são pessoais: qualquer papel abre
// esta página, mas só ADMIN vê as abas e seções de empresa. As APIs delas
// (/api/configuracoes/*) seguem restritas a ADMIN no servidor; aqui é só para
// não mostrar o que daria 403. /api/push/* exige apenas sessão.
const TABS_TODOS_OS_PAPEIS = new Set(["notificacoes", "menu", "lojas"]);

type MeResponse = { usuario: { role: string } };

/**
 * Lê `?tab=` (deep-link usado pelos callbacks OAuth) e o resultado da conexão
 * (`?amazon=` / `?ads=`) para dar feedback via toast. Precisa de Suspense por
 * causa do useSearchParams — o wrapper é o default export abaixo.
 */
function ConfiguracoesTabs() {
  const searchParams = useSearchParams();

  // Mesma query (e cache) do menu de perfil da topbar.
  const me = useQuery<MeResponse>({
    queryKey: ["auth-me"],
    queryFn: () => fetchJSON<MeResponse>("/api/auth/me"),
    staleTime: 60_000,
    retry: false,
  });
  const ehAdmin = me.data?.usuario.role === UsuarioRole.ADMIN;
  const tabsDoPapel = ehAdmin ? TABS_VALIDAS : TABS_TODOS_OS_PAPEIS;

  const tabParam = searchParams.get("tab") ?? "";
  // O callback do Gmail redireciona sem ?tab= — os params dele implicam Integrações.
  const veioDoGmail =
    searchParams.has("gmail_ok") || searchParams.has("gmail_erro");
  const defaultTab = tabsDoPapel.has(tabParam)
    ? tabParam
    : !ehAdmin
      ? "menu"
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

  // `defaultValue` só vale na montagem: espera o papel para não abrir na aba errada.
  if (me.isLoading) return <SkeletonAbas />;

  // `key` remonta as abas quando o `?tab=` muda com a página já aberta (atalhos
  // da folha Mais navegam no cliente, sem recarregar).
  return (
    <Tabs key={defaultTab} defaultValue={defaultTab} className="space-y-4">
      <TabsList className="flex h-auto flex-wrap">
        {ehAdmin && (
          <>
            <TabsTrigger value="geral" className="gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Geral
            </TabsTrigger>
            <TabsTrigger value="integracoes" className="gap-2">
              <Plug className="h-4 w-4" />
              Integrações
            </TabsTrigger>
          </>
        )}
        <TabsTrigger value="notificacoes" className="gap-2">
          <Bell className="h-4 w-4" />
          Notificações
        </TabsTrigger>
        <TabsTrigger value="menu" className="gap-2">
          <LayoutList className="h-4 w-4" />
          Menu
        </TabsTrigger>
        <TabsTrigger value="lojas" className="gap-2">
          <Layers className="h-4 w-4" />
          Lojas
        </TabsTrigger>
      </TabsList>

      {ehAdmin && (
        <>
          {/* ---- Geral ---- */}
          <TabsContent value="geral" className="space-y-4">
            <ImpostoSimplesSection />

            <AssinaturaSection />
          </TabsContent>

          {/* ---- Integrações ---- */}
          <TabsContent value="integracoes" className="space-y-4">
            <AmazonSection />
            <AmazonAdsSection />
            <GmailSection />
            <WhatsappEstoqueSection />
          </TabsContent>
        </>
      )}

      {/* ---- Notificações ---- */}
      <TabsContent value="notificacoes" className="space-y-4">
        <NesteCelularSection />
        {ehAdmin && <NotificacoesSection />}
      </TabsContent>

      {/* ---- Menu ---- */}
      <TabsContent value="menu" className="space-y-4">
        <MenuSection />
      </TabsContent>

      {/* ---- Lojas (duas lojas juntas) ---- */}
      <TabsContent value="lojas" className="space-y-4">
        <LojasSection />
      </TabsContent>
    </Tabs>
  );
}

function SkeletonAbas() {
  return <div className="h-40 rounded-xl border bg-card" />;
}

export default function ConfiguracoesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Preferências gerais, integrações, notificações, menu e lojas."
      />

      <Suspense fallback={<SkeletonAbas />}>
        <ConfiguracoesTabs />
      </Suspense>
    </div>
  );
}
