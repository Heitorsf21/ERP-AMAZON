"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL } from "@/lib/money";

type PontoProjecao = {
  label: string;
  dias: number;
  saldoCentavos: number;
  saldoBaseCentavos: number;
  amazonPrevistasCentavos: number;
};

export type SaldoResposta = {
  atualCentavos: number;
  comprometidoCentavos: number;
  livreCentavos: number;
  contasEmAberto: number;
  aReceberCentavos: number;
  recebiveisCount: number;
  projecao: PontoProjecao[];
};

async function fetchSaldo(): Promise<SaldoResposta> {
  const r = await fetch("/api/movimentacoes/saldo");
  if (!r.ok) throw new Error("falha ao carregar saldo");
  return r.json();
}

export function useSaldo() {
  return useQuery<SaldoResposta>({
    queryKey: ["saldo"],
    queryFn: fetchSaldo,
  });
}

export function CardSaldo() {
  const { data, isLoading } = useSaldo();

  const atual = data?.atualCentavos ?? 0;
  const comprometido = data?.comprometidoCentavos ?? 0;
  const livre = data?.livreCentavos ?? 0;
  const contasEmAberto = data?.contasEmAberto ?? 0;
  const aReceber = data?.aReceberCentavos ?? 0;
  const recebiveisCount = data?.recebiveisCount ?? 0;

  const livreColor =
    !isLoading && data
      ? livre < 0
        ? "text-destructive"
        : livre < comprometido * 0.1
          ? "text-yellow-600"
          : "text-green-600"
      : "";

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Saldo atual
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {isLoading ? "—" : formatBRL(atual)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Comprometido
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold">
            {isLoading ? "—" : formatBRL(comprometido)}
          </p>
          {!isLoading && contasEmAberto > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {contasEmAberto} conta{contasEmAberto !== 1 ? "s" : ""} em aberto
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            A receber
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold text-blue-600">
            {isLoading ? "—" : formatBRL(aReceber)}
          </p>
          {!isLoading && recebiveisCount > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {recebiveisCount} liquidaç{recebiveisCount !== 1 ? "ões" : "ão"} pendente{recebiveisCount !== 1 ? "s" : ""}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Saldo livre
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className={`text-2xl font-semibold ${livreColor}`}>
            {isLoading ? "—" : formatBRL(livre)}
          </p>
          {!isLoading && data && livre < 0 && (
            <p className="mt-1 text-xs text-destructive">
              comprometido excede o saldo atual
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
