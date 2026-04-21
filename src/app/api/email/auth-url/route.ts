import { handle, ok, erro } from "@/lib/api";
import { gerarUrlAutorizacao } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  try {
    const url = await gerarUrlAutorizacao();
    return ok({ url });
  } catch (e) {
    return erro(400, e instanceof Error ? e.message : "Erro ao gerar URL");
  }
});
