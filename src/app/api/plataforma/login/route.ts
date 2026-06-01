import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  PLATAFORMA_COOKIE_NAME, signPlataformaSession,
  buildPlataformaCookieOptions, buildPlataformaExpiry,
} from "@/lib/plataforma-session";
import { originViolationResponse } from "@/lib/origin-check";
import { recordLoginFailureByKey, resetLoginFailuresByKey, getClientIp } from "@/lib/auth-rate-limit";
import { auditPlataforma } from "@/modules/plataforma/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email().max(200), senha: z.string().min(1).max(200) });

// DUMMY_HASH é um hash bcrypt real gerado uma vez no carregamento do módulo.
// Usar bcrypt.hashSync garante que bcrypt.compare nunca retorne false "instantaneamente"
// por hash malformado — preservando a uniformidade de tempo contra user enumeration.
const DUMMY_HASH = bcrypt.hashSync("atlas-seller-plataforma-dummy", 10);

export async function POST(req: Request) {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ erro: "JSON_INVALIDO" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });

  const email = parsed.data.email.toLowerCase().trim();
  const key = `plataforma:${getClientIp(req.headers)}:${email}`;
  const u = await db.plataformaUsuario.findUnique({ where: { email } });

  // if/else garante uniformidade de tempo (sem comma/sequence operator — eslint no-sequences).
  let senhaOk = false;
  if (u) {
    senhaOk = await bcrypt.compare(parsed.data.senha, u.senhaHash);
  } else {
    await bcrypt.compare(parsed.data.senha, DUMMY_HASH); // descarta, só p/ uniformizar tempo
  }

  if (!u || !u.ativo || !senhaOk) {
    const lim = await recordLoginFailureByKey(key);
    if (lim.limited) {
      return NextResponse.json({ erro: "MUITAS_TENTATIVAS_LOGIN", retryAfterSeconds: lim.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(lim.retryAfterSeconds) } });
    }
    return NextResponse.json({ erro: "CREDENCIAIS_INVALIDAS" }, { status: 401 });
  }

  await resetLoginFailuresByKey(key);
  await db.plataformaUsuario.update({ where: { id: u.id }, data: { ultimoAcesso: new Date() } });
  const token = await signPlataformaSession({
    puid: u.id, email: u.email, nome: u.nome, v: u.sessionVersion, exp: buildPlataformaExpiry(),
  });
  await auditPlataforma({ plataformaUsuarioId: u.id, acao: "LOGIN_PLATAFORMA", ip: getClientIp(req.headers) });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(PLATAFORMA_COOKIE_NAME, token, buildPlataformaCookieOptions());
  return res;
}
