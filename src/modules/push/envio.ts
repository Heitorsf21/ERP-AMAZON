import webpush from "web-push";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { PayloadPush } from "./regras";

export const TipoPushEnvio = {
  VENDA_NOVA: "VENDA_NOVA",
  VENDAS_AGRUPADAS: "VENDAS_AGRUPADAS",
  TESTE: "TESTE",
} as const;
export type TipoPushEnvio = (typeof TipoPushEnvio)[keyof typeof TipoPushEnvio];

export const MAX_FALHAS_CONSECUTIVAS = 5;
const SUBJECT_PADRAO = "https://erp.mundofs.cloud";

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };
export type ResultadoEntrega = { destinos: number; ok: number; falhas: number };

export function getVapidConfig(
  env: Record<string, string | undefined> = process.env,
): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT?.trim() || SUBJECT_PADRAO };
}

/** Reserva o aviso. null = esse dedupeKey já foi usado (outro gatilho avisou antes). */
export async function reservarEnvio(input: {
  empresaId: string;
  tipo: TipoPushEnvio;
  dedupeKey: string | null;
  payload: PayloadPush;
}): Promise<string | null> {
  try {
    const criado = await db.pushEnvio.create({
      data: {
        empresaId: input.empresaId,
        tipo: input.tipo,
        dedupeKey: input.dedupeKey,
        payloadJson: JSON.stringify(input.payload),
      },
      select: { id: true },
    });
    return criado.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

export async function entregar(input: {
  empresaId: string;
  payload: PayloadPush;
  /** Só para o teste: aparelhos de um usuário. Sem isso: quem quer vendas. */
  usuarioId?: string;
  cfg?: VapidConfig | null;
}): Promise<ResultadoEntrega> {
  const cfg = input.cfg === undefined ? getVapidConfig() : input.cfg;
  if (!cfg) return { destinos: 0, ok: 0, falhas: 0 };

  const dispositivos = await db.pushDispositivo.findMany({
    where: {
      empresaId: input.empresaId,
      ativo: true,
      ...(input.usuarioId ? { usuarioId: input.usuarioId } : { receberVendas: true }),
    },
    select: { id: true, endpoint: true, p256dh: true, auth: true, falhasConsecutivas: true },
  });

  const corpo = JSON.stringify(input.payload);
  const resultados = await Promise.all(
    dispositivos.map(async (d) => {
      try {
        await webpush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          corpo,
          {
            TTL: 3600,
            urgency: "high",
            timeout: 5000,
            vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
          },
        );
        await db.pushDispositivo.update({
          where: { id: d.id },
          data: { ultimoEnvioEm: new Date(), falhasConsecutivas: 0 },
        });
        return true;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // A inscrição morreu no navegador: vale para todas as lojas do aparelho.
          await db.pushDispositivo.deleteMany({ where: { endpoint: d.endpoint } });
        } else {
          const falhas = d.falhasConsecutivas + 1;
          await db.pushDispositivo.update({
            where: { id: d.id },
            data: { falhasConsecutivas: falhas, ativo: falhas < MAX_FALHAS_CONSECUTIVAS },
          });
          logger.warn({ status, dispositivoId: d.id }, "push: falha ao entregar");
        }
        return false;
      }
    }),
  );
  const ok = resultados.filter(Boolean).length;
  return { destinos: dispositivos.length, ok, falhas: dispositivos.length - ok };
}

export async function concluirEnvio(envioId: string, r: ResultadoEntrega): Promise<void> {
  const status = r.destinos === 0 ? "SEM_DESTINO" : r.ok > 0 ? "ENVIADO" : "ERRO";
  await db.pushEnvio.update({
    where: { id: envioId },
    data: { status, enviadosOk: r.ok, falhas: r.falhas, enviadoEm: new Date() },
  });
}

export async function enviarPush(input: {
  empresaId: string;
  tipo: TipoPushEnvio;
  dedupeKey: string | null;
  payload: PayloadPush;
  usuarioId?: string;
  cfg?: VapidConfig | null;
}): Promise<ResultadoEntrega & { duplicado: boolean }> {
  const envioId = await reservarEnvio(input);
  if (!envioId) return { destinos: 0, ok: 0, falhas: 0, duplicado: true };
  const r = await entregar(input);
  await concluirEnvio(envioId, r);
  return { ...r, duplicado: false };
}
