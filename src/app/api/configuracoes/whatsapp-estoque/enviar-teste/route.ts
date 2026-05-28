import { handleAuth, ok, erro } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { runWhatsappEstoqueResumo } from "@/modules/whatsapp-estoque/jobs";

export const dynamic = "force-dynamic";

/** Dispara um envio de teste imediato e devolve o resultado para a UI. */
export const POST = handleAuth([UsuarioRole.ADMIN], async () => {
  const resultado = await runWhatsappEstoqueResumo({ tipo: "TESTE" });
  if (resultado.status !== "SUCESSO") {
    return erro(502, resultado.erro ?? "falha ao enviar teste", resultado);
  }
  return ok(resultado);
});
