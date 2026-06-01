export const SLUGS_RESERVADOS = [
  "api", "app", "plataforma", "admin", "www", "static", "_next",
  "login", "logout", "dashboard-ecommerce", "definir-senha",
  "redefinir-senha", "recuperar-senha", "configuracoes",
] as const;

const FORMATO = /^[a-z0-9-]{3,30}$/;

export type SlugCheck = { ok: true } | { ok: false; motivo: string };

export function validarSlug(slug: string): SlugCheck {
  if (!FORMATO.test(slug)) {
    return { ok: false, motivo: "Use 3 a 30 caracteres: letras minusculas, numeros e hifen." };
  }
  if ((SLUGS_RESERVADOS as readonly string[]).includes(slug)) {
    return { ok: false, motivo: "Este identificador e reservado." };
  }
  return { ok: true };
}
