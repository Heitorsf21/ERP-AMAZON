import { enviarEmail, escapeHtml } from "@/lib/email";

/**
 * Envia o convite com link de definir senha. O link leva slug+email pra
 * pre-preencher o login depois. NUNCA envia senha em texto puro.
 */
export async function enviarConviteAdmin(input: {
  to: string;
  nome: string;
  empresaNome: string;
  slug: string;
  rawToken: string;
}): Promise<{ ok: boolean; viaConsole: boolean }> {
  const base = process.env.APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
  const link = `${base}/definir-senha?token=${encodeURIComponent(input.rawToken)}` +
    `&empresa=${encodeURIComponent(input.slug)}&email=${encodeURIComponent(input.to)}`;
  return enviarEmail({
    to: input.to,
    subject: `Acesso ao Atlas Seller — ${input.empresaNome}`,
    html: `
      <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#0b1220">Bem-vindo(a) ao Atlas Seller</h2>
        <p>Olá ${escapeHtml(input.nome)},</p>
        <p>Você foi cadastrado(a) como administrador da empresa
           <strong>${escapeHtml(input.empresaNome)}</strong>.</p>
        <p>Defina sua senha para acessar:</p>
        <p style="text-align:center;margin:24px 0">
          <a href="${link}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Definir minha senha</a>
        </p>
        <p style="color:#6b7280;font-size:13px">O link expira em 7 dias. Se você não esperava este convite, ignore este e-mail.</p>
      </div>`,
  });
}
