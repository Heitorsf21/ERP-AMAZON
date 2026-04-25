"use client";

import { Suspense } from "react";
import { Bell, Plug, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Palette } from "lucide-react";
import { GmailSection } from "./gmail-section";
import { PreferenciasSection } from "./preferencias-section";
import { AmazonSection } from "@/components/configuracoes/amazon-section";
import { DriveSection } from "@/components/configuracoes/drive-section";
import { NotificacoesSection } from "@/components/configuracoes/notificacoes-section";
import { SistemaSection } from "@/components/configuracoes/sistema-section";

export default function ConfiguracoesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuracoes"
        description="Aparencia, integracoes externas e preferencias de notificacao."
      />

      <Tabs defaultValue="sistema" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="sistema" className="gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Sistema
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

        {/* ---- Sistema ---- */}
        <TabsContent value="sistema" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Palette className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">Aparencia</CardTitle>
                  <CardDescription>Tema da interface usado neste navegador.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <PreferenciasSection />
            </CardContent>
          </Card>

          <SistemaSection />
        </TabsContent>

        {/* ---- Integracoes ---- */}
        <TabsContent value="integracoes" className="space-y-4">
          <AmazonSection />
          <Suspense fallback={<div className="h-40 rounded-xl border bg-card" />}>
            <GmailSection />
          </Suspense>
          <DriveSection />
        </TabsContent>

        {/* ---- Notificacoes ---- */}
        <TabsContent value="notificacoes" className="space-y-4">
          <NotificacoesSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
