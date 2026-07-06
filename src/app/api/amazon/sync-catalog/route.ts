import { handle, ok } from "@/lib/api";
import { assertEmpresaPrimaria, requireRole, UsuarioRole } from "@/lib/auth";
import { syncCatalog } from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  const session = await requireRole(UsuarioRole.ADMIN, UsuarioRole.OPERADOR);
  // Sync usa a credencial SP-API GLOBAL legada (ConfiguracaoSistema da empresa
  // primária) e materializa dados no tenant do chamador — só a primária dispara.
  assertEmpresaPrimaria(session);
  let produtoIds: string[] | undefined;

  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body?.produtoIds)) produtoIds = body.produtoIds as string[];
  }

  const result = await syncCatalog(produtoIds);
  return ok(result);
});
