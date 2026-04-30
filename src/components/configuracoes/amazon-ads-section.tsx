"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  EyeOff,
  Loader2,
  Megaphone,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchJSON } from "@/lib/fetcher";

type ConfigResponse = {
  config: Record<string, string>;
  configurado: boolean;
};

type Profile = {
  profileId: number;
  countryCode?: string;
  currencyCode?: string;
  accountInfo?: {
    marketplaceStringId?: string;
    name?: string;
    type?: string;
  };
};

const CAMPOS = [
  {
    key: "amazon_ads_client_id",
    label: "Ads Client ID",
    placeholder: "amzn1.application-oa2-client...",
    secret: false,
  },
  {
    key: "amazon_ads_client_secret",
    label: "Ads Client Secret",
    placeholder: "...",
    secret: true,
  },
  {
    key: "amazon_ads_refresh_token",
    label: "Ads Refresh Token",
    placeholder: "Atz|...",
    secret: true,
  },
  {
    key: "amazon_ads_profile_id",
    label: "Profile ID",
    placeholder: "123456789",
    secret: false,
  },
  {
    key: "amazon_ads_endpoint",
    label: "Ads endpoint (opcional)",
    placeholder: "https://advertising-api.amazon.com",
    secret: false,
  },
] as const;

export function AmazonAdsSection() {
  const qc = useQueryClient();
  const [formValues, setFormValues] = React.useState<Record<string, string>>({});
  const [visiveis, setVisiveis] = React.useState<Set<string>>(new Set());
  const [profiles, setProfiles] = React.useState<Profile[] | null>(null);

  const { data: configData, isLoading } = useQuery<ConfigResponse>({
    queryKey: ["amazon-ads-config"],
    queryFn: () => fetchJSON<ConfigResponse>("/api/amazon/ads/config"),
  });

  React.useEffect(() => {
    if (!configData) return;
    setFormValues({
      amazon_ads_endpoint: "https://advertising-api.amazon.com",
      ...configData.config,
    });
  }, [configData]);

  const salvar = useMutation({
    mutationFn: (values: Record<string, string>) =>
      fetchJSON("/api/amazon/ads/config", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["amazon-ads-config"] });
      toast.success("Credenciais Ads salvas.");
    },
    onError: () => toast.error("Erro ao salvar credenciais Ads."),
  });

  const carregarProfiles = useMutation({
    mutationFn: () =>
      fetchJSON<{ profiles: Profile[] }>("/api/amazon/ads/profiles"),
    onSuccess: (data) => {
      setProfiles(data.profiles);
      if (data.profiles.length === 0) {
        toast.warning("Nenhum profile retornado pela Amazon.");
      } else {
        toast.success(`${data.profiles.length} profile(s) encontrado(s).`);
      }
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erro ao listar profiles."),
  });

  function toggleVisivel(key: string) {
    setVisiveis((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Megaphone className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Amazon Advertising</CardTitle>
              <CardDescription>
                Sponsored Products — sync de gasto / vendas / ACOS por SKU.
              </CardDescription>
            </div>
          </div>
          {configData && (
            <Badge variant={configData.configurado ? "success" : "secondary"}>
              {configData.configurado ? "Configurado" : "Nao configurado"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs text-muted-foreground">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Como obter as credenciais
          </p>
          <ol className="list-inside list-decimal space-y-1 leading-relaxed">
            <li>
              Aplicacao Ads API aprovada (separada da SP-API) com scope{" "}
              <code className="rounded bg-muted px-1 font-mono">
                advertising::campaign_management
              </code>
              .
            </li>
            <li>Refresh token gerado apos o consent flow do anunciante.</li>
            <li>Salve clientId/secret/refreshToken e clique &quot;Listar profiles&quot;.</li>
            <li>Selecione o profile do BR (marketplace A2Q3Y263D00KWC) e salve.</li>
          </ol>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {CAMPOS.map((campo) => (
              <div key={campo.key} className="space-y-1">
                <Label>{campo.label}</Label>
                <div className="relative">
                  <Input
                    type={
                      campo.secret && !visiveis.has(campo.key) ? "password" : "text"
                    }
                    placeholder={campo.placeholder}
                    value={formValues[campo.key] ?? ""}
                    onChange={(e) =>
                      setFormValues((prev) => ({
                        ...prev,
                        [campo.key]: e.target.value,
                      }))
                    }
                  />
                  {campo.secret && (
                    <button
                      type="button"
                      onClick={() => toggleVisivel(campo.key)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={
                        visiveis.has(campo.key)
                          ? "Ocultar credencial"
                          : "Mostrar credencial"
                      }
                    >
                      {visiveis.has(campo.key) ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {profiles && profiles.length > 0 && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Profiles disponiveis:
            </p>
            <div className="flex flex-wrap gap-2">
              {profiles.map((p) => {
                const ativo =
                  String(p.profileId) === formValues.amazon_ads_profile_id;
                return (
                  <button
                    key={p.profileId}
                    type="button"
                    onClick={() =>
                      setFormValues((prev) => ({
                        ...prev,
                        amazon_ads_profile_id: String(p.profileId),
                      }))
                    }
                    className={`rounded-md border px-3 py-1.5 text-xs transition ${
                      ativo
                        ? "border-primary bg-primary/10 text-primary"
                        : "hover:bg-accent"
                    }`}
                  >
                    <span className="font-mono">{p.profileId}</span>
                    {p.countryCode && (
                      <span className="ml-1 text-muted-foreground">
                        ({p.countryCode}
                        {p.accountInfo?.marketplaceStringId
                          ? ` · ${p.accountInfo.marketplaceStringId}`
                          : ""}
                        )
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => salvar.mutate(formValues)}
            disabled={salvar.isPending || isLoading}
          >
            {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar credenciais Ads
          </Button>
          <Button
            variant="outline"
            onClick={() => carregarProfiles.mutate()}
            disabled={
              carregarProfiles.isPending ||
              isLoading ||
              !formValues.amazon_ads_client_id ||
              !formValues.amazon_ads_refresh_token
            }
          >
            {carregarProfiles.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Listar profiles
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
