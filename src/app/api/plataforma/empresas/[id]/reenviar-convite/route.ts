import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/plataforma-auth";
import { originViolationResponse } from "@/lib/origin-check";
import { reenviarConvite } from "@/modules/plataforma/empresas";
import { enviarConviteAdmin } from "@/lib/email-convite";
import { auditPlataforma } from "@/modules/plataforma/audit";
import { getClientIp } from "@/lib/auth-rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;
  const su = await requireSuperAdmin();
  if (su instanceof NextResponse) return su;
  const { id } = await params;
  const r = await reenviarConvite(id);
  if (!r.ok || !r.rawToken || !r.admin || !r.empresaNome || !r.slug) {
    return NextResponse.json({ erro: "NAO_ENCONTRADO" }, { status: 404 });
  }

  // Gera o LINK para o superadmin copiar/enviar (WhatsApp). O e-mail é best-effort
  // — NUNCA bloqueia (SMTP pode falhar / não estar configurado).
  const base = (process.env.APP_URL || "").replace(/\/$/, "");
  const conviteUrl =
    `${base}/definir-senha?token=${encodeURIComponent(r.rawToken)}` +
    `&empresa=${encodeURIComponent(r.slug)}&email=${encodeURIComponent(r.admin.email)}`;
  let emailOk = false;
  try {
    const envio = await enviarConviteAdmin({ to: r.admin.email, nome: r.admin.nome, empresaNome: r.empresaNome, slug: r.slug, rawToken: r.rawToken });
    emailOk = envio.ok;
  } catch (err) {
    logger.warn({ err }, "[plataforma] reenviar convite por e-mail falhou (link retornado)");
  }

  await auditPlataforma({ plataformaUsuarioId: su.puid, acao: "CONVITE_REENVIADO", empresaIdAlvo: id, ip: getClientIp(req.headers) });
  return NextResponse.json({
    ok: true,
    conviteUrl,
    emailOk,
    admin: { email: r.admin.email, nome: r.admin.nome },
    empresaNome: r.empresaNome,
    slug: r.slug,
  });
}
