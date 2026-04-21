// Minimal OFX/QFX parser.
// OFX is SGML-like; extracts <STMTTRN> blocks without a full SGML parser.

export type TransacaoOFX = {
  fitid: string;
  valor: number; // em reais, negativo = saída
  data: Date;
  descricao: string;
};

function extrairTag(content: string, tag: string): string {
  const match = content.match(new RegExp(`<${tag}>([^<\\n]+)`, "i"));
  return match?.[1]?.trim() ?? "";
}

function parsarDataOFX(raw: string): Date {
  // Formats: "20250801120000[-3:BRT]", "20250801", "20250801120000"
  const digits = raw.replace(/[^\d]/g, "").slice(0, 8);
  const ano = parseInt(digits.slice(0, 4));
  const mes = parseInt(digits.slice(4, 6)) - 1;
  const dia = parseInt(digits.slice(6, 8));
  return new Date(ano, mes, dia);
}

export function parseOFX(conteudo: string): TransacaoOFX[] {
  const blockRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  const matches = [...conteudo.matchAll(blockRegex)];
  const transacoes: TransacaoOFX[] = [];

  for (const match of matches) {
    const block = match[1] ?? "";
    const trnamt = extrairTag(block, "TRNAMT");
    const dtposted = extrairTag(block, "DTPOSTED");
    const memo = extrairTag(block, "MEMO");
    const name = extrairTag(block, "NAME");
    const fitid = extrairTag(block, "FITID");

    const valor = parseFloat(trnamt.replace(",", "."));
    if (isNaN(valor) || valor === 0) continue;

    transacoes.push({
      fitid,
      valor,
      data: parsarDataOFX(dtposted),
      descricao: memo || name || "Sem descrição",
    });
  }

  return transacoes;
}
