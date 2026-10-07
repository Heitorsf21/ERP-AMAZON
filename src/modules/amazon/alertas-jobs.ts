// Avisos de job no sino: um aviso por INCIDENTE, não um por dia.
//
// Antes, todo job que esgotava as tentativas emitia "Job X falhou 5x" com
// dedupe por dia: o TRAFFIC_SYNC (403 por falta da permissão Brand Analytics)
// gerou 1 aviso/dia em cada empresa por meses, e um tropeço de rede de minutos
// no INVENTORY_SYNC também ia para o sino. Agora:
// - 403 da SP-API = falta de permissão: aviso explicativo na hora (sem retry);
// - falha comum só avisa se o job não conclui há mais de max(1 h, 2 ciclos);
// - o aviso não reabre enquanto o incidente continua e some quando o job volta
//   a concluir (`resolverAlertasDoJob` no sucesso).
import { db } from "@/lib/db";
import { emitirNotificacao, resolverNotificacoes } from "@/lib/notificacoes";
import { currentEmpresaIdOrDefault } from "@/lib/tenant-context";
import { StatusAmazonSyncJob, TipoNotificacao } from "@/modules/shared/domain";

export type ClasseFalhaJob = "PERMISSAO" | "COMUM";

const NOME_JOB: Record<string, string> = {
  ORDERS_SYNC: "pedidos",
  INVENTORY_SYNC: "estoque FBA",
  INVENTORY_SNAPSHOT: "histórico de estoque",
  FINANCES_SYNC: "taxas e repasses",
  FINANCES_BACKFILL: "histórico financeiro",
  REFUNDS_SYNC: "reembolsos",
  BUYBOX_CHECK: "buybox",
  CATALOG_REFRESH: "catálogo (imagens e títulos)",
  SETTLEMENT_REPORT_SYNC: "relatórios de liquidação",
  SETTLEMENT_BACKFILL: "histórico de liquidações",
  REPORTS_BACKFILL: "histórico de pedidos",
  REVIEWS_DISCOVERY: "pedidos de avaliação",
  REVIEWS_SEND: "pedidos de avaliação",
  LISTING_PRICE_SYNC: "preços dos anúncios",
  AMAZON_FEE_ESTIMATE_SYNC: "estimativa de taxas",
  TRAFFIC_SYNC: "tráfego (sessões e conversão)",
  FBA_REIMBURSEMENTS_SYNC: "ressarcimentos FBA",
  RETURNS_SYNC: "devoluções",
  FBA_STORAGE_SYNC: "taxas de armazenagem",
  AMAZON_ADS_REPORT_SYNC: "anúncios (Ads)",
  AMAZON_ADS_BACKFILL: "histórico de anúncios (Ads)",
  ADS_OPTIMIZER_CYCLE: "otimizador de anúncios",
};

/** Permissão (role) do app da Amazon que libera cada job, quando conhecida. */
const PERMISSAO_JOB: Record<string, string> = {
  TRAFFIC_SYNC: "Brand Analytics",
  LISTING_PRICE_SYNC: "Product Listing",
  CATALOG_REFRESH: "Product Listing",
};

const UMA_HORA_MS = 60 * 60_000;
const INTERVALO_PADRAO_MS = 30 * 60_000;
const CHAVE_FINANCES_PARADO = "finances-sync-parado";

function nomeJob(tipo: string): string {
  return NOME_JOB[tipo] ?? tipo;
}

export function classificarFalhaJob(erro: string): ClasseFalhaJob {
  return /->\s*403\b/.test(erro) && /unauthorized|forbidden|access.?denied/i.test(erro)
    ? "PERMISSAO"
    : "COMUM";
}

/** Falha comum só vira aviso se o job não conclui há mais de max(1 h, 2 ciclos). */
export function deveAlertarFalhaJob(input: {
  ultimoSucessoEm: Date | null;
  agora: Date;
  intervaloMs: number | null;
}): boolean {
  if (!input.ultimoSucessoEm) return true;
  const limite = Math.max(UMA_HORA_MS, 2 * (input.intervaloMs ?? INTERVALO_PADRAO_MS));
  return input.agora.getTime() - input.ultimoSucessoEm.getTime() >= limite;
}

export function chavesAlertaJob(tipo: string): string[] {
  const chaves = [`job_falhando:${tipo}`, `permissao_amazon:${tipo}`];
  if (tipo === "FINANCES_SYNC") chaves.push(CHAVE_FINANCES_PARADO);
  return chaves;
}

export function montarAlertaJob(tipo: string, classe: ClasseFalhaJob, erro: string) {
  const nome = nomeJob(tipo);
  if (classe === "PERMISSAO") {
    const permissao = PERMISSAO_JOB[tipo];
    return {
      tipo: TipoNotificacao.CONFIG_REVIEW,
      titulo: `Amazon sem permissão: ${nome}`,
      descricao:
        `A Amazon recusou o acesso (403) aos dados de ${nome}. ` +
        (permissao
          ? `Falta a permissão "${permissao}" no app desta conta na Amazon. `
          : "Falta uma permissão no app desta conta na Amazon. ") +
        "O resto da sincronização segue normal, e este aviso some sozinho quando a permissão for liberada.",
      dedupeKey: `permissao_amazon:${tipo}`,
    };
  }
  return {
    tipo: TipoNotificacao.JOB_FALHANDO,
    titulo: `Sincronização com falha: ${nome}`,
    descricao: `A sincronização de ${nome} não está concluindo. Último erro: ${erro.replace(/\s+/g, " ").slice(0, 200)}. O aviso some sozinho quando ela voltar.`,
    dedupeKey: `job_falhando:${tipo}`,
  };
}

/**
 * Chamado quando o job esgota as tentativas (ou falha por permissão, que não
 * tem retry). Roda sob o tenant do job. Devolve se o aviso foi emitido.
 */
export async function alertarFalhaDeJob(input: {
  tipo: string;
  erro: string;
  intervaloMs: number | null;
  agora?: Date;
}): Promise<boolean> {
  const classe = classificarFalhaJob(input.erro);
  if (classe === "COMUM") {
    const ultimo = await db.amazonSyncJob.findFirst({
      where: {
        empresaId: currentEmpresaIdOrDefault(),
        tipo: input.tipo,
        status: StatusAmazonSyncJob.SUCCESS,
      },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    });
    const alertar = deveAlertarFalhaJob({
      ultimoSucessoEm: ultimo?.finishedAt ?? null,
      agora: input.agora ?? new Date(),
      intervaloMs: input.intervaloMs,
    });
    if (!alertar) return false;
  }
  await emitirNotificacao({ ...montarAlertaJob(input.tipo, classe, input.erro), reabrirSeLida: false });
  return true;
}

/** Job concluiu: encerra o incidente (os avisos dele somem do sino). */
export async function resolverAlertasDoJob(tipo: string): Promise<void> {
  await resolverNotificacoes(chavesAlertaJob(tipo));
}

export { CHAVE_FINANCES_PARADO };
