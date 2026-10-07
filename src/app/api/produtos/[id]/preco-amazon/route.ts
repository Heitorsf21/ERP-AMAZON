import { NextRequest } from "next/server";
import { z } from "zod";
import { erro, handleAuth, ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { TipoAuditLog } from "@/modules/shared/domain";
import { AmazonContaNaoConectadaError } from "@/modules/amazon/service";
import {
  ehErroQuota,
  enviarPrecoAmazon,
  PermissaoListingNegadaError,
  precisaConfirmarVariacao,
  PrecoRejeitadoError,
  type ResultadoPatchListing,
} from "@/modules/amazon/listings-preco";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  precoCentavos: z.number().int().min(100).max(10_000_000),
  confirmarVariacao: z.boolean().optional(),
});

export const POST = handleAuth(
  [UsuarioRole.ADMIN],
  async (req: NextRequest, { params }: Params) => {
    const session = await requireRole(UsuarioRole.ADMIN);
    const { id } = await params;
    const body = schema.parse(await req.json());

    const produto = await db.produto.findFirst({
      where: { id },
      select: { id: true, sku: true, amazonPrecoListagemCentavos: true },
    });
    if (!produto) return erro(404, "produto não encontrado");

    const atual = produto.amazonPrecoListagemCentavos;
    if (precisaConfirmarVariacao(atual, body.precoCentavos) && !body.confirmarVariacao) {
      return erro(409, "CONFIRMAR_VARIACAO", { atualCentavos: atual, novoCentavos: body.precoCentavos });
    }

    let resultado: ResultadoPatchListing;
    try {
      resultado = await enviarPrecoAmazon({
        sku: produto.sku,
        precoCentavos: body.precoCentavos,
        somenteValidar: false,
      });
    } catch (e) {
      if (e instanceof PermissaoListingNegadaError) {
        return erro(403, `${e.message} Habilite-a no Developer Central e reconecte a loja em Configurações → Integrações.`);
      }
      if (e instanceof PrecoRejeitadoError) return erro(422, e.message);
      if (e instanceof AmazonContaNaoConectadaError) {
        return erro(422, "Loja Amazon não conectada. Conecte em Configurações → Integrações.");
      }
      if (ehErroQuota(e)) return erro(429, "A Amazon pediu para esperar. Tente de novo em instantes.");
      logger.warn(
        { err: e instanceof Error ? e.message : String(e), sku: produto.sku },
        "preço amazon: falha no PATCH",
      );
      return erro(502, "A Amazon não respondeu. Tente de novo em instantes.");
    }

    await db.produto.update({
      where: { id: produto.id },
      data: { amazonPrecoListagemCentavos: body.precoCentavos, amazonPrecoListagemSyncEm: new Date() },
    });
    await auditLog({
      session,
      req,
      acao: TipoAuditLog.PRECO_AMAZON_ALTERADO,
      entidade: "Produto",
      entidadeId: produto.id,
      antes: { precoCentavos: atual },
      depois: { precoCentavos: body.precoCentavos },
      metadata: { sku: produto.sku, status: resultado.status, submissionId: resultado.submissionId },
    });
    return ok({ ok: true, status: resultado.status ?? null });
  },
);
