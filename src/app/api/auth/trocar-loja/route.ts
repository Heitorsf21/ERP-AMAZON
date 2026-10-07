import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { originViolationResponse } from "@/lib/origin-check";
import { SESSION_COOKIE_NAME, buildSessionCookieOptions, signSession } from "@/lib/session";
import {
  assinarChaveiro,
  CHAVEIRO_COOKIE,
  chaveiroDoRequest,
  guardarContas,
  opcoesCookieChaveiro,
} from "@/modules/lojas/chaveiro";
import { contaVinculadaNaEmpresa } from "@/modules/lojas/vinculos";
import { TipoAuditLog } from "@/modules/shared/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ empresaId: z.string().min(1).max(64) });

/**
 * Troca de loja sem novo login: reemite o cookie como a conta da empresa
 * pedida que ESTE aparelho provou com senha/2FA (chaveiro do cookie). Em outro
 * aparelho, sem o chaveiro, não há troca. A sessão não é renovada — o novo
 * cookie expira junto com o atual; o chaveiro, sim, renova o prazo.
 */
export const POST = handle(async (req: Request) => {
  const origemBloqueada = originViolationResponse(req);
  if (origemBloqueada) return origemBloqueada;
  const session = await requireSession();

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });
  }

  const chaveiro = await chaveiroDoRequest();
  const conta = await contaVinculadaNaEmpresa(session.uid, parsed.data.empresaId, chaveiro);
  if (!conta || !chaveiro) {
    return NextResponse.json({ erro: "LOJA_NAO_VINCULADA" }, { status: 404 });
  }

  const token = await signSession({
    uid: conta.id,
    email: conta.email,
    nome: conta.nome,
    role: conta.role,
    exp: session.exp,
    v: conta.sessionVersion,
    empresaId: conta.empresaId,
  });

  await db.usuario.update({ where: { id: conta.id }, data: { ultimoAcesso: new Date() } });
  await auditLog({
    session,
    req,
    acao: TipoAuditLog.LOJA_TROCADA,
    entidade: "Usuario",
    entidadeId: conta.id,
    metadata: { deEmpresa: session.empresaId ?? null, paraEmpresa: conta.empresaId },
  });

  const res = NextResponse.json({
    ok: true,
    loja: { empresaId: conta.empresaId, nome: conta.empresa.nome },
  });
  const restanteSeg = Math.max(60, session.exp - Math.floor(Date.now() / 1000));
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    ...buildSessionCookieOptions(),
    maxAge: restanteSeg,
  });
  res.cookies.set(CHAVEIRO_COOKIE, await assinarChaveiro(guardarContas(chaveiro, [])), opcoesCookieChaveiro());
  return res;
});
