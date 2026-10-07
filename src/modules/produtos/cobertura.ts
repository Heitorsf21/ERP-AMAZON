import { classificarFaixa, JANELA_VENDAS_DIAS } from "@/modules/whatsapp-estoque/service";
import type { FaixaEstoque } from "@/modules/whatsapp-estoque/schemas";

export type Cobertura = {
  vendas30d: number;
  dias: number | null;
  faixa: FaixaEstoque | null;
  /** YYYY-MM-DD (America/Sao_Paulo) em que o estoque acaba no ritmo atual. */
  rupturaEm: string | null;
};

/** Mesma régua do resumo de estoque do WhatsApp (estoque / média de 30 d). */
export function calcularCobertura(input: {
  estoque: number;
  vendas30d: number;
  hoje: Date;
}): Cobertura {
  if (input.vendas30d <= 0) return { vendas30d: 0, dias: null, faixa: null, rupturaEm: null };
  const mediaDia = input.vendas30d / JANELA_VENDAS_DIAS;
  const dias = Math.floor(Math.max(0, input.estoque) / mediaDia);
  const rupturaEm = new Date(input.hoje.getTime() + dias * 86_400_000).toLocaleDateString(
    "en-CA",
    { timeZone: "America/Sao_Paulo" },
  );
  return { vendas30d: input.vendas30d, dias, faixa: classificarFaixa(dias), rupturaEm };
}
