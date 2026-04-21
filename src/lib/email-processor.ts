// Routes email attachments to the right import service.
// Called by /api/email/sincronizar.

import { parse as csvParseSync } from "csv-parse/sync";
import { db } from "@/lib/db";
import { contasReceberService } from "@/modules/contas-a-receber/service";
import { financeiroService } from "@/modules/financeiro/service";
import {
  isFormatoNubank,
  limparDescricaoNubank,
  sugerirCategoriaNubank,
} from "@/lib/importadores/nubank";
import { parseOFX } from "@/lib/importadores/ofx";
import { linhaImportacaoSchema } from "@/modules/financeiro/schemas";
import { FormatoImportacao } from "@/modules/shared/domain";
import type { AnexoEmail } from "@/lib/gmail";

export type ResultadoProcessamento = {
  arquivo: string;
  tipo: TipoImportacao;
  registros: number;
  mensagem?: string;
};

export type TipoImportacao =
  | "AMAZON_CSV"
  | "NUBANK_CSV"
  | "NUBANK_OFX"
  | "IGNORADO"
  | "ERRO";

// ─── Type detection ───────────────────────────────────────────────────────────

function detectarTipo(anexo: AnexoEmail): TipoImportacao {
  const nome = anexo.nomeArquivo.toLowerCase();
  const remetente = anexo.remetente.toLowerCase();
  const assunto = anexo.assunto.toLowerCase();

  // Amazon: filename or sender
  if (
    nome.includes("unifiedtransaction") ||
    nome.includes("unified_transaction") ||
    nome.includes("settlement") ||
    (remetente.includes("amazon") && nome.endsWith(".csv"))
  ) {
    return "AMAZON_CSV";
  }

  // Nubank: sender or filename
  if (remetente.includes("nubank") || assunto.includes("nubank") || nome.includes("nubank")) {
    if (nome.endsWith(".ofx") || nome.endsWith(".qfx")) return "NUBANK_OFX";
    if (nome.endsWith(".csv")) return "NUBANK_CSV";
  }

  // Try to detect Nubank CSV by content (header check)
  if (nome.endsWith(".csv")) {
    try {
      const texto = anexo.dados.toString("utf-8");
      const primeiraLinha = texto.split("\n")[0]?.trim() ?? "";
      const headers = primeiraLinha.split(",").map((h) => h.replace(/"/g, "").trim());
      if (isFormatoNubank(headers)) return "NUBANK_CSV";
      // Check Amazon CSV: "settlement-start-date" or "transaction-type" header
      if (
        primeiraLinha.includes("settlement-start-date") ||
        primeiraLinha.includes("transaction-type") ||
        primeiraLinha.includes("settlement id")
      ) {
        return "AMAZON_CSV";
      }
    } catch {
      // ignore parse errors
    }
  }

  return "IGNORADO";
}

// ─── Category resolution ──────────────────────────────────────────────────────

type CatRow = { id: string; nome: string; tipo: string };
let _catCache: CatRow[] | null = null;

async function getCategorias(): Promise<CatRow[]> {
  if (_catCache) return _catCache;
  _catCache = await db.categoria.findMany({ select: { id: true, nome: true, tipo: true } });
  return _catCache;
}

async function resolverCategoriaId(sugestao: string | null, isEntrada: boolean): Promise<string | null> {
  const cats = await getCategorias();
  if (!cats.length) return null;

  if (sugestao) {
    const q = sugestao.toLowerCase();
    const match = cats.find(
      (c) => c.nome.toLowerCase() === q || c.nome.toLowerCase().includes(q),
    );
    if (match) return match.id;
  }

  // Fallback to first RECEITA for entries, DESPESA for expenses
  const tipoDesejado = isEntrada ? "RECEITA" : "DESPESA";
  const fallback =
    cats.find((c) => c.tipo === tipoDesejado || c.tipo === "AMBAS") ?? cats[0];
  return fallback?.id ?? null;
}

// ─── Processors ───────────────────────────────────────────────────────────────

async function processarAmazonCSV(anexo: AnexoEmail): Promise<ResultadoProcessamento> {
  const conteudo = anexo.dados.toString("utf-8");
  const resumo = await contasReceberService.importarAmazonCSV(conteudo);
  return {
    arquivo: anexo.nomeArquivo,
    tipo: "AMAZON_CSV",
    registros: resumo.liquidacoes.length,
    mensagem: `${resumo.liquidacoes.length} liquidações · ${resumo.periodo}`,
  };
}

async function processarNubankCSV(anexo: AnexoEmail): Promise<ResultadoProcessamento> {
  const conteudo = anexo.dados.toString("utf-8");

  const rows = csvParseSync(conteudo, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  if (!rows.length) {
    return { arquivo: anexo.nomeArquivo, tipo: "NUBANK_CSV", registros: 0, mensagem: "Arquivo vazio" };
  }

  const linhas: {
    data: Date;
    descricao: string;
    valorCentavos: number;
    categoriaId: string;
  }[] = [];

  for (const row of rows) {
    const dataStr = row["Data"] ?? row["data"] ?? "";
    const valorStr = row["Valor"] ?? row["valor"] ?? "";
    const descricaoOriginal = row["Descrição"] ?? row["descricao"] ?? row["Descricao"] ?? "";

    if (!dataStr || !valorStr) continue;

    // Parse date: "DD/MM/YYYY" or "YYYY-MM-DD"
    let data: Date;
    if (/^\d{2}\/\d{2}\/\d{4}/.test(dataStr)) {
      const [d, m, y] = dataStr.split("/");
      data = new Date(Number(y), Number(m) - 1, Number(d));
    } else {
      data = new Date(dataStr);
    }
    if (isNaN(data.getTime())) continue;

    const valor = parseFloat(valorStr.replace(",", "."));
    if (isNaN(valor) || valor === 0) continue;

    const valorCentavos = Math.round(valor * 100);
    const isEntrada = valorCentavos > 0;

    const descricao = limparDescricaoNubank(descricaoOriginal);
    const sugestao = sugerirCategoriaNubank(descricaoOriginal);
    const categoriaId = await resolverCategoriaId(sugestao, isEntrada);
    if (!categoriaId) continue;

    linhas.push({ data, descricao, valorCentavos, categoriaId });
  }

  if (!linhas.length) {
    return { arquivo: anexo.nomeArquivo, tipo: "NUBANK_CSV", registros: 0, mensagem: "Nenhuma linha válida" };
  }

  const linhasParseadas = linhas.map((l) =>
    linhaImportacaoSchema.parse({
      data: l.data,
      descricao: l.descricao,
      valorCentavos: l.valorCentavos,
      categoriaId: l.categoriaId,
    }),
  );

  await financeiroService.importarLote(linhasParseadas, {
    nomeArquivo: anexo.nomeArquivo,
    formato: FormatoImportacao.NUBANK,
  });

  return { arquivo: anexo.nomeArquivo, tipo: "NUBANK_CSV", registros: linhas.length };
}

async function processarNubankOFX(anexo: AnexoEmail): Promise<ResultadoProcessamento> {
  const conteudo = anexo.dados.toString("utf-8");
  const transacoes = parseOFX(conteudo);

  if (!transacoes.length) {
    return { arquivo: anexo.nomeArquivo, tipo: "NUBANK_OFX", registros: 0, mensagem: "Sem transações" };
  }

  const linhas: {
    data: Date;
    descricao: string;
    valorCentavos: number;
    categoriaId: string;
  }[] = [];

  for (const t of transacoes) {
    const valorCentavos = Math.round(t.valor * 100);
    if (valorCentavos === 0) continue;
    const isEntrada = valorCentavos > 0;
    const categoriaId = await resolverCategoriaId(null, isEntrada);
    if (!categoriaId) continue;
    linhas.push({ data: t.data, descricao: t.descricao, valorCentavos, categoriaId });
  }

  if (!linhas.length) {
    return { arquivo: anexo.nomeArquivo, tipo: "NUBANK_OFX", registros: 0, mensagem: "Nenhuma linha válida" };
  }

  const linhasParseadas = linhas.map((l) =>
    linhaImportacaoSchema.parse({
      data: l.data,
      descricao: l.descricao,
      valorCentavos: l.valorCentavos,
      categoriaId: l.categoriaId,
    }),
  );

  await financeiroService.importarLote(linhasParseadas, {
    nomeArquivo: anexo.nomeArquivo,
    formato: FormatoImportacao.GENERICO,
  });

  return { arquivo: anexo.nomeArquivo, tipo: "NUBANK_OFX", registros: linhas.length };
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function processarAnexo(anexo: AnexoEmail): Promise<ResultadoProcessamento> {
  const tipo = detectarTipo(anexo);

  switch (tipo) {
    case "AMAZON_CSV":
      return processarAmazonCSV(anexo);
    case "NUBANK_CSV":
      return processarNubankCSV(anexo);
    case "NUBANK_OFX":
      return processarNubankOFX(anexo);
    default:
      return { arquivo: anexo.nomeArquivo, tipo: "IGNORADO", registros: 0, mensagem: "Tipo não reconhecido" };
  }
}
