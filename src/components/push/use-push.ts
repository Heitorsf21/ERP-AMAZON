"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJSON } from "@/lib/fetcher";
import { precisaInstalarParaPush } from "@/lib/pwa/plataforma";
import {
  calcularEstadoPush,
  obterInscricaoAtual,
  urlBase64ParaUint8Array,
  type EstadoPush,
} from "@/lib/push/cliente";
import { usePwa } from "@/components/pwa/pwa-provider";

export type DispositivoPushCliente = {
  id: string;
  apelido: string | null;
  endpoint: string;
  receberVendas: boolean;
  ativo: boolean;
  criadoEm: string;
  ultimoEnvioEm: string | null;
};

type ConfigPush = { enabled: boolean; publicKey: string | null; loja: string };

const ESPERA_SERVICE_WORKER_MS = 10_000;

/** `serviceWorker.ready` nunca resolve se o registro falhou: não deixa o botão preso. */
function serviceWorkerPronto(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, rejeitar) =>
      setTimeout(
        () => rejeitar(new Error("O app ainda não está pronto para avisos. Recarregue a página.")),
        ESPERA_SERVICE_WORKER_MS,
      ),
    ),
  ]);
}

export function usePush() {
  const qc = useQueryClient();
  const { plataforma } = usePwa();
  const config = useQuery<ConfigPush>({
    queryKey: ["push-config"],
    queryFn: () => fetchJSON<ConfigPush>("/api/push/config"),
    staleTime: Infinity,
  });
  const lista = useQuery<{ dispositivos: DispositivoPushCliente[] }>({
    queryKey: ["push-dispositivos"],
    queryFn: () => fetchJSON("/api/push/dispositivos"),
  });

  const [endpointAtual, setEndpointAtual] = React.useState<string | null>(null);
  const [permissao, setPermissao] = React.useState<NotificationPermission | "indisponivel">(
    "indisponivel",
  );

  React.useEffect(() => {
    if (typeof Notification !== "undefined") setPermissao(Notification.permission);
    obterInscricaoAtual()
      .then((s) => setEndpointAtual(s?.endpoint ?? null))
      .catch(() => setEndpointAtual(null));
  }, []);

  const suportado =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined" &&
    !!config.data?.enabled;
  const dispositivos = lista.data?.dispositivos ?? [];
  const desteAparelho = dispositivos.find((d) => d.endpoint === endpointAtual) ?? null;
  const carregando = config.isLoading || lista.isLoading || !plataforma;
  const estado: EstadoPush | "carregando" = carregando
    ? "carregando"
    : calcularEstadoPush({
        suportado,
        precisaInstalar: precisaInstalarParaPush(plataforma),
        permissao,
        inscritoNestaLoja: !!desteAparelho,
        recebeVendas: desteAparelho?.receberVendas,
      });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["push-dispositivos"] });

  const ativarMutation = useMutation({
    mutationFn: async (pedidoPermissao: Promise<NotificationPermission>) => {
      const perm = await pedidoPermissao;
      setPermissao(perm);
      if (perm !== "granted") throw new Error("Permissão de notificação não concedida.");
      if (!config.data?.publicKey) throw new Error("Avisos ainda não configurados no servidor.");
      const reg = await serviceWorkerPronto();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ParaUint8Array(config.data.publicKey) as BufferSource,
        }));
      const json = sub.toJSON();
      await fetchJSON("/api/push/dispositivos", {
        method: "POST",
        body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys }),
      });
      setEndpointAtual(sub.endpoint);
    },
    onSuccess: invalidar,
  });

  // iOS exige que o pedido de permissão saia direto do toque. O useMutation
  // aguarda o onMutate antes do mutationFn, então o pedido começa aqui, de
  // forma síncrona, e a mutation só espera a resposta.
  const ativar = {
    isPending: ativarMutation.isPending,
    mutate: (opcoes?: Parameters<typeof ativarMutation.mutate>[1]) =>
      ativarMutation.mutate(Notification.requestPermission(), opcoes),
  };

  const remover = useMutation({
    mutationFn: (alvo: { id?: string; endpoint?: string }) =>
      fetchJSON("/api/push/dispositivos", { method: "DELETE", body: JSON.stringify(alvo) }),
    onSuccess: invalidar,
  });

  const alternarVendas = useMutation({
    mutationFn: (receberVendas: boolean) =>
      fetchJSON("/api/push/dispositivos", {
        method: "PATCH",
        body: JSON.stringify({ endpoint: endpointAtual, receberVendas }),
      }),
    onSuccess: invalidar,
  });

  const teste = useMutation({
    mutationFn: () => fetchJSON<{ enviados: number; destinos: number }>("/api/push/teste", { method: "POST" }),
  });

  return {
    estado,
    loja: config.data?.loja ?? "sua loja",
    plataforma,
    endpointAtual,
    desteAparelho,
    dispositivos,
    ativar,
    remover,
    alternarVendas,
    teste,
  };
}
