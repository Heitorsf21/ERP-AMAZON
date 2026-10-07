"use client";

import * as React from "react";
import Image from "next/image";
import { Download, Share, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { usePwa } from "@/components/pwa/pwa-provider";

function Passo({
  n,
  children,
  icone,
}: {
  n: number;
  children: React.ReactNode;
  icone?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        {n}
      </span>
      <span className="flex-1 text-[15px] leading-snug">{children}</span>
      {icone && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
          {icone}
        </span>
      )}
    </li>
  );
}

export function InstalarSheet({
  aberto,
  onAbertoChange,
}: {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
}) {
  const { plataforma, podeInstalarDireto, instalar } = usePwa();

  async function instalarAgora() {
    const aceitou = await instalar();
    if (aceitou) {
      toast.success("Atlas instalado. Abra pelo ícone na tela inicial.");
      onAbertoChange(false);
    }
  }

  return (
    <Sheet open={aberto} onOpenChange={onAbertoChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-2xl px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="text-lg">
          Instalar o Atlas{plataforma?.ios ? " no iPhone" : ""}
        </SheetTitle>
        <SheetDescription>Leva 20 segundos e não passa pela loja de apps.</SheetDescription>

        {podeInstalarDireto ? (
          <Button className="mt-4 h-12 w-full text-base" onClick={instalarAgora}>
            <Download className="mr-2 h-5 w-5" aria-hidden />
            Instalar agora
          </Button>
        ) : plataforma?.ios ? (
          <ol className="mt-4 space-y-3.5">
            {plataforma.iosSemSafari && (
              <li className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                No iPhone a instalação é feita pelo <strong>Safari</strong>. Abra
                erp.mundofs.cloud nele.
              </li>
            )}
            <Passo n={1}>
              Abra <strong>erp.mundofs.cloud</strong> no Safari
            </Passo>
            <Passo n={2} icone={<Share className="h-5 w-5" aria-hidden />}>
              Toque em <strong>Compartilhar</strong>
            </Passo>
            <Passo n={3} icone={<SquarePlus className="h-5 w-5" aria-hidden />}>
              Escolha <strong>Adicionar à Tela de Início</strong>
            </Passo>
            <Passo n={4}>Abra o Atlas pelo ícone e entre com sua conta</Passo>
          </ol>
        ) : (
          <p className="mt-4 text-[15px] leading-relaxed">
            No menu do navegador, toque em <strong>Instalar app</strong> ou{" "}
            <strong>Adicionar à tela inicial</strong>.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
          <Image
            src="/icons/icon-192.png"
            alt="Ícone do Atlas"
            width={56}
            height={56}
            className="rounded-xl"
          />
          <p className="text-sm text-muted-foreground">
            Depois de abrir pelo ícone, ative o aviso de venda em{" "}
            <strong className="text-foreground">Mais → Notificações deste celular</strong>.
          </p>
        </div>

        <Button
          variant="outline"
          className="mt-4 h-12 w-full"
          onClick={() => onAbertoChange(false)}
        >
          Entendi
        </Button>
      </SheetContent>
    </Sheet>
  );
}
