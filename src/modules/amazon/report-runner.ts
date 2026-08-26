/**
 * Helpers para o ciclo de vida de um Report SP-API:
 *   1) Se já existe pendingReportId, faz polling de status.
 *   2) Caso contrário, cria report novo para a janela [start, end].
 *   3) Quando DONE, baixa o documento e descomprime (se GZIP).
 *
 * O helper NÃO toca em DB — quem chamar é responsável por persistir cursor /
 * pendingReportId / windowEnd em ConfiguracaoSistema (ou onde fizer sentido).
 *
 * Isso evita duplicar a sequência createReport → poll → getReportDocument →
 * decompress em cada novo handler de backfill (orders, finances backfill,
 * future Sprint 3: reimbursements / returns / storage fees).
 */
import { gunzipSync } from "node:zlib";
import {
  createReport,
  getReport,
  getReportDocument,
  type SPAPICredentials,
  type SPReport,
} from "@/lib/amazon-sp-api";

/**
 * Um reportId pendente pode ficar ILEGIVEL de forma permanente: a Amazon expira
 * reports antigos e responde 403/404 ao consultar, e um report criado por OUTRA
 * aplicacao LWA tambem devolve 403 ("Access to the resource is forbidden").
 *
 * Sem tratar isso, o `pendingReportId` gravado em ConfiguracaoSistema nunca era
 * limpo: o job repetia o mesmo GET para sempre e NUNCA criava report novo. Foi
 * o que travou o TRAFFIC_SYNC das duas empresas por ~45 dias (KPIs de trafego
 * congelados). Aqui o erro permanente vira FAILED, e o handler limpa as chaves
 * e recria o report no ciclo seguinte.
 */
const HTTP_PERMANENTE_REPORT = [400, 403, 404, 410];

export function isReportIlegivelPermanente(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // 429 (quota) e 5xx sao transitorios — precisam continuar propagando para o
  // retry/cooldown normal do worker.
  const match = message.match(/->\s*(\d{3})/);
  const status = match?.[1] ? Number(match[1]) : null;
  return status != null && HTTP_PERMANENTE_REPORT.includes(status);
}

export type ReportLifecycleResult =
  | { status: "PENDING_NEW"; reportId: string }
  | {
      status: "PENDING_PROCESSING";
      reportId: string;
      processingStatus: string;
    }
  | {
      status: "FAILED";
      reportId: string;
      processingStatus: string;
    }
  | {
      status: "DONE";
      reportId: string;
      report: SPReport;
      buffer: Buffer;
    };

export interface ReportLifecycleArgs {
  /** Report já em polling, ou null se vamos criar um novo. */
  pendingReportId: string | null;
  reportType: string;
  /** Obrigatórios quando pendingReportId é null. */
  dataStartTime?: Date;
  dataEndTime?: Date;
  marketplaceIds?: string[];
  reportOptions?: Record<string, string>;
}

/**
 * Roda 1 passo do ciclo de vida do report.
 *
 * Casos:
 *   - pendingReportId presente + status IN_QUEUE/IN_PROGRESS → PENDING_PROCESSING
 *   - pendingReportId presente + status FATAL/CANCELLED      → FAILED
 *   - pendingReportId presente + status DONE                 → DONE (com buffer)
 *   - pendingReportId ausente                                → cria report e retorna PENDING_NEW
 */
export async function stepReportLifecycle(
  creds: SPAPICredentials,
  args: ReportLifecycleArgs,
): Promise<ReportLifecycleResult> {
  if (args.pendingReportId) {
    let report: SPReport;
    try {
      report = await getReport(creds, args.pendingReportId);
    } catch (e) {
      if (isReportIlegivelPermanente(e)) {
        return {
          status: "FAILED",
          reportId: args.pendingReportId,
          processingStatus: "ILEGIVEL",
        };
      }
      throw e;
    }
    const status = report.processingStatus ?? "UNKNOWN";

    if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
      return {
        status: "PENDING_PROCESSING",
        reportId: args.pendingReportId,
        processingStatus: status,
      };
    }

    if (status === "FATAL" || status === "CANCELLED") {
      return {
        status: "FAILED",
        reportId: args.pendingReportId,
        processingStatus: status,
      };
    }

    if (!report.reportDocumentId) {
      return {
        status: "FAILED",
        reportId: args.pendingReportId,
        processingStatus: "NO_DOCUMENT",
      };
    }

    const doc = await getReportDocument(creds, report.reportDocumentId);
    if (!doc?.url) {
      return {
        status: "FAILED",
        reportId: args.pendingReportId,
        processingStatus: "NO_URL",
      };
    }

    const buffer = await downloadReportDocument(
      doc.url,
      doc.compressionAlgorithm,
    );
    return {
      status: "DONE",
      reportId: args.pendingReportId,
      report,
      buffer,
    };
  }

  // Sem pending — cria report novo.
  if (!args.dataStartTime || !args.dataEndTime) {
    throw new Error(
      "stepReportLifecycle: dataStartTime e dataEndTime são obrigatórios para criar report novo",
    );
  }
  const created = await createReport(creds, {
    reportType: args.reportType,
    dataStartTime: args.dataStartTime,
    dataEndTime: args.dataEndTime,
    marketplaceIds: args.marketplaceIds,
    reportOptions: args.reportOptions,
  });
  return { status: "PENDING_NEW", reportId: created.reportId };
}

/**
 * Baixa o documento de report da URL pre-assinada e descomprime se GZIP.
 * Substitui o helper duplicado que existia em jobs-handlers.ts.
 */
export async function downloadReportDocument(
  url: string,
  compression?: string,
): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download report ${res.status}`);
  const ab = await res.arrayBuffer();
  let buffer = Buffer.from(ab);
  if (compression === "GZIP") buffer = gunzipSync(buffer);
  return buffer;
}
