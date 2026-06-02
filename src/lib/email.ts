import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "@/lib/logger";

type EnviarEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * Escapa metacaracteres HTML para uso seguro em interpolacao de templates de
 * e-mail. Necessario porque user.nome / user.email podem conter "<" / ">" /
 * aspas / '&' e sao renderizados direto no body do e-mail (HTML).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Mascara um email para logging seguro: mantém os 2 primeiros caracteres do
 * local-part e o domínio. Entrada sem "@" vira "***" (nunca vaza o valor cru).
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `***${domain}`;
  return `${local.slice(0, 2)}***${domain}`;
}

export type DevEmailLog = { to: string; subject: string; bodyPreview?: string };

/**
 * Monta o payload de log para o modo dev (SMTP ausente). Por padrão NÃO inclui o
 * corpo — o body de emails transacionais carrega SEGREDOS (link de reset de
 * senha, código 2FA, token de convite). O preview só entra com opt-in explícito
 * (EMAIL_DEV_LOG_BODY=true em ambiente não-produção), para depuração local.
 */
export function buildDevEmailLog(
  input: { to: string; subject: string; text?: string; html: string },
  opts: { logBody: boolean },
): DevEmailLog {
  const log: DevEmailLog = { to: maskEmail(input.to), subject: input.subject };
  if (opts.logBody) {
    log.bodyPreview = (input.text ?? input.html.replace(/<[^>]+>/g, "")).slice(0, 400);
  }
  return log;
}

let transporterCache: Transporter | null = null;
let configChecked = false;
let configValid = false;

function getTransporter(): Transporter | null {
  if (configChecked) return transporterCache;
  configChecked = true;

  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const secure = (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true";

  if (!host || !user || !pass) {
    logger.warn(
      "[email] SMTP_HOST/USER/PASS ausentes — emails caem no console (modo dev)",
    );
    return null;
  }

  configValid = true;
  transporterCache = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return transporterCache;
}

/**
 * Envia email transacional. Em dev (sem SMTP configurado), loga o conteúdo
 * no console em vez de falhar — modo permissivo igual ao crypto.ts.
 *
 * Retorna sempre `{ ok, viaConsole }`. Caller deve tratar `ok=false` como
 * falha real (SMTP configurado mas erro ao enviar).
 */
export async function enviarEmail(
  input: EnviarEmailInput,
): Promise<{ ok: boolean; viaConsole: boolean }> {
  const from = process.env.SMTP_FROM?.trim() || "noreply@localhost";
  const transporter = getTransporter();

  if (!transporter) {
    // PRODUÇÃO sem SMTP = misconfiguração. NÃO logar o corpo (vazaria link de
    // reset / código 2FA / token de convite) e NÃO fingir sucesso: o email não
    // saiu. Retornar ok=false força o caller a tratar como falha real.
    if (process.env.NODE_ENV === "production") {
      logger.error(
        { to: maskEmail(input.to), subject: input.subject },
        "[email] SMTP não configurado em produção — email NÃO enviado",
      );
      return { ok: false, viaConsole: false };
    }

    // DEV: por padrão loga só metadados mascarados. Para ver o link/código no
    // console (depuração local), defina EMAIL_DEV_LOG_BODY=true.
    const logBody = process.env.EMAIL_DEV_LOG_BODY === "true";
    logger.info(
      buildDevEmailLog(input, { logBody }),
      logBody
        ? "[email DEV] email simulado (SMTP não configurado) — corpo logado (EMAIL_DEV_LOG_BODY=true)"
        : "[email DEV] email simulado (SMTP não configurado) — defina EMAIL_DEV_LOG_BODY=true p/ ver o conteúdo",
    );
    return { ok: true, viaConsole: true };
  }

  try {
    await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text ?? input.html.replace(/<[^>]+>/g, ""),
    });
    return { ok: true, viaConsole: false };
  } catch (err) {
    logger.error({ err, to: input.to, subject: input.subject }, "[email] falha ao enviar");
    return { ok: false, viaConsole: false };
  }
}

export function isEmailConfigured(): boolean {
  getTransporter();
  return configValid;
}
