import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/plataforma-auth";
import { originViolationResponse } from "@/lib/origin-check";
import { criarEmpresa, listarEmpresas } from "@/modules/plataforma/empresas";
import { enviarConviteAdmin } from "@/lib/email-convite";
import { auditPlataforma } from "@/modules/plataforma/audit";
import { getClientIp } from "@/lib/auth-rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  nome: z.string().min(2).max(120),
  slug: z.string().min(3).max(30),
  admin: z.object({
    nome: z.string().min(2).max(120),
    email: z.string().email().max(200),
    // Opcional: superadmin define a senha do admin direto (login imediato, sem
    // convite por e-mail). Em branco → fluxo de convite.
    senha: z.string().min(8).max(200).optional(),
  }),
});

export async function GET() {
  const su = await requireSuperAdmin();
  if (su instanceof NextResponse) return su;
  return NextResponse.json({ empresas: await listarEmpresas() });
}

export async function POST(req: Request) {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;
  const su = await requireSuperAdmin();
  if (su instanceof NextResponse) return su;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ erro: "JSON_INVALIDO" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });

  let result;
  try {
    result = await criarEmpresa(parsed.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ERRO";
    if (msg.startsWith("SLUG_INVALIDO")) return NextResponse.json({ erro: "SLUG_INVALIDO", detalhe: msg }, { status: 400 });
    if (msg.includes("Unique constraint") || (err as { code?: string })?.code === "P2002") {
      return NextResponse.json({ erro: "SLUG_OU_EMAIL_DUPLICADO" }, { status: 409 });
    }
    logger.error({ err }, "[plataforma] falha criarEmpresa");
    return NextResponse.json({ erro: "ERRO_INTERNO" }, { status: 500 });
  }

  await auditPlataforma({ plataformaUsuarioId: su.puid, acao: "EMPRESA_CRIADA", empresaIdAlvo: result.empresaId, metadata: { slug: parsed.data.slug }, ip: getClientIp(req.headers) });

  // Modo senha direta: admin entra na hora, sem link/convite.
  if (result.definiuSenha) {
    await auditPlataforma({ plataformaUsuarioId: su.puid, acao: "ADMIN_CONVIDADO", empresaIdAlvo: result.empresaId, metadata: { email: parsed.data.admin.email, senhaDefinida: true }, ip: getClientIp(req.headers) });
    return NextResponse.json({ ok: true, empresaId: result.empresaId, senhaDefinida: true });
  }

  // Modo convite por LINK: devolve o link para o superadmin copiar/enviar (WhatsApp).
  // O e-mail é best-effort — NUNCA bloqueia (SMTP pode não estar configurado).
  const base = (process.env.APP_URL || "").replace(/\/$/, "");
  const conviteUrl =
    `${base}/definir-senha?token=${encodeURIComponent(result.rawToken ?? "")}` +
    `&empresa=${encodeURIComponent(parsed.data.slug)}&email=${encodeURIComponent(parsed.data.admin.email)}`;
  let emailOk = false;
  try {
    const envio = await enviarConviteAdmin({
      to: parsed.data.admin.email, nome: parsed.data.admin.nome,
      empresaNome: parsed.data.nome, slug: parsed.data.slug, rawToken: result.rawToken ?? "",
    });
    emailOk = envio.ok;
  } catch (err) {
    logger.warn({ err }, "[plataforma] envio de convite por e-mail falhou (link retornado)");
  }
  await auditPlataforma({ plataformaUsuarioId: su.puid, acao: "ADMIN_CONVIDADO", empresaIdAlvo: result.empresaId, metadata: { email: parsed.data.admin.email, emailOk }, ip: getClientIp(req.headers) });

  return NextResponse.json({ ok: true, empresaId: result.empresaId, conviteUrl, emailOk });
}
