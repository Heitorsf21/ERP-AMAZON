import { z } from "zod";
import { handle, ok } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { requireRole, UsuarioRole } from "@/lib/auth";
import {
  atualizarFbmPickingItem,
  StatusFbmPickingItem,
} from "@/modules/expedicao/fbm-picking";
import { TipoAuditLog } from "@/modules/shared/domain";

type Params = { params: Promise<{ id: string; itemId: string }> };

const atualizarSchema = z.object({
  status: z
    .enum([
      StatusFbmPickingItem.PENDENTE,
      StatusFbmPickingItem.SEPARADO,
      StatusFbmPickingItem.CONFERIDO,
      StatusFbmPickingItem.DIVERGENTE,
    ])
    .optional(),
  checklist: z.record(z.boolean()).optional(),
});

export const dynamic = "force-dynamic";

export const PATCH = handle(async (req: Request, { params }: Params) => {
  const session = await requireRole(UsuarioRole.ADMIN, UsuarioRole.OPERADOR);
  const { id, itemId } = await params;
  const body = atualizarSchema.parse(await req.json());
  const item = await atualizarFbmPickingItem(id, itemId, body);

  await auditLog({
    session,
    req,
    acao: TipoAuditLog.FBM_PICKING_ATUALIZADO,
    entidade: "FbmPickingItem",
    entidadeId: itemId,
    depois: item,
  });

  return ok(item);
});
