"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  Search,
  ArrowRight,
  Package,
  FileText,
  Building2,
  Receipt,
  Plus,
  Upload,
  RefreshCw,
  CheckCircle2,
  Zap,
  ScrollText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ALL_NAV_ITEMS } from "./nav-routes";
import type { BuscaResposta, BuscaResultadoItem } from "@/modules/busca/service";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Modo = "navegacao" | "acoes";

type FlatItem = {
  key: string;
  label: string;
  sub?: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Ação ao selecionar. Pode navegar (usar router.push) ou executar callback. */
  run: () => void | Promise<void>;
};

// ─── Context ──────────────────────────────────────────────────────────────────

type Ctx = { open: () => void };
const CommandPaletteCtx = React.createContext<Ctx>({ open: () => {} });

export function useCommandPalette() {
  return React.useContext(CommandPaletteCtx);
}

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
    .replace(/[̀-ͯ]/g, "");
}

const TIPO_ICON: Record<BuscaResultadoItem["tipo"], React.ComponentType<{ className?: string }>> = {
  produto: Package,
  "conta-pagar": Receipt,
  fornecedor: Building2,
  documento: FileText,
};

const TIPO_GROUP: Record<BuscaResultadoItem["tipo"], string> = {
  produto: "Produtos",
  "conta-pagar": "Contas a Pagar",
  fornecedor: "Fornecedores",
  documento: "Documentos",
};

// ─── Dialog ───────────────────────────────────────────────────────────────────

function CommandPaletteDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [query, setQuery] = React.useState("");
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Modo é decidido pelo prefixo da query.
  const modo: Modo = query.startsWith(">") ? "acoes" : "navegacao";
  const queryAjustada = modo === "acoes" ? query.slice(1).trim() : query.trim();

  // Busca remota: só dispara se modo=navegacao e tem ≥2 chars, com debounce 200ms.
  const [dadosRemotos, setDadosRemotos] = React.useState<BuscaResposta | null>(null);
  const [carregandoRemoto, setCarregandoRemoto] = React.useState(false);

  React.useEffect(() => {
    if (modo !== "navegacao" || queryAjustada.length < 2) {
      setDadosRemotos(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setCarregandoRemoto(true);
      try {
        const r = await fetch(
          `/api/busca?q=${encodeURIComponent(queryAjustada)}&limit=5`,
          { signal: ctrl.signal },
        );
        if (r.ok) {
          const data = (await r.json()) as BuscaResposta;
          setDadosRemotos(data);
        }
      } catch {
        // ignore (abort/erro)
      } finally {
        setCarregandoRemoto(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [queryAjustada, modo]);

  // Ações rápidas (estáticas, executam callback).
  const acoesRapidas = React.useMemo<FlatItem[]>(
    () => [
      {
        key: "acao:nova-conta",
        label: "Nova conta a pagar",
        sub: "Abre o formulário",
        group: "Ações",
        icon: Plus,
        run: () => {
          router.push("/contas-a-pagar?novo=1" as Route);
          onClose();
        },
      },
      {
        key: "acao:novo-produto",
        label: "Novo produto",
        sub: "Cadastrar SKU MFS-",
        group: "Ações",
        icon: Plus,
        run: () => {
          router.push("/produtos?novo=1" as Route);
          onClose();
        },
      },
      {
        key: "acao:subir-documento",
        label: "Subir nota fiscal ou boleto",
        sub: "Upload de PDF",
        group: "Ações",
        icon: Upload,
        run: () => {
          router.push("/notas-fiscais?upload=1" as Route);
          onClose();
        },
      },
      {
        key: "acao:importar-extrato",
        label: "Importar extrato Nubank",
        sub: "CSV/OFX",
        group: "Ações",
        icon: Upload,
        run: () => {
          router.push("/caixa?importar=1" as Route);
          onClose();
        },
      },
      {
        key: "acao:sync-amazon",
        label: "Sincronizar Amazon agora",
        sub: "Pedidos + estoque",
        group: "Ações",
        icon: RefreshCw,
        run: async () => {
          onClose();
          toast.loading("Disparando sync...", { id: "sync-amazon" });
          try {
            const r = await fetch("/api/amazon/sync", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ tipo: "ORDERS", diasAtras: 3 }),
            });
            if (r.ok) {
              toast.success("Sync de pedidos disparado", { id: "sync-amazon" });
              qc.invalidateQueries({ queryKey: ["amazon-status"] });
            } else {
              toast.error("Falha ao disparar sync", { id: "sync-amazon" });
            }
          } catch {
            toast.error("Erro de rede", { id: "sync-amazon" });
          }
        },
      },
      {
        key: "acao:sync-settlement",
        label: "Sincronizar settlement Amazon",
        sub: "Baixa CSV financeiro",
        group: "Ações",
        icon: RefreshCw,
        run: async () => {
          onClose();
          toast.loading("Buscando settlement...", { id: "sync-sett" });
          try {
            const r = await fetch("/api/amazon/sync-settlement", { method: "POST" });
            if (r.ok) {
              toast.success("Settlement sincronizado", { id: "sync-sett" });
            } else {
              toast.error("Falha", { id: "sync-sett" });
            }
          } catch {
            toast.error("Erro de rede", { id: "sync-sett" });
          }
        },
      },
      {
        key: "acao:marcar-recebida",
        label: "Marcar liquidação como recebida",
        sub: "Vai para Contas a Receber",
        group: "Ações",
        icon: CheckCircle2,
        run: () => {
          router.push("/contas-a-receber" as Route);
          onClose();
        },
      },
      {
        key: "acao:health",
        label: "Ver saúde do sistema",
        sub: "Worker, fila, quotas",
        group: "Ações",
        icon: ScrollText,
        run: () => {
          router.push("/sistema" as Route);
          onClose();
        },
      },
    ],
    [router, qc, onClose],
  );

  // Constrói lista plana de resultados de acordo com o modo.
  const flat = React.useMemo<FlatItem[]>(() => {
    // MODO AÇÕES
    if (modo === "acoes") {
      if (!queryAjustada) return acoesRapidas;
      const q = normalize(queryAjustada);
      return acoesRapidas.filter(
        (a) =>
          normalize(a.label).includes(q) || normalize(a.sub ?? "").includes(q),
      );
    }

    // MODO NAVEGAÇÃO
    const items: FlatItem[] = [];

    // Páginas (filtra client-side por label/keywords/group)
    const q = normalize(queryAjustada);
    const paginas = queryAjustada
      ? ALL_NAV_ITEMS.filter(
          (it) =>
            normalize(it.label).includes(q) ||
            normalize((it.keywords ?? []).join(" ")).includes(q) ||
            normalize(it.group).includes(q),
        )
      : ALL_NAV_ITEMS;

    for (const p of paginas) {
      items.push({
        key: `pagina:${p.href}`,
        label: p.label,
        group: `Páginas — ${p.group}`,
        icon: p.icon,
        run: () => {
          router.push(p.href);
          onClose();
        },
      });
    }

    // Dados remotos
    if (dadosRemotos) {
      const grupos: Array<keyof BuscaResposta> = [
        "produtos",
        "contas",
        "fornecedores",
        "documentos",
      ];
      for (const g of grupos) {
        for (const it of dadosRemotos[g]) {
          items.push({
            key: `${it.tipo}:${it.id}`,
            label: it.label,
            sub: it.sub,
            group: TIPO_GROUP[it.tipo],
            icon: TIPO_ICON[it.tipo],
            run: () => {
              router.push(it.href as Route);
              onClose();
            },
          });
        }
      }
    }

    return items;
  }, [modo, queryAjustada, dadosRemotos, acoesRapidas, router, onClose]);

  // Agrupa por group label, preservando ordem
  const grupos = React.useMemo(() => {
    const map = new Map<string, FlatItem[]>();
    for (const item of flat) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    return [...map.entries()];
  }, [flat]);

  React.useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

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
      if (item) item.run();
    }
  }

  // Indices flat para a render
  const renderedGroups = React.useMemo(() => {
    let idx = 0;
    return grupos.map(([groupLabel, items]) => ({
      groupLabel,
      rows: items.map((item) => ({ item, idx: idx++ })),
    }));
  }, [grupos]);

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-150" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-[12vh] z-50 w-[min(92vw,640px)] -translate-x-1/2",
            "rounded-xl border bg-popover shadow-2xl",
            "animate-in fade-in-0 zoom-in-95 slide-in-from-top-4 duration-150",
          )}
          onKeyDown={onKeyDown}
          aria-label="Paleta de comandos"
        >
          <DialogPrimitive.Title className="sr-only">Paleta de comandos</DialogPrimitive.Title>

          {/* Search bar */}
          <div className="flex items-center gap-3 border-b px-4 py-3">
            {modo === "acoes" ? (
              <Zap className="h-4 w-4 shrink-0 text-amber-500" />
            ) : (
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                modo === "acoes"
                  ? "Buscar ação..."
                  : "Buscar produtos, contas, fornecedores ou digite > para ações"
              }
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {carregandoRemoto && (
              <span className="text-[10px] text-muted-foreground">buscando…</span>
            )}
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

          {/* Hint quando query vazia */}
          {!queryAjustada && modo === "navegacao" && (
            <div className="border-b px-4 py-2 text-[11px] text-muted-foreground">
              Digite ao menos 2 caracteres para buscar produtos/contas. Use{" "}
              <kbd className="rounded border border-border/70 bg-muted/50 px-1 py-0.5 font-mono text-[10px]">
                {">"}
              </kbd>{" "}
              para entrar no modo de ações rápidas.
            </div>
          )}

          {/* Results */}
          <div ref={listRef} className="max-h-[420px] overflow-y-auto p-1.5">
            {flat.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {queryAjustada
                  ? `Nenhum resultado para "${queryAjustada}"`
                  : "Nenhuma sugestão"}
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
                        key={item.key}
                        type="button"
                        data-cmd-idx={idx}
                        onClick={() => item.run()}
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
                        <div className="flex min-w-0 flex-1 flex-col text-left">
                          <span className="truncate">{item.label}</span>
                          {item.sub && (
                            <span className="truncate text-[11px] text-muted-foreground">
                              {item.sub}
                            </span>
                          )}
                        </div>
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
              <kbd className="rounded border border-border/50 bg-muted/50 px-1 py-0.5 font-mono text-[10px]">
                ↑↓
              </kbd>
              navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border/50 bg-muted/50 px-1 py-0.5 font-mono text-[10px]">
                ↵
              </kbd>
              abrir
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border/50 bg-muted/50 px-1 py-0.5 font-mono text-[10px]">
                ESC
              </kbd>
              fechar
            </span>
            <span className="ml-auto">
              {modo === "acoes" ? "Modo: ações" : "Modo: navegação"}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
