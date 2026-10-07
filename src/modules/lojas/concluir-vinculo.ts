import { NextResponse } from "next/server";
import { auditLog } from "@/lib/audit";
import type { SessionPayload } from "@/lib/session";
import { TipoAuditLog } from "@/modules/shared/domain";
import {
  assinarChaveiro,
  baseParaVincular,
  CHAVEIRO_COOKIE,
  chaveiroDoRequest,
  guardarContas,
  opcoesCookieChaveiro,
} from "./chaveiro";
import { ErroVinculo, prepararVinculo } from "./vinculos";

/**
 * Última etapa do vínculo (senha e, se houver, 2FA já conferidos): guarda as
 * duas contas no chaveiro DESTE aparelho. Nada é gravado no banco — quem entra
 * pelos mesmos logins em outro aparelho continua vendo só a própria loja.
 */
export async function concluirVinculo(input: {
  session: SessionPayload;
  alvoId: string;
  req: Request;
  metadata?: Record<string, unknown>;
}): Promise<NextResponse> {
  try {
    const { contas, loja } = await prepararVinculo(input.session.uid, input.alvoId);
    const minhaVersao = contas.find((c) => c.uid === input.session.uid)?.v ?? -1;
    const base = baseParaVincular(await chaveiroDoRequest(), input.session.uid, minhaVersao);
    const chaveiro = guardarContas(base, contas);

    await auditLog({
      session: input.session,
      req: input.req,
      acao: TipoAuditLog.LOJA_VINCULADA,
      entidade: "Usuario",
      entidadeId: loja.vinculoId,
      metadata: { empresaVinculada: loja.empresaId, escopo: "aparelho", ...input.metadata },
    });

    const res = NextResponse.json({ loja });
    res.cookies.set(CHAVEIRO_COOKIE, await assinarChaveiro(chaveiro), opcoesCookieChaveiro());
    return res;
  } catch (e) {
    if (e instanceof ErroVinculo) {
      return NextResponse.json({ erro: e.codigo }, { status: 400 });
    }
    throw e;
  }
}
