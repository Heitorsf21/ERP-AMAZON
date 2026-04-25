import { z } from "zod";
import { handle, ok } from "@/lib/api";
import {
  PeriodoPreset,
  resolverPeriodo,
  resolverPeriodoDeBusca,
} from "@/lib/periodo";
import { dashboardEcommerceService } from "@/modules/dashboard-ecommerce/service";

export const dynamic = "force-dynamic";

const criarAdsGastoManualSchema = z.object({
  periodoInicio: z.string().date(),
  periodoFim: z.string().date(),
  produtoId: z.string().optional().nullable(),
  valorCentavos: z.number().int().min(1),
});

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const periodo = resolverPeriodoDeBusca(searchParams);
  const gastos = await dashboardEcommerceService.listarAdsGastoManual(periodo);
  return ok(gastos);
});

export const POST = handle(async (req: Request) => {
  const body = criarAdsGastoManualSchema.parse(await req.json());
  const periodo = resolverPeriodo(
    PeriodoPreset.PERSONALIZADO,
    body.periodoInicio,
    body.periodoFim,
  );
  const gasto = await dashboardEcommerceService.criarAdsGastoManual({
    periodoInicio: periodo.de,
    periodoFim: periodo.ate,
    produtoId: body.produtoId || null,
    valorCentavos: body.valorCentavos,
  });

  return ok(gasto, { status: 201 });
});
