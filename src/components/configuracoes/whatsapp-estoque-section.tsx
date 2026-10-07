"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Smartphone,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fetchJSON } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  FAIXA_LABEL,
  type FaixaEstoque,
} from "@/modules/whatsapp-estoque/schemas";

const API = "/api/configuracoes/whatsapp-estoque";
const API_KEY_SENTINEL = "********";

const SESSAO_QUERY_KEY = ["whatsapp-estoque-sessao"] as const;
const QR_QUERY_KEY = ["whatsapp-estoque-sessao-qr"] as const;
/** Consulta do status enquanto a sessão está voltando / aguardando o QR. */
const SESSAO_POLL_MS = 3_000;
/** O QR do WhatsApp gira a cada ~20 s: busca um novo a cada 5 s. */
const QR_POLL_MS = 5_000;
/** Teto do acompanhamento disparado pelo botão "Reconectar". */
const ACOMPANHAR_TETO_MS = 2 * 60_000;

type SessaoWhatsapp = { status: string | null; conta: string | null };

const STATUS_SESSAO: Record<
  string,
  { rotulo: string; variant: BadgeProps["variant"] }
> = {
  WORKING: { rotulo: "Conectado", variant: "success" },
  SCAN_QR_CODE: { rotulo: "Desconectado — escaneie o QR", variant: "warning" },
  FAILED: { rotulo: "Sessão caiu", variant: "destructive" },
  STOPPED: { rotulo: "Sessão caiu", variant: "destructive" },
  STARTING: { rotulo: "Iniciando…", variant: "secondary" },
};

type ConfigPublic = {
  ativo: boolean;
  horario: string;
  destinatario: string;
  wahaUrl: string;
  wahaSession: string;
  wahaApiKeyDefinida: boolean;
};

type UltimoEnvio = {
  tipo: string;
  status: string;
  partes: number;
  erro: string | null;
  iniciadoEm: string;
  concluidoEm: string | null;
} | null;

type ProdutoMonitorado = {
  produtoId: string;
  sku: string;
  nome: string;
  estoqueAtual: number;
  vendas30d: number;
  coberturaDias: number;
  faixa: FaixaEstoque;
  excluido: boolean;
};

const FAIXA_CLASSE: Record<FaixaEstoque, string> = {
  CRITICO: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  ATENCAO: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  ESTAVEL: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  SEGURO: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

export function WhatsappEstoqueSection() {
  const qc = useQueryClient();
  const [carregando, setCarregando] = React.useState(true);
  // URL do WAHA já SALVA (não o valor em edição): só com ela dá para
  // consultar a conexão.
  const [urlSalva, setUrlSalva] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);

  const [ativo, setAtivo] = React.useState(false);
  const [horario, setHorario] = React.useState("10:00");
  const [destinatario, setDestinatario] = React.useState("");
  const [wahaUrl, setWahaUrl] = React.useState("");
  const [wahaSession, setWahaSession] = React.useState("default");
  const [apiKey, setApiKey] = React.useState("");
  const [ultimoEnvio, setUltimoEnvio] = React.useState<UltimoEnvio>(null);

  function aplicar(config: ConfigPublic, envio: UltimoEnvio) {
    setAtivo(config.ativo);
    setHorario(config.horario);
    setDestinatario(config.destinatario);
    setWahaUrl(config.wahaUrl);
    setUrlSalva(config.wahaUrl.trim().length > 0);
    setWahaSession(config.wahaSession);
    setApiKey(config.wahaApiKeyDefinida ? API_KEY_SENTINEL : "");
    setUltimoEnvio(envio);
  }

  React.useEffect(() => {
    let cancelado = false;
    async function carregar() {
      try {
        const res = await fetch(API, { cache: "no-store" });
        if (!res.ok) throw new Error("Falha ao carregar configuracao");
        const data = (await res.json()) as {
          config: ConfigPublic;
          ultimoEnvio: UltimoEnvio;
        };
        if (!cancelado) aplicar(data.config, data.ultimoEnvio);
      } catch (err) {
        if (!cancelado) {
          toast.error(
            err instanceof Error ? err.message : "Erro ao carregar configuracao",
          );
        }
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => {
      cancelado = true;
    };
  }, []);

  async function salvar() {
    setSalvando(true);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ativo,
          horario: horario.trim(),
          destinatario: destinatario.trim(),
          wahaUrl: wahaUrl.trim(),
          wahaSession: wahaSession.trim(),
          wahaApiKey: apiKey,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(data.erro ?? "Falha ao salvar");
      }
      const data = (await res.json()) as {
        config: ConfigPublic;
        ultimoEnvio: UltimoEnvio;
      };
      aplicar(data.config, data.ultimoEnvio);
      // URL/sessão/chave podem ter mudado: reconsulta a conexão.
      qc.invalidateQueries({ queryKey: SESSAO_QUERY_KEY });
      toast.success("Configuracao salva.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  async function enviarTeste() {
    setEnviando(true);
    try {
      const res = await fetch(`${API}/enviar-teste`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        erro?: string;
        partes?: number;
        totalProdutos?: number;
      };
      if (!res.ok) throw new Error(data.erro ?? "Falha ao enviar teste");
      toast.success(
        `Teste enviado (${data.partes ?? 1} parte(s), ${data.totalProdutos ?? 0} produtos).`,
      );
      // Recarrega para refletir o status do ultimo envio.
      const recarregar = await fetch(API, { cache: "no-store" });
      if (recarregar.ok) {
        const d = (await recarregar.json()) as {
          config: ConfigPublic;
          ultimoEnvio: UltimoEnvio;
        };
        setUltimoEnvio(d.ultimoEnvio);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar teste");
    } finally {
      setEnviando(false);
      // O envio pode ter reiniciado a sessão do WAHA: atualiza a conexão.
      qc.invalidateQueries({ queryKey: SESSAO_QUERY_KEY });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">WhatsApp - Resumo de estoque</CardTitle>
            <CardDescription>
              Resumo diario de cobertura de estoque por WhatsApp (via WAHA).
              Considera apenas produtos com venda nos ultimos 30 dias.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {carregando ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando...
          </div>
        ) : (
          <>
            <ConexaoWhatsapp urlConfigurada={urlSalva} />

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Envio diario</p>
                <p className="text-xs text-muted-foreground">
                  Dispara automaticamente no horario configurado.
                </p>
              </div>
              <Switch
                checked={ativo}
                onCheckedChange={setAtivo}
                aria-label="Ativar envio diario"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo label="Horario (HH:mm)" htmlFor="wa-horario">
                <Input
                  id="wa-horario"
                  type="text"
                  inputMode="numeric"
                  placeholder="10:00"
                  value={horario}
                  onChange={(e) => setHorario(e.target.value)}
                />
              </Campo>
              <Campo label="Numero destinatario" htmlFor="wa-destino">
                <Input
                  id="wa-destino"
                  type="text"
                  inputMode="numeric"
                  placeholder="5511999999999"
                  value={destinatario}
                  onChange={(e) => setDestinatario(e.target.value)}
                />
              </Campo>
              <Campo label="URL do WAHA" htmlFor="wa-url">
                <Input
                  id="wa-url"
                  type="text"
                  placeholder="http://127.0.0.1:3002"
                  value={wahaUrl}
                  onChange={(e) => setWahaUrl(e.target.value)}
                />
              </Campo>
              <Campo label="Session" htmlFor="wa-session">
                <Input
                  id="wa-session"
                  type="text"
                  placeholder="default"
                  value={wahaSession}
                  onChange={(e) => setWahaSession(e.target.value)}
                />
              </Campo>
              <Campo label="API key (opcional)" htmlFor="wa-apikey">
                <Input
                  id="wa-apikey"
                  type="password"
                  autoComplete="off"
                  placeholder="deixe em branco se nao usar"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Campo>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={salvar} disabled={salvando} size="sm">
                {salvando ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Salvar
              </Button>
              <Button
                onClick={enviarTeste}
                disabled={enviando}
                size="sm"
                variant="outline"
              >
                {enviando ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                )}
                Enviar teste agora
              </Button>
              <StatusUltimoEnvio envio={ultimoEnvio} />
            </div>

            <ProdutosMonitorados />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Conexão da sessão do WhatsApp no WAHA: selo de status, botão "Reconectar"
 * (reinicia a sessão caída) e o QR de pareamento quando o WhatsApp desvinculou
 * o aparelho. Consulta o status a cada 3 s enquanto a sessão volta / aguarda o
 * QR e para ao ficar conectada.
 */
function ConexaoWhatsapp({ urlConfigurada }: { urlConfigurada: boolean }) {
  const qc = useQueryClient();
  const [acompanhando, setAcompanhando] = React.useState(false);

  const sessao = useQuery<SessaoWhatsapp>({
    queryKey: SESSAO_QUERY_KEY,
    queryFn: () => fetchJSON<SessaoWhatsapp>(`${API}/sessao`),
    enabled: urlConfigurada,
    retry: false,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === "WORKING") return false;
      if (acompanhando) return SESSAO_POLL_MS;
      if (query.state.status === "error") return false;
      return s === "SCAN_QR_CODE" || s === "STARTING" ? SESSAO_POLL_MS : false;
    },
  });

  const status = sessao.data?.status ?? null;
  const aguardandoQr = status === "SCAN_QR_CODE";

  const qr = useQuery<{ qr: string }>({
    queryKey: QR_QUERY_KEY,
    queryFn: () => fetchJSON<{ qr: string }>(`${API}/sessao/qr`),
    enabled: urlConfigurada && aguardandoQr,
    refetchInterval: aguardandoQr ? QR_POLL_MS : false,
    retry: false,
    gcTime: 0,
  });

  const reconectar = useMutation({
    mutationFn: () =>
      fetchJSON<SessaoWhatsapp>(`${API}/sessao`, {
        method: "POST",
        body: JSON.stringify({ acao: "reconectar" }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(SESSAO_QUERY_KEY, data);
      setAcompanhando(true);
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Erro ao reconectar o WhatsApp.",
      ),
  });

  // Ao virar WORKING (vindo de outro status): avisa e para de consultar.
  const statusAnterior = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!status) return;
    if (
      statusAnterior.current &&
      statusAnterior.current !== "WORKING" &&
      status === "WORKING"
    ) {
      toast.success("WhatsApp conectado");
      setAcompanhando(false);
      qc.removeQueries({ queryKey: QR_QUERY_KEY });
    }
    statusAnterior.current = status;
  }, [status, qc]);

  // O acompanhamento disparado pelo botão tem teto (não consulta para sempre).
  React.useEffect(() => {
    if (!acompanhando) return;
    const t = setTimeout(() => setAcompanhando(false), ACOMPANHAR_TETO_MS);
    return () => clearTimeout(t);
  }, [acompanhando]);

  const info = status ? STATUS_SESSAO[status] : undefined;

  let descricao: string;
  if (!urlConfigurada) {
    descricao = "Configure e salve a URL do WAHA abaixo para ver a conexão.";
  } else if (sessao.isLoading) {
    descricao = "Consultando o WAHA…";
  } else if (sessao.isError) {
    descricao = `Não foi possível consultar o WAHA: ${
      sessao.error instanceof Error ? sessao.error.message : "erro desconhecido"
    }`;
  } else if (status === "WORKING") {
    descricao = sessao.data?.conta
      ? `Enviando pelo número com final ${sessao.data.conta}.`
      : "Sessão ativa.";
  } else if (status === "SCAN_QR_CODE") {
    descricao =
      "O WhatsApp desvinculou este aparelho. Escaneie o QR abaixo com o celular da conta.";
  } else if (status === "FAILED" || status === "STOPPED") {
    descricao = "A sessão do WhatsApp parou. Clique em Reconectar.";
  } else if (status === "STARTING") {
    descricao = "A sessão está iniciando…";
  } else {
    descricao = "Status da sessão desconhecido.";
  }

  const podeReconectar =
    urlConfigurada && !sessao.isError && !!status && status !== "WORKING";

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div
        className="flex flex-wrap items-start justify-between gap-2"
        aria-live="polite"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Conexão do WhatsApp</p>
          <p className="break-words text-xs text-muted-foreground">
            {descricao}
          </p>
        </div>
        {urlConfigurada && sessao.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : urlConfigurada && status ? (
          <Badge variant={info?.variant ?? "outline"} className="shrink-0">
            {info?.rotulo ?? "Desconhecido"}
          </Badge>
        ) : null}
      </div>

      {(podeReconectar || (urlConfigurada && sessao.isError)) && (
        <div className="flex flex-wrap items-center gap-2">
          {podeReconectar ? (
            <Button
              className="h-11"
              variant="outline"
              onClick={() => reconectar.mutate()}
              disabled={reconectar.isPending}
            >
              {reconectar.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Reconectar
            </Button>
          ) : (
            <Button
              className="h-11"
              variant="outline"
              onClick={() => sessao.refetch()}
              disabled={sessao.isFetching}
            >
              {sessao.isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Consultar de novo
            </Button>
          )}
          {(acompanhando || aguardandoQr || status === "STARTING") && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Acompanhando a conexão…
            </span>
          )}
        </div>
      )}

      {urlConfigurada && aguardandoQr && (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <div className="flex aspect-square w-full max-w-[232px] shrink-0 items-center justify-center rounded-lg border bg-white p-2">
            {qr.data?.qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr.data.qr}
                alt="QR code para conectar o WhatsApp do resumo de estoque"
                width={216}
                height={216}
                className="h-full w-full object-contain"
              />
            ) : qr.isError ? (
              <p className="break-words p-2 text-center text-xs text-slate-600">
                {qr.error instanceof Error
                  ? qr.error.message
                  : "Não foi possível carregar o QR."}
              </p>
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
            )}
          </div>
          <div className="flex min-w-0 items-start gap-2 text-sm">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="break-words">
              No celular da conta do WhatsApp: Configurações → Aparelhos
              conectados → Conectar um aparelho e aponte para este QR.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Campo({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function StatusUltimoEnvio({ envio }: { envio: UltimoEnvio }) {
  if (!envio) {
    return (
      <p className="text-xs text-muted-foreground">Nenhum envio registrado.</p>
    );
  }
  const quando = new Date(envio.iniciadoEm).toLocaleString("pt-BR");
  const cor =
    envio.status === "SUCESSO"
      ? "text-emerald-600 dark:text-emerald-400"
      : envio.status === "ERRO"
        ? "text-rose-600 dark:text-rose-400"
        : "text-muted-foreground";
  return (
    <p className="text-xs text-muted-foreground">
      Ultimo envio:{" "}
      <span className={cn("font-medium", cor)}>{envio.status}</span> ({envio.tipo}
      ) em {quando}
      {envio.erro ? ` — ${envio.erro}` : ""}
    </p>
  );
}

function ProdutosMonitorados() {
  const [busca, setBusca] = React.useState("");
  const [produtos, setProdutos] = React.useState<ProdutoMonitorado[]>([]);
  const [carregando, setCarregando] = React.useState(false);
  const [acaoId, setAcaoId] = React.useState<string | null>(null);

  const carregar = React.useCallback(async (termo: string) => {
    setCarregando(true);
    try {
      const url = termo.trim()
        ? `${API}/produtos?busca=${encodeURIComponent(termo.trim())}`
        : `${API}/produtos`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Falha ao carregar produtos");
      const data = (await res.json()) as { produtos: ProdutoMonitorado[] };
      setProdutos(data.produtos);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar produtos");
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    const t = setTimeout(() => carregar(busca), 300);
    return () => clearTimeout(t);
  }, [busca, carregar]);

  async function alternar(p: ProdutoMonitorado) {
    setAcaoId(p.produtoId);
    try {
      const res = await fetch(
        `${API}/produtos/${p.produtoId}/excluir`,
        { method: p.excluido ? "DELETE" : "POST" },
      );
      if (!res.ok) throw new Error("Falha ao atualizar produto");
      setProdutos((lista) =>
        lista.map((item) =>
          item.produtoId === p.produtoId
            ? { ...item, excluido: !item.excluido }
            : item,
        ),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar produto");
    } finally {
      setAcaoId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Produtos monitorados</p>
        <p className="text-xs text-muted-foreground">
          Produtos elegiveis (ativos com venda nos ultimos 30 dias). Exclua os
          que nao quer no resumo.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por SKU ou nome..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border">
        {carregando ? (
          <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando...
          </div>
        ) : produtos.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">
            Nenhum produto elegivel encontrado.
          </p>
        ) : (
          <ul className="divide-y">
            {produtos.map((p) => (
              <li
                key={p.produtoId}
                className={cn(
                  "flex items-center justify-between gap-3 p-3",
                  p.excluido && "opacity-60",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.sku} · Estoque {p.estoqueAtual} · Vendeu 30d{" "}
                    {p.vendas30d} · Cobertura {p.coberturaDias}d
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      FAIXA_CLASSE[p.faixa],
                    )}
                  >
                    {FAIXA_LABEL[p.faixa]}
                  </span>
                  <Button
                    size="sm"
                    variant={p.excluido ? "outline" : "ghost"}
                    disabled={acaoId === p.produtoId}
                    onClick={() => alternar(p)}
                  >
                    {acaoId === p.produtoId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : p.excluido ? (
                      "Reativar"
                    ) : (
                      "Excluir"
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
