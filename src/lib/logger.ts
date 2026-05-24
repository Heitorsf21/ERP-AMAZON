import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

// Paths sensíveis que o pino mascara antes de serializar. Cobre todos os
// pontos onde acidentalmente possamos passar credenciais (body de auth,
// headers de cookie/authorization, codigos 2FA, refresh tokens). NUNCA
// remover entradas — só adicionar.
const REDACT_PATHS = [
  "password",
  "senha",
  "senhaAtual",
  "senhaNova",
  "novaSenha",
  "senhaHash",
  "token",
  "tokenHash",
  "tokenPlain",
  "refreshToken",
  "accessToken",
  "codigo",
  "codigoHash",
  "authorization",
  "cookie",
  "secret",
  "*.password",
  "*.senha",
  "*.senhaAtual",
  "*.senhaNova",
  "*.novaSenha",
  "*.senhaHash",
  "*.token",
  "*.tokenHash",
  "*.refreshToken",
  "*.accessToken",
  "*.codigo",
  "*.secret",
  "headers.authorization",
  "headers.cookie",
  "headers['set-cookie']",
  "req.headers.authorization",
  "req.headers.cookie",
  "body.password",
  "body.senha",
  "body.senhaAtual",
  "body.senhaNova",
  "body.novaSenha",
  "body.codigo",
  "body.token",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  redact: {
    paths: REDACT_PATHS,
    censor: "[redacted]",
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
      }
    : {}),
});
