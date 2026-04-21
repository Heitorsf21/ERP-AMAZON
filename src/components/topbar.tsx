"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Package, User, LogOut, Settings, UserCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMobileSheet } from "@/components/sidebar";
import { fetchJSON } from "@/lib/fetcher";
import { useCommandPalette } from "@/components/command-palette";

type MeResponse = {
  usuario: {
    id: string;
    nome: string;
    email: string;
    role: string;
    avatarUrl: string | null;
  };
};

const ATALHO_BUSCA = "Ctrl+K";

/**
 * Topbar global. Substitui a barra superior mobile antiga do Sidebar.
 * Etapa 4 liga o botão de busca ao Command Palette real.
 * Etapa 2 troca o perfil placeholder pelo usuário autenticado.
 */
export function Topbar() {
  const palette = useCommandPalette();

  return (
    <header
      className={cn(
        "sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md",
        "supports-[backdrop-filter]:bg-background/60",
      )}
    >
      {/* Mobile: menu + logo */}
      <div className="flex items-center gap-2 lg:hidden">
        <SidebarMobileSheet />
        <Link href={"/home" as Route} className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--sidebar-accent))]">
            <Package className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold">ERP AMAZON</span>
        </Link>
      </div>

      {/* Busca centralizada (desktop) */}
      <div className="hidden flex-1 justify-center lg:flex">
        <SearchTrigger onOpen={palette.open} />
      </div>

      {/* Busca mobile */}
      <div className="ml-auto lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Buscar"
          onClick={palette.open}
        >
          <Search className="h-5 w-5" />
        </Button>
      </div>

      {/* Perfil */}
      <div className="ml-0 lg:ml-auto">
        <ProfileMenu />
      </div>
    </header>
  );
}

function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border/80 bg-muted/40 px-3 text-sm text-muted-foreground transition-all",
        "hover:border-border hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
      )}
      aria-label="Buscar no sistema"
    >
      <Search className="h-4 w-4 opacity-70 transition-opacity group-hover:opacity-100" />
      <span className="flex-1 text-left">Buscar páginas, ações, dados…</span>
      <kbd className="hidden items-center gap-1 rounded border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
        {ATALHO_BUSCA}
      </kbd>
    </button>
  );
}

function gerarIniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "";
  const primeiro = partes[0] ?? "";
  if (partes.length === 1) return primeiro.slice(0, 2).toUpperCase();
  const ultimo = partes[partes.length - 1] ?? "";
  return ((primeiro[0] ?? "") + (ultimo[0] ?? "")).toUpperCase();
}

function ProfileMenu() {
  const router = useRouter();
  const qc = useQueryClient();
  const [saindo, setSaindo] = React.useState(false);

  const { data, isLoading } = useQuery<MeResponse>({
    queryKey: ["auth-me"],
    queryFn: () => fetchJSON<MeResponse>("/api/auth/me"),
    staleTime: 60_000,
    retry: false,
  });

  const usuario = data?.usuario;
  const nome = usuario?.nome ?? "";
  const email = usuario?.email ?? "";
  const iniciais = nome ? gerarIniciais(nome) : "";

  async function fazerLogout() {
    if (saindo) return;
    setSaindo(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Mesmo com erro, seguimos: cookie será revalidado no próximo load.
    }
    qc.clear();
    toast.success("Sessão encerrada.");
    router.replace("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-full p-1 pr-3 transition-colors",
            "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label="Menu do usuário"
        >
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full",
              "bg-gradient-to-br from-primary to-primary/70 text-xs font-semibold text-primary-foreground",
              "shadow-sm ring-2 ring-background",
            )}
          >
            {isLoading && !iniciais ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : iniciais ? (
              iniciais
            ) : (
              <User className="h-4 w-4" />
            )}
          </span>
          <span className="hidden text-sm font-medium lg:inline-block">
            {nome || "Conta"}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm font-medium leading-none">
              {nome || "Sessão"}
            </span>
            <span className="mt-1 truncate text-xs font-normal text-muted-foreground">
              {email || "—"}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={"/perfil" as Route} className="cursor-pointer">
            <UserCircle className="mr-0 h-4 w-4" />
            Meu perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={"/configuracoes" as Route} className="cursor-pointer">
            <Settings className="mr-0 h-4 w-4" />
            Configurações
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            fazerLogout();
          }}
          disabled={saindo}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          {saindo ? (
            <Loader2 className="mr-0 h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="mr-0 h-4 w-4" />
          )}
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
