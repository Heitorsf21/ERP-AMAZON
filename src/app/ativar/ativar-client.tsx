"use client";
import { useEffect, useRef, useState } from "react";

type Fase = "validando" | "processando" | "ja-ativo" | "nao-pago" | "erro";

const MAX_TENTATIVAS = 10; // ~30s de espera pelo webhook
const INTERVALO_MS = 3000;

export function AtivarClient({
  sessionId,
  paymentIntentId,
}: {
  sessionId: string;
  paymentIntentId: string;
}) {
  const [fase, setFase] = useState<Fase>("validando");
  const tentativas = useRef(0);
  const timeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId && !paymentIntentId) {
      setFase("erro");
      return;
    }
    let cancelado = false;

    async function tentar() {
      try {
        const res = await fetch("/api/checkout-publico/ativar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sessionId ? { sessionId } : { paymentIntentId }),
        });
        if (cancelado) return;

        if (res.status === 202) {
          tentativas.current += 1;
          if (tentativas.current >= MAX_TENTATIVAS) {
            setFase("erro");
            return;
          }
          setFase("processando");
          timeoutId.current = setTimeout(tentar, INTERVALO_MS);
          return;
        }
        if (res.status === 402) {
          setFase("nao-pago");
          return;
        }
        if (!res.ok) {
          setFase("erro");
          return;
        }
        const data = (await res.json()) as { status: string; redirectTo?: string };
        if (data.status === "pronto" && data.redirectTo && data.redirectTo.startsWith("/")) {
          window.location.assign(data.redirectTo);
          return;
        }
        if (data.status === "ja-ativo") {
          setFase("ja-ativo");
          return;
        }
        setFase("erro");
      } catch {
        if (!cancelado) setFase("erro");
      }
    }

    tentar();
    return () => {
      cancelado = true;
      if (timeoutId.current) clearTimeout(timeoutId.current);
    };
  }, [sessionId, paymentIntentId]);

  const estilos: React.CSSProperties = {
    width: 380,
    maxWidth: "100%",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };

  if (fase === "validando" || fase === "processando") {
    return (
      <div style={estilos} role="status" aria-live="polite">
        <h2>Pagamento confirmado 🎉</h2>
        <p>
          Estamos preparando sua conta no Atlas Seller. Isso leva só alguns
          segundos — não feche esta página.
        </p>
      </div>
    );
  }
  if (fase === "ja-ativo") {
    return (
      <div style={estilos}>
        <h2>Sua conta já está ativa</h2>
        <p>Você já definiu sua senha. É só entrar.</p>
        <a href="/login">Ir para o login</a>
      </div>
    );
  }
  if (fase === "nao-pago") {
    return (
      <div style={estilos}>
        <h2>Pagamento não confirmado</h2>
        <p>
          Não encontramos um pagamento aprovado para este link. Se você acabou
          de pagar, aguarde um instante e recarregue a página.
        </p>
      </div>
    );
  }
  return (
    <div style={estilos}>
      <h2>Não conseguimos ativar automaticamente</h2>
      <p>
        Seu pagamento está seguro. Fale com a gente em{" "}
        <a href="mailto:admfsmundo@gmail.com">admfsmundo@gmail.com</a> que
        liberamos seu acesso rapidinho.
      </p>
    </div>
  );
}
