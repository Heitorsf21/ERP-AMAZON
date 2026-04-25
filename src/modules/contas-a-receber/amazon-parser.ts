/**
 * Parser para o CSV "Unified Transaction Report" da Amazon Seller Central.
 *
 * O relatório tem 9 linhas de cabeçalho descritivo antes da linha com os nomes
 * das colunas. Cada linha de dado contém 24 campos entre aspas, separados por
 * vírgula.
 *
 * Campos relevantes:
 *   [0] data/hora
 *   [1] id de liquidação
 *   [2] tipo (Pedido, Transferir, Reembolso, Ajuste, ...)
 *   [3] id do pedido
 *   [4] sku
 *   [5] descrição
 *   [6] quantidade
 *  [13] vendas do produto
 *  [18] tarifas de venda
 *  [19] taxas fba
 *  [22] total (líquido)
 *  [23] Status da transação (Liberado | Diferido)
 *  [24] Data de liberação da transação
 */

import {
  StatusTransacaoAmazon,
  TipoTransacaoAmazon,
} from "@/modules/shared/domain";

// ── Tipos ────────────────────────────────────────────────────────────

export type TransacaoAmazon = {
  dataHora: Date;
  liquidacaoId: string;
  tipo: string;
  pedidoId: string;
  sku: string;
  descricao: string;
  quantidade: number;
  vendasProduto: number; // centavos
  tarifasVenda: number; // centavos (negativo)
  taxasFba: number; // centavos (negativo)
  totalCentavos: number; // centavos, líquido
  status: string; // Liberado | Diferido
  dataLiberacao: Date | null;
};

export type ResumoLiquidacao = {
  liquidacaoId: string;
  totalPedidos: number;
  totalLiquidoCentavos: number; // soma dos totais dos pedidos
  totalTransferidoCentavos: number; // soma dos Transferir (negativo -> positivo)
  status: "PENDENTE" | "PARCIAL" | "TRANSFERIDO";
  primeiraData: Date;
  ultimaData: Date;
  dataTransferencia: Date | null;
};

export type ResumoImportacao = {
  periodo: string;
  totalTransacoes: number;
  pedidos: { quantidade: number; totalCentavos: number };
  transferencias: { quantidade: number; totalCentavos: number };
  reembolsos: { quantidade: number; totalCentavos: number };
  taxas: { quantidade: number; totalCentavos: number };
  diferidos: { quantidade: number; totalCentavos: number };
  liquidacoes: ResumoLiquidacao[];
};

// ── Helpers de parsing ─────────────���─────────────────────────────────

const HEADER_LINES = 9;

/** Converte "1.234,56" ou "-1.234,56" → centavos inteiros. */
function parseBRL(raw: string): number {
  const limpo = raw.replace(/"/g, "").trim();
  if (!limpo || limpo === "0") return 0;
  // formato BR: ponto como separador de milhar, vírgula como decimal
  const semMilhar = limpo.replace(/\./g, "");
  const comPonto = semMilhar.replace(",", ".");
  return Math.round(parseFloat(comPonto) * 100);
}

/**
 * Converte datas no formato Amazon:
 *   "28 de fev. de 2026 21:17:51 GMT-8"
 *   "8 de mar. de 2026 07:19:19 GMT-7"
 */
const MESES: Record<string, string> = {
  "jan.": "01",
  "fev.": "02",
  "mar.": "03",
  "abr.": "04",
  "mai.": "05",
  "jun.": "06",
  "jul.": "07",
  "ago.": "08",
  "set.": "09",
  "out.": "10",
  "nov.": "11",
  "dez.": "12",
};

function parseDataAmazon(raw: string): Date | null {
  const limpo = raw.replace(/"/g, "").trim();
  if (!limpo) return null;

  // "28 de fev. de 2026 21:17:51 GMT-8"
  const match =
    /^(\d{1,2}) de (\w+\.?) de (\d{4}) (\d{2}:\d{2}:\d{2}) GMT([+-]\d+)$/.exec(
      limpo,
    );
  if (!match) return null;

  const [, dia, mesAbrev, ano, hora, gmtOffset] = match;
  const mes = MESES[mesAbrev!] ?? MESES[mesAbrev! + "."];
  if (!mes) return null;

  // Normalizar offset: "GMT-8" → "-08:00", "GMT-7" → "-07:00"
  const offsetNum = parseInt(gmtOffset!, 10);
  const sign = offsetNum >= 0 ? "+" : "-";
  const abs = Math.abs(offsetNum).toString().padStart(2, "0");
  const offsetStr = `${sign}${abs}:00`;

  const isoStr = `${ano}-${mes}-${dia!.padStart(2, "0")}T${hora}${offsetStr}`;
  const d = new Date(isoStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Faz parse de uma linha CSV com campos entre aspas.
 * Lida com campos que contêm vírgulas dentro de aspas.
 */
function parseCSVLine(line: string): string[] {
  const campos: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      // Campo entre aspas
      let j = i + 1;
      let valor = "";
      while (j < line.length) {
        if (line[j] === '"') {
          if (j + 1 < line.length && line[j + 1] === '"') {
            valor += '"';
            j += 2;
          } else {
            j++; // pula aspa de fechamento
            break;
          }
        } else {
          valor += line[j];
          j++;
        }
      }
      campos.push(valor);
      // Pula vírgula separadora
      if (j < line.length && line[j] === ",") j++;
      i = j;
    } else if (line[i] === ",") {
      campos.push("");
      i++;
    } else {
      // Campo sem aspas
      let j = i;
      while (j < line.length && line[j] !== ",") j++;
      campos.push(line.substring(i, j));
      if (j < line.length) j++; // pula vírgula
      i = j;
    }
  }
  return campos;
}

// ── Parser principal ─────────────────────────────────────────────────

/**
 * Aceita string (UTF-8 já decodificada) ou Buffer/Uint8Array (vindo da SP-API
 * Reports API). O CSV da Amazon vem em UTF-8.
 */
export function parseAmazonCSV(
  conteudo: string | Buffer | Uint8Array,
): TransacaoAmazon[] {
  const texto =
    typeof conteudo === "string"
      ? conteudo
      : Buffer.from(conteudo).toString("utf8");
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());

  // Pula linhas de cabeçalho descritivo + linha de nomes de colunas
  const dataLines = linhas.slice(HEADER_LINES + 1);

  const transacoes: TransacaoAmazon[] = [];

  for (const linha of dataLines) {
    const campos = parseCSVLine(linha);
    if (campos.length < 24) continue;

    const dataHora = parseDataAmazon(campos[0]!);
    if (!dataHora) continue;

    transacoes.push({
      dataHora,
      liquidacaoId: campos[1]!.trim(),
      tipo: campos[2]!.trim(),
      pedidoId: campos[3]!.trim(),
      sku: campos[4]!.trim(),
      descricao: campos[5]!.trim(),
      quantidade: parseInt(campos[6]!.trim() || "0", 10),
      vendasProduto: parseBRL(campos[13]!),
      tarifasVenda: parseBRL(campos[18]!),
      taxasFba: parseBRL(campos[19]!),
      totalCentavos: parseBRL(campos[22]!),
      status: campos[23]!.trim(),
      dataLiberacao: campos[24] ? parseDataAmazon(campos[24]) : null,
    });
  }

  return transacoes;
}

// ── Resumo por liquidação ────────────────────────────────────────────

export function resumirImportacao(
  transacoes: TransacaoAmazon[],
): ResumoImportacao {
  // Agrupar por liquidação
  const porLiquidacao = new Map<string, TransacaoAmazon[]>();
  for (const t of transacoes) {
    if (!t.liquidacaoId) continue;
    const grupo = porLiquidacao.get(t.liquidacaoId) ?? [];
    grupo.push(t);
    porLiquidacao.set(t.liquidacaoId, grupo);
  }

  const liquidacoes: ResumoLiquidacao[] = [];
  for (const [lid, txns] of porLiquidacao) {
    const pedidos = txns.filter((t) => t.tipo === TipoTransacaoAmazon.PEDIDO);
    const transfers = txns.filter(
      (t) => t.tipo === TipoTransacaoAmazon.TRANSFERIR,
    );

    const totalLiquido = pedidos.reduce((s, t) => s + t.totalCentavos, 0);
    const totalTransferido = Math.abs(
      transfers.reduce((s, t) => s + t.totalCentavos, 0),
    );

    const datas = txns.map((t) => t.dataHora.getTime());
    const primeiraData = new Date(Math.min(...datas));
    const ultimaData = new Date(Math.max(...datas));

    const dataTransferencia =
      transfers.length > 0
        ? new Date(Math.max(...transfers.map((t) => t.dataHora.getTime())))
        : null;

    // Se houver qualquer linha de Transferir, a liquidação foi paga (pode ser em
    // múltiplas transferências por bandeira). A diferença entre totalLiquido e
    // totalTransferido não indica pagamento parcial — existe porque: (a) o
    // totalLiquido soma apenas Pedidos deste CSV, enquanto a liquidação pode ter
    // pedidos de outros períodos; (b) Reembolsos/Ajustes reduzem o líquido.
    let status: ResumoLiquidacao["status"];
    if (transfers.length === 0) {
      status = "PENDENTE";
    } else {
      status = "TRANSFERIDO";
    }

    liquidacoes.push({
      liquidacaoId: lid,
      totalPedidos: pedidos.length,
      totalLiquidoCentavos: totalLiquido,
      totalTransferidoCentavos: totalTransferido,
      status,
      primeiraData,
      ultimaData,
      dataTransferencia,
    });
  }

  // Totais gerais
  const pedidos = transacoes.filter(
    (t) => t.tipo === TipoTransacaoAmazon.PEDIDO,
  );
  const transfers = transacoes.filter(
    (t) => t.tipo === TipoTransacaoAmazon.TRANSFERIR,
  );
  const reembolsos = transacoes.filter(
    (t) => t.tipo === TipoTransacaoAmazon.REEMBOLSO,
  );
  const taxas = transacoes.filter(
    (t) =>
      t.tipo === TipoTransacaoAmazon.TAXA_ESTOQUE_FBA ||
      t.tipo === TipoTransacaoAmazon.TAXA_SERVICO,
  );
  const diferidos = transacoes.filter(
    (t) => t.status === StatusTransacaoAmazon.DIFERIDO,
  );

  // Período
  const todasDatas = transacoes.map((t) => t.dataHora.getTime());
  const inicio = new Date(Math.min(...todasDatas));
  const fim = new Date(Math.max(...todasDatas));
  const fmtData = (d: Date) =>
    `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getFullYear()}`;
  const periodo =
    transacoes.length > 0 ? `${fmtData(inicio)} — ${fmtData(fim)}` : "";

  return {
    periodo,
    totalTransacoes: transacoes.length,
    pedidos: {
      quantidade: pedidos.length,
      totalCentavos: pedidos.reduce((s, t) => s + t.totalCentavos, 0),
    },
    transferencias: {
      quantidade: transfers.length,
      totalCentavos: Math.abs(
        transfers.reduce((s, t) => s + t.totalCentavos, 0),
      ),
    },
    reembolsos: {
      quantidade: reembolsos.length,
      totalCentavos: reembolsos.reduce((s, t) => s + t.totalCentavos, 0),
    },
    taxas: {
      quantidade: taxas.length,
      totalCentavos: taxas.reduce((s, t) => s + t.totalCentavos, 0),
    },
    diferidos: {
      quantidade: diferidos.length,
      totalCentavos: diferidos.reduce((s, t) => s + t.totalCentavos, 0),
    },
    liquidacoes: liquidacoes.sort(
      (a, b) => a.primeiraData.getTime() - b.primeiraData.getTime(),
    ),
  };
}
