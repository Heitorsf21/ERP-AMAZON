import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { TIMEZONE } from "@/lib/date";
import { FAIXAS_ORDENADAS, FAIXA_LABEL } from "./schemas";
import type { ItemResumoEstoque, ResumoEstoqueWhatsApp } from "./service";

// Limite pratico por mensagem. O WhatsApp aceita ~4096 caracteres; mantemos
// folga para o cabecalho "Parte i/N" e para qualquer normalizacao do WAHA.
export const LIMITE_CARACTERES_PARTE = 3500;

export function formatarItem(item: ItemResumoEstoque): string {
  return `${item.sku} - ${item.nome} | Estoque: ${item.estoqueAtual} | Vendeu 30d: ${item.vendas30d} | Cobertura: ${item.coberturaDias}d`;
}

function cabecalho(geradoEm: Date): string {
  return `Resumo de estoque - ${format(toZonedTime(geradoEm, TIMEZONE), "dd/MM/yyyy HH:mm")}`;
}

/**
 * Constroi as linhas da mensagem completa (cabecalho + todas as faixas).
 * Faixas vazias aparecem com contagem (0) para confirmar a varredura completa.
 */
function construirLinhas(resumo: ResumoEstoqueWhatsApp): string[] {
  const linhas: string[] = [cabecalho(resumo.geradoEm)];

  if (resumo.totalProdutos === 0) {
    linhas.push(
      "",
      "Nenhum produto elegivel (ativo com venda nos ultimos 30 dias).",
    );
    return linhas;
  }

  for (const faixa of FAIXAS_ORDENADAS) {
    const itens = resumo.porFaixa[faixa];
    linhas.push("", `${FAIXA_LABEL[faixa]} (${itens.length})`);
    for (const item of itens) linhas.push(formatarItem(item));
  }
  return linhas;
}

export function formatarMensagemResumoEstoque(
  resumo: ResumoEstoqueWhatsApp,
): string {
  return construirLinhas(resumo).join("\n");
}

// Agrupa linhas em blocos cujo tamanho fica abaixo do limite efetivo,
// nunca quebrando uma linha de item ao meio.
function agruparLinhas(linhas: string[], limiteEfetivo: number): string[][] {
  const grupos: string[][] = [];
  let atual: string[] = [];
  let tamanho = 0;

  for (const linha of linhas) {
    const custo = linha.length + 1; // +1 pela quebra de linha
    if (atual.length > 0 && tamanho + custo > limiteEfetivo) {
      grupos.push(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(linha);
    tamanho += custo;
  }
  if (atual.length > 0) grupos.push(atual);
  return grupos;
}

/**
 * Monta a mensagem em uma ou mais partes. Quando cabe no limite, retorna uma
 * unica string. Quando excede, quebra em partes numeradas ("Parte i/N"),
 * preservando todas as faixas e todos os itens.
 */
export function montarPartesMensagem(
  resumo: ResumoEstoqueWhatsApp,
  limite = LIMITE_CARACTERES_PARTE,
): string[] {
  const linhas = construirLinhas(resumo);
  const completa = linhas.join("\n");
  if (completa.length <= limite) return [completa];

  // Reserva espaco para o prefixo "Parte i/N\n\n".
  const limiteEfetivo = Math.max(200, limite - 24);
  const grupos = agruparLinhas(linhas, limiteEfetivo);
  const total = grupos.length;
  return grupos.map(
    (grupo, i) => `Parte ${i + 1}/${total}\n${grupo.join("\n")}`,
  );
}
