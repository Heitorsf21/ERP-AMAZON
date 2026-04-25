"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronsUpDown, Package } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchJSON } from "@/lib/fetcher";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { classificarAcos } from "./classificacao-acos";

type LinhaSku = {
  sku: string;
  asin: string | null;
  gastoCentavos: number;
  vendasCentavos: number;
  cliques: number;
  impressoes: number;
  pedidos: number;
  unidades: number;
  acos: number | null;
  roas: number | null;
  ctr: number | null;
  cpc: number | null;
  conversao: number | null;
  vendasAmazonCentavos: number;
  vendasOrganicasCentavos: number;
  tacos: number | null;
};

type ColunaSort =
  | "sku"
  | "gastoCentavos"
  | "vendasCentavos"
  | "acos"
  | "roas"
  | "tacos"
  | "vendasAmazonCentavos"
  | "vendasOrganicasCentavos"
  | "pedidos";

export function TabelaPorSku({ de, ate }: { de: string; ate: string }) {
  const { data, isLoading } = useQuery<LinhaSku[]>({
    queryKey: ["ads-por-sku", de, ate],
    queryFn: () => fetchJSON<LinhaSku[]>(`/api/ads/por-sku?de=${de}&ate=${ate}`),
  });

  const [coluna, setColuna] = React.useState<ColunaSort>("gastoCentavos");
  const [direcao, setDirecao] = React.useState<"asc" | "desc">("desc");

  const ordenadas = React.useMemo(() => {
    if (!data) return [];
    const arr = [...data];
    arr.sort((a, b) => {
      const va = a[coluna];
      const vb = b[coluna];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" && typeof vb === "string") {
        return direcao === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const na = Number(va);
      const nb = Number(vb);
      return direcao === "asc" ? na - nb : nb - na;
    });
    return arr;
  }, [data, coluna, direcao]);

  function alternar(c: ColunaSort) {
    if (c === coluna) {
      setDirecao((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setColuna(c);
      setDirecao("desc");
    }
  }

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (!ordenadas.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <Package className="h-8 w-8 opacity-40" />
        <p className="text-sm">
          Nenhuma campanha com SKU informado no período.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <Cab campo="sku" coluna={coluna} direcao={direcao} onClick={alternar} alinhar="left">
              SKU
            </Cab>
            <Cab campo="gastoCentavos" coluna={coluna} direcao={direcao} onClick={alternar}>
              Investido
            </Cab>
            <Cab campo="vendasCentavos" coluna={coluna} direcao={direcao} onClick={alternar}>
              Vendas atrib.
            </Cab>
            <Cab campo="vendasAmazonCentavos" coluna={coluna} direcao={direcao} onClick={alternar}>
              Vendas Amazon
            </Cab>
            <Cab campo="vendasOrganicasCentavos" coluna={coluna} direcao={direcao} onClick={alternar}>
              Orgânicas
            </Cab>
            <Cab campo="acos" coluna={coluna} direcao={direcao} onClick={alternar}>
              ACoS
            </Cab>
            <Cab campo="tacos" coluna={coluna} direcao={direcao} onClick={alternar}>
              TACoS
            </Cab>
            <Cab campo="roas" coluna={coluna} direcao={direcao} onClick={alternar}>
              ROAS
            </Cab>
            <Cab campo="pedidos" coluna={coluna} direcao={direcao} onClick={alternar}>
              Pedidos
            </Cab>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordenadas.map((l) => {
            const classif = classificarAcos(l.acos);
            return (
              <TableRow key={l.sku}>
                <TableCell>
                  <div className="text-sm font-medium">{l.sku}</div>
                  {l.asin && (
                    <div className="text-xs text-muted-foreground">{l.asin}</div>
                  )}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {formatBRL(l.gastoCentavos)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {l.vendasCentavos > 0 ? formatBRL(l.vendasCentavos) : "—"}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {l.vendasAmazonCentavos > 0
                    ? formatBRL(l.vendasAmazonCentavos)
                    : "—"}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                  {l.vendasOrganicasCentavos > 0
                    ? formatBRL(l.vendasOrganicasCentavos)
                    : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="text-sm tabular-nums">
                      {l.acos != null ? `${l.acos.toFixed(1)}%` : "—"}
                    </span>
                    <span
                      className={cn(
                        "inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium",
                        classif.classe,
                      )}
                    >
                      {classif.label}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {l.tacos != null ? `${l.tacos.toFixed(1)}%` : "—"}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {l.roas != null ? `${l.roas.toFixed(2)}x` : "—"}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {l.pedidos}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function Cab({
  campo,
  coluna,
  direcao,
  onClick,
  alinhar = "right",
  children,
}: {
  campo: ColunaSort;
  coluna: ColunaSort;
  direcao: "asc" | "desc";
  onClick: (c: ColunaSort) => void;
  alinhar?: "left" | "right";
  children: React.ReactNode;
}) {
  const ativo = campo === coluna;
  const Icon = !ativo ? ChevronsUpDown : direcao === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={alinhar === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onClick(campo)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          alinhar === "right" && "ml-auto",
          ativo ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {children}
        <Icon className="h-3 w-3 opacity-70" />
      </button>
    </TableHead>
  );
}
