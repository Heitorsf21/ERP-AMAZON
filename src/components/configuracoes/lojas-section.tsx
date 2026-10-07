"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layers, Link2, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SeloLojaQuadrado } from "@/components/lojas/trocar-loja-sheet";
import { CHAVE_LOJAS, useLojas, type LojaComCor } from "@/components/lojas/use-lojas";
import { fetchJSON } from "@/lib/fetcher";

const PAPEL: Record<string, string> = {
  ADMIN: "Administrador",
  OPERADOR: "Operador",
  FINANCEIRO: "Financeiro",
  LEITURA: "Leitura",
};

function CabecalhoCartao({
  icone: Icone,
  titulo,
  descricao,
}: {
  icone: React.ComponentType<{ className?: string }>;
  titulo: string;
  descricao: string;
}) {
  return (
    <CardHeader className="flex-row items-start gap-3 space-y-0">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icone className="h-5 w-5" />
      </span>
      <div className="space-y-1">
        <CardTitle className="text-base">{titulo}</CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </div>
    </CardHeader>
  );
}

function MinhasLojas() {
  const qc = useQueryClient();
  const { lojas, isLoading, isError } = useLojas();
  const [desvincular, setDesvincular] = React.useState<LojaComCor | null>(null);
  const [removendo, setRemovendo] = React.useState(false);

  async function confirmarDesvinculo() {
    const loja = desvincular;
    if (!loja?.vinculoId) return;
    setRemovendo(true);
    try {
      await fetchJSON(`/api/lojas/vinculos/${encodeURIComponent(loja.vinculoId)}`, { method: "DELETE" });
      toast.success(`${loja.nome} desvinculada.`);
      setDesvincular(null);
      await qc.invalidateQueries({ queryKey: CHAVE_LOJAS });
    } catch {
      toast.error("Não deu para desvincular agora. Tente de novo.");
    } finally {
      setRemovendo(false);
    }
  }

  return (
    <Card>
      <CabecalhoCartao
        icone={Layers}
        titulo="Minhas lojas"
        descricao="Lojas que você abre neste login, sem digitar senha."
      />
      <CardContent className="space-y-1 px-4 pb-4">
        {isLoading ? (
          <Skeleton className="h-[52px] w-full" />
        ) : isError ? (
          <p className="px-2 text-sm text-muted-foreground">Não deu para carregar as lojas agora.</p>
        ) : (
          lojas.map((loja) => (
            <div key={loja.empresaId} className="flex min-h-[52px] items-center gap-3 rounded-lg px-2 py-1.5">
              <SeloLojaQuadrado loja={loja} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{loja.nome}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {loja.atual ? `Esta conta · ${PAPEL[loja.papel] ?? loja.papel}` : loja.email}
                </span>
              </span>
              {!loja.atual && (
                <Button variant="ghost" size="sm" className="h-11 text-destructive hover:text-destructive sm:h-9" onClick={() => setDesvincular(loja)}>
                  Desvincular
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>

      <Dialog open={!!desvincular} onOpenChange={(aberto) => !aberto && !removendo && setDesvincular(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Desvincular {desvincular?.nome}?</DialogTitle>
            <DialogDescription>
              A {desvincular?.nome} sai da troca rápida e da visão Todas. A loja e os dados dela
              continuam iguais, e dá para vincular de novo quando quiser.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
            <Button variant="outline" className="h-11" disabled={removendo} onClick={() => setDesvincular(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" className="h-11" disabled={removendo} onClick={() => void confirmarDesvinculo()}>
              {removendo && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Desvincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

type RespostaVincular =
  | { requires2FA: true; challengeId: string; metodo: "EMAIL" | "TOTP" }
  | { loja: { nome: string } };

function mensagemDeErro(codigo: string): { campo: "senha" | "codigo" | "geral"; texto: string; recomecar?: boolean } {
  switch (codigo) {
    case "CREDENCIAIS_INVALIDAS":
      return { campo: "senha", texto: "E-mail ou senha não conferem. Confira e tente de novo." };
    case "DADOS_INVALIDOS":
      return { campo: "senha", texto: "Confira o e-mail e a senha." };
    case "MESMA_LOJA":
      return { campo: "geral", texto: "Essa conta é desta mesma loja. Use o login da outra loja." };
    case "MUITAS_TENTATIVAS":
    case "MUITAS_REQUISICOES":
      return { campo: "geral", texto: "Muitas tentativas. Espere alguns minutos e tente de novo." };
    case "CODIGO_INCORRETO":
      return { campo: "codigo", texto: "Código incorreto. Confira e tente de novo." };
    case "CODIGO_INVALIDO_OU_EXPIRADO":
    case "CHALLENGE_BLOQUEADO":
      return {
        campo: "geral",
        texto: "O código expirou ou foi bloqueado. Entre de novo com a senha da outra loja.",
        recomecar: true,
      };
    default:
      return { campo: "geral", texto: "Não deu para vincular agora. Tente de novo." };
  }
}

function VincularLoja() {
  const qc = useQueryClient();
  const [email, setEmail] = React.useState("");
  const [senha, setSenha] = React.useState("");
  const [codigo, setCodigo] = React.useState("");
  const [desafio, setDesafio] = React.useState<{ challengeId: string; metodo: "EMAIL" | "TOTP" } | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<ReturnType<typeof mensagemDeErro> | null>(null);
  const campoCodigo = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (desafio) campoCodigo.current?.focus();
  }, [desafio]);

  function recomecar() {
    setDesafio(null);
    setCodigo("");
    setSenha("");
  }

  async function concluir(loja: { nome: string }) {
    toast.success(`${loja.nome} vinculada. Troque de loja tocando no nome dela no topo.`);
    setEmail("");
    recomecar();
    await qc.invalidateQueries({ queryKey: CHAVE_LOJAS });
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      if (!desafio) {
        const r = await fetchJSON<RespostaVincular>("/api/lojas/vincular", {
          method: "POST",
          body: JSON.stringify({ email, senha }),
        });
        if ("requires2FA" in r) setDesafio({ challengeId: r.challengeId, metodo: r.metodo });
        else await concluir(r.loja);
      } else {
        const r = await fetchJSON<{ loja: { nome: string } }>("/api/lojas/vincular/2fa", {
          method: "POST",
          body: JSON.stringify({ challengeId: desafio.challengeId, codigo }),
        });
        await concluir(r.loja);
      }
    } catch (err) {
      const m = mensagemDeErro(err instanceof Error ? err.message : "");
      setErro(m);
      if (m.recomecar) recomecar();
    } finally {
      setEnviando(false);
    }
  }

  const erroSenha = erro?.campo === "senha" ? erro.texto : null;
  const erroCodigo = erro?.campo === "codigo" ? erro.texto : null;
  const erroGeral = erro?.campo === "geral" ? erro.texto : null;

  return (
    <Card>
      <CabecalhoCartao
        icone={Link2}
        titulo="Vincular outra loja"
        descricao="Entre uma vez com a conta da outra loja. Depois a troca é na hora."
      />
      <CardContent>
        <form className="space-y-4" onSubmit={(e) => void enviar(e)} noValidate>
          <div className="space-y-2">
            <Label htmlFor="vincular-email">E-mail da outra loja</Label>
            <Input
              id="vincular-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              value={email}
              disabled={!!desafio || enviando}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vincular-senha">Senha</Label>
            <Input
              id="vincular-senha"
              type="password"
              autoComplete="off"
              value={senha}
              disabled={!!desafio || enviando}
              onChange={(e) => setSenha(e.target.value)}
              aria-invalid={!!erroSenha}
              aria-describedby={erroSenha ? "vincular-senha-erro" : undefined}
              required
            />
            {erroSenha && (
              <p id="vincular-senha-erro" role="alert" className="text-sm text-destructive">
                {erroSenha}
              </p>
            )}
          </div>

          {desafio && (
            <div className="space-y-2">
              <Label htmlFor="vincular-codigo">Código de verificação</Label>
              <Input
                id="vincular-codigo"
                ref={campoCodigo}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6 dígitos"
                maxLength={6}
                className="tracking-[0.15em]"
                value={codigo}
                disabled={enviando}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                aria-invalid={!!erroCodigo}
                aria-describedby="vincular-codigo-ajuda"
              />
              <p id="vincular-codigo-ajuda" className="text-xs text-muted-foreground">
                {desafio.metodo === "TOTP"
                  ? "Use o código do app autenticador da outra loja."
                  : "Mandamos um código para o e-mail da outra loja. Ele vale por 5 minutos."}
              </p>
              {erroCodigo && (
                <p role="alert" className="text-sm text-destructive">
                  {erroCodigo}
                </p>
              )}
            </div>
          )}

          {erroGeral && (
            <p role="alert" className="text-sm text-destructive">
              {erroGeral}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              className="h-11 sm:h-10"
              disabled={enviando || !email || !senha || (!!desafio && codigo.length !== 6)}
            >
              {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              {desafio ? "Confirmar e vincular" : "Vincular loja"}
            </Button>
            {desafio && (
              <Button type="button" variant="ghost" className="h-11 sm:h-10" disabled={enviando} onClick={recomecar}>
                Voltar
              </Button>
            )}
          </div>

          <p className="flex gap-2 text-xs text-muted-foreground">
            <Lock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            Cada loja continua com o próprio login, avisos de venda e permissões. Dá para desvincular
            quando quiser.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

/** Configurações → Lojas: vínculo pessoal (cada login vincula o seu). */
export function LojasSection() {
  return (
    <>
      <MinhasLojas />
      <VincularLoja />
    </>
  );
}
