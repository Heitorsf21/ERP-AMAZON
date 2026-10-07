import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  getLoginFailureKey,
  recordLoginFailureByKey,
  resetLoginFailuresByKey,
} from "@/lib/auth-rate-limit";
import { originViolationResponse } from "@/lib/origin-check";
import { criarDesafio2FA, finalidadeVinculo } from "@/modules/auth/desafio-2fa";
import { criarVinculo, ErroVinculo } from "@/modules/lojas/vinculos";
import { TipoAuditLog } from "@/modules/shared/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  // trim/lowercase antes de validar: teclado do celular deixa espaço no fim.
  email: z.string().trim().toLowerCase().email().max(200),
  senha: z.string().min(1).max(200),
});

// Hash bcrypt real para o compare de tempo uniforme quando o e-mail não
// existe (mesma defesa anti-enumeração do login).
const DUMMY_HASH = bcrypt.hashSync("atlas-seller-dummy-password", 10);

async function conferirSenha(senha: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(senha, DUMMY_HASH); // só uniformiza o tempo
    return false;
  }
  return bcrypt.compare(senha, hash);
}

/**
 * Vincula a conta de OUTRA loja à conta da sessão. Prova de posse igual ao
 * login: senha (tempo uniforme + limite de tentativas) e, se a outra conta
 * usar 2FA, o código dela (confirmado em /api/lojas/vincular/2fa).
 */
export const POST = handle(async (req: Request) => {
  const origemBloqueada = originViolationResponse(req);
  if (origemBloqueada) return origemBloqueada;
  const session = await requireSession();

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });
  }
  const email = parsed.data.email;
  const chaveLimite = `vinculo:${getLoginFailureKey(req.headers, email)}`;

  const alvo = await db.usuario.findUnique({
    where: { email },
    include: { empresa: { select: { ativa: true } } },
  });
  const senhaOk = await conferirSenha(parsed.data.senha, alvo?.senhaHash ?? null);

  if (!alvo || !alvo.ativo || alvo.empresa.ativa === false || !senhaOk) {
    const limite = await recordLoginFailureByKey(chaveLimite);
    await auditLog({
      session,
      req,
      acao: TipoAuditLog.LOGIN_FALHA,
      entidade: "Usuario",
      entidadeId: alvo?.id ?? null,
      metadata: { etapa: "VINCULO", email },
    });
    if (limite.limited) {
      return NextResponse.json(
        { erro: "MUITAS_TENTATIVAS", retryAfterSeconds: limite.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(limite.retryAfterSeconds) } },
      );
    }
    return NextResponse.json({ erro: "CREDENCIAIS_INVALIDAS" }, { status: 401 });
  }

  await resetLoginFailuresByKey(chaveLimite);

  // Mesma loja (ou a própria conta): recusa ANTES de mandar código de 2FA.
  if (alvo.id === session.uid || alvo.empresaId === session.empresaId) {
    return NextResponse.json({ erro: "MESMA_LOJA" }, { status: 400 });
  }

  const desafio = await criarDesafio2FA(alvo, finalidadeVinculo(session.uid));
  if (desafio) {
    return NextResponse.json({
      requires2FA: true,
      challengeId: desafio.challengeId,
      metodo: desafio.metodo,
    });
  }

  try {
    const loja = await criarVinculo(session.uid, alvo.id);
    await auditLog({
      session,
      req,
      acao: TipoAuditLog.LOJA_VINCULADA,
      entidade: "VinculoLoja",
      entidadeId: loja.vinculoId,
      metadata: { empresaVinculada: loja.empresaId },
    });
    return NextResponse.json({ loja });
  } catch (e) {
    if (e instanceof ErroVinculo) {
      return NextResponse.json({ erro: e.codigo }, { status: 400 });
    }
    throw e;
  }
});
