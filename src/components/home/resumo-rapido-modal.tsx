"use client";

import * as React from "react";
import { LayoutDashboard, Package, CalendarClock, Activity, Globe } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  PendenciasFinanceiras,
  EstoqueAtencao,
} from "@/components/home/pendencias";
import { UltimasMovimentacoes } from "@/components/home/ultimas-movimentacoes";
import { AmazonStatusCard } from "@/components/home/amazon-status-card";

type Aba = "vencimentos" | "estoque" | "movimentacoes" | "amazon";

export function ResumoRapidoModal() {
  const [open, setOpen] = React.useState(false);
  const [aba, setAba] = React.useState<Aba>("vencimentos");

  // Mantemos um set de abas já visitadas para lazy-mount: cada componente só
  // monta (e dispara seu fetch) na primeira vez que sua aba é selecionada.
  const [visitadas, setVisitadas] = React.useState<Set<Aba>>(
    () => new Set<Aba>(["vencimentos"]),
  );

  React.useEffect(() => {
    if (!open) return;
    setVisitadas((prev) => {
      if (prev.has(aba)) return prev;
      const next = new Set(prev);
      next.add(aba);
      return next;
    });
  }, [aba, open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <LayoutDashboard className="h-4 w-4" />
          Abrir Resumo Rápido
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-4 overflow-hidden p-0 sm:max-w-xl"
      >
        <SheetHeader className="border-b px-6 pb-4 pt-6 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <LayoutDashboard className="h-4 w-4 text-primary" />
            Resumo Rápido
          </SheetTitle>
          <SheetDescription>
            Detalhes operacionais sem sair da home.
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={aba}
          onValueChange={(v) => setAba(v as Aba)}
          className="flex min-h-0 flex-1 flex-col px-6 pb-6"
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="vencimentos" className="gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Vencimentos</span>
            </TabsTrigger>
            <TabsTrigger value="estoque" className="gap-1.5">
              <Package className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Estoque</span>
            </TabsTrigger>
            <TabsTrigger value="movimentacoes" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Movimentações</span>
            </TabsTrigger>
            <TabsTrigger value="amazon" className="gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Amazon</span>
            </TabsTrigger>
          </TabsList>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            <TabsContent value="vencimentos" className="mt-0">
              {visitadas.has("vencimentos") && <PendenciasFinanceiras />}
            </TabsContent>
            <TabsContent value="estoque" className="mt-0">
              {visitadas.has("estoque") && <EstoqueAtencao />}
            </TabsContent>
            <TabsContent value="movimentacoes" className="mt-0">
              {visitadas.has("movimentacoes") && <UltimasMovimentacoes />}
            </TabsContent>
            <TabsContent value="amazon" className="mt-0">
              {visitadas.has("amazon") && <AmazonStatusCard />}
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
