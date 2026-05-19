import { handle, ok, erro } from "@/lib/api";
import {
  getConfigImpostoSimples,
  saveConfigImpostoSimples,
} from "@/modules/configuracao/imposto-simples";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const config = await getConfigImpostoSimples();
  return ok(config);
});

export const PUT = handle(async (req: Request) => {
  const body = (await req.json()) as {
    aliquotaBps?: unknown;
    ativo?: unknown;
  };

  const aliquotaBps =
    body.aliquotaBps != null ? Number(body.aliquotaBps) : undefined;
  if (aliquotaBps != null && (!Number.isFinite(aliquotaBps) || aliquotaBps < 0)) {
    return erro(400, "aliquotaBps invalido");
  }

  const ativo =
    typeof body.ativo === "boolean"
      ? body.ativo
      : body.ativo === "true"
        ? true
        : body.ativo === "false"
          ? false
          : undefined;

  const config = await saveConfigImpostoSimples({ aliquotaBps, ativo });
  return ok(config);
});
