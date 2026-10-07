import { NextRequest } from "next/server";
import { z } from "zod";
import { handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { TipoAuditLog } from "@/modules/shared/domain";
import { lerOcultas, salvarOcultas } from "@/modules/menu/service";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  ocultas: z.array(z.string().max(100)).max(50),
});

// Preferência pessoal: qualquer usuário logado lê e grava SÓ a própria.
export const GET = handle(async () => {
  const session = await requireSession();
  return ok({ ocultas: await lerOcultas(session.uid) });
});

export const PUT = handle(async (req: NextRequest) => {
  const session = await requireSession();
  const body = putSchema.parse(await req.json());
  const antes = await lerOcultas(session.uid);
  const ocultas = await salvarOcultas(session.uid, body.ocultas);
  await auditLog({
    session,
    req,
    acao: TipoAuditLog.MENU_ATUALIZADO,
    entidade: "Usuario",
    entidadeId: session.uid,
    antes: { ocultas: antes },
    depois: { ocultas },
  });
  return ok({ ocultas });
});
