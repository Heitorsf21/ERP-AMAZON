import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  buildSessionExpiry,
  signSession,
} from "@/lib/session";
import {
  recordLoginFailureByKey,
  resetLoginFailuresByKey,
  getLoginFailureKey,
} from "@/lib/auth-rate-limit";
import { originViolationResponse } from "@/lib/origin-check";
import { TipoAuditLog } from "@/modules/shared/domain";
import { criarDesafio2FA, FINALIDADE_LOGIN } from "@/modules/auth/desafio-2fa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email().max(200),
  senha: z.string().min(1).max(200),
  lembrar: z.boolean().optional(),
});

// Hash bcrypt REAL para o dummy compare (uniformiza tempo quando empresa/usuario
// nao existem). Gerado no load do modulo: garante hash valido => bcrypt.compare
// faz o trabalho real (um hash malformado seria rejeitado rapido, anulando a defesa).
const DUMMY_HASH = bcrypt.hashSync("atlas-seller-dummy-password", 10);

export async function POST(req: Request) {
  const origemBloqueada = originViolationResponse(req);
  if (origemBloqueada) return origemBloqueada;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "JSON_INVALIDO" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const lembrar = parsed.data.lembrar === true;

  // email e unico GLOBAL (1 email = 1 empresa). Usuario e GLOBAL_MODEL, entao a
  // extensao de tenant nao auto-filtra esta query (login roda pre-contexto).
  const user = await db.usuario.findUnique({
    where: { email },
    include: { empresa: { select: { ativa: true } } },
  });

  // Dummy bcrypt SEMPRE quando nao ha user: tempo uniforme (anti-enumeracao).
  let senhaOk = false;
  if (user) {
    senhaOk = await bcrypt.compare(parsed.data.senha, user.senhaHash);
  } else {
    await bcrypt.compare(parsed.data.senha, DUMMY_HASH); // descarta resultado, so p/ uniformizar tempo
  }

  const empresaInativa = user != null && user.empresa.ativa === false;

  if (!user || !user.ativo || empresaInativa || !senhaOk) {
    const failureLimit = await recordLoginFailureByKey(
      getLoginFailureKey(req.headers, email),
    );

    await auditLog({
      req,
      acao: TipoAuditLog.LOGIN_FALHA,
      entidade: "Usuario",
      entidadeId: user?.id ?? null,
      metadata: { email },
    });

    if (failureLimit.limited) {
      return NextResponse.json(
        {
          erro: "MUITAS_TENTATIVAS_LOGIN",
          retryAfterSeconds: failureLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(failureLimit.retryAfterSeconds),
          },
        },
      );
    }

    return NextResponse.json(
      { erro: "CREDENCIAIS_INVALIDAS" },
      { status: 401 },
    );
  }

  await resetLoginFailuresByKey(getLoginFailureKey(req.headers, email));

  // Com 2FA (e-mail ou app autenticador), cria o desafio — NÃO cria sessão.
  const desafio = await criarDesafio2FA(user, FINALIDADE_LOGIN);
  if (desafio) {
    return NextResponse.json({
      requires2FA: true,
      challengeId: desafio.challengeId,
      lembrar,
      ...(desafio.metodo === "TOTP" ? { metodo: "TOTP" } : {}),
    });
  }

  // Sem 2FA: cria sessão direto.
  await db.usuario.update({
    where: { id: user.id },
    data: { ultimoAcesso: new Date() },
  });

  const token = await signSession({
    uid: user.id,
    email: user.email,
    nome: user.nome,
    role: user.role,
    exp: buildSessionExpiry(lembrar),
    v: user.sessionVersion,
    empresaId: user.empresaId ?? undefined,
  });

  await auditLog({
    session: { uid: user.id, email: user.email },
    req,
    acao: TipoAuditLog.LOGIN_SUCESSO,
    entidade: "Usuario",
    entidadeId: user.id,
  });

  const res = NextResponse.json({
    usuario: {
      id: user.id,
      email: user.email,
      nome: user.nome,
      role: user.role,
      avatarUrl: user.avatarUrl,
    },
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(lembrar));
  return res;
}
