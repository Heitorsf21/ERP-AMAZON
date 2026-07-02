"use client";

import * as React from "react";
import { CreditCard, ExternalLink, RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Plano = "starter" | "pro" | "scale";
type Periodo = "mensal" | "trimestral" | "semestral" | "anual";

type AssinaturaStatus = {
  plano: string | null;
  cicloAssinatura: string | null;
  assinaturaStatus: string;
  assinaturaAtualizadaEm: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  stripeCurrentPeriodEnd: string | null;
};

const PLANOS: Array<{ value: Plano; label: string }> = [
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "scale", label: "Scale" },
];

const PERIODOS: Array<{ value: Periodo; label: string }> = [
  { value: "mensal", label: "Mensal" },
  { value: "trimestral", label: "Trimestral" },
  { value: "semestral", label: "Semestral" },
  { value: "anual", label: "Anual" },
];

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AssinaturaSection() {
  const [plano, setPlano] = React.useState<Plano>("pro");
  const [periodo, setPeriodo] = React.useState<Periodo>("mensal");
  const [status, setStatus] = React.useState<AssinaturaStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const carregarStatus = React.useCallback(async () => {
    const res = await fetch("/api/stripe/status", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { assinatura: AssinaturaStatus | null };
    setStatus(data.assinatura);
  }, []);

  React.useEffect(() => {
    void carregarStatus();
  }, [carregarStatus]);

  async function iniciarCheckout() {
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plano, periodo }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; erro?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.erro ?? "Não foi possível iniciar o checkout.");
      }
      window.location.assign(data.url);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao iniciar checkout.");
    } finally {
      setLoading(false);
    }
  }

  async function abrirPortal() {
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { url?: string; erro?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.erro ?? "Não foi possível abrir o portal.");
      }
      window.location.assign(data.url);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao abrir portal.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">Assinatura</CardTitle>
            <CardDescription>
              Checkout e portal de cobrança via Stripe Billing.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Info label="Status" value={status?.assinaturaStatus ?? "PENDENTE"} />
          <Info label="Plano" value={status?.plano ?? "—"} />
          <Info label="Ciclo" value={status?.cicloAssinatura ?? "—"} />
          <Info label="Renovação" value={formatDate(status?.stripeCurrentPeriodEnd ?? null)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
          <label className="grid gap-1 text-sm font-medium">
            Plano
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={plano}
              onChange={(event) => setPlano(event.target.value as Plano)}
            >
              {PLANOS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-sm font-medium">
            Ciclo
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={periodo}
              onChange={(event) => setPeriodo(event.target.value as Periodo)}
            >
              {PERIODOS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <Button className="self-end gap-2" onClick={iniciarCheckout} disabled={loading}>
            <ExternalLink className="h-4 w-4" />
            Abrir Checkout
          </Button>

          <Button
            className="self-end gap-2"
            variant="outline"
            onClick={abrirPortal}
            disabled={loading || !status?.stripeCustomerId}
          >
            <RefreshCw className="h-4 w-4" />
            Portal
          </Button>
        </div>

        {erro && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {erro}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1">
        <Badge variant="outline" className="max-w-full truncate font-mono text-xs">
          {value}
        </Badge>
      </div>
    </div>
  );
}
