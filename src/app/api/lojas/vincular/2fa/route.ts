import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { originViolationResponse } from "@/lib/origin-check";
import { conferirDesafio2FA, finalidadeVinculo } from "@/modules/auth/desafio-2fa";
import { criarVinculo, ErroVinculo } from "@/modules/lojas/vinculos";
import { TipoAuditLog } from "@/modules/shared/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  challengeId: z.string().min(8).max(64),
  codigo: z.string().regex(/^\d{6}$/),
});

/**
 * Segunda etapa do vínculo quando a outra conta usa 2FA. O desafio só vale
 * para a sessão que o pediu (finalidade VINCULO:<uid>).
 */
export const POST = handle(async (req: Request) => {
  const origemBloqueada = originViolationResponse(req);
  if (origemBloqueada) return origemBloqueada;
  const session = await requireSession();

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ erro: "DADOS_INVALIDOS" }, { status: 400 });
  }

  const resultado = await conferirDesafio2FA({
    challengeId: parsed.data.challengeId,
    codigo: parsed.data.codigo,
    finalidade: finalidadeVinculo(session.uid),
    req,
    etapaAuditoria: "VINCULO_2FA",
  });
  if (!resultado.ok) {
    return NextResponse.json({ erro: resultado.erro }, { status: 401 });
  }

  try {
    const loja = await criarVinculo(session.uid, resultado.usuario.id);
    await auditLog({
      session,
      req,
      acao: TipoAuditLog.LOJA_VINCULADA,
      entidade: "VinculoLoja",
      entidadeId: loja.vinculoId,
      metadata: { empresaVinculada: loja.empresaId, etapa: "2FA" },
    });
    return NextResponse.json({ loja });
  } catch (e) {
    if (e instanceof ErroVinculo) {
      return NextResponse.json({ erro: e.codigo }, { status: 400 });
    }
    throw e;
  }
});
