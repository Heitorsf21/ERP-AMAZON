// Tratamento específico do CSV oficial do Nubank PJ/PF (cabeçalho exato:
// "Data,Valor,Identificador,Descrição"). Sem este tratador o importador
// genérico ainda funciona — só passaria as descrições brutas e dependeria
// das categorias-fallback. Aqui:
//   1. detectamos o formato pelo header,
//   2. limpamos a descrição preservando o nome da contraparte,
//   3. sugerimos categoria por palavra-chave da descrição original.

const COLUNAS_NUBANK = ["Data", "Valor", "Identificador", "Descrição"];

export function isFormatoNubank(headers: string[]): boolean {
  if (headers.length !== COLUNAS_NUBANK.length) return false;
  return COLUNAS_NUBANK.every((c, i) => headers[i] === c);
}

type Padrao = { prefixo: string; rotulo: string };

// Ordem importa: variantes mais específicas vêm antes das mais genéricas.
const PADROES: Padrao[] = [
  { prefixo: "Transferência recebida pelo Pix - ", rotulo: "PIX recebido" },
  { prefixo: "Transferência enviada pelo Pix - ", rotulo: "PIX enviado" },
  { prefixo: "Transferência Recebida - ", rotulo: "Transferência recebida" },
  { prefixo: "Transferência Enviada - ", rotulo: "Transferência enviada" },
  { prefixo: "Pagamento de boleto efetuado - ", rotulo: "Boleto pago" },
];

const REGEX_DATA = /^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2}(:\d{2})?)?$/;
// CPF mascarado (•••.123.456-••), CPF completo (123.456.789-00) e
// CNPJ (12.345.678/0001-90).
const REGEX_DOCUMENTO =
  /^(?:[•\d]{3}\.[•\d]{3}\.[•\d]{3}-[•\d]{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/;

// Segmentos "ruidosos" que NÃO devem virar o nome exibido. Cobre o caso visto
// em alguns extratos onde o primeiro segmento após o prefixo é uma data, um
// CPF/CNPJ ou ficou vazio — sem este filtro, o resultado ficava "PIX recebido
// — 04/08/2025".
function pareceNome(seg: string): boolean {
  if (!seg) return false;
  if (REGEX_DATA.test(seg)) return false;
  if (REGEX_DOCUMENTO.test(seg)) return false;
  return true;
}

/**
 * Reduz a descrição do Nubank ao essencial: rótulo do tipo + nome da
 * contraparte. Para "Transferência recebida pelo Pix - ARTHUR ... -
 * •••.631...-•• - BCO SANTANDER...", retorna "PIX recebido — ARTHUR ...".
 * Mantém a string original quando o padrão não é reconhecido (ex.: "Pagamento
 * de fatura").
 */
export function limparDescricaoNubank(original: string): string {
  const s = original.trim();
  for (const p of PADROES) {
    if (s.startsWith(p.prefixo)) {
      const resto = s.slice(p.prefixo.length);
      const segmentos = resto.split(" - ").map((x) => x.trim());
      const nome = segmentos.find(pareceNome);
      return nome ? `${p.rotulo} — ${nome}` : p.rotulo;
    }
  }
  return s;
}

/**
 * Sugere o nome da categoria com base em palavras-chave da descrição original
 * (não a limpa, para não perder pistas como CNPJ). Retorna `null` quando não há
 * regra — o caller deve cair no fallback por sinal do valor.
 */
export function sugerirCategoriaNubank(descricaoOriginal: string): string | null {
  const s = descricaoOriginal.toUpperCase();
  if (s.includes("AMAZON SERVICOS")) return "Pagamento Amazon";
  if (s.includes("APS GESTAO CONTABIL")) return "Contabilidade";
  if (s.startsWith("PAGAMENTO DE FATURA")) return "Pagamento de fatura";
  if (
    s.includes("WOOVI") ||
    s.includes("HERMES COMERCIAL") ||
    s.includes("ASAAS")
  ) {
    return "Despesas operacionais";
  }
  return null;
}
