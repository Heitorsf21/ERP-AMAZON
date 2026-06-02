"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTableSkeleton } from "@/components/ui/data-table-skeleton";
import { ProductThumb } from "@/components/ui/product-thumb";
import { BadgeStatusPedido } from "./badge-status-pedido";
import { periodoParaQuery } from "./kpi-cards";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { formatData } from "@/lib/date";
import { resolverImagemProduto } from "@/lib/amazon-images";
import type { FiltroPeriodoValue } from "@/components/ui/filtro-periodo";

type ItemBrief = {
  id: string;
  quantidade: number;
  produto: {
    nome: string;
    sku: string;
    imagemUrl: string | null;
    amazonImagemUrl: string | null;
    asin: string | null;
  };
};
type Pedido = {
  id: string;
  numero: string | null;
  status: string;
  dataEmissao: string;
  dataPrevisao: string | null;
  totalCentavos: number;
  fornecedor: { id: string; nome: string } | null;
  itens: ItemBrief[];
};

const abas = [
  { value: "", label: "Todos" },
  { value: "RASCUNHO", label: "Rascunho" },
  { value: "CONFIRMADO", label: "Confirmados" },
  { value: "RECEBIDO", label: "Recebidos" },
  { value: "CANCELADO", label: "Cancelados" },
];

export function ListaPedidos({
  periodo,
  fornecedorId,
}: {
  periodo: FiltroPeriodoValue;
  fornecedorId?: string;
}) {
  const router = useRouter();
  const [abaAtiva, setAbaAtiva] = React.useState("");
  const periodoQs = periodoParaQuery(periodo);

  const { data: pedidos = [], isLoading } = useQuery<Pedido[]>({
    queryKey: ["compras", abaAtiva, periodoQs, fornecedorId ?? ""],
    queryFn: () => {
      const params = new URLSearchParams(periodoQs);
      if (abaAtiva) params.set("status", abaAtiva);
      if (fornecedorId) params.set("fornecedor", fornecedorId);
      return fetchJSON<Pedido[]>(`/api/compras?${params.toString()}`);
    },
  });

  return (
    <div className="space-y-4">
      <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
        <TabsList>
          {abas.map((a) => (
            <TabsTrigger key={a.value} value={a.value}>
              {a.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <DataTableSkeleton rows={5} columns={7} />
      ) : pedidos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/20 py-16 text-center">
          <ShoppingCart className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Nenhum pedido encontrado.</p>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Data</TableHead>
                <TableHead>Número / ID</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Itens</TableHead>
                <TableHead className="w-[110px]">Previsão</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[140px] text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidos.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/50 even:bg-muted/20"
                  onClick={() => router.push(`/compras/${p.id}`)}
                >
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatData(new Date(p.dataEmissao))}
                  </TableCell>
                  <TableCell className="font-medium">
                    {p.numero ?? p.id.slice(0, 8).toUpperCase()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.fornecedor?.nome ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {p.itens.slice(0, 3).map((item) => (
                          <ProductThumb
                            key={item.id}
                            src={resolverImagemProduto(
                              item.produto.amazonImagemUrl,
                              item.produto.asin,
                              item.produto.imagemUrl,
                            )}
                            alt={item.produto.sku}
                            title={item.produto.nome}
                            size={32}
                            className="ring-2 ring-background"
                          />
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {p.itens.length} produto(s)
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {p.dataPrevisao ? formatData(new Date(p.dataPrevisao)) : "—"}
                  </TableCell>
                  <TableCell>
                    <BadgeStatusPedido status={p.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums font-medium">
                    {formatBRL(p.totalCentavos)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
