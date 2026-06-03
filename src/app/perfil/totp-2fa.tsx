"use client";

import * as React from "react";
import Image from "next/image";
import { Loader2, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { inicialAtivo: boolean };

type IniciarResp = { otpauthUri: string; qrDataUrl: string; secret: string };

export function Totp2FA({ inicialAtivo }: Props) {
  const [ativo, setAtivo] = React.useState(inicialAtivo);
  const [enroll, setEnroll] = React.useState<IniciarResp | null>(null);
  const [codigo, setCodigo] = React.useState("");
  const [carregando, setCarregando] = React.useState(false);

  async function iniciar() {
    setCarregando(true);
    try {
      const r = await fetch("/api/perfil/2fa/totp/iniciar", { method: "POST" });
      if (!r.ok) throw new Error();
      setEnroll((await r.json()) as IniciarResp);
      setCodigo("");
    } catch {
      toast.error("Não foi possível iniciar o cadastro do autenticador.");
    } finally {
      setCarregando(false);
    }
  }

  async function confirmar() {
    if (!/^\d{6}$/.test(codigo)) {
      toast.error("Digite os 6 dígitos do app.");
      return;
    }
    setCarregando(true);
    try {
      const r = await fetch("/api/perfil/2fa/totp/confirmar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.erro === "CODIGO_INCORRETO" ? "Código incorreto." : "Falha ao confirmar.");
      }
      setAtivo(true);
      setEnroll(null);
      toast.success("Autenticador ativado. O próximo login pedirá o código.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }

  async function desativar() {
    setCarregando(true);
    try {
      const r = await fetch("/api/perfil/2fa/totp/desativar", { method: "POST" });
      if (!r.ok) throw new Error();
      setAtivo(false);
      setEnroll(null);
      toast.success("Autenticador desativado.");
    } catch {
      toast.error("Não foi possível desativar.");
    } finally {
      setCarregando(false);
    }
  }

  // Em enrolamento: mostra QR + entrada de código.
  if (enroll) {
    return (
      <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
        <p className="text-sm font-medium">Escaneie no app autenticador</p>
        <p className="text-xs text-muted-foreground">
          Google Authenticator, Authy, 1Password, etc. Depois digite o código de 6 dígitos.
        </p>
        {/* qrDataUrl é um data URL gerado no servidor (segredo não vaza p/ terceiros) */}
        <Image
          src={enroll.qrDataUrl}
          alt="QR code do autenticador"
          width={176}
          height={176}
          unoptimized
          className="rounded-md border bg-white"
        />
        <p className="text-xs text-muted-foreground">
          Sem câmera? Entre manualmente:{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px] break-all">{enroll.secret}</code>
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="totp-codigo">Código do app</Label>
          <Input
            id="totp-codigo"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="w-32 tabular-nums"
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={confirmar} disabled={carregando}>
            {carregando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Confirmar e ativar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEnroll(null)} disabled={carregando}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-4">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          ativo
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {ativo ? <ShieldCheck className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">App autenticador (TOTP)</p>
        <p className="text-xs text-muted-foreground">
          {ativo
            ? "Ativo · a cada login pediremos o código do seu app autenticador."
            : "Método MFA mais forte (recomendado). Use um app autenticador no celular."}
        </p>
      </div>
      {ativo ? (
        <Button type="button" size="sm" variant="outline" onClick={desativar} disabled={carregando}>
          {carregando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          <ShieldOff className="mr-1.5 h-3.5 w-3.5" />
          Desativar
        </Button>
      ) : (
        <Button type="button" size="sm" onClick={iniciar} disabled={carregando}>
          {carregando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Configurar
        </Button>
      )}
    </div>
  );
}
