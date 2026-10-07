import { NextRequest } from "next/server";
import { z } from "zod";
import { erro, handle, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { auditLog } from "@/lib/audit";
import { currentEmpresaIdOrDefault } from "@/lib/tenant-context";
import type { SessionPayload } from "@/lib/session";
import { TipoAuditLog } from "@/modules/shared/domain";
import {
  atualizarPreferencia,
  inscreverDispositivo,
  inscricaoSchema,
  listarDispositivos,
  removerDispositivo,
} from "@/modules/push/dispositivos";

export const dynamic = "force-dynamic";

function escopo(session: SessionPayload) {
  return { empresaId: session.empresaId ?? currentEmpresaIdOrDefault(), usuarioId: session.uid };
}

export const GET = handle(async () => {
  const session = await requireSession();
  return ok({ dispositivos: await listarDispositivos(escopo(session)) });
});

export const POST = handle(async (req: NextRequest) => {
  const session = await requireSession();
  const body = inscricaoSchema.parse(await req.json());
  const dispositivo = await inscreverDispositivo({
    ...escopo(session),
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    userAgent: req.headers.get("user-agent"),
  });
  await auditLog({
    session,
    req,
    acao: TipoAuditLog.PUSH_DISPOSITIVO_ATIVADO,
    entidade: "PushDispositivo",
    entidadeId: dispositivo.id,
  });
  return ok({ dispositivo });
});

const patchSchema = z.object({ endpoint: z.string().url(), receberVendas: z.boolean() });

export const PATCH = handle(async (req: NextRequest) => {
  const session = await requireSession();
  const body = patchSchema.parse(await req.json());
  const n = await atualizarPreferencia({ ...escopo(session), ...body });
  if (n === 0) return erro(404, "aparelho não encontrado");
  return ok({ ok: true });
});

const deleteSchema = z
  .object({ endpoint: z.string().url().optional(), id: z.string().min(1).optional() })
  .refine((b) => !!b.endpoint || !!b.id, "informe o aparelho");

export const DELETE = handle(async (req: NextRequest) => {
  const session = await requireSession();
  const body = deleteSchema.parse(await req.json());
  const removidos = await removerDispositivo({ ...escopo(session), ...body });
  await auditLog({
    session,
    req,
    acao: TipoAuditLog.PUSH_DISPOSITIVO_REMOVIDO,
    entidade: "PushDispositivo",
    entidadeId: body.id ?? null,
    metadata: { removidos },
  });
  return ok({ removidos });
});
