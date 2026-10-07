import { z } from "zod";
import { db } from "@/lib/db";

// PushDispositivo é GLOBAL (db.ts): cada acesso aqui filtra empresaId e
// usuarioId explicitamente.

export const inscricaoSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => u.startsWith("https://"), "endpoint precisa ser https"),
  keys: z.object({
    p256dh: z.string().min(10).max(200),
    auth: z.string().min(8).max(100),
  }),
});

export type DispositivoPush = {
  id: string;
  apelido: string | null;
  endpoint: string;
  receberVendas: boolean;
  ativo: boolean;
  criadoEm: Date;
  ultimoEnvioEm: Date | null;
};

export function apelidoDoUserAgent(ua: string | null | undefined): string {
  const s = (ua ?? "").toLowerCase();
  if (!s) return "Navegador";
  if (s.includes("iphone")) return "iPhone";
  if (s.includes("ipad")) return "iPad";
  if (s.includes("android")) return "Android";
  if (s.includes("windows")) return "Computador (Windows)";
  if (s.includes("macintosh")) return "Computador (Mac)";
  if (s.includes("linux")) return "Computador (Linux)";
  return "Navegador";
}

export async function inscreverDispositivo(input: {
  empresaId: string;
  usuarioId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}): Promise<{ id: string }> {
  return db.pushDispositivo.upsert({
    where: { empresaId_endpoint: { empresaId: input.empresaId, endpoint: input.endpoint } },
    update: {
      usuarioId: input.usuarioId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
      ativo: true,
      falhasConsecutivas: 0,
    },
    create: {
      empresaId: input.empresaId,
      usuarioId: input.usuarioId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
      apelido: apelidoDoUserAgent(input.userAgent),
    },
    select: { id: true },
  });
}

export async function listarDispositivos(input: {
  empresaId: string;
  usuarioId: string;
}): Promise<DispositivoPush[]> {
  return db.pushDispositivo.findMany({
    where: { empresaId: input.empresaId, usuarioId: input.usuarioId },
    select: {
      id: true,
      apelido: true,
      endpoint: true,
      receberVendas: true,
      ativo: true,
      criadoEm: true,
      ultimoEnvioEm: true,
    },
    orderBy: { criadoEm: "desc" },
  });
}

export async function atualizarPreferencia(input: {
  empresaId: string;
  usuarioId: string;
  endpoint: string;
  receberVendas: boolean;
}): Promise<number> {
  const r = await db.pushDispositivo.updateMany({
    where: { empresaId: input.empresaId, usuarioId: input.usuarioId, endpoint: input.endpoint },
    data: { receberVendas: input.receberVendas },
  });
  return r.count;
}

export async function removerDispositivo(input: {
  empresaId: string;
  usuarioId: string;
  endpoint?: string;
  id?: string;
}): Promise<number> {
  if (!input.endpoint && !input.id) throw new Error("informe o aparelho (endpoint ou id)");
  const r = await db.pushDispositivo.deleteMany({
    where: {
      empresaId: input.empresaId,
      usuarioId: input.usuarioId,
      ...(input.endpoint ? { endpoint: input.endpoint } : {}),
      ...(input.id ? { id: input.id } : {}),
    },
  });
  return r.count;
}
