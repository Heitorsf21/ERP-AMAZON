"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Menu, Package, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { MaisSheet } from "@/components/mobile/mais-sheet";

const ITENS = [
  { href: "/dashboard-ecommerce", rotulo: "Início", icone: LayoutDashboard },
  { href: "/vendas", rotulo: "Vendas", icone: ShoppingBag },
  { href: "/produtos", rotulo: "Produtos", icone: Package },
] as const;

function ativo(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Navegação do celular (< lg). Substitui o hamburguer/drawer da sidebar. */
export function BottomNav() {
  const pathname = usePathname() ?? "";
  const [maisAberto, setMaisAberto] = React.useState(false);

  React.useEffect(() => setMaisAberto(false), [pathname]);

  const maisAtivo = maisAberto || !ITENS.some((i) => ativo(pathname, i.href));

  return (
    <>
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {ITENS.map(({ href, rotulo, icone: Icone }) => {
            const selecionado = ativo(pathname, href);
            return (
              <Link
                key={href}
                href={href as Route}
                aria-current={selecionado ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
                  selecionado ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                    selecionado && "bg-primary/10",
                  )}
                >
                  <Icone className="h-5 w-5" aria-hidden />
                </span>
                {rotulo}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMaisAberto(true)}
            aria-haspopup="dialog"
            aria-expanded={maisAberto}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium",
              maisAtivo ? "text-primary" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                maisAtivo && "bg-primary/10",
              )}
            >
              <Menu className="h-5 w-5" aria-hidden />
            </span>
            Mais
          </button>
        </div>
      </nav>
      <MaisSheet aberto={maisAberto} onAbertoChange={setMaisAberto} />
    </>
  );
}
