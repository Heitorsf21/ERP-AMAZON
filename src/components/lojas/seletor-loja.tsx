"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, Layers, Loader2 } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { destinoAoTrocar } from "@/modules/lojas/regras";
import { TrocarLojaSheet } from "./trocar-loja-sheet";
import { useLojas, useTrocarLoja } from "./use-lojas";
import { useVisaoInicio } from "./visao-inicio";

/**
 * Celular: o nome da loja aberta (com ⌄) no lugar de "Atlas Seller". Toque
 * abre a folha "Trocar de loja". Enquanto carrega, fica a marca de sempre.
 */
export function SeletorLojaMobile() {
  const { atual } = useLojas();
  const [aberto, setAberto] = React.useState(false);

  if (!atual) {
    return (
      <Link href={"/dashboard-ecommerce" as Route} className="flex items-center gap-2">
        <BrandMark size="sm" />
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={`Trocar de loja. Loja aberta: ${atual.nome}`}
        aria-haspopup="dialog"
        className="-ml-1 flex min-h-[44px] min-w-0 items-center gap-2.5 rounded-lg px-1 active:bg-muted"
      >
        <Image
          src="/atlas-symbol.png"
          alt=""
          width={24}
          height={24}
          priority
          className="shrink-0 object-contain"
          style={{ height: 24, width: 24 }}
        />
        <span className="truncate text-sm font-semibold leading-none tracking-tight">
          {atual.nome}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <TrocarLojaSheet aberto={aberto} onAbertoChange={setAberto} />
    </>
  );
}

/**
 * Computador: seletor na barra de cima, à esquerda da busca. "Todas as lojas"
 * abre o Início com as lojas somadas; uma loja vinculada troca a sessão
 * mantendo a seção aberta.
 */
export function SeletorLojaDesktop() {
  const router = useRouter();
  const pathname = usePathname();
  const { lojas, atual, temVinculo } = useLojas();
  const { trocar, trocandoPara } = useTrocarLoja();
  const [visao, definirVisao] = useVisaoInicio();

  if (!atual) return null;

  const noInicio = pathname === "/dashboard-ecommerce";
  const mostrandoTodas = temVinculo && noInicio && visao === "todas";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 max-w-[220px] gap-2 px-3 font-semibold">
          {trocandoPara ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          ) : mostrandoTodas ? (
            <Layers className="h-4 w-4 text-primary" aria-hidden />
          ) : (
            <span className={cn("h-2 w-2 shrink-0 rounded-full", atual.cor.ponto)} aria-hidden />
          )}
          <span className="truncate">{mostrandoTodas ? "Todas as lojas" : atual.nome}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {temVinculo && (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Ver no Início
            </DropdownMenuLabel>
            <DropdownMenuItem
              className="h-9 cursor-pointer gap-2"
              onSelect={() => {
                definirVisao("todas");
                if (!noInicio) router.push("/dashboard-ecommerce" as Route);
              }}
            >
              <Layers className="h-4 w-4 text-primary" aria-hidden />
              <span className="flex-1">Todas as lojas</span>
              {mostrandoTodas && <Check className="h-4 w-4" aria-label="Selecionado" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="text-xs text-muted-foreground">Suas lojas</DropdownMenuLabel>
        {lojas.map((loja) => (
          <DropdownMenuItem
            key={loja.empresaId}
            className="h-9 cursor-pointer gap-2"
            disabled={trocandoPara != null}
            onSelect={() => {
              if (loja.atual) {
                definirVisao("loja");
                return;
              }
              void trocar(loja.empresaId, { destino: destinoAoTrocar(pathname), visao: "loja" });
            }}
          >
            <span className={cn("mx-1 h-2 w-2 shrink-0 rounded-full", loja.cor.ponto)} aria-hidden />
            <span className="flex-1 truncate">{loja.nome}</span>
            {loja.atual && <span className="text-xs text-muted-foreground">aberta</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="h-9 cursor-pointer">
          <Link href={"/configuracoes?tab=lojas" as Route}>Vincular outra loja…</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
