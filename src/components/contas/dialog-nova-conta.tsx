"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Sparkles, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { parseValorBRParaCentavos, formatBRL } from "@/lib/money";
import { fetchJSON } from "@/lib/fetcher";
import { Badge } from "@/components/ui/badge";
import { StatusConta } from "@/modules/shared/domain";

type Categoria = { id: string; nome: string; tipo: string };
type ContaSugerida = {
  id: string;
  descricao: string;
  valor: number;
  vencimento: string;
  status: string;
  nfNome: string | null;
  fornecedor: { id: string; nome: string; documento?: string | null };
  categoria: { id: string; nome: string };
  score: number;
  motivos: string[];
};

type SugestaoConta = {
  modo: "NOVA" | "EXISTENTE" | "CANDIDATOS";
  candidatos: ContaSugerida[];
};

const CATEGORIAS_CONTA_PAGAR_VISIVEIS = new Set([
  "Compra de mercadorias / produtos",
  "Fretes e entregas",
  "Contabilidade",
  "Impostos",
  "Marketing",
  "Despesas operacionais",
  "Serviços terceirizados",
  "Tecnologia e sistemas",
  "Taxas de plataformas / pagamentos",
]);

type RespostaExtracaoDocumento = {
  error?: string;
  fornecedor?: string;
  cnpj?: string;
  valor?: number;
  vencimento?: string;
  descricao?: string;
  numero?: string | null;
  nfAnexo?: string | null;
  nfNome?: string;
  sugestaoConta?: SugestaoConta;
};

export type PrefillNovaConta = {
  dossieId?: string;
  fornecedorNome?: string;
  fornecedorDocumento?: string;
  descricao?: string;
  valorCentavos?: number;
  vencimento?: string;
};

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function addMesISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  dt.setMonth(dt.getMonth() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate(),
  ).padStart(2, "0")}`;
}

function formatCentavosParaInput(valorCentavos: number) {
  return (valorCentavos / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function DialogNovaConta({
  aberto,
  onOpenChange,
  prefill,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  prefill?: PrefillNovaConta;
}) {
  const qc = useQueryClient();

  // Campos do formulário
  const [fornecedor, setFornecedor] = React.useState("");
  const [fornecedorDoc, setFornecedorDoc] = React.useState("");
  const [valor, setValor] = React.useState("");
  const [vencimento, setVencimento] = React.useState(addMesISO(hojeISO()));
  const [categoriaId, setCategoriaId] = React.useState("");
  const [descricao, setDescricao] = React.useState("");
  const [recorrencia, setRecorrencia] = React.useState("NENHUMA");
  const [observacoes, setObservacoes] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [dossieId, setDossieId] = React.useState("");

  // NF
  const [nfAnexo, setNfAnexo] = React.useState<string | null>(null);
  const [nfNome, setNfNome] = React.useState<string | null>(null);
  const [analisandoNF, setAnalisandoNF] = React.useState(false);
  const [nfExtracted, setNfExtracted] = React.useState(false);
  const [sugestaoConta, setSugestaoConta] = React.useState<SugestaoConta | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const { data: categorias = [] } = useQuery<Categoria[]>({
    queryKey: ["categorias"],
    queryFn: () => fetchJSON<Categoria[]>("/api/categorias"),
  });

  const categoriasContaPagarBase = categorias.filter(
    (c) =>
      (c.tipo === "DESPESA" || c.tipo === "AMBAS") &&
      CATEGORIAS_CONTA_PAGAR_VISIVEIS.has(c.nome),
  );
  const categoriaSelecionada = categorias.find((c) => c.id === categoriaId);
  const categoriasContaPagar =
    categoriaSelecionada &&
    !categoriasContaPagarBase.some((c) => c.id === categoriaSelecionada.id)
      ? [...categoriasContaPagarBase, categoriaSelecionada]
      : categoriasContaPagarBase;

  React.useEffect(() => {
    if (!aberto || !prefill) return;
    setDossieId(prefill.dossieId ?? "");
    setFornecedor(prefill.fornecedorNome ?? "");
    setFornecedorDoc(prefill.fornecedorDocumento ?? "");
    setDescricao(prefill.descricao ?? "");
    if (typeof prefill.valorCentavos === "number") {
      setValor(formatCentavosParaInput(prefill.valorCentavos));
    }
    setVencimento(prefill.vencimento ?? hojeISO());
    setErro(null);
  }, [aberto, prefill]);

  const mutation = useMutation({
    mutationFn: async () => {
      const valorCentavos = parseValorBRParaCentavos(valor);
      if (!fornecedor.trim()) throw new Error("fornecedor obrigatório");
      if (valorCentavos <= 0) throw new Error("valor deve ser > 0");
      if (!vencimento) throw new Error("vencimento obrigatório");
      if (!categoriaId) throw new Error("selecione uma categoria");
      if (!descricao.trim()) throw new Error("descrição obrigatória");

      return fetchJSON("/api/contas", {
        method: "POST",
        body: JSON.stringify({
          fornecedorNome: fornecedor.trim(),
          fornecedorDocumento: fornecedorDoc.trim() || undefined,
          categoriaId,
          descricao: descricao.trim(),
          valorCentavos,
          vencimento,
          recorrencia,
          observacoes: observacoes.trim() || undefined,
          nfAnexo: nfAnexo ?? undefined,
          nfNome: nfNome ?? undefined,
          dossieId: dossieId || undefined,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contas"] });
      resetar();
      onOpenChange(false);
    },
    onError: (e) => setErro(e instanceof Error ? e.message : "falha ao salvar"),
  });

  const vincularDocumento = useMutation({
    mutationFn: async (contaId: string) => {
      if (!nfAnexo || !nfNome) throw new Error("anexo da NF/boleto não encontrado");
      return fetchJSON(`/api/contas/${contaId}`, {
        method: "PATCH",
        body: JSON.stringify({
          nfAnexo,
          nfNome,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contas"] });
      resetar();
      onOpenChange(false);
    },
    onError: (e) =>
      setErro(e instanceof Error ? e.message : "falha ao vincular documento"),
  });

  function resetar() {
    setFornecedor("");
    setFornecedorDoc("");
    setValor("");
    setVencimento(addMesISO(hojeISO()));
    setCategoriaId("");
    setDescricao("");
    setRecorrencia("NENHUMA");
    setObservacoes("");
    setDossieId("");
    setNfAnexo(null);
    setNfNome(null);
    setNfExtracted(false);
    setSugestaoConta(null);
    setErro(null);
  }

  async function analisarNF(file: File) {
    setAnalisandoNF(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", file);
      const res = await fetch("/api/contas/nf-extract", { method: "POST", body: fd });
      const dados: RespostaExtracaoDocumento = await res.json();

      if (!res.ok) {
        setErro(dados.error ?? "falha ao analisar NF");
        return;
      }

      // Preenche os campos com os dados extraídos
      if (dados.fornecedor) setFornecedor(dados.fornecedor);
      if (dados.cnpj) setFornecedorDoc(dados.cnpj);
      if (dados.descricao) setDescricao(dados.descricao);
      if (dados.valor && dados.valor > 0) {
        // Converte decimal para formato BR (ex: 1234.56 → "1.234,56")
        setValor(
          dados.valor
            .toFixed(2)
            .replace(".", ",")
            .replace(/\B(?=(\d{3})+(?!\d))/g, "."),
        );
      }
      if (dados.vencimento) setVencimento(dados.vencimento);
      if (dados.nfAnexo) setNfAnexo(dados.nfAnexo);
      if (dados.sugestaoConta?.candidatos[0] && !categoriaId) {
        setCategoriaId(dados.sugestaoConta.candidatos[0].categoria.id);
      }
      setNfNome(file.name);
      setNfExtracted(true);
      setSugestaoConta(dados.sugestaoConta ?? null);
    } catch {
      setErro("falha ao enviar arquivo para análise");
    } finally {
      setAnalisandoNF(false);
    }
  }

  function onArquivoSelecionado(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    analisarNF(file);
    // Limpa o input para permitir re-seleção do mesmo arquivo
    e.target.value = "";
  }

  function submeter(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    mutation.mutate();
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) resetar();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Nova conta a pagar
          </DialogTitle>
        </DialogHeader>

        {/* Seção NF */}
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              Anexar nota fiscal / boleto
            </div>
            {nfExtracted && nfNome && (
              <button
                type="button"
                onClick={() => {
                  setNfAnexo(null);
                  setNfNome(null);
                  setNfExtracted(false);
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
                {nfNome}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Envie uma imagem (JPG, PNG) ou PDF — os dados são extraídos automaticamente
            pela IA e preenchem o formulário abaixo.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              className="hidden"
              onChange={onArquivoSelecionado}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={analisandoNF}
              onClick={() => fileInputRef.current?.click()}
            >
              {analisandoNF ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analisando…
                </>
              ) : (
                "Selecionar arquivo"
              )}
            </Button>
            {nfExtracted && (
              <span className="flex items-center gap-1 text-xs text-emerald-600">
                <Sparkles className="h-3 w-3" />
                Dados extraídos — revise antes de salvar
              </span>
            )}
          </div>
        </div>

        {dossieId && (
          <div className="rounded-md border border-emerald-600/30 bg-emerald-600/10 p-3 text-sm text-emerald-800">
            Esta conta sera vinculada ao dossie de documentos recebido. Se outro
            arquivo da mesma compra chegar depois, ele sera anexado no mesmo
            grupo.
          </div>
        )}

        {sugestaoConta && (
          <PainelSugestaoConta
            sugestao={sugestaoConta}
            vincularPendente={vincularDocumento.isPending}
            onVincular={(contaId) => {
              setErro(null);
              vincularDocumento.mutate(contaId);
            }}
          />
        )}

        <form onSubmit={submeter} className="space-y-3">
          {/* Fornecedor + CNPJ */}
          <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
            <div className="space-y-1.5">
              <Label htmlFor="fornecedor">Fornecedor</Label>
              <Input
                id="fornecedor"
                value={fornecedor}
                onChange={(e) => setFornecedor(e.target.value)}
                placeholder="Nome da empresa ou pessoa"
                required
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cnpj">CNPJ / CPF</Label>
              <Input
                id="cnpj"
                value={fornecedorDoc}
                onChange={(e) => setFornecedorDoc(e.target.value)}
                placeholder="opcional"
                maxLength={20}
              />
            </div>
          </div>

          {/* Valor + Vencimento */}
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="valor">Valor (R$)</Label>
              <Input
                id="valor"
                placeholder="0,00"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                required
                className="font-mono text-base"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vencimento">Vencimento</Label>
              <Input
                id="vencimento"
                type="date"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Categoria */}
          <div className="space-y-1.5">
            <Label htmlFor="categoria">Categoria</Label>
            <Select
              id="categoria"
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
              required
            >
              <option value="">— selecione —</option>
              {categoriasContaPagar.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </div>

          {/* Descrição */}
          <div className="space-y-1.5">
            <Label htmlFor="descricao">Descrição</Label>
            <Input
              id="descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              required
              maxLength={300}
              placeholder="Ex: mensalidade contabilidade abril"
            />
          </div>

          {/* Recorrência */}
          <div className="space-y-1.5">
            <Label htmlFor="recorrencia">Recorrência</Label>
            <Select
              id="recorrencia"
              value={recorrencia}
              onChange={(e) => setRecorrencia(e.target.value)}
            >
              <option value="NENHUMA">Nenhuma (conta única)</option>
              <option value="MENSAL">Mensal (gera próxima ao pagar)</option>
            </Select>
          </div>

          {/* Observações */}
          <div className="space-y-1.5">
            <Label htmlFor="observacoes">
              Observações{" "}
              <span className="text-muted-foreground text-xs font-normal">opcional</span>
            </Label>
            <Textarea
              id="observacoes"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Ex: boleto referente ao mês de abril"
            />
          </div>

          {erro && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive">
              {erro}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending || analisandoNF || vincularDocumento.isPending
              }
            >
              {mutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PainelSugestaoConta({
  sugestao,
  vincularPendente,
  onVincular,
}: {
  sugestao: SugestaoConta;
  vincularPendente: boolean;
  onVincular: (contaId: string) => void;
}) {
  if (sugestao.modo === "NOVA") {
    return (
      <div className="rounded-md border border-emerald-600/30 bg-emerald-600/10 p-3 text-sm">
        <div className="font-medium text-emerald-700">Documento parece novo</div>
        <p className="mt-1 text-xs text-emerald-700/90">
          Não encontrei conta parecida no ERP. Você pode seguir e salvar como nova conta a pagar.
        </p>
      </div>
    );
  }

  const titulo =
    sugestao.modo === "EXISTENTE"
      ? "Encontrei uma conta muito compatível"
      : "Encontrei contas parecidas";
  const subtitulo =
    sugestao.modo === "EXISTENTE"
      ? "Se for a mesma conta, vincule o documento direto para evitar duplicidade."
      : "Revise os candidatos abaixo. Se nenhum bater, você ainda pode salvar como nova conta.";

  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
      <div>
        <div className="text-sm font-medium text-amber-900">{titulo}</div>
        <p className="mt-1 text-xs text-amber-900/80">{subtitulo}</p>
      </div>

      <div className="space-y-2">
        {sugestao.candidatos.map((conta) => (
          <div key={conta.id} className="rounded-md border bg-background/80 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{conta.descricao}</span>
                  <Badge variant={variantStatus(conta.status)}>
                    {conta.status.toLowerCase()}
                  </Badge>
                  <Badge variant="outline">{Math.round(conta.score)} pts</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {conta.fornecedor.nome} · {formatBRL(conta.valor)} · vence em{" "}
                  {formatarDataConta(conta.vencimento)}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {conta.motivos.map((motivo) => (
                    <span
                      key={motivo}
                      className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {motivo}
                    </span>
                  ))}
                </div>
                {conta.nfNome && (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Já possui anexo: {conta.nfNome}
                  </div>
                )}
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={vincularPendente}
                onClick={() => onVincular(conta.id)}
              >
                {vincularPendente ? "Vinculando..." : "Vincular aqui"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function variantStatus(status: string): "secondary" | "destructive" | "success" | "outline" {
  switch (status) {
    case StatusConta.ABERTA:
      return "secondary";
    case StatusConta.VENCIDA:
      return "destructive";
    case StatusConta.PAGA:
      return "success";
    default:
      return "outline";
  }
}

function formatarDataConta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}
