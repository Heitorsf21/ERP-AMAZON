"use client";

import * as React from "react";
import { CheckCircle2, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseArquivoTabular } from "./parser";

// Componente reutilizável — pipe genérico "upload → (mapear, se necessário) →
// preview → confirmar". O caller injeta `mapearLinha` (regra de negócio) e
// `onConfirmar`. Quando todas as colunas obrigatórias casam automaticamente
// com o cabeçalho, a etapa de mapeamento é pulada.
export type CampoAlvo = {
  chave: string;
  label: string;
  obrigatorio?: boolean;
  dica?: string;
};

export type LinhaBruta = Record<string, string>;

export type ResultadoMapeamento<T> =
  | { ok: true; dado: T }
  | { ok: false; erro: string };

export type MetaArquivo = { nomeArquivo: string };

export type ImportadorProps<T> = {
  campos: CampoAlvo[];
  mapearLinha: (linha: Record<string, string>) => ResultadoMapeamento<T>;
  // Recebe as linhas válidas + metadados do arquivo (para registrar lote).
  onConfirmar: (
    dados: T[],
    meta: MetaArquivo,
  ) => Promise<{ criadas: number }>;
  // Disparado uma vez por upload, com os cabeçalhos detectados. Permite que o
  // caller reaja ao formato do arquivo (ex.: ativar tratador específico).
  onCabecalhosDetectados?: (headers: string[]) => void;
};

// Normaliza nome de coluna/campo para casamento robusto: remove acentos,
// downcase e tira não-alfanuméricos. Assim "Descrição" casa com "descricao".
function normalizarNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

type Etapa = "upload" | "mapear" | "preview" | "feito";

export function ImportadorCSV<T>({
  campos,
  mapearLinha,
  onConfirmar,
  onCabecalhosDetectados,
}: ImportadorProps<T>) {
  const [etapa, setEtapa] = React.useState<Etapa>("upload");
  const [nomeArquivo, setNomeArquivo] = React.useState<string>("");
  const [cabecalhos, setCabecalhos] = React.useState<string[]>([]);
  const [linhas, setLinhas] = React.useState<LinhaBruta[]>([]);
  const [mapeamento, setMapeamento] = React.useState<Record<string, string>>({});
  const [erroArquivo, setErroArquivo] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [resultado, setResultado] = React.useState<{ criadas: number } | null>(
    null,
  );
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = ev.target.files?.[0];
    if (!arquivo) return;
    setErroArquivo(null);
    try {
      const { headers, rows } = await parseArquivoTabular(arquivo);
      if (rows.length === 0) throw new Error("arquivo vazio");
      setNomeArquivo(arquivo.name);
      setCabecalhos(headers);
      setLinhas(rows);
      // Heurística: se um campo alvo tem o mesmo nome de uma coluna (ignorando
      // acentos, caixa e separadores), já pré-seleciona.
      const sugerido: Record<string, string> = {};
      for (const campo of campos) {
        const alvo = normalizarNome(campo.chave);
        const match = headers.find((h) => normalizarNome(h) === alvo);
        if (match) sugerido[campo.chave] = match;
      }
      setMapeamento(sugerido);
      onCabecalhosDetectados?.(headers);

      // Se todos os campos obrigatórios já têm coluna mapeada, vai direto pro
      // preview — esconde a etapa intermediária no caso comum.
      const obrigatoriosFaltando = campos
        .filter((c) => c.obrigatorio !== false && !sugerido[c.chave]);
      setEtapa(obrigatoriosFaltando.length === 0 ? "preview" : "mapear");
    } catch (e) {
      setErroArquivo(e instanceof Error ? e.message : "falha ao ler arquivo");
    }
  }

  function avancarParaPreview() {
    const faltando = campos
      .filter((c) => c.obrigatorio !== false && !mapeamento[c.chave])
      .map((c) => c.label);
    if (faltando.length > 0) {
      setErroArquivo(`mapeie: ${faltando.join(", ")}`);
      return;
    }
    setErroArquivo(null);
    setEtapa("preview");
  }

  const linhasMapeadas = React.useMemo(() => {
    if (etapa !== "preview" && etapa !== "feito") return [];
    return linhas.map((linha, idx) => {
      const bruto: Record<string, string> = {};
      for (const campo of campos) {
        const coluna = mapeamento[campo.chave];
        bruto[campo.chave] = coluna ? linha[coluna] ?? "" : "";
      }
      return { idx, bruto, resultado: mapearLinha(bruto) };
    });
  }, [etapa, linhas, campos, mapeamento, mapearLinha]);

  const totalErros = linhasMapeadas.filter((l) => !l.resultado.ok).length;
  const totalOk = linhasMapeadas.length - totalErros;

  async function confirmar() {
    const validos = linhasMapeadas
      .map((l) => (l.resultado.ok ? l.resultado.dado : null))
      .filter((x): x is T => x !== null);
    if (validos.length === 0) return;
    setEnviando(true);
    try {
      const r = await onConfirmar(validos, { nomeArquivo });
      setResultado(r);
      setEtapa("feito");
    } catch (e) {
      setErroArquivo(e instanceof Error ? e.message : "falha ao enviar");
    } finally {
      setEnviando(false);
    }
  }

  function resetar() {
    setEtapa("upload");
    setNomeArquivo("");
    setCabecalhos([]);
    setLinhas([]);
    setMapeamento({});
    setErroArquivo(null);
    setResultado(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      {erroArquivo && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {erroArquivo}
        </div>
      )}

      {etapa === "upload" && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="group flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 p-10 text-center transition hover:border-primary/60 hover:bg-muted/60"
        >
          <Upload className="h-8 w-8 text-muted-foreground transition group-hover:text-primary" />
          <div className="text-sm font-medium">
            Clique para selecionar o arquivo
          </div>
          <div className="text-xs text-muted-foreground">
            Aceita CSV ou XLSX
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFile}
            className="hidden"
          />
        </button>
      )}

      {(etapa === "mapear" || etapa === "preview" || etapa === "feito") &&
        nomeArquivo && (
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex items-center gap-2 truncate">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{nomeArquivo}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                · {linhas.length} linhas
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={resetar}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              trocar
            </Button>
          </div>
        )}

      {etapa === "mapear" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Não consegui identificar todas as colunas automaticamente. Associe
            os campos abaixo:
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {campos.map((campo) => (
              <div key={campo.chave} className="space-y-1">
                <Label>
                  {campo.label}
                  {campo.obrigatorio !== false && (
                    <span className="ml-1 text-destructive">*</span>
                  )}
                </Label>
                <Select
                  value={mapeamento[campo.chave] ?? ""}
                  onChange={(e) =>
                    setMapeamento((m) => ({
                      ...m,
                      [campo.chave]: e.target.value,
                    }))
                  }
                >
                  <option value="">— escolha a coluna —</option>
                  {cabecalhos.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </Select>
                {campo.dica && (
                  <p className="text-xs text-muted-foreground">{campo.dica}</p>
                )}
              </div>
            ))}
          </div>
          <Button onClick={avancarParaPreview}>Continuar</Button>
        </div>
      )}

      {etapa === "preview" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="success">{totalOk} válidas</Badge>
            {totalErros > 0 && (
              <Badge variant="destructive">{totalErros} com erro</Badge>
            )}
          </div>

          <div className="max-h-[420px] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  {campos.map((c) => (
                    <TableHead key={c.chave}>{c.label}</TableHead>
                  ))}
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhasMapeadas.slice(0, 100).map((l) => (
                  <TableRow key={l.idx}>
                    <TableCell className="text-muted-foreground">
                      {l.idx + 1}
                    </TableCell>
                    {campos.map((c) => (
                      <TableCell
                        key={c.chave}
                        className="max-w-[260px] truncate"
                      >
                        {l.bruto[c.chave]}
                      </TableCell>
                    ))}
                    <TableCell>
                      {l.resultado.ok ? (
                        <Badge variant="success">ok</Badge>
                      ) : (
                        <span className="text-xs text-destructive">
                          {l.resultado.erro}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {linhasMapeadas.length > 100 && (
              <p className="border-t bg-muted/30 p-2 text-xs text-muted-foreground">
                Mostrando primeiras 100 linhas. Todas serão importadas se
                estiverem válidas.
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={confirmar} disabled={enviando || totalOk === 0}>
              {enviando
                ? "Importando..."
                : `Importar ${totalOk} linha(s)${totalErros > 0 ? " (ignorando erros)" : ""}`}
            </Button>
          </div>
        </div>
      )}

      {etapa === "feito" && resultado && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-emerald-600/40 bg-emerald-600/10 p-3 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{resultado.criadas} registro(s) importado(s).</span>
          </div>
          <Button variant="outline" onClick={resetar}>
            Importar outro arquivo
          </Button>
        </div>
      )}
    </div>
  );
}
