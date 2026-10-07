"use client";

import * as React from "react";
import { Bell, BellOff, CheckCircle2, Info, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { InstalarSheet } from "@/components/pwa/instalar-sheet";
import { usePush } from "@/components/push/use-push";

function dataCurta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function NesteCelularSection() {
  const push = usePush();
  const [instalarAberto, setInstalarAberto] = React.useState(false);
  const nomeAparelho = push.plataforma?.ios ? "iPhone" : push.plataforma?.android ? "Android" : "aparelho";

  function ativar() {
    push.ativar.mutate({
      onSuccess: () => toast.success(`Avisos da ${push.loja} ativados neste ${nomeAparelho}.`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível ativar."),
    });
  }

  function testar() {
    push.teste.mutate(undefined, {
      onSuccess: (r) =>
        r.destinos > 0
          ? toast.success("Teste enviado. Chega em instantes.")
          : toast.info("Nenhum aparelho seu está recebendo avisos ainda."),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao enviar o teste."),
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Smartphone className="h-5 w-5" aria-hidden />
        </span>
        <div className="space-y-1">
          <CardTitle className="text-base">Aviso de venda neste celular</CardTitle>
          <CardDescription>
            Segundos depois de cada venda, mesmo com o celular bloqueado. Mostra a
            loja e o valor, sem o nome do produto.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {push.estado === "carregando" && <Skeleton className="h-12 w-full" />}

        {push.estado === "instalar-primeiro" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No iPhone, os avisos funcionam com o Atlas instalado na Tela de Início
              (iOS 16.4 ou mais novo).
            </p>
            <Button className="h-12 w-full" onClick={() => setInstalarAberto(true)}>
              Como instalar
            </Button>
          </div>
        )}

        {push.estado === "nao-suportado" && (
          <p className="text-sm text-muted-foreground">
            Este navegador não recebe notificações. No celular, use o Chrome
            (Android) ou o app instalado (iPhone).
          </p>
        )}

        {push.estado === "negado" && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            As notificações estão bloqueadas para o Atlas. Libere em Ajustes →
            Notificações → Atlas (iPhone) ou nas permissões do site (Android) e
            volte aqui.
          </p>
        )}

        {push.estado === "desligado" && (
          <div className="space-y-2">
            <Button className="h-12 w-full text-base" onClick={ativar} disabled={push.ativar.isPending}>
              <Bell className="mr-2 h-5 w-5" aria-hidden />
              {push.ativar.isPending ? "Ativando…" : "Ativar notificações"}
            </Button>
            <p className="text-xs text-muted-foreground">
              No iPhone, funciona com o Atlas instalado na Tela de Início. No
              Android, direto pelo Chrome.
            </p>
          </div>
        )}

        {(push.estado === "ativo" || push.estado === "pausado") && push.desteAparelho && (
          <div className="space-y-1">
            {push.estado === "ativo" ? (
              <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                Ativo neste {nomeAparelho} para a {push.loja}
              </p>
            ) : (
              <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <BellOff className="h-4 w-4 shrink-0" aria-hidden />
                Avisos de venda da {push.loja} desligados neste {nomeAparelho}. Ligue “Vendas novas” para voltar a receber.
              </p>
            )}
            {/* Só o interruptor liga/desliga: a linha inteira clicável ficava logo
                acima de "Enviar teste" e desligava os avisos sem querer. */}
            <div className="flex min-h-[56px] items-center gap-3">
              <span className="flex-1">
                <span className="block text-[15px] font-medium">Vendas novas</span>
                <span className="block text-xs text-muted-foreground">
                  “Nova venda na {push.loja}” e o valor do pedido
                </span>
              </span>
              <Switch
                aria-label="Vendas novas"
                checked={push.desteAparelho.receberVendas}
                disabled={push.alternarVendas.isPending}
                onCheckedChange={(v) =>
                  push.alternarVendas.mutate(v, {
                    onSuccess: () =>
                      v
                        ? toast.success(`Avisos de venda da ${push.loja} ligados neste ${nomeAparelho}.`)
                        : toast.warning(`Avisos de venda da ${push.loja} desligados neste ${nomeAparelho}.`),
                    onError: (e) =>
                      toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
                  })
                }
              />
            </div>
            <Button variant="outline" className="h-11 w-full" onClick={testar} disabled={push.teste.isPending}>
              Enviar teste
            </Button>
          </div>
        )}

        {(push.estado === "ativo" || push.estado === "pausado" || push.estado === "desligado") && (
          <p className="flex gap-2 rounded-lg bg-primary/5 p-3 text-xs leading-relaxed text-primary">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Tem outra loja? Entre na conta dela neste celular e ative aqui também.
            Cada aviso mostra o nome da loja.
          </p>
        )}

        <div className="overflow-hidden rounded-lg border">
          <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Seus aparelhos
          </p>
          {push.dispositivos.length === 0 ? (
            <p className="border-t px-4 py-3 text-sm text-muted-foreground">
              Nenhum aparelho seu recebe avisos da {push.loja} ainda.
            </p>
          ) : (
            push.dispositivos.map((d) => (
              <div key={d.id} className="flex min-h-[56px] items-center gap-3 border-t pl-4 pr-1">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium">
                    {d.apelido ?? "Aparelho"}
                    {d.endpoint === push.endpointAtual && (
                      <span className="ml-1 text-xs font-semibold text-primary">· este aparelho</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.ativo ? `Avisos desde ${dataCurta(d.criadoEm)}` : "Pausado após falhas de entrega"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="h-11 text-red-700 dark:text-red-400"
                  disabled={push.remover.isPending}
                  onClick={() =>
                    push.remover.mutate(
                      { id: d.id },
                      {
                        onSuccess: () => toast.success("Aparelho removido. Ele não recebe mais avisos."),
                        onError: (e) =>
                          toast.error(e instanceof Error ? e.message : "Não foi possível remover."),
                      },
                    )
                  }
                >
                  Remover
                </Button>
              </div>
            ))
          )}
        </div>
      </CardContent>
      <InstalarSheet aberto={instalarAberto} onAbertoChange={setInstalarAberto} />
    </Card>
  );
}
