// Gmail API integration via OAuth2 (googleapis).
// Credentials stored in ConfiguracaoSistema to be configurable from the UI.

import { google } from "googleapis";
import { db } from "@/lib/db";
import {
  decryptConfigValue,
  encryptConfigValue,
  isSecretConfigKey,
} from "@/lib/crypto";

// ─── Config helpers ──────────────────────────────────────────────────────────

async function cfg(chave: string): Promise<string | null> {
  const row = await db.configuracaoSistema.findUnique({ where: { chave } });
  return decryptConfigValue(row?.valor) ?? null;
}

async function setCfg(chave: string, valor: string): Promise<void> {
  const armazenado = isSecretConfigKey(chave) ? encryptConfigValue(valor) : valor;
  await db.configuracaoSistema.upsert({
    where: { chave },
    update: { valor: armazenado },
    create: { chave, valor: armazenado },
  });
}

// ─── OAuth2 client ───────────────────────────────────────────────────────────

async function makeOAuth2() {
  const clientId = await cfg("gmail_client_id");
  const clientSecret = await cfg("gmail_client_secret");
  const redirectUri =
    (await cfg("gmail_redirect_uri")) ?? "http://localhost:3000/api/email/callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Credenciais Gmail não configuradas. Preencha Client ID e Client Secret em Configurações → Email.",
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function gerarUrlAutorizacao(): Promise<string> {
  const oauth2 = await makeOAuth2();
  return oauth2.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
    prompt: "consent",
  });
}

export async function trocarCodigo(code: string): Promise<void> {
  const oauth2 = await makeOAuth2();
  const { tokens } = await oauth2.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "Nenhum refresh_token retornado. Revogue o acesso em myaccount.google.com/permissions e tente novamente.",
    );
  }

  await setCfg("gmail_refresh_token", tokens.refresh_token);
  if (tokens.access_token) await setCfg("gmail_access_token", tokens.access_token);
  if (tokens.expiry_date) await setCfg("gmail_token_expiry", String(tokens.expiry_date));
}

async function getGmailClient() {
  const refreshToken = await cfg("gmail_refresh_token");
  if (!refreshToken) {
    throw new Error("Gmail não autorizado. Conecte sua conta em Configurações → Email.");
  }

  const oauth2 = await makeOAuth2();
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2 });
}

export async function verificarConexao(): Promise<{ ok: boolean; email?: string }> {
  try {
    const gmail = await getGmailClient();
    const { data } = await gmail.users.getProfile({ userId: "me" });
    return { ok: true, email: data.emailAddress ?? undefined };
  } catch {
    return { ok: false };
  }
}

export type AnexoEmail = {
  messageId: string;
  assunto: string;
  remetente: string;
  dataEmail: Date;
  nomeArquivo: string;
  mimeType: string;
  dados: Buffer;
};

const EXT_ACEITAS = [".csv", ".xlsx", ".xls", ".ofx"];

// Recursively find attachment parts (Gmail nests parts in multipart/mixed emails)
function coletarPartes(parts: NonNullable<ReturnType<typeof Object.create>>[]): typeof parts {
  const resultado: typeof parts = [];
  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      resultado.push(part);
    }
    if (part.parts?.length) {
      resultado.push(...coletarPartes(part.parts as typeof parts));
    }
  }
  return resultado;
}

export async function buscarEmailsComAnexos(diasAtras = 14): Promise<AnexoEmail[]> {
  const gmail = await getGmailClient();

  const corte = new Date();
  corte.setDate(corte.getDate() - diasAtras);
  const filtroData = `${corte.getFullYear()}/${corte.getMonth() + 1}/${corte.getDate()}`;

  const listResp = await gmail.users.messages.list({
    userId: "me",
    q: `has:attachment after:${filtroData}`,
    maxResults: 50,
  });

  const mensagens = listResp.data.messages ?? [];
  if (mensagens.length === 0) return [];

  // IDs already processed (avoid duplicates)
  const processadosRaw = await cfg("gmail_processados_ids");
  const processados = new Set<string>(processadosRaw ? (JSON.parse(processadosRaw) as string[]) : []);

  const anexos: AnexoEmail[] = [];

  for (const msg of mensagens) {
    if (!msg.id || processados.has(msg.id)) continue;

    const msgData = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "full",
    });

    const headers = msgData.data.payload?.headers ?? [];
    const assunto = headers.find((h) => h.name === "Subject")?.value ?? "";
    const remetente = headers.find((h) => h.name === "From")?.value ?? "";
    const dateStr = headers.find((h) => h.name === "Date")?.value ?? "";
    const dataEmail = dateStr ? new Date(dateStr) : new Date();

    const allParts = coletarPartes((msgData.data.payload?.parts ?? []) as ReturnType<typeof Object.create>[]);

    for (const part of allParts) {
      const filename: string = part.filename ?? "";
      const mimeType: string = part.mimeType ?? "";
      const attachmentId: string = part.body?.attachmentId ?? "";

      if (!attachmentId || !filename) continue;

      const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
      if (!EXT_ACEITAS.includes(ext)) continue;

      const attachResp = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: msg.id,
        id: attachmentId,
      });

      const b64 = attachResp.data.data;
      if (!b64) continue;

      const dados = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64");

      anexos.push({ messageId: msg.id, assunto, remetente, dataEmail, nomeArquivo: filename, mimeType, dados });
    }
  }

  return anexos;
}

export async function marcarProcessado(messageId: string): Promise<void> {
  const raw = await cfg("gmail_processados_ids");
  const ids: string[] = raw ? (JSON.parse(raw) as string[]) : [];
  if (!ids.includes(messageId)) {
    ids.push(messageId);
    await setCfg("gmail_processados_ids", JSON.stringify(ids.slice(-500)));
  }
}

export async function salvarCredenciais(clientId: string, clientSecret: string, redirectUri?: string) {
  await setCfg("gmail_client_id", clientId);
  await setCfg("gmail_client_secret", clientSecret);
  if (redirectUri) await setCfg("gmail_redirect_uri", redirectUri);
}

export async function getStatus() {
  const [clientId, refreshToken, ultimaSync] = await Promise.all([
    cfg("gmail_client_id"),
    cfg("gmail_refresh_token"),
    cfg("gmail_ultima_sincronizacao"),
  ]);

  return {
    credenciaisConfiguradas: !!(clientId),
    autorizado: !!(refreshToken),
    ultimaSincronizacao: ultimaSync ?? null,
  };
}
