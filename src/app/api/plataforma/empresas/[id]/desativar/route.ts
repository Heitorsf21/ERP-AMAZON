import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/plataforma-auth";
import { originViolationResponse } from "@/lib/origin-check";
import { desativarEmpresa } from "@/modules/plataforma/empresas";
import { auditPlataforma } from "@/modules/plataforma/audit";
import { getClientIp } from "@/lib/auth-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const bloqueio = originViolationResponse(req);
  if (bloqueio) return bloqueio;
  const su = await requireSuperAdmin();
  if (su instanceof NextResponse) return su;
  const { id } = await params;
  if (!(await desativarEmpresa(id))) {
    return NextResponse.json({ erro: "NAO_ENCONTRADO" }, { status: 404 });
  }
  await auditPlataforma({ plataformaUsuarioId: su.puid, acao: "EMPRESA_DESATIVADA", empresaIdAlvo: id, ip: getClientIp(req.headers) });
  return NextResponse.json({ ok: true });
}
