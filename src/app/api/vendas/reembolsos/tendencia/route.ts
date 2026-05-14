import { handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { whereVendaAmazonContabilizavelEstrito } from "@/modules/vendas/filtros";
import { subDays, startOfWeek, format } from "date-fns";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const semanas = Math.min(parseInt(searchParams.get("semanas") ?? "8"), 16);

  const desde = subDays(new Date(), semanas * 7);

  const [vendas, reembolsos] = await Promise.all([
    db.vendaAmazon.findMany({
      where: whereVendaAmazonContabilizavelEstrito({ dataVenda: { gte: desde } }),
      select: { amazonOrderId: true, sku: true, dataVenda: true },
    }),
    db.amazonReembolso.findMany({
      where: { dataReembolso: { gte: desde } },
      select: {
        amazonOrderId: true,
        sku: true,
        dataReembolso: true,
        motivoCategoria: true,
      },
    }),
  ]);

  // Agrupa por semana
  const porSemana = new Map<
    string,
    { vendas: Set<string>; reembolsos: Set<string> }
  >();

  const semanaKey = (d: Date) =>
    format(startOfWeek(d, { weekStartsOn: 0 }), "yyyy-MM-dd");

  for (const v of vendas) {
    const k = semanaKey(v.dataVenda);
    if (!porSemana.has(k)) porSemana.set(k, { vendas: new Set(), reembolsos: new Set() });
    porSemana.get(k)!.vendas.add(v.amazonOrderId);
  }

  for (const r of reembolsos) {
    const k = semanaKey(r.dataReembolso);
    if (!porSemana.has(k)) porSemana.set(k, { vendas: new Set(), reembolsos: new Set() });
    porSemana.get(k)!.reembolsos.add(r.amazonOrderId);
  }

  const tendencia = [...porSemana.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([semana, dados]) => {
      const totalVendas = dados.vendas.size;
      const totalReembolsos = dados.reembolsos.size;
      const taxa =
        totalVendas > 0 ? (totalReembolsos / totalVendas) * 100 : 0;
      return {
        semana,
        totalVendas,
        totalReembolsos,
        taxaPercentual: parseFloat(taxa.toFixed(2)),
        alerta: taxa > 5,
      };
    });

  // Motivos (últimas 8 semanas)
  const motivoCounts: Record<string, number> = {};
  for (const r of reembolsos) {
    const motivo = r.motivoCategoria ?? "SEM_CATEGORIA";
    motivoCounts[motivo] = (motivoCounts[motivo] ?? 0) + 1;
  }
  const motivos = Object.entries(motivoCounts)
    .map(([motivo, quantidade]) => ({ motivo, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade);

  const ultimaSemana = tendencia[tendencia.length - 1];
  const taxaAtual = ultimaSemana?.taxaPercentual ?? 0;
  const alertaAtivo = taxaAtual > 5;

  return ok({ tendencia, motivos, taxaAtual, alertaAtivo });
});
