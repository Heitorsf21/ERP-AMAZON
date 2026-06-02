import { z } from "zod";
import { handleAuth, ok, erro } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function sincronizarCustoAusenteSemFalharRequest() {
  try {
    const { sincronizarCustoAusente } = await import(
      "@/modules/notificacoes/service"
    );
    await sincronizarCustoAusente();
  } catch (err) {
    logger.warn({ err }, "falha ao sincronizar notificacao CUSTO_AUSENTE");
  }
}

/**
 * GET /api/produtos/:id/custo-historico
 * Lista todas as vigências do produto, ordenadas por vigenciaInicio.
 */
export const GET = handleAuth(
  [UsuarioRole.OPERADOR],
  async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const produto = await db.produto.findUnique({ where: { id } });
  if (!produto) return erro(404, "produto não encontrado");

  const vigencias = await db.produtoCustoHistorico.findMany({
    where: { produtoId: id },
    orderBy: { vigenciaInicio: "asc" },
  });

  return ok({
    produto: {
      id: produto.id,
      sku: produto.sku,
      nome: produto.nome,
      custoUnitarioAtual: produto.custoUnitario,
    },
    vigencias,
  });
},
);

const aplicarSchema = z.object({
  modo: z.enum(["A_PARTIR_DE_HOJE", "PERIODO", "HISTORICO_COMPLETO"]),
  custoCentavos: z.number().int().positive(),
  de: z.string().optional(),
  ate: z.string().optional(),
  observacao: z.string().optional(),
});

/**
 * POST /api/produtos/:id/custo-historico
 * Aplica nova vigência usando um dos 3 modos. Body:
 *   { modo, custoCentavos, de?, ate?, observacao? }
 * Para PERIODO: de + ate obrigatórios (YYYY-MM-DD).
 * Reaplica custo nas VendaAmazon afetadas automaticamente.
 */
export const POST = handleAuth(
  [UsuarioRole.OPERADOR],
  async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = aplicarSchema.parse(await req.json());

  const produto = await db.produto.findUnique({ where: { id } });
  if (!produto) return erro(404, "produto não encontrado");

  const {
    aplicarCustoAPartirDeHoje,
    aplicarCustoNoPeriodo,
    aplicarCustoHistoricoCompleto,
    reaplicarCustoEmVendas,
  } = await import("@/modules/produtos/custo-historico");

  if (body.modo === "A_PARTIR_DE_HOJE") {
    await aplicarCustoAPartirDeHoje({
      produtoId: id,
      custoCentavos: body.custoCentavos,
      observacao: body.observacao,
    });
  } else if (body.modo === "PERIODO") {
    if (!body.de || !body.ate) {
      return erro(400, "modo PERIODO requer 'de' e 'ate' (YYYY-MM-DD)");
    }
    const de = new Date(`${body.de}T00:00:00-03:00`);
    const ate = new Date(`${body.ate}T23:59:59.999-03:00`);
    if (!Number.isFinite(de.getTime()) || !Number.isFinite(ate.getTime())) {
      return erro(400, "datas inválidas");
    }
    if (de > ate) return erro(400, "'de' deve ser <= 'ate'");
    await aplicarCustoNoPeriodo({
      produtoId: id,
      custoCentavos: body.custoCentavos,
      de,
      ate,
      observacao: body.observacao,
    });
  } else {
    await aplicarCustoHistoricoCompleto({
      produtoId: id,
      custoCentavos: body.custoCentavos,
      observacao: body.observacao,
    });
  }

  const r = await reaplicarCustoEmVendas({ produtoId: id });
  await sincronizarCustoAusenteSemFalharRequest();
  return ok({ ok: true, vendasAtualizadas: r.atualizadas });
},
);

const deleteSchema = z.object({
  vigenciaId: z.string().cuid(),
});

/**
 * DELETE /api/produtos/:id/custo-historico
 * Remove uma vigência específica (body: { vigenciaId }).
 * Reaplica custo nas vendas afetadas.
 */
export const DELETE = handleAuth(
  [UsuarioRole.OPERADOR],
  async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = deleteSchema.parse(await req.json());

  const vigencia = await db.produtoCustoHistorico.findFirst({
    where: { id: body.vigenciaId, produtoId: id },
  });
  if (!vigencia) return erro(404, "vigência não encontrada para este produto");

  await db.produtoCustoHistorico.delete({ where: { id: body.vigenciaId } });

  const { reaplicarCustoEmVendas } = await import(
    "@/modules/produtos/custo-historico"
  );
  const r = await reaplicarCustoEmVendas({ produtoId: id });
  await sincronizarCustoAusenteSemFalharRequest();
  return ok({ ok: true, vendasAtualizadas: r.atualizadas });
},
);
