"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, Sparkles, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ImportadorCSV } from "@/components/importador/importador-csv";
import type {
  MetaArquivo,
  ResultadoMapeamento,
} from "@/components/importador/importador-csv";
import { parseValorBRParaCentavos } from "@/lib/money";
import { parseDataBR } from "@/lib/date";
import { fetchJSON } from "@/lib/fetcher";
import {
  isFormatoNubank,
  limparDescricaoNubank,
  sugerirCategoriaNubank,
} from "@/lib/importadores/nubank";
import { FormatoImportacao } from "@/modules/shared/domain";
import { cn } from "@/lib/utils";

type Categoria = { id: string; nome: string; tipo: string };

type ImportacaoLote = {
  id: string;
  nomeArquivo: string;
  formato: string;
  totalLinhas: number;
  criadoEm: string;
};

// Payload enviado ao /api/movimentacoes/import: o backend aplica
// linhaImportacaoSchema (transforma valor assinado → tipo+abs).
type LinhaPayload = {
  data: string; // ISO
  descricao: string;
  valorCentavos: number; // pode ser negativo (saída)
  categoriaId: string;
};

const campos = [
  { chave: "data", label: "Data", obrigatorio: true, dica: "dd/mm/aaaa ou aaaa-mm-dd" },
  { chave: "descricao", label: "Descrição", obrigatorio: true },
  {
    chave: "valor",
    label: "Valor",
    obrigatorio: true,
    dica: "negativo = saída; positivo = entrada",
  },
  {
    chave: "categoria",
    label: "Categoria",
    obrigatorio: false,
    dica: "opcional — categoria sugerida pelo conteúdo",
  },
];

type Aba = "importar" | "historico";

export function DialogImportar({
  aberto,
  onOpenChange,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();

  const [aba, setAba] = React.useState<Aba>("importar");
  const [tratadorNubank, setTratadorNubank] = React.useState(false);

  const { data: categorias = [] } = useQuery<Categoria[]>({
    queryKey: ["categorias"],
    queryFn: () => fetchJSON<Categoria[]>("/api/categorias"),
  });

  const categoriaPorNome = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categorias) m.set(c.nome.toLowerCase(), c.id);
    return m;
  }, [categorias]);

  // Fallbacks silenciosos: prioriza nomes conhecidos; se não existirem, usa a
  // primeira categoria do tipo correspondente. Garante que toda linha resolve.
  const fallbackEntradaId = React.useMemo(() => {
    return (
      categoriaPorNome.get("outras receitas") ??
      categoriaPorNome.get("pagamento amazon") ??
      categorias.find((c) => c.tipo === "RECEITA" || c.tipo === "AMBAS")?.id ??
      ""
    );
  }, [categoriaPorNome, categorias]);

  const fallbackSaidaId = React.useMemo(() => {
    return (
      categoriaPorNome.get("despesas operacionais") ??
      categoriaPorNome.get("ajuste de saldo") ??
      categorias.find((c) => c.tipo === "DESPESA" || c.tipo === "AMBAS")?.id ??
      ""
    );
  }, [categoriaPorNome, categorias]);

  function mapearLinha(bruto: Record<string, string>): ResultadoMapeamento<LinhaPayload> {
    try {
      if (!bruto.data) return { ok: false, erro: "data vazia" };
      if (!bruto.descricao?.trim())
        return { ok: false, erro: "descrição vazia" };
      if (!bruto.valor) return { ok: false, erro: "valor vazio" };

      const data = parseDataBR(bruto.data);
      const descricaoOriginal = bruto.descricao.trim();
      const descricao = tratadorNubank
        ? limparDescricaoNubank(descricaoOriginal)
        : descricaoOriginal;

      // parseValorBRParaCentavos preserva o sinal. Ex: "-1.234,56" -> -123456.
      const centavos = parseValorBRParaCentavos(bruto.valor);
      if (centavos === 0) return { ok: false, erro: "valor zero" };

      let categoriaId = "";
      // 1) coluna "categoria" mapeada (Nubank não tem)
      if (bruto.categoria?.trim()) {
        const buscada = categoriaPorNome.get(bruto.categoria.trim().toLowerCase());
        if (buscada) categoriaId = buscada;
      }
      // 2) sugestão por palavra-chave (somente Nubank)
      if (!categoriaId && tratadorNubank) {
        const sugerida = sugerirCategoriaNubank(descricaoOriginal);
        if (sugerida) {
          const id = categoriaPorNome.get(sugerida.toLowerCase());
          if (id) categoriaId = id;
        }
      }
      // 3) fallback silencioso por sinal do valor
      if (!categoriaId) {
        categoriaId = centavos > 0 ? fallbackEntradaId : fallbackSaidaId;
      }
      if (!categoriaId) {
        return { ok: false, erro: "nenhuma categoria disponível no sistema" };
      }

      return {
        ok: true,
        dado: {
          data: data.toISOString(),
          descricao,
          valorCentavos: centavos,
          categoriaId,
        },
      };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : "erro" };
    }
  }

  async function onConfirmar(linhas: LinhaPayload[], meta: MetaArquivo) {
    const formato = tratadorNubank
      ? FormatoImportacao.NUBANK
      : FormatoImportacao.GENERICO;
    const r = await fetchJSON<{ criadas: number; loteId: string | null }>(
      "/api/movimentacoes/import",
      {
        method: "POST",
        body: JSON.stringify({
          nomeArquivo: meta.nomeArquivo,
          formato,
          linhas,
        }),
      },
    );
    qc.invalidateQueries({ queryKey: ["movimentacoes"] });
    qc.invalidateQueries({ queryKey: ["saldo"] });
    qc.invalidateQueries({ queryKey: ["importacoes"] });
    return r;
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) {
          setTratadorNubank(false);
          setAba("importar");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar extrato/planilha</DialogTitle>
        </DialogHeader>

        <div className="flex border-b">
          <AbaBotao
            ativo={aba === "importar"}
            onClick={() => setAba("importar")}
            icone={<Upload className="h-4 w-4" />}
            label="Importar"
          />
          <AbaBotao
            ativo={aba === "historico"}
            onClick={() => setAba("historico")}
            icone={<History className="h-4 w-4" />}
            label="Histórico"
          />
        </div>

        {aba === "importar" && (
          <div className="space-y-4">
            {tratadorNubank && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-600/40 bg-emerald-600/10 p-3 text-sm">
                <Sparkles className="h-4 w-4 text-emerald-600" />
                <span>
                  <strong>Nubank</strong> detectado — descrições e categorias
                  ajustadas automaticamente.
                </span>
              </div>
            )}

            <ImportadorCSV
              campos={campos}
              mapearLinha={mapearLinha}
              onConfirmar={onConfirmar}
              onCabecalhosDetectados={(headers) =>
                setTratadorNubank(isFormatoNubank(headers))
              }
            />
          </div>
        )}

        {aba === "historico" && <HistoricoImportacoes />}
      </DialogContent>
    </Dialog>
  );
}

function AbaBotao({
  ativo,
  onClick,
  icone,
  label,
}: {
  ativo: boolean;
  onClick: () => void;
  icone: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition",
        ativo
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icone}
      {label}
    </button>
  );
}

function HistoricoImportacoes() {
  const qc = useQueryClient();
  const { data: lotes = [], isLoading } = useQuery<ImportacaoLote[]>({
    queryKey: ["importacoes"],
    queryFn: () => fetchJSON<ImportacaoLote[]>("/api/movimentacoes/importacoes"),
  });

  const [removendoId, setRemovendoId] = React.useState<string | null>(null);

  const remover = useMutation({
    mutationFn: (id: string) =>
      fetchJSON<{ removidas: number }>(
        `/api/movimentacoes/importacoes/${id}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["importacoes"] });
      qc.invalidateQueries({ queryKey: ["movimentacoes"] });
      qc.invalidateQueries({ queryKey: ["saldo"] });
    },
    onSettled: () => setRemovendoId(null),
  });

  function confirmarRemocao(lote: ImportacaoLote) {
    toast.warning(`Remover "${lote.nomeArquivo}"?`, {
      description: `${lote.totalLinhas} movimentação(ões) serão excluídas. Ação irreversível.`,
      action: {
        label: "Remover",
        onClick: () => {
          setRemovendoId(lote.id);
          remover.mutate(lote.id);
        },
      },
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Carregando histórico…
      </div>
    );
  }

  if (lotes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 py-10 text-center text-sm text-muted-foreground">
        <History className="h-6 w-6" />
        <span>Nenhum arquivo importado ainda.</span>
      </div>
    );
  }

  return (
    <div className="max-h-[440px] space-y-2 overflow-auto">
      {lotes.map((lote) => (
        <div
          key={lote.id}
          className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 p-3"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">
                {lote.nomeArquivo}
              </span>
              {lote.formato === "NUBANK" && (
                <Badge variant="success" className="shrink-0">
                  Nubank
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatarDataHora(lote.criadoEm)} · {lote.totalLinhas} movimentação(ões)
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => confirmarRemocao(lote)}
            disabled={removendoId === lote.id}
            className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {removendoId === lote.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      ))}
    </div>
  );
}

// Formata "2026-04-16T13:45:00.000Z" como "16/04/2026 10:45" no fuso de SP.
function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
