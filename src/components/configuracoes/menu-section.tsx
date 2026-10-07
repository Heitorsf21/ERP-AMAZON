"use client";

import * as React from "react";
import { CheckCheck, Lock, Menu as MenuIcon } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { HOME_ITEM, HREFS_NAV, NAV_GROUPS, type NavLeaf } from "@/components/nav-routes";
import {
  contarVisiveis,
  ehFixo,
  ocultasDaSugestao,
} from "@/modules/menu/preferencias";
import { useMenuOcultas, useSalvarMenu } from "@/components/menu/use-menu-visivel";

type Secao = { id: string; label: string; itens: NavLeaf[] };

const SECOES: Secao[] = [
  ...NAV_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    itens: g.items.filter((item) => !ehFixo(item.href)),
  })),
  { id: "outros", label: "Outros", itens: [HOME_ITEM] },
].filter((secao) => secao.itens.length > 0);

const FIXAS: NavLeaf[] = NAV_GROUPS.flatMap((g) => g.items).filter((item) =>
  ehFixo(item.href),
);

const ROTULO_SECAO =
  "px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

export function MenuSection() {
  const { data, isLoading } = useMenuOcultas();
  const salvar = useSalvarMenu();
  const ocultas = data?.ocultas ?? [];
  const ocultasSet = new Set(ocultas);

  function aplicar(novas: string[], mensagem: string) {
    salvar.mutate(novas, {
      onSuccess: () => toast.success(mensagem),
      onError: (e) => toast.error(e.message || "Não foi possível salvar o menu."),
    });
  }

  function alternar(href: string) {
    const novas = ocultasSet.has(href)
      ? ocultas.filter((h) => h !== href)
      : [...ocultas, href];
    aplicar(novas, "Menu atualizado.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Abas do menu</CardTitle>
        <CardDescription>
          Escolha o que aparece no seu menu. Vale no celular e no computador, só
          para você.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm text-primary">
              <MenuIcon className="h-4 w-4" aria-hidden />
              <span>
                Seu menu tem <strong>{contarVisiveis(HREFS_NAV, ocultas)}</strong> de{" "}
                {HREFS_NAV.length} abas.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={salvar.isPending}
                onClick={() =>
                  aplicar(
                    ocultasDaSugestao(HREFS_NAV),
                    "Sugestão aplicada: Dashboard, Vendas, Produtos e Configurações.",
                  )
                }
              >
                <CheckCheck className="mr-2 h-4 w-4" aria-hidden />
                Usar sugestão
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={salvar.isPending}
                onClick={() => aplicar([], "Todas as abas voltaram ao menu.")}
              >
                Mostrar tudo
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Sugestão: deixar só Dashboard, Vendas, Produtos e Configurações, as
              abas mais usadas. Esconder uma aba não desliga nada do que roda por
              trás.
            </p>

            <div className="overflow-hidden rounded-lg border">
              <p className={ROTULO_SECAO}>Sempre no menu</p>
              {FIXAS.map((item) => (
                <div
                  key={item.href}
                  className="flex min-h-[52px] items-center gap-3 border-t px-4"
                >
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 text-sm font-medium">{item.label}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" aria-hidden />
                    fixa
                  </span>
                </div>
              ))}
            </div>

            {SECOES.map((secao) => (
              <div key={secao.id} className="overflow-hidden rounded-lg border">
                <p className={ROTULO_SECAO}>{secao.label}</p>
                {secao.itens.map((item) => {
                  const ligado = !ocultasSet.has(item.href);
                  // O <label> envolve o Switch (um <button>): a associação é
                  // implícita, então a linha inteira de 52px é alvo de toque.
                  return (
                    <label
                      key={item.href}
                      className="flex min-h-[52px] cursor-pointer items-center gap-3 border-t px-4"
                    >
                      <item.icon
                        className={cn(
                          "h-4 w-4",
                          ligado ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span
                        className={cn(
                          "flex-1 text-sm font-medium",
                          !ligado && "text-muted-foreground",
                        )}
                      >
                        {item.label}
                      </span>
                      <Switch
                        checked={ligado}
                        disabled={salvar.isPending}
                        onCheckedChange={() => alternar(item.href)}
                        aria-label={`Mostrar ${item.label} no menu`}
                      />
                    </label>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
