import { z } from "zod";
import { handle, ok, erro } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { requireRole, UsuarioRole } from "@/lib/auth";
import {
  atualizarFbmPickingBatch,
  detalharFbmPickingBatch,
  StatusFbmPicking,
} from "@/modules/expedicao/fbm-picking";
import { TipoAuditLog } from "@/modules/shared/domain";

type Params = { params: Promise<{ id: string }> };

const atualizarSchema = z.object({
  status: z
    .enum([
      StatusFbmPicking.ABERTO,
      StatusFbmPicking.EM_SEPARACAO,
      StatusFbmPicking.CONFERIDO,
      StatusFbmPicking.DESPACHADO,
      StatusFbmPicking.CANCELADO,
    ])
    .optional(),
  etiquetaUrl: z.string().url().optional().nullable(),
  observacoes: z.string().max(500).optional().nullable(),
});

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const batch = await detalharFbmPickingBatch(id);
  if (!batch) return erro(404, "lote nao encontrado");
  return ok(batch);
});

export const PATCH = handle(async (req: Request, { params }: Params) => {
  const session = await requireRole(UsuarioRole.ADMIN, UsuarioRole.OPERADOR);
  const { id } = await params;
  const antes = await detalharFbmPickingBatch(id);
  if (!antes) return erro(404, "lote nao encontrado");

  const body = atualizarSchema.parse(await req.json());
  const batch = await atualizarFbmPickingBatch(id, body);

  await auditLog({
    session,
    req,
    acao: TipoAuditLog.FBM_PICKING_ATUALIZADO,
    entidade: "FbmPickingBatch",
    entidadeId: id,
    antes,
    depois: batch,
  });

  return ok(batch);
});
