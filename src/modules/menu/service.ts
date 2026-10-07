import { db } from "@/lib/db";
import { HREFS_NAV } from "@/components/nav-routes";
import { chaveMenuUsuario, parseOcultas, sanitizarOcultas } from "./preferencias";

// ConfiguracaoSistema é GLOBAL; a chave carrega o id do usuário (único entre
// empresas), então não há como um usuário ler o menu de outro.
export async function lerOcultas(usuarioId: string): Promise<string[]> {
  const row = await db.configuracaoSistema.findUnique({
    where: { chave: chaveMenuUsuario(usuarioId) },
  });
  return sanitizarOcultas(parseOcultas(row?.valor), HREFS_NAV);
}

export async function salvarOcultas(
  usuarioId: string,
  ocultas: readonly string[],
): Promise<string[]> {
  const limpas = sanitizarOcultas(ocultas, HREFS_NAV);
  const chave = chaveMenuUsuario(usuarioId);
  const valor = JSON.stringify(limpas);
  await db.configuracaoSistema.upsert({
    where: { chave },
    create: { chave, valor },
    update: { valor },
  });
  return limpas;
}
