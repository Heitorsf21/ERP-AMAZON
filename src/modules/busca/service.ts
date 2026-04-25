import { db } from "@/lib/db";

export type BuscaResultadoItem = {
  id: string;
  label: string;
  sub?: string;
  href: string;
  /** Tipo da entidade (usado no front para escolher ícone). */
  tipo: "produto" | "conta-pagar" | "fornecedor" | "documento";
};

export type BuscaResposta = {
  produtos: BuscaResultadoItem[];
  contas: BuscaResultadoItem[];
  fornecedores: BuscaResultadoItem[];
  documentos: BuscaResultadoItem[];
};

function formatBRL(centavos: number | null | undefined): string {
  if (centavos == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(centavos / 100);
}

function formatData(d: Date | null | undefined): string | null {
  if (!d) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/**
 * Busca multi-entidade. Cada entidade limitada a `limit` resultados.
 * Tudo em paralelo via Promise.all. Tempo alvo: < 50ms para SQLite local.
 */
export async function buscarGlobal(
  q: string,
  limit = 5,
): Promise<BuscaResposta> {
  const termo = q.trim();
  if (termo.length < 2) {
    return { produtos: [], contas: [], fornecedores: [], documentos: [] };
  }

  const [produtos, contas, fornecedores, documentos] = await Promise.all([
    // PRODUTOS — só MFS-, busca em sku/nome/asin
    db.produto.findMany({
      where: {
        sku: { startsWith: "MFS-" },
        OR: [
          { sku: { contains: termo } },
          { nome: { contains: termo } },
          { asin: { contains: termo } },
        ],
      },
      select: {
        id: true,
        sku: true,
        nome: true,
        asin: true,
        estoqueAtual: true,
      },
      orderBy: { nome: "asc" },
      take: limit,
    }),
    // CONTAS A PAGAR — busca em descricao + fornecedor.nome
    db.contaPagar.findMany({
      where: {
        OR: [
          { descricao: { contains: termo } },
          { fornecedor: { nome: { contains: termo } } },
        ],
      },
      select: {
        id: true,
        descricao: true,
        valor: true,
        vencimento: true,
        status: true,
        fornecedor: { select: { nome: true } },
      },
      orderBy: { vencimento: "desc" },
      take: limit,
    }),
    // FORNECEDORES — busca em nome + documento
    db.fornecedor.findMany({
      where: {
        OR: [
          { nome: { contains: termo } },
          { documento: { contains: termo } },
        ],
      },
      select: { id: true, nome: true, documento: true },
      orderBy: { nome: "asc" },
      take: limit,
    }),
    // DOCUMENTOS FINANCEIROS — busca em numeroDocumento + nomeArquivo + descricao
    db.documentoFinanceiro.findMany({
      where: {
        OR: [
          { numeroDocumento: { contains: termo } },
          { nomeArquivo: { contains: termo } },
          { descricao: { contains: termo } },
          { fornecedorNome: { contains: termo } },
        ],
      },
      select: {
        id: true,
        nomeArquivo: true,
        tipo: true,
        numeroDocumento: true,
        valor: true,
        fornecedorNome: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  return {
    produtos: produtos.map((p) => ({
      id: p.id,
      label: `${p.sku} — ${p.nome}`,
      sub: `Estoque: ${p.estoqueAtual}${p.asin ? ` · ASIN ${p.asin}` : ""}`,
      href: `/produtos/${p.id}`,
      tipo: "produto" as const,
    })),
    contas: contas.map((c) => ({
      id: c.id,
      label: c.descricao,
      sub: `${c.fornecedor.nome} · ${formatBRL(c.valor)} · venc. ${formatData(c.vencimento) ?? "—"} · ${c.status}`,
      href: `/contas-a-pagar`,
      tipo: "conta-pagar" as const,
    })),
    fornecedores: fornecedores.map((f) => ({
      id: f.id,
      label: f.nome,
      sub: f.documento ?? undefined,
      href: `/contas-a-pagar`,
      tipo: "fornecedor" as const,
    })),
    documentos: documentos.map((d) => ({
      id: d.id,
      label: d.numeroDocumento
        ? `${d.tipo === "BOLETO" ? "Boleto" : "NF"} ${d.numeroDocumento}`
        : d.nomeArquivo,
      sub: [
        d.fornecedorNome,
        d.valor != null ? formatBRL(d.valor) : null,
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
      href: `/notas-fiscais`,
      tipo: "documento" as const,
    })),
  };
}
