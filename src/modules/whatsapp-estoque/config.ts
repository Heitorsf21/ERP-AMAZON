import { db } from "@/lib/db";
import {
  decryptConfigValue,
  encryptConfigValue,
  isSecretConfigKey,
} from "@/lib/crypto";

export const WHATSAPP_ESTOQUE_KEYS = {
  ATIVO: "whatsapp_estoque_ativo",
  HORARIO: "whatsapp_estoque_horario",
  DESTINATARIO: "whatsapp_estoque_destinatario",
  WAHA_URL: "whatsapp_estoque_waha_url",
  WAHA_SESSION: "whatsapp_estoque_waha_session",
  WAHA_API_KEY: "whatsapp_estoque_waha_api_key",
} as const;

export const HORARIO_DEFAULT = "10:00";
export const SESSION_DEFAULT = "default";

export type WhatsappEstoqueConfig = {
  ativo: boolean;
  horario: string;
  destinatario: string;
  wahaUrl: string;
  wahaSession: string;
  wahaApiKey: string;
};

// Versao para a UI: nunca expoe a api key real, apenas se esta definida.
export type WhatsappEstoqueConfigPublic = Omit<
  WhatsappEstoqueConfig,
  "wahaApiKey"
> & { wahaApiKeyDefinida: boolean };

export type SalvarWhatsappEstoqueConfig = {
  ativo?: boolean;
  horario?: string;
  destinatario?: string;
  wahaUrl?: string;
  wahaSession?: string;
  wahaApiKey?: string;
};

function parseBool(valor: string | undefined | null): boolean {
  if (valor == null) return false;
  const n = valor.trim().toLowerCase();
  return n === "true" || n === "1" || n === "on";
}

const TODAS_KEYS = Object.values(WHATSAPP_ESTOQUE_KEYS);

export async function getWhatsappEstoqueConfig(): Promise<WhatsappEstoqueConfig> {
  const registros = await db.configuracaoSistema.findMany({
    where: { chave: { in: TODAS_KEYS } },
    select: { chave: true, valor: true },
  });
  const mapa = new Map(registros.map((r) => [r.chave, r.valor]));

  return {
    ativo: parseBool(mapa.get(WHATSAPP_ESTOQUE_KEYS.ATIVO)),
    horario: mapa.get(WHATSAPP_ESTOQUE_KEYS.HORARIO)?.trim() || HORARIO_DEFAULT,
    destinatario:
      mapa.get(WHATSAPP_ESTOQUE_KEYS.DESTINATARIO)?.trim() ?? "",
    wahaUrl: mapa.get(WHATSAPP_ESTOQUE_KEYS.WAHA_URL)?.trim() ?? "",
    wahaSession:
      mapa.get(WHATSAPP_ESTOQUE_KEYS.WAHA_SESSION)?.trim() || SESSION_DEFAULT,
    wahaApiKey:
      decryptConfigValue(mapa.get(WHATSAPP_ESTOQUE_KEYS.WAHA_API_KEY) ?? "") ??
      "",
  };
}

export async function getWhatsappEstoqueConfigPublic(): Promise<WhatsappEstoqueConfigPublic> {
  const { wahaApiKey, ...resto } = await getWhatsappEstoqueConfig();
  return { ...resto, wahaApiKeyDefinida: wahaApiKey.length > 0 };
}

/**
 * Versao leve para o gate do worker (le apenas ativo + horario).
 */
export async function getWhatsappEstoqueScheduleConfig(): Promise<{
  ativo: boolean;
  horario: string;
}> {
  const registros = await db.configuracaoSistema.findMany({
    where: {
      chave: { in: [WHATSAPP_ESTOQUE_KEYS.ATIVO, WHATSAPP_ESTOQUE_KEYS.HORARIO] },
    },
    select: { chave: true, valor: true },
  });
  const mapa = new Map(registros.map((r) => [r.chave, r.valor]));
  return {
    ativo: parseBool(mapa.get(WHATSAPP_ESTOQUE_KEYS.ATIVO)),
    horario: mapa.get(WHATSAPP_ESTOQUE_KEYS.HORARIO)?.trim() || HORARIO_DEFAULT,
  };
}

export async function saveWhatsappEstoqueConfig(
  input: SalvarWhatsappEstoqueConfig,
): Promise<void> {
  const writes: Array<Promise<unknown>> = [];

  const setKey = (chave: string, valor: string) => {
    if (!valor) {
      writes.push(db.configuracaoSistema.deleteMany({ where: { chave } }));
      return;
    }
    const armazenado = isSecretConfigKey(chave)
      ? encryptConfigValue(valor)
      : valor;
    writes.push(
      db.configuracaoSistema.upsert({
        where: { chave },
        create: { chave, valor: armazenado },
        update: { valor: armazenado },
      }),
    );
  };

  if (input.ativo != null) {
    setKey(WHATSAPP_ESTOQUE_KEYS.ATIVO, input.ativo ? "true" : "false");
  }
  if (input.horario != null) {
    setKey(WHATSAPP_ESTOQUE_KEYS.HORARIO, input.horario.trim());
  }
  if (input.destinatario != null) {
    setKey(WHATSAPP_ESTOQUE_KEYS.DESTINATARIO, input.destinatario.trim());
  }
  if (input.wahaUrl != null) {
    setKey(WHATSAPP_ESTOQUE_KEYS.WAHA_URL, input.wahaUrl.trim());
  }
  if (input.wahaSession != null) {
    setKey(WHATSAPP_ESTOQUE_KEYS.WAHA_SESSION, input.wahaSession.trim());
  }
  // Segredo: se vier mascarado (com "*"), preserva o valor ja armazenado.
  if (input.wahaApiKey != null && !input.wahaApiKey.includes("*")) {
    setKey(WHATSAPP_ESTOQUE_KEYS.WAHA_API_KEY, input.wahaApiKey.trim());
  }

  await Promise.all(writes);
}
