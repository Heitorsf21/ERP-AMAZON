"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FiltroPeriodo, type FiltroPeriodoValue } from "@/components/ui/filtro-periodo";
import { PeriodoPreset } from "@/lib/periodo";
import { ListaPedidos } from "@/components/compras/lista-pedidos";
import { ComprasKpiCards } from "@/components/compras/kpi-cards";
import { fetchJSON } from "@/lib/fetcher";

type Fornecedor = { id: string; nome: string };

export default function ComprasPage() {
  const [periodo, setPeriodo] = React.useState<FiltroPeriodoValue>({
    preset: PeriodoPreset.TRINTA_DIAS,
  });
  const [fornecedorId, setFornecedorId] = React.useState("");

  const { data: fornecedores = [] } = useQuery<Fornecedor[]>({
    queryKey: ["fornecedores"],
    queryFn: () => fetchJSON<Fornecedor[]>("/api/fornecedores"),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Compras" description="Histórico de pedidos de compra.">
        <Button asChild size="sm">
          <Link href="/compras/novo">
            <Plus className="mr-2 h-4 w-4" />
            Novo Pedido
          </Link>
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <FiltroPeriodo value={periodo} onChange={setPeriodo} />
        <div className="w-56">
          <Select
            aria-label="Fornecedor"
            value={fornecedorId}
            onChange={(e) => setFornecedorId(e.target.value)}
          >
            <option value="">Todos os fornecedores</option>
            {fornecedores.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ComprasKpiCards periodo={periodo} />

      <ListaPedidos periodo={periodo} fornecedorId={fornecedorId || undefined} />
    </div>
  );
}
