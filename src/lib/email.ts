import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "@/lib/logger";

type EnviarEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

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
    // Modo dev: log estruturado para devs verem o que seria enviado
    logger.info(
      {
        to: input.to,
        subject: input.subject,
        textPreview: (input.text ?? input.html.replace(/<[^>]+>/g, "")).slice(
          0,
          400,
        ),
      },
      "[email DEV] email simulado (SMTP não configurado)",
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
