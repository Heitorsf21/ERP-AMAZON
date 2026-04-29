import { z } from "zod";
import { handle, ok } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { requireRole, UsuarioRole } from "@/lib/auth";
import {
  criarFbmPickingBatch,
  listarFbmPickingBatches,
} from "@/modules/expedicao/fbm-picking";
import { TipoAuditLog } from "@/modules/shared/domain";

const criarSchema = z.object({
  limite: z.number().int().min(1).max(100).optional(),
  diasAtras: z.number().int().min(1).max(60).optional(),
});

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const batches = await listarFbmPickingBatches();
  return ok(batches);
});

export const POST = handle(async (req: Request) => {
  const session = await requireRole(UsuarioRole.ADMIN, UsuarioRole.OPERADOR);
  const body = criarSchema.parse(await req.json().catch(() => ({})));
  const result = await criarFbmPickingBatch({
    ...body,
    criadoPorId: session.uid,
    criadoPorEmail: session.email,
  });

  await auditLog({
    session,
    req,
    acao: TipoAuditLog.FBM_PICKING_CRIADO,
    entidade: "FbmPickingBatch",
    entidadeId: result.batch?.id ?? null,
    depois: result,
  });

  return ok(result, { status: result.batch ? 201 : 200 });
});
