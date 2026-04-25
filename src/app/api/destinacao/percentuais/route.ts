import { handle, ok } from "@/lib/api";
import {
  BOLSAS,
  BOLSA_META,
  PERCENTUAIS_DEFAULT,
  getPercentuais,
  setPercentuais,
  type Bolsa,
  type Percentuais,
} from "@/modules/destinacao/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const { percentuais, configurado } = await getPercentuais();
  return ok({
    percentuais,
    configurado,
    defaults: PERCENTUAIS_DEFAULT,
    bolsas: BOLSAS.map((b) => ({
      bolsa: b,
      label: BOLSA_META[b].label,
      descricao: BOLSA_META[b].descricao,
      cor: BOLSA_META[b].cor,
    })),
  });
});

export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as Partial<Percentuais> | undefined;
  if (!body || typeof body !== "object") {
    throw new Error("body inválido");
  }
  // Filtra só chaves válidas para não confundir o service.
  const limpo: Partial<Percentuais> = {};
  for (const b of BOLSAS) {
    const v = (body as Record<string, unknown>)[b];
    if (v !== undefined && v !== null) {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        throw new Error(`valor inválido para "${b}"`);
      }
      limpo[b as Bolsa] = n;
    }
  }
  const salvos = await setPercentuais(limpo);
  return ok({ percentuais: salvos });
});
