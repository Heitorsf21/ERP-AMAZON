import { parse as parseUrlLegado } from "node:url";
import { z } from "zod";
import { db } from "@/lib/db";

// PushDispositivo é GLOBAL (db.ts): cada acesso aqui filtra empresaId e
// usuarioId explicitamente.

/**
 * O servidor faz POST web-push no endpoint a cada venda: só aceitamos os
 * serviços de push dos navegadores (anti-SSRF). FCM = Chrome/Edge Android/
 * Samsung/Opera; Mozilla = Firefox; Apple = Safari/iOS; WNS = Edge Windows.
 */
const HOSTS_PUSH_EXATOS = new Set(["fcm.googleapis.com"]);
const SUFIXOS_HOSTS_PUSH = [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];

/** Até quantos aparelhos um usuário mantém por loja; o mais antigo sai para o novo entrar. */
export const LIMITE_DISPOSITIVOS_POR_USUARIO = 10;

export function endpointPushPermitido(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname;
  // Só hosts DNS simples e URL já canônica (como os serviços de push entregam):
  // barra %2E, ";", "{", aspas e afins, que o WHATWG e o url.parse leem diferente.
  if (!/^[a-z0-9.-]+$/.test(host) || url.href !== endpoint) return false;
  // O web-push conecta pelo url.parse LEGADO: ele precisa ver o mesmo host e porta.
  const legado = parseUrlLegado(endpoint);
  if ((legado.hostname ?? "").toLowerCase() !== host) return false;
  if (legado.port && legado.port !== "443") return false;
  return HOSTS_PUSH_EXATOS.has(host) || SUFIXOS_HOSTS_PUSH.some((sufixo) => host.endsWith(sufixo));
}

export const inscricaoSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => u.startsWith("https://"), "endpoint precisa ser https")
    .refine(endpointPushPermitido, "endpoint não é de um serviço de push conhecido"),
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
  // Limite por usuário e loja: abre espaço removendo os aparelhos mais antigos
  // do PRÓPRIO usuário (o endpoint que está sendo reinscrito não conta).
  const outros = await db.pushDispositivo.findMany({
    where: { empresaId: input.empresaId, usuarioId: input.usuarioId, NOT: { endpoint: input.endpoint } },
    orderBy: { criadoEm: "desc" },
    select: { id: true },
  });
  const excedentes = outros.slice(LIMITE_DISPOSITIVOS_POR_USUARIO - 1).map((d) => d.id);
  if (excedentes.length > 0) {
    await db.pushDispositivo.deleteMany({
      where: { empresaId: input.empresaId, usuarioId: input.usuarioId, id: { in: excedentes } },
    });
  }

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
