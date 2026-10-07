"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchJSON } from "@/lib/fetcher";
import {
  decidirSaida,
  ehAppInstalado,
  inscricaoDestaLojaNesteAparelho,
  type PerguntaAvisosAoSair,
} from "@/lib/push/cliente";

type Pergunta = PerguntaAvisosAoSair;

export type ControleLogout = {
  sair: () => Promise<void>;
  saindo: boolean;
  pergunta: Pergunta | null;
  responder: (continuar: boolean) => Promise<void>;
};

/**
 * `perguntarAvisos: true` SÓ para quem renderiza `<DialogAvisosAoSair
 * controle={...} />` (topbar e "Mais"). Sem a opção, o "Sair" não pergunta:
 * encerra a sessão e mantém os avisos deste aparelho (ex.: "Trocar de conta").
 * `destino`: para onde ir depois de sair (padrão `/login`).
 */
export function useLogout(
  opcoes: { perguntarAvisos?: boolean; destino?: string } = {},
): ControleLogout {
  const perguntarAvisos = opcoes.perguntarAvisos === true;
  const destino = opcoes.destino ?? "/login";
  const qc = useQueryClient();
  const [saindo, setSaindo] = React.useState(false);
  const [pergunta, setPergunta] = React.useState<Pergunta | null>(null);

  const encerrar = React.useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Mesmo com erro, seguimos: o cookie é revalidado no próximo load.
    }
    qc.clear();
    toast.success("Sessão encerrada.");
    // Navegação "dura": descarta todo estado de cliente da conta anterior.
    window.location.href = destino;
  }, [qc, destino]);

  const sair = React.useCallback(async () => {
    if (saindo) return;
    setSaindo(true);
    // Quem troca entre MundoFS e UDN no mesmo celular quer continuar recebendo
    // as duas; computador compartilhado, não. Por isso perguntamos.
    const inscricao = perguntarAvisos ? await inscricaoDestaLojaNesteAparelho() : null;
    const decisao = decidirSaida({ perguntarAvisos, inscricao, appInstalado: ehAppInstalado() });
    if (decisao.acao === "perguntar") {
      setPergunta(decisao.pergunta);
      return;
    }
    await encerrar();
  }, [saindo, encerrar, perguntarAvisos]);

  const responder = React.useCallback(
    async (continuar: boolean) => {
      const atual = pergunta;
      setPergunta(null);
      if (atual && !continuar) {
        try {
          await fetchJSON("/api/push/dispositivos", {
            method: "DELETE",
            body: JSON.stringify({ endpoint: atual.endpoint }),
          });
        } catch {
          // Sem rede: dá para remover depois em "Seus aparelhos".
        }
      }
      await encerrar();
    },
    [pergunta, encerrar],
  );

  return { sair, saindo, pergunta, responder };
}

export function DialogAvisosAoSair({ controle }: { controle: ControleLogout }) {
  const p = controle.pergunta;
  return (
    <Dialog
      open={!!p}
      onOpenChange={(aberto) => {
        if (!aberto && p) void controle.responder(p.padraoContinuar);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Continuar recebendo avisos?</DialogTitle>
          <DialogDescription>
            Este aparelho recebe os avisos de venda da {p?.loja}. Quer continuar
            recebendo depois de sair?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
          <Button
            variant="outline"
            className="h-11"
            autoFocus={!p?.padraoContinuar}
            onClick={() => void controle.responder(false)}
          >
            Parar avisos
          </Button>
          <Button
            className="h-11"
            autoFocus={!!p?.padraoContinuar}
            onClick={() => void controle.responder(true)}
          >
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
