import { handle, ok, erro } from "@/lib/api";
import { contasReceberService } from "@/modules/contas-a-receber/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  const formData = await req.formData();
  const file = formData.get("arquivo") as File | null;

  if (!file) {
    return erro(400, "campo 'arquivo' obrigatório (CSV Amazon)");
  }

  if (!file.name.endsWith(".csv")) {
    return erro(400, "apenas arquivos .csv são aceitos");
  }

  const conteudo = await file.text();
  const resumo = await contasReceberService.importarAmazonCSV(conteudo);
  return ok(resumo);
});
