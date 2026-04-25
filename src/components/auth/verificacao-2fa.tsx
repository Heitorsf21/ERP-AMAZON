"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  challengeId: string;
  lembrar: boolean;
  email: string;
  onVerificado: () => void;
  onCancelar: () => void;
};

export function Verificacao2FA({
  challengeId,
  lembrar,
  email,
  onVerificado,
  onCancelar,
}: Props) {
  const [digitos, setDigitos] = useState<string[]>(["", "", "", "", "", ""]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  function handleChange(idx: number, value: string) {
    const ch = value.replace(/\D/g, "").slice(0, 1);
    setDigitos((prev) => {
      const next = [...prev];
      next[idx] = ch;
      return next;
    });
    if (ch && idx < 5) {
      inputsRef.current[idx + 1]?.focus();
    }
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digitos[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    const arr = ["", "", "", "", "", ""];
    for (let i = 0; i < text.length; i++) arr[i] = text[i]!;
    setDigitos(arr);
    const focus = Math.min(text.length, 5);
    inputsRef.current[focus]?.focus();
  }

  async function submeter() {
    const codigo = digitos.join("");
    if (codigo.length !== 6) {
      setErro("Digite os 6 dígitos.");
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/auth/2fa/verificar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId, codigo, lembrar }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (j.erro === "CODIGO_INCORRETO") setErro("Código incorreto.");
        else if (j.erro === "CODIGO_INVALIDO_OU_EXPIRADO")
          setErro("Código expirado. Faça login novamente.");
        else setErro("Não foi possível verificar agora.");
        setEnviando(false);
        return;
      }
      onVerificado();
    } catch {
      setErro("Falha de conexão.");
      setEnviando(false);
    }
  }

  // Auto-submit quando completar 6 dígitos
  useEffect(() => {
    if (digitos.every((d) => d) && !enviando) {
      submeter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digitos]);

  return (
    <div>
      <button
        type="button"
        onClick={onCancelar}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para o login
      </button>

      <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <ShieldCheck className="h-5 w-5" />
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">
        Verificação de duas etapas
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Enviamos um código de 6 dígitos para <strong>{email}</strong>. Cole ou
        digite abaixo (expira em 5 min).
      </p>

      <div className="mt-6 flex gap-2 justify-center">
        {digitos.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={d}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            disabled={enviando}
            className="h-12 w-10 rounded-md border border-input bg-background text-center text-lg font-semibold tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-ring"
          />
        ))}
      </div>

      {erro && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {erro}
        </div>
      )}

      <Button
        type="button"
        className="mt-6 w-full"
        onClick={submeter}
        disabled={enviando || digitos.some((d) => !d)}
      >
        {enviando ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Verificando…
          </>
        ) : (
          "Verificar"
        )}
      </Button>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Não chegou? Confira o spam ou volte ao login para tentar novamente.
      </p>
    </div>
  );
}
