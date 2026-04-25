"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Search,
  Home,
  LayoutDashboard,
  Wallet,
  FileText,
  ArrowDownToLine,
  PiggyBank,
  BarChart3,
  Package,
  ShoppingBag,
  ShoppingCart,
  Globe,
  UserCircle,
  Settings,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type NavItem = {
  id: string;
  label: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  keywords: string[];
};

// ─── Static items ─────────────────────────────────────────────────────────────

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", group: "Páginas", icon: Home, href: "/home", keywords: ["inicio", "principal", "central"] },
  { id: "dashboard", label: "Dashboard Financeiro", group: "Páginas", icon: LayoutDashboard, href: "/financeiro/dashboard", keywords: ["relatorio", "resumo", "financeiro", "grafico"] },
  { id: "caixa", label: "Caixa", group: "Páginas", icon: Wallet, href: "/caixa", keywords: ["extrato", "movimentacao", "bancario", "lancamento", "banco"] },
  { id: "contas-pagar", label: "Contas a Pagar", group: "Páginas", icon: FileText, href: "/contas-a-pagar", keywords: ["debito", "fornecedor", "boleto", "pagar", "vencimento"] },
  { id: "contas-receber", label: "Contas a Receber", group: "Páginas", icon: ArrowDownToLine, href: "/contas-a-receber", keywords: ["amazon", "recebimento", "liquidacao", "receber"] },
  { id: "destinacao", label: "Destinação de Caixa", group: "Páginas", icon: PiggyBank, href: "/destinacao", keywords: ["saldo", "livre", "comprometido", "projetado"] },
  { id: "dre", label: "DRE", group: "Páginas", icon: BarChart3, href: "/dre", keywords: ["resultado", "lucro", "prejuizo", "demonstrativo", "receita", "despesa"] },
  { id: "produtos", label: "Produtos", group: "Páginas", icon: Package, href: "/produtos", keywords: ["estoque", "inventario", "fba", "quantidade", "sku", "catalogo"] },
  { id: "vendas", label: "Vendas", group: "Páginas", icon: ShoppingBag, href: "/vendas", keywords: ["pedidos", "venda", "orders"] },
  { id: "compras", label: "Compras", group: "Páginas", icon: ShoppingCart, href: "/compras", keywords: ["pedido compra", "reposicao", "fornecedor", "purchase"] },
  { id: "amazon", label: "Conector Amazon", group: "Configuração", icon: Globe, href: "/amazon", keywords: ["sp-api", "sincronizar", "api", "credenciais", "marketplace"] },
  { id: "perfil", label: "Meu Perfil", group: "Configuração", icon: UserCircle, href: "/perfil", keywords: ["senha", "usuario", "conta", "alterar"] },
  { id: "configuracoes", label: "Configurações", group: "Configuração", icon: Settings, href: "/configuracoes", keywords: ["sistema", "preferencias", "config"] },
];

// ─── Context ──────────────────────────────────────────────────────────────────

type Ctx = { open: () => void };
const CommandPaletteCtx = React.createContext<Ctx>({ open: () => {} });

export function useCommandPalette() {
  return React.useContext(CommandPaletteCtx);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);

  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <CommandPaletteCtx.Provider value={{ open: () => setIsOpen(true) }}>
      {children}
      <CommandPaletteDialog isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </CommandPaletteCtx.Provider>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// ─── Dialog ───────────────────────────────────────────────────────────────────

function CommandPaletteDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const filtered = React.useMemo<NavItem[]>(() => {
    if (!query.trim()) return NAV_ITEMS;
    const q = normalize(query);
    return NAV_ITEMS.filter((item) => {
      return (
        normalize(item.label).includes(q) ||
        normalize(item.keywords.join(" ")).includes(q) ||
        normalize(item.group).includes(q)
      );
    });
  }, [query]);

  const groups = React.useMemo(() => {
    const map = new Map<string, NavItem[]>();
    for (const item of filtered) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    return map;
  }, [filtered]);

  // Pre-compute flat list for keyboard nav
  const flat = React.useMemo<NavItem[]>(() => [...groups.values()].flat(), [groups]);

  React.useEffect(() => { setSelectedIdx(0); }, [query]);

  React.useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  function go(href: string) {
    router.push(href as Route);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[selectedIdx];
      if (item) go(item.href);
    }
  }

  // Build indexed rows per group for rendering
  const renderedGroups = React.useMemo(() => {
    let idx = 0;
    return [...groups.entries()].map(([groupLabel, items]) => ({
      groupLabel,
      rows: items.map((item) => ({ item, idx: idx++ })),
    }));
  }, [groups]);

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-150" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-[12vh] z-50 w-[min(92vw,560px)] -translate-x-1/2",
            "rounded-xl border bg-popover shadow-2xl",
            "animate-in fade-in-0 zoom-in-95 slide-in-from-top-4 duration-150",
          )}
          onKeyDown={onKeyDown}
          aria-label="Paleta de comandos"
        >
          <DialogPrimitive.Title className="sr-only">Paleta de comandos</DialogPrimitive.Title>

          {/* Search bar */}
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar páginas e ações…"
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground/60 hover:text-muted-foreground"
              >
                <span className="sr-only">Limpar</span>
                <span aria-hidden>×</span>
              </button>
            )}
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[380px] overflow-y-auto p-1.5">
            {flat.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Nenhum resultado para &ldquo;{query}&rdquo;
              </div>
            ) : (
              renderedGroups.map(({ groupLabel, rows }) => (
                <div key={groupLabel} className="mb-1">
                  <p className="px-2 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/55">
                    {groupLabel}
                  </p>
                  {rows.map(({ item, idx }) => {
                    const Icon = item.icon;
                    const sel = idx === selectedIdx;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-cmd-idx={idx}
                        onClick={() => go(item.href)}
                        onMouseEnter={() => setSelectedIdx(idx)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                          sel
                            ? "bg-accent text-accent-foreground"
                            : "text-foreground/80 hover:text-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                            sel
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="flex-1 text-left">{item.label}</span>
                        {sel && (
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground/60">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border/50 bg-muted/50 px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
              navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border/50 bg-muted/50 px-1 py-0.5 font-mono text-[10px]">↵</kbd>
              abrir
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border/50 bg-muted/50 px-1 py-0.5 font-mono text-[10px]">ESC</kbd>
              fechar
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
