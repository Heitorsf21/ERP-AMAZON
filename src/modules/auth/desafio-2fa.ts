// Desafio 2FA compartilhado entre o login e o vínculo de lojas.
//
// `finalidade` separa os fluxos: "LOGIN" ou "VINCULO:<usuarioId de quem pediu>".
// Um código pedido para vincular não abre sessão (o /api/auth/2fa/verificar
// exige "LOGIN") e um código de login não cria vínculo.

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Usuario } from "@prisma/client";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { decryptConfigValue } from "@/lib/crypto";
import { enviarEmail, escapeHtml } from "@/lib/email";
import { verificarTotp } from "@/lib/totp";
import { TipoAuditLog } from "@/modules/shared/domain";

export const FINALIDADE_LOGIN = "LOGIN";

export function finalidadeVinculo(usuarioId: string): string {
  return `VINCULO:${usuarioId}`;
}

// Limite de tentativas por desafio. Ao atingir, o desafio é invalidado
// (usadoEm = agora) e exige começar de novo.
const MAX_TENTATIVAS_POR_CHALLENGE = 5;
const VALIDADE_MS = 5 * 60_000;

type ContaCom2FA = {
  id: string;
  email: string;
  nome: string;
  twoFactorEnabled: boolean;
  twoFactorMethod: string | null;
};

function emailDoCodigo(nome: string, codigo: string, vinculo: boolean): { subject: string; html: string } {
  if (vinculo) {
    return {
      subject: "Código para vincular sua loja — Atlas Seller",
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #0b1220;">Vincular esta loja</h2>
          <p>Olá ${escapeHtml(nome)},</p>
          <p>Pediram para vincular esta conta a outra loja no Atlas Seller. O código é:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; background: #f3f4f6; padding: 16px; text-align: center; border-radius: 8px;">${codigo}</p>
          <p style="color: #6b7280; font-size: 13px;">Este código expira em 5 minutos. Se não foi você, ignore este email e troque sua senha.</p>
        </div>
      `,
    };
  }
  return {
    subject: "Código de verificação — ERP Mundo F&S",
    html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #0b1220;">Código de verificação</h2>
          <p>Olá ${escapeHtml(nome)},</p>
          <p>Seu código de acesso ao ERP é:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px; background: #f3f4f6; padding: 16px; text-align: center; border-radius: 8px;">${codigo}</p>
          <p style="color: #6b7280; font-size: 13px;">Este código expira em 5 minutos. Se você não tentou entrar, ignore este email.</p>
        </div>
      `,
  };
}

/**
 * Cria o desafio 2FA da conta, quando ela usa 2FA. EMAIL: gera e envia o
 * código. TOTP: o código vem do app autenticador (validado contra o segredo).
 * Devolve null quando a conta não tem 2FA.
 */
export async function criarDesafio2FA(
  usuario: ContaCom2FA,
  finalidade: string,
): Promise<{ challengeId: string; metodo: "EMAIL" | "TOTP" } | null> {
  if (!usuario.twoFactorEnabled) return null;
  const challengeId = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + VALIDADE_MS);

  if (usuario.twoFactorMethod === "EMAIL") {
    const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const codigoHash = await bcrypt.hash(codigo, 8);
    await db.codigoVerificacao2FA.create({
      data: { usuarioId: usuario.id, codigoHash, challengeId, expiresAt, finalidade },
    });
    const { subject, html } = emailDoCodigo(usuario.nome, codigo, finalidade !== FINALIDADE_LOGIN);
    await enviarEmail({ to: usuario.email, subject, html });
    return { challengeId, metodo: "EMAIL" };
  }

  if (usuario.twoFactorMethod === "TOTP") {
    await db.codigoVerificacao2FA.create({
      data: {
        usuarioId: usuario.id,
        codigoHash: "-", // não usado no TOTP (validação é contra o segredo)
        metodo: "TOTP",
        challengeId,
        expiresAt,
        finalidade,
      },
    });
    return { challengeId, metodo: "TOTP" };
  }

  return null;
}

export type ResultadoDesafio =
  | { ok: true; usuario: Usuario }
  | { ok: false; erro: "CODIGO_INVALIDO_OU_EXPIRADO" | "CHALLENGE_BLOQUEADO" | "CODIGO_INCORRETO" };

/**
 * Confere o código de um desafio da `finalidade` pedida. Conta tentativas,
 * bloqueia na 5ª errada e marca o desafio como usado de forma atômica (dois
 * envios simultâneos do código certo: só o primeiro vale).
 */
export async function conferirDesafio2FA(input: {
  challengeId: string;
  codigo: string;
  finalidade: string;
  req: Request;
  etapaAuditoria?: string;
}): Promise<ResultadoDesafio> {
  const { challengeId, codigo, finalidade, req } = input;
  const etapa = input.etapaAuditoria ?? "2FA";

  const challenge = await db.codigoVerificacao2FA.findUnique({
    where: { challengeId },
    include: { usuario: true },
  });

  if (
    !challenge ||
    challenge.usadoEm ||
    challenge.expiresAt < new Date() ||
    !challenge.usuario.ativo ||
    challenge.finalidade !== finalidade
  ) {
    await auditLog({
      req,
      acao: TipoAuditLog.LOGIN_FALHA,
      entidade: "Usuario",
      entidadeId: challenge?.usuarioId ?? null,
      metadata: { etapa, motivo: "challenge_invalido" },
    });
    return { ok: false, erro: "CODIGO_INVALIDO_OU_EXPIRADO" };
  }

  // Defesa redundante: outro request pode ter estourado o limite entre a
  // leitura e este ponto.
  if (challenge.tentativas >= MAX_TENTATIVAS_POR_CHALLENGE) {
    return { ok: false, erro: "CHALLENGE_BLOQUEADO" };
  }

  const codigoOk =
    challenge.metodo === "TOTP"
      ? verificarTotp(codigo, decryptConfigValue(challenge.usuario.totpSecretEnc) ?? "")
      : await bcrypt.compare(codigo, challenge.codigoHash);

  if (!codigoOk) {
    const novaTentativa = challenge.tentativas + 1;
    const limiteAtingido = novaTentativa >= MAX_TENTATIVAS_POR_CHALLENGE;
    await db.codigoVerificacao2FA.update({
      where: { id: challenge.id },
      data: {
        tentativas: novaTentativa,
        usadoEm: limiteAtingido ? new Date() : undefined,
      },
    });
    await auditLog({
      req,
      acao: TipoAuditLog.LOGIN_FALHA,
      entidade: "Usuario",
      entidadeId: challenge.usuarioId,
      metadata: {
        etapa,
        motivo: limiteAtingido ? "challenge_bloqueado_por_tentativas" : "codigo_incorreto",
        tentativas: novaTentativa,
      },
    });
    return { ok: false, erro: limiteAtingido ? "CHALLENGE_BLOQUEADO" : "CODIGO_INCORRETO" };
  }

  const marcado = await db.codigoVerificacao2FA.updateMany({
    where: { id: challenge.id, usadoEm: null },
    data: { usadoEm: new Date() },
  });
  if (marcado.count !== 1) {
    return { ok: false, erro: "CODIGO_INVALIDO_OU_EXPIRADO" };
  }

  return { ok: true, usuario: challenge.usuario };
}
