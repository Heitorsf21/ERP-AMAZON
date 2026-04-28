import { z } from "zod";

export const PASSWORD_POLICY_MESSAGE =
  "Senha precisa ter ao menos 12 caracteres, com maiuscula, minuscula, numero e caractere especial";

export const strongPasswordSchema = z
  .string()
  .min(12, PASSWORD_POLICY_MESSAGE)
  .max(200)
  .regex(/[a-z]/, PASSWORD_POLICY_MESSAGE)
  .regex(/[A-Z]/, PASSWORD_POLICY_MESSAGE)
  .regex(/[0-9]/, PASSWORD_POLICY_MESSAGE)
  .regex(/[^A-Za-z0-9]/, PASSWORD_POLICY_MESSAGE);
