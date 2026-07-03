import { handle, ok, erro } from "@/lib/api";
import { assertEmpresaPrimaria, requireRole, UsuarioRole } from "@/lib/auth";
import { gerarUrlAutorizacao } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const session = await requireRole(UsuarioRole.ADMIN);
  // Integracao Gmail e GLOBAL (caixa da empresa primaria) — gate anti cross-tenant.
  assertEmpresaPrimaria(session);
  try {
    const url = await gerarUrlAutorizacao();
    return ok({ url });
  } catch (e) {
    return erro(400, e instanceof Error ? e.message : "Erro ao gerar URL");
  }
});
