import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const DELETE = handleAuth(
  [UsuarioRole.ADMIN],
  async (_req: Request, { params }: Params) => {
    const { id } = await params;
    if (!id) throw new Error("id obrigatório");
    await db.adsGastoManual.delete({ where: { id } });
    return ok({ ok: true });
  },
);
