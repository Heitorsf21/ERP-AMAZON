import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/plataforma-auth";
import { originViolationResponse } from "@/lib/origin-check";
import { reenviarConvite } from "@/modules/plataforma/empresas";
import { enviarConviteAdmin } from "@/lib/email-convite";
import { auditPlataforma } from "@/modules/plataforma/audit";
import { getClientIp } from "@/lib/auth-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;
  const su = await requireSuperAdmin();
  const { id } = await params;
  const r = await reenviarConvite(id);
  if (!r.ok || !r.rawToken || !r.admin || !r.empresaNome || !r.slug) {
    return NextResponse.json({ erro: "NAO_ENCONTRADO" }, { status: 404 });
  }
  const envio = await enviarConviteAdmin({ to: r.admin.email, nome: r.admin.nome, empresaNome: r.empresaNome, slug: r.slug, rawToken: r.rawToken });
  await auditPlataforma({ plataformaUsuarioId: su.puid, acao: "CONVITE_REENVIADO", empresaIdAlvo: id, ip: getClientIp(req.headers) });
  return NextResponse.json({ ok: true, conviteViaConsole: envio.viaConsole, conviteEmailOk: envio.ok });
}
