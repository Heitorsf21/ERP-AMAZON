import { handle, ok, erro } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { originViolationResponse } from "@/lib/origin-check";
import {
  assinarChaveiro,
  CHAVEIRO_COOKIE,
  chaveiroDoRequest,
  opcoesCookieChaveiro,
  opcoesLimparChaveiro,
  temConta,
  tirarConta,
} from "@/modules/lojas/chaveiro";
import { TipoAuditLog } from "@/modules/shared/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Desvincula uma loja NESTE aparelho: tira a conta dela do chaveiro do cookie.
 * `id` = conta da outra loja. Só mexe no chaveiro de que a sessão faz parte.
 */
export const DELETE = handle(async (req: Request, { params }: Params) => {
  const origemBloqueada = originViolationResponse(req);
  if (origemBloqueada) return origemBloqueada;
  const session = await requireSession();
  const { id } = await params;

  const chaveiro = await chaveiroDoRequest();
  if (!chaveiro || id === session.uid || !temConta(chaveiro, session.uid) || !temConta(chaveiro, id)) {
    return erro(404, "VINCULO_NAO_ENCONTRADO");
  }

  await auditLog({
    session,
    req,
    acao: TipoAuditLog.LOJA_DESVINCULADA,
    entidade: "Usuario",
    entidadeId: id,
    metadata: { escopo: "aparelho" },
  });

  const restante = tirarConta(chaveiro, id);
  const res = ok({ ok: true });
  if (restante) {
    res.cookies.set(CHAVEIRO_COOKIE, await assinarChaveiro(restante), opcoesCookieChaveiro());
  } else {
    res.cookies.set(CHAVEIRO_COOKIE, "", opcoesLimparChaveiro());
  }
  return res;
});
