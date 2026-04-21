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
import { BadgeStatusPedido } from "./badge-status-pedido";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { formatData } from "@/lib/date";

type ItemBrief = { id: string; quantidade: number; produto: { nome: string } };
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

export function ListaPedidos() {
  const router = useRouter();
  const [abaAtiva, setAbaAtiva] = React.useState("");

  const { data: pedidos = [], isLoading } = useQuery<Pedido[]>({
    queryKey: ["compras", abaAtiva],
    queryFn: () =>
      fetchJSON<Pedido[]>(
        `/api/compras${abaAtiva ? `?status=${abaAtiva}` : ""}`,
      ),
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
        <DataTableSkeleton rows={5} columns={6} />
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
                <TableHead className="w-[130px]">Data</TableHead>
                <TableHead>Número / ID</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="w-[100px]">Itens</TableHead>
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
                  <TableCell className="text-sm">
                    {p.itens.length} produto(s)
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
