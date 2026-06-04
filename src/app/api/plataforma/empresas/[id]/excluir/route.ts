import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/plataforma-auth";
import { originViolationResponse } from "@/lib/origin-check";
import { excluirEmpresa } from "@/modules/plataforma/empresas";
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
  try {
    const r = await excluirEmpresa(id);
    if (!r.ok) {
      return NextResponse.json({ erro: "NAO_ENCONTRADO" }, { status: 404 });
    }
    await auditPlataforma({
      plataformaUsuarioId: su.puid,
      acao: "EMPRESA_EXCLUIDA",
      empresaIdAlvo: id,
      metadata: { removidos: r.removidos, total: r.total },
      ip: getClientIp(req.headers),
    });
    return NextResponse.json({ ok: true, total: r.total, removidos: r.removidos });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "FALHA";
    // EMPRESA_ATIVA -> 409 (conflito: precisa desativar antes); demais -> 400.
    const status = msg.startsWith("EMPRESA_ATIVA") ? 409 : 400;
    return NextResponse.json({ erro: msg }, { status });
  }
}
