// Regra invariante do ERP: dinheiro é armazenado em CENTAVOS (Int).
// Toda conversão entre reais (decimal) e centavos passa por este módulo.

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Converte reais (ex: 12.34) em centavos (1234). */
export function reaisToCentavos(valorEmReais: number): number {
  if (!Number.isFinite(valorEmReais)) {
    throw new Error(`valor inválido: ${valorEmReais}`);
  }
  return Math.round(valorEmReais * 100);
}

/** Converte centavos em reais (decimal). */
export function centavosToReais(valorEmCentavos: number): number {
  return valorEmCentavos / 100;
}

/** Formata centavos como moeda BRL (ex: 1234 -> "R$ 12,34"). */
export function formatBRL(valorEmCentavos: number): string {
  return BRL.format(centavosToReais(valorEmCentavos));
}

/**
 * Parse robusto de string em formato BR ("1.234,56" ou "1234,56" ou "1234.56")
 * para centavos. Usado pelo importador CSV/XLSX.
 */
export function parseValorBRParaCentavos(input: string): number {
  const limpo = input.trim().replace(/[^\d,.-]/g, "");
  if (!limpo) throw new Error(`valor vazio`);

  const temVirgula = limpo.includes(",");
  const temPonto = limpo.includes(".");

  let normalizado: string;
  if (temVirgula && temPonto) {
    // formato BR clássico: 1.234,56
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    normalizado = limpo.replace(",", ".");
  } else {
    normalizado = limpo;
  }

  const numero = Number(normalizado);
  if (!Number.isFinite(numero)) {
    throw new Error(`não consegui interpretar valor: "${input}"`);
  }
  return reaisToCentavos(numero);
}
