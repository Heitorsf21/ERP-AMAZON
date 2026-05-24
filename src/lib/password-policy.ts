import { z } from "zod";

export const PASSWORD_POLICY_MESSAGE =
  "Senha precisa ter ao menos 12 caracteres, com maiuscula, minuscula, numero e caractere especial";

export const PASSWORD_POLICY_MIN_LENGTH = 12;

export const strongPasswordSchema = z
  .string()
  .min(PASSWORD_POLICY_MIN_LENGTH, PASSWORD_POLICY_MESSAGE)
  .max(200)
  .regex(/[a-z]/, PASSWORD_POLICY_MESSAGE)
  .regex(/[A-Z]/, PASSWORD_POLICY_MESSAGE)
  .regex(/[0-9]/, PASSWORD_POLICY_MESSAGE)
  .regex(/[^A-Za-z0-9]/, PASSWORD_POLICY_MESSAGE);

/**
 * Resultado per-requisito para o indicador visual no front. Backend continua
 * usando `strongPasswordSchema` para enforce — esse helper espelha as mesmas
 * regras para o cliente bloquear submissoes invalidas antes da rede.
 */
export type PasswordChecks = {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
};

export function evaluatePassword(senha: string): PasswordChecks {
  return {
    minLength: senha.length >= PASSWORD_POLICY_MIN_LENGTH,
    hasUppercase: /[A-Z]/.test(senha),
    hasLowercase: /[a-z]/.test(senha),
    hasDigit: /[0-9]/.test(senha),
    hasSpecial: /[^A-Za-z0-9]/.test(senha),
  };
}

export function isPasswordStrong(senha: string): boolean {
  const c = evaluatePassword(senha);
  return c.minLength && c.hasUppercase && c.hasLowercase && c.hasDigit && c.hasSpecial;
}

/**
 * Retorna mensagem de erro pronta para exibir ou null se senha for valida.
 */
export function validatePasswordClient(senha: string): string | null {
  if (!senha) return PASSWORD_POLICY_MESSAGE;
  if (isPasswordStrong(senha)) return null;
  return PASSWORD_POLICY_MESSAGE;
}
