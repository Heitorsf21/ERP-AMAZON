import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { PDF } from "@libpdf/core";
import OpenAI from "openai";
import type { Prisma } from "@prisma/client";
import { differenceInCalendarDays } from "date-fns";
import { db } from "@/lib/db";
import {
  TipoMovimentacao,
  StatusConta,
  StatusDossieFinanceiro,
  TipoDocumentoFinanceiro,
  type TipoDocumentoFinanceiro as TipoDocumentoFinanceiroValue,
} from "@/modules/shared/domain";

const MIME_ACEITOS = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const LIMITE_TEXTO_IA = 45_000;
const TOLERANCIA_TAXA_PAGAMENTO_CENTAVOS = 500; // R$ 5,00
const TOLERANCIA_TAXA_PAGAMENTO_PERCENTUAL = 0.002; // 0,2%

const PROMPT_EXTRACAO_DOCUMENTO = `Voce e um assistente especializado em documentos financeiros brasileiros.

Classifique e extraia os dados do documento retornando SOMENTE JSON valido:
{
  "tipoDocumento": "BOLETO" | "NOTA_FISCAL" | "OUTRO",
  "fornecedor": "beneficiario/cedente do boleto ou emitente da NF",
  "cnpj": "CNPJ do fornecedor com apenas digitos, ou null",
  "valor": 0.00,
  "vencimento": "YYYY-MM-DD ou null",
  "dataEmissao": "YYYY-MM-DD ou null",
  "descricao": "descricao curta do documento",
  "numero": "numero do boleto, nosso numero, numero da NF ou null",
  "chaveAcesso": "chave de acesso NF-e com apenas digitos ou null",
  "linhaDigitavel": "linha digitavel/codigo de barras do boleto com apenas digitos ou null"
}

Regras:
- Para BOLETO, "fornecedor" e o beneficiario/cedente, "valor" e o valor a pagar e "vencimento" e obrigatorio quando existir.
- Para NOTA_FISCAL, "fornecedor" e o emitente, "valor" e o valor total da NF e "vencimento" deve ser null se a NF nao trouxer vencimento.
- Use null quando nao encontrar um campo com confianca.
- Nao invente dados.`;

type ConteudoOpenAI =
  | { type: "input_text"; text: string }
  | { type: "input_file"; filename: string; file_data: string }
  | { type: "input_image"; image_url: string; detail: "high" | "low" | "auto" };

type DocumentoExtraidoIA = {
  tipoDocumento?: string | null;
  fornecedor?: string | null;
  cnpj?: string | null;
  valor?: number | null;
  vencimento?: string | null;
  dataEmissao?: string | null;
  descricao?: string | null;
  numero?: string | null;
  chaveAcesso?: string | null;
  linhaDigitavel?: string | null;
};

type MetadadosDocumento = {
  tipo: TipoDocumentoFinanceiroValue;
  fornecedorNome: string | null;
  fornecedorDocumento: string | null;
  descricao: string | null;
  valor: number | null;
  vencimento: Date | null;
  dataEmissao: Date | null;
  numeroDocumento: string | null;
  chaveAcesso: string | null;
  linhaDigitavel: string | null;
};

type DadosComparaveis = {
  fornecedorNome: string | null;
  fornecedorDocumento: string | null;
  valor: number | null;
  vencimento: Date | null;
  dataEmissao: Date | null;
  numeroDocumento: string | null;
  chaveAcesso: string | null;
  linhaDigitavel: string | null;
};

type CandidatoDossie = Prisma.DossieFinanceiroGetPayload<{
  include: { documentos: true; contaPagar: { include: { fornecedor: true } } };
}>;

type CandidatoConta = Prisma.ContaPagarGetPayload<{
  include: {
    fornecedor: true;
    movimentacao: true;
    dossieFinanceiro: { include: { documentos: true } };
  };
}>;

type CandidatoPagamento = Prisma.MovimentacaoGetPayload<{
  include: { contaPaga: true };
}>;

type ProcessarDocumentoInput = {
  arquivo: File;
  senhaPdf?: string;
};

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function somenteDigitos(input?: string | null) {
  return (input ?? "").replace(/\D/g, "");
}

function limparTexto(input?: string | null) {
  const texto = input?.trim();
  return texto ? texto : null;
}

function normalizarTexto(input?: string | null) {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function palavrasEmComum(a: string, b: string) {
  const stopwords = new Set([
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "ltda",
    "sa",
    "s",
    "a",
    "me",
    "epp",
    "comercio",
    "servicos",
    "distribuicao",
  ]);
  const aa = new Set(
    a
      .split(" ")
      .filter((x) => x.length >= 3 && !stopwords.has(x)),
  );
  const bb = new Set(
    b
      .split(" ")
      .filter((x) => x.length >= 3 && !stopwords.has(x)),
  );

  let total = 0;
  for (const palavra of aa) if (bb.has(palavra)) total += 1;
  return total;
}

function cnpjRaiz(cnpj?: string | null) {
  const digits = somenteDigitos(cnpj);
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}

function dataISOParaDate(input?: string | null) {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  return new Date(`${input}T12:00:00.000Z`);
}

function valorDecimalParaCentavos(valor?: number | null) {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
    return null;
  }
  return Math.round(valor * 100);
}

function formatarCentavos(valor: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor / 100);
}

function toleranciaPagamentoCentavos(valorDocumento: number) {
  const toleranciaPercentual = Math.round(
    valorDocumento * TOLERANCIA_TAXA_PAGAMENTO_PERCENTUAL,
  );
  return Math.max(TOLERANCIA_TAXA_PAGAMENTO_CENTAVOS, toleranciaPercentual);
}

function tipoDocumentoSeguro(input?: string | null): TipoDocumentoFinanceiroValue {
  if (input === TipoDocumentoFinanceiro.BOLETO) return input;
  if (input === TipoDocumentoFinanceiro.NOTA_FISCAL) return input;
  return TipoDocumentoFinanceiro.OUTRO;
}

function normalizarMetadados(raw: DocumentoExtraidoIA): MetadadosDocumento {
  return {
    tipo: tipoDocumentoSeguro(raw.tipoDocumento),
    fornecedorNome: limparTexto(raw.fornecedor),
    fornecedorDocumento: somenteDigitos(raw.cnpj) || null,
    descricao: limparTexto(raw.descricao),
    valor: valorDecimalParaCentavos(raw.valor),
    vencimento: dataISOParaDate(raw.vencimento),
    dataEmissao: dataISOParaDate(raw.dataEmissao),
    numeroDocumento: limparTexto(raw.numero),
    chaveAcesso: somenteDigitos(raw.chaveAcesso) || null,
    linhaDigitavel: somenteDigitos(raw.linhaDigitavel) || null,
  };
}

function pontuarDados(a: DadosComparaveis, b: DadosComparaveis) {
  let score = 0;
  const motivos: string[] = [];

  if (a.linhaDigitavel && b.linhaDigitavel && a.linhaDigitavel === b.linhaDigitavel) {
    score += 120;
    motivos.push("Linha digitavel igual");
  }

  if (a.chaveAcesso && b.chaveAcesso && a.chaveAcesso === b.chaveAcesso) {
    score += 120;
    motivos.push("Chave NF-e igual");
  }

  const cnpjA = somenteDigitos(a.fornecedorDocumento);
  const cnpjB = somenteDigitos(b.fornecedorDocumento);
  if (cnpjA && cnpjB) {
    if (cnpjA === cnpjB) {
      score += 65;
      motivos.push("CNPJ igual");
    } else if (cnpjRaiz(cnpjA) && cnpjRaiz(cnpjA) === cnpjRaiz(cnpjB)) {
      score += 42;
      motivos.push("Raiz do CNPJ igual");
    }
  }

  const nomeA = normalizarTexto(a.fornecedorNome);
  const nomeB = normalizarTexto(b.fornecedorNome);
  if (nomeA && nomeB) {
    if (nomeA === nomeB) {
      score += 38;
      motivos.push("Fornecedor igual");
    } else if (nomeA.includes(nomeB) || nomeB.includes(nomeA)) {
      score += 26;
      motivos.push("Fornecedor muito parecido");
    } else if (palavrasEmComum(nomeA, nomeB) >= 2) {
      score += 16;
      motivos.push("Fornecedor parcialmente compativel");
    }
  }

  if (a.valor !== null && b.valor !== null) {
    const diff = Math.abs(a.valor - b.valor);
    if (diff === 0) {
      score += 38;
      motivos.push("Valor igual");
    } else if (diff <= 100) {
      score += 20;
      motivos.push("Valor muito proximo");
    } else if (diff <= 500) {
      score += 10;
      motivos.push("Valor proximo");
    }
  }

  if (a.vencimento && b.vencimento) {
    const dias = Math.abs(differenceInCalendarDays(a.vencimento, b.vencimento));
    if (dias === 0) {
      score += 20;
      motivos.push("Mesmo vencimento");
    } else if (dias <= 7) {
      score += 10;
      motivos.push("Vencimento proximo");
    }
  }

  if (a.dataEmissao && b.dataEmissao) {
    const dias = Math.abs(differenceInCalendarDays(a.dataEmissao, b.dataEmissao));
    if (dias === 0) {
      score += 14;
      motivos.push("Mesma data de emissao");
    } else if (dias <= 2) {
      score += 7;
      motivos.push("Data de emissao proxima");
    }
  }

  const numeroA = normalizarTexto(a.numeroDocumento);
  const numeroB = normalizarTexto(b.numeroDocumento);
  if (numeroA && numeroB && (numeroA === numeroB || numeroA.includes(numeroB) || numeroB.includes(numeroA))) {
    score += 16;
    motivos.push("Numero do documento compativel");
  }

  return { score, motivos };
}

function dadosDoDocumento(meta: MetadadosDocumento): DadosComparaveis {
  return {
    fornecedorNome: meta.fornecedorNome,
    fornecedorDocumento: meta.fornecedorDocumento,
    valor: meta.valor,
    vencimento: meta.vencimento,
    dataEmissao: meta.dataEmissao,
    numeroDocumento: meta.numeroDocumento,
    chaveAcesso: meta.chaveAcesso,
    linhaDigitavel: meta.linhaDigitavel,
  };
}

function dadosDoDossie(dossie: CandidatoDossie): DadosComparaveis {
  const chaves = dossie.documentos
    .map((d) => d.chaveAcesso)
    .filter(Boolean);
  const linhas = dossie.documentos
    .map((d) => d.linhaDigitavel)
    .filter(Boolean);
  return {
    fornecedorNome:
      dossie.fornecedorNome ??
      dossie.documentos.find((d) => d.fornecedorNome)?.fornecedorNome ??
      dossie.contaPagar?.fornecedor.nome ??
      null,
    fornecedorDocumento:
      dossie.fornecedorDocumento ??
      dossie.documentos.find((d) => d.fornecedorDocumento)?.fornecedorDocumento ??
      dossie.contaPagar?.fornecedor.documento ??
      null,
    valor: dossie.valor ?? dossie.documentos.find((d) => d.valor)?.valor ?? null,
    vencimento:
      dossie.vencimento ??
      dossie.documentos.find((d) => d.vencimento)?.vencimento ??
      null,
    dataEmissao: dossie.documentos.find((d) => d.dataEmissao)?.dataEmissao ?? null,
    numeroDocumento:
      dossie.numeroDocumento ??
      dossie.documentos.find((d) => d.numeroDocumento)?.numeroDocumento ??
      null,
    chaveAcesso: chaves[0] ?? null,
    linhaDigitavel: linhas[0] ?? null,
  };
}

function dadosDaConta(conta: CandidatoConta): DadosComparaveis {
  return {
    fornecedorNome: conta.fornecedor.nome,
    fornecedorDocumento: conta.fornecedor.documento,
    valor: conta.valor,
    vencimento: conta.vencimento,
    dataEmissao: null,
    numeroDocumento: conta.descricao,
    chaveAcesso:
      conta.dossieFinanceiro?.documentos.find((d) => d.chaveAcesso)?.chaveAcesso ??
      null,
    linhaDigitavel:
      conta.dossieFinanceiro?.documentos.find((d) => d.linhaDigitavel)
        ?.linhaDigitavel ?? null,
  };
}

function pontuarContaPorDocumento(meta: MetadadosDocumento, conta: CandidatoConta) {
  const resultado = pontuarDados(dadosDoDocumento(meta), dadosDaConta(conta));
  let score = resultado.score;
  const motivos = [...resultado.motivos];

  if (conta.status !== StatusConta.PAGA) {
    return { score, motivos };
  }

  const valorDocumento = meta.valor;
  if (valorDocumento !== null) {
    const toleranciaTaxa = toleranciaPagamentoCentavos(valorDocumento);
    const diffConta = Math.abs(valorDocumento - conta.valor);
    if (diffConta === 0) {
      score += 12;
      motivos.push("Valor igual a uma conta ja paga");
    } else if (diffConta <= toleranciaTaxa) {
      score += 8;
      motivos.push("Valor da conta pago com pequena diferenca de taxa");
    }

    if (conta.movimentacao) {
      const diffMovimento = Math.abs(valorDocumento - conta.movimentacao.valor);
      if (diffMovimento === 0) {
        score += 8;
        motivos.push("Valor igual ao pagamento registrado no caixa");
      } else if (diffMovimento <= toleranciaTaxa) {
        score += 6;
        motivos.push("Pagamento no caixa tem pequena diferenca de taxa");
      }
    }
  }

  const dataPagamento = conta.pagoEm ?? conta.movimentacao?.dataCaixa ?? null;
  const datasDocumento = [meta.vencimento, meta.dataEmissao].filter(
    (data): data is Date => data instanceof Date,
  );
  if (dataPagamento && datasDocumento.length > 0) {
    const menorDiferenca = Math.min(
      ...datasDocumento.map((dataDocumento) =>
        Math.abs(differenceInCalendarDays(dataDocumento, dataPagamento)),
      ),
    );
    if (menorDiferenca <= 7) {
      score += 18;
      motivos.push("Pagamento proximo da data do documento");
    } else if (menorDiferenca <= 30) {
      score += 10;
      motivos.push("Pagamento no mesmo periodo do documento");
    } else if (menorDiferenca <= 90) {
      score += 5;
      motivos.push("Pagamento em periodo compativel");
    }
  }

  const descricaoMovimento = normalizarTexto(conta.movimentacao?.descricao);
  if (descricaoMovimento) {
    const fornecedorDocumento = normalizarTexto(meta.fornecedorNome);
    if (
      fornecedorDocumento &&
      (descricaoMovimento.includes(fornecedorDocumento) ||
        palavrasEmComum(descricaoMovimento, fornecedorDocumento) >= 2)
    ) {
      score += 12;
      motivos.push("Descricao do pagamento cita fornecedor parecido");
    }

    const numeroDocumento = normalizarTexto(meta.numeroDocumento);
    if (numeroDocumento && descricaoMovimento.includes(numeroDocumento)) {
      score += 10;
      motivos.push("Descricao do pagamento cita numero do documento");
    }
  }

  if (score >= 70) {
    motivos.push("Conta ja estava marcada como paga");
  }

  return { score, motivos };
}

function pontuarPagamentoPorDocumento(
  meta: MetadadosDocumento,
  pagamento: CandidatoPagamento,
) {
  let score = 0;
  const motivos: string[] = [];

  if (meta.valor !== null) {
    const diff = Math.abs(meta.valor - pagamento.valor);
    const toleranciaTaxa = toleranciaPagamentoCentavos(meta.valor);
    if (diff === 0) {
      score += 45;
      motivos.push("Valor igual ao pagamento no caixa");
    } else if (diff <= 100) {
      score += 36;
      motivos.push("Valor muito proximo do pagamento no caixa");
    } else if (diff <= toleranciaTaxa) {
      score += 30;
      motivos.push("Valor compativel com pequena taxa do fornecedor");
    }
  }

  const datasDocumento = [meta.vencimento, meta.dataEmissao].filter(
    (data): data is Date => data instanceof Date,
  );
  if (datasDocumento.length > 0) {
    const menorDiferenca = Math.min(
      ...datasDocumento.map((dataDocumento) =>
        Math.abs(differenceInCalendarDays(dataDocumento, pagamento.dataCaixa)),
      ),
    );
    if (menorDiferenca <= 7) {
      score += 28;
      motivos.push("Pagamento proximo da data do documento");
    } else if (menorDiferenca <= 30) {
      score += 16;
      motivos.push("Pagamento no mesmo periodo do documento");
    } else if (menorDiferenca <= 90) {
      score += 8;
      motivos.push("Pagamento em periodo compativel");
    }
  }

  const descricaoPagamento = normalizarTexto(pagamento.descricao);
  const fornecedorDocumento = normalizarTexto(meta.fornecedorNome);
  if (descricaoPagamento && fornecedorDocumento) {
    if (
      descricaoPagamento.includes(fornecedorDocumento) ||
      fornecedorDocumento.includes(descricaoPagamento)
    ) {
      score += 24;
      motivos.push("Descricao do pagamento cita o fornecedor");
    } else {
      const palavras = palavrasEmComum(descricaoPagamento, fornecedorDocumento);
      if (palavras >= 2) {
        score += 20;
        motivos.push("Descricao do pagamento cita fornecedor parecido");
      } else if (palavras === 1) {
        score += 18;
        motivos.push("Descricao do pagamento tem palavra forte do fornecedor");
      }
    }
  }

  const numeroDocumento = normalizarTexto(meta.numeroDocumento);
  if (numeroDocumento && descricaoPagamento.includes(numeroDocumento)) {
    score += 10;
    motivos.push("Descricao do pagamento cita numero do documento");
  }

  return { score, motivos };
}

function observacaoConciliacaoPagamento(
  atual: string | null | undefined,
  pagamento: CandidatoPagamento,
  meta: MetadadosDocumento,
) {
  const partes = [
    "Conciliada automaticamente com pagamento ja existente no caixa.",
    `Movimentacao: ${pagamento.descricao}.`,
  ];

  if (meta.valor !== null && meta.valor !== pagamento.valor) {
    partes.push(
      `Valor do documento: ${formatarCentavos(meta.valor)}; valor pago: ${formatarCentavos(pagamento.valor)}.`,
    );
  }

  const novaObservacao = partes.join(" ");
  return atual ? `${atual}\n${novaObservacao}` : novaObservacao;
}

async function upsertFornecedorDocumento(meta: MetadadosDocumento) {
  const nome = meta.fornecedorNome ?? "Fornecedor nao identificado";
  const documento = meta.fornecedorDocumento ?? undefined;
  const existente = await db.fornecedor.findFirst({
    where: { nome: { equals: nome } },
  });

  if (existente) {
    if (documento && !existente.documento) {
      return db.fornecedor.update({
        where: { id: existente.id },
        data: { documento },
      });
    }
    return existente;
  }

  return db.fornecedor.create({ data: { nome, documento } });
}

function resumoDossie(meta: MetadadosDocumento, contaPagarId?: string | null) {
  return {
    fornecedorNome: meta.fornecedorNome,
    fornecedorDocumento: meta.fornecedorDocumento,
    descricao: meta.descricao,
    valor: meta.valor,
    vencimento: meta.vencimento,
    numeroDocumento: meta.numeroDocumento,
    status: contaPagarId
      ? StatusDossieFinanceiro.VINCULADO_CONTA
      : StatusDossieFinanceiro.PENDENTE,
    contaPagarId: contaPagarId ?? undefined,
  };
}

function patchResumoDossie(
  atual: CandidatoDossie,
  meta: MetadadosDocumento,
): Prisma.DossieFinanceiroUpdateInput {
  return {
    fornecedorNome: atual.fornecedorNome ?? meta.fornecedorNome ?? undefined,
    fornecedorDocumento:
      atual.fornecedorDocumento ?? meta.fornecedorDocumento ?? undefined,
    descricao: atual.descricao ?? meta.descricao ?? undefined,
    valor:
      meta.tipo === TipoDocumentoFinanceiro.BOLETO && meta.valor
        ? meta.valor
        : atual.valor ?? meta.valor ?? undefined,
    vencimento:
      meta.tipo === TipoDocumentoFinanceiro.BOLETO && meta.vencimento
        ? meta.vencimento
        : atual.vencimento ?? meta.vencimento ?? undefined,
    numeroDocumento: atual.numeroDocumento ?? meta.numeroDocumento ?? undefined,
    status: atual.contaPagarId
      ? StatusDossieFinanceiro.VINCULADO_CONTA
      : StatusDossieFinanceiro.PENDENTE,
  };
}

async function extrairTextoPdfComSenha(buffer: Buffer, senha: string) {
  let pdf;
  try {
    pdf = await PDF.load(buffer, { credentials: senha });
  } catch {
    throw new Error("nao foi possivel abrir o PDF com a senha informada");
  }

  const texto = pdf
    .extractText()
    .map((page) => page.text)
    .join("\n\n")
    .trim();

  if (texto.length < 20) {
    throw new Error("PDF aberto, mas sem texto suficiente para analise");
  }

  return texto.slice(0, LIMITE_TEXTO_IA);
}

async function montarConteudoOpenAI({
  buffer,
  mimeType,
  nomeArquivo,
  senhaPdf,
}: {
  buffer: Buffer;
  mimeType: string;
  nomeArquivo: string;
  senhaPdf?: string;
}): Promise<{ conteudo: ConteudoOpenAI[]; textoExtraido: string | null; protegidoPorSenha: boolean }> {
  const base64 = buffer.toString("base64");

  if (mimeType === "application/pdf" && senhaPdf?.trim()) {
    const textoExtraido = await extrairTextoPdfComSenha(buffer, senhaPdf.trim());
    return {
      conteudo: [
        {
          type: "input_text",
          text: `${PROMPT_EXTRACAO_DOCUMENTO}\n\nTexto extraido do PDF protegido:\n${textoExtraido}`,
        },
      ],
      textoExtraido,
      protegidoPorSenha: true,
    };
  }

  if (mimeType === "application/pdf") {
    return {
      conteudo: [
        {
          type: "input_file",
          filename: nomeArquivo,
          file_data: `data:application/pdf;base64,${base64}`,
        },
        { type: "input_text", text: PROMPT_EXTRACAO_DOCUMENTO },
      ],
      textoExtraido: null,
      protegidoPorSenha: false,
    };
  }

  const imageMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  return {
    conteudo: [
      {
        type: "input_image",
        image_url: `data:${imageMime};base64,${base64}`,
        detail: "high",
      },
      { type: "input_text", text: PROMPT_EXTRACAO_DOCUMENTO },
    ],
    textoExtraido: null,
    protegidoPorSenha: false,
  };
}

async function extrairMetadadosComIA(input: {
  buffer: Buffer;
  mimeType: string;
  nomeArquivo: string;
  senhaPdf?: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY nao configurada no servidor");

  const { conteudo, textoExtraido, protegidoPorSenha } =
    await montarConteudoOpenAI(input);

  const client = new OpenAI({ apiKey });
  let jsonText = "";
  try {
    const resposta = await client.responses.create({
      model: "gpt-4o",
      input: [{ role: "user", content: conteudo }],
      text: { format: { type: "json_object" } },
    });
    jsonText = resposta.output_text.trim();
  } catch (e) {
    const mensagem =
      e instanceof Error ? e.message : "falha ao analisar documento com IA";
    if (input.mimeType === "application/pdf" && !input.senhaPdf?.trim()) {
      throw new Error(
        "falha ao ler PDF. Se for boleto protegido, informe a senha do arquivo.",
      );
    }
    throw new Error(mensagem);
  }

  let dados: DocumentoExtraidoIA;
  try {
    dados = JSON.parse(
      jsonText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim(),
    );
  } catch {
    throw new Error("IA retornou um JSON invalido para o documento");
  }

  return {
    metadados: normalizarMetadados(dados),
    raw: dados,
    textoExtraido,
    protegidoPorSenha,
  };
}

async function salvarArquivo(buffer: Buffer, nomeOriginal: string) {
  const uploadDir = path.join(process.cwd(), "uploads", "documentos-financeiros");
  await mkdir(uploadDir, { recursive: true });
  const ext = nomeOriginal.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "bin";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const filePath = path.join(uploadDir, filename);
  await writeFile(filePath, buffer);
  return path.join("uploads", "documentos-financeiros", filename);
}

async function buscarMelhorDossie(meta: MetadadosDocumento) {
  const candidatos = await db.dossieFinanceiro.findMany({
    where: { status: { not: "CANCELADO" } },
    include: {
      documentos: true,
      contaPagar: { include: { fornecedor: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });

  return candidatos
    .map((dossie) => ({
      dossie,
      ...pontuarDados(dadosDoDocumento(meta), dadosDoDossie(dossie)),
    }))
    .filter((c) => c.score >= 70)
    .sort((a, b) => b.score - a.score)[0];
}

async function buscarMelhorConta(meta: MetadadosDocumento) {
  const contas = await db.contaPagar.findMany({
    where: { status: { not: "CANCELADA" } },
    include: {
      fornecedor: true,
      movimentacao: true,
      dossieFinanceiro: { include: { documentos: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });

  return contas
    .map((conta) => ({
      conta,
      ...pontuarContaPorDocumento(meta, conta),
    }))
    .filter((c) =>
      c.score >= (c.conta.status === StatusConta.PAGA ? 75 : 80),
    )
    .sort((a, b) => b.score - a.score)[0];
}

async function buscarMelhorPagamento(meta: MetadadosDocumento) {
  const pagamentos = await db.movimentacao.findMany({
    where: {
      tipo: TipoMovimentacao.SAIDA,
      contaPaga: { is: null },
    },
    include: { contaPaga: true },
    orderBy: { dataCaixa: "desc" },
    take: 500,
  });

  const candidatos = pagamentos
    .map((pagamento) => ({
      pagamento,
      ...pontuarPagamentoPorDocumento(meta, pagamento),
    }))
    .filter((c) => c.score >= 70)
    .sort((a, b) => b.score - a.score);

  const melhor = candidatos[0];
  const segundo = candidatos[1];
  if (!melhor) return null;

  // Evita marcar como pago quando existem duas saidas parecidas demais.
  if (segundo && melhor.score - segundo.score < 8) return null;

  return melhor;
}

async function criarContaPagaPorPagamento(
  meta: MetadadosDocumento,
  pagamento: CandidatoPagamento,
) {
  const fornecedor = await upsertFornecedorDocumento(meta);

  return db.contaPagar.create({
    data: {
      fornecedorId: fornecedor.id,
      categoriaId: pagamento.categoriaId,
      descricao: meta.descricao ?? pagamento.descricao,
      valor: meta.valor ?? pagamento.valor,
      vencimento: pagamento.dataCaixa,
      status: StatusConta.PAGA,
      pagoEm: pagamento.dataCaixa,
      movimentacaoId: pagamento.id,
      recorrencia: "NENHUMA",
      observacoes: observacaoConciliacaoPagamento(null, pagamento, meta),
    },
  });
}

async function conciliarContaComPagamento(
  conta: CandidatoConta,
  pagamento: CandidatoPagamento,
  meta: MetadadosDocumento,
) {
  if (conta.status === StatusConta.PAGA || conta.movimentacaoId) {
    return conta;
  }

  return db.contaPagar.update({
    where: { id: conta.id },
    data: {
      status: StatusConta.PAGA,
      pagoEm: pagamento.dataCaixa,
      vencimento: pagamento.dataCaixa,
      movimentacaoId: pagamento.id,
      observacoes: observacaoConciliacaoPagamento(
        conta.observacoes,
        pagamento,
        meta,
      ),
    },
    include: {
      fornecedor: true,
      movimentacao: true,
      dossieFinanceiro: { include: { documentos: true } },
    },
  });
}

async function criarDocumentoNoDossie(input: {
  dossieId: string;
  meta: MetadadosDocumento;
  nomeArquivo: string;
  caminhoArquivo: string;
  mimeType: string;
  hash: string;
  textoExtraido: string | null;
  protegidoPorSenha: boolean;
}) {
  return db.documentoFinanceiro.create({
    data: {
      dossieId: input.dossieId,
      tipo: input.meta.tipo,
      nomeArquivo: input.nomeArquivo,
      caminhoArquivo: input.caminhoArquivo,
      mimeType: input.mimeType,
      sha256: input.hash,
      textoExtraido: input.textoExtraido,
      fornecedorNome: input.meta.fornecedorNome,
      fornecedorDocumento: input.meta.fornecedorDocumento,
      descricao: input.meta.descricao,
      valor: input.meta.valor,
      vencimento: input.meta.vencimento,
      numeroDocumento: input.meta.numeroDocumento,
      chaveAcesso: input.meta.chaveAcesso,
      linhaDigitavel: input.meta.linhaDigitavel,
      dataEmissao: input.meta.dataEmissao,
      protegidoPorSenha: input.protegidoPorSenha,
    },
  });
}

async function serializarDossie(id: string) {
  return db.dossieFinanceiro.findUniqueOrThrow({
    where: { id },
    include: {
      documentos: { orderBy: { createdAt: "desc" } },
      contaPagar: {
        include: {
          fornecedor: { select: { id: true, nome: true, documento: true } },
          categoria: { select: { id: true, nome: true } },
          movimentacao: {
            select: {
              id: true,
              valor: true,
              dataCaixa: true,
              descricao: true,
              origem: true,
            },
          },
        },
      },
    },
  });
}

async function vincularDossieAConta(dossieId: string, contaId: string) {
  const dossie = await db.dossieFinanceiro.findUnique({
    where: { id: dossieId },
  });
  if (!dossie) throw new Error("dossie financeiro nao encontrado");
  if (dossie.contaPagarId && dossie.contaPagarId !== contaId) {
    throw new Error("dossie financeiro ja vinculado a outra conta");
  }

  const conta = await db.contaPagar.findUnique({ where: { id: contaId } });
  if (!conta) throw new Error("conta nao encontrada");

  await db.dossieFinanceiro.update({
    where: { id: dossieId },
    data: {
      contaPagarId: contaId,
      status: StatusDossieFinanceiro.VINCULADO_CONTA,
    },
  });

  return serializarDossie(dossieId);
}

async function vincularMelhorDossieAConta(contaId: string) {
  const conta = await db.contaPagar.findUnique({
    where: { id: contaId },
    include: {
      fornecedor: true,
      movimentacao: true,
      dossieFinanceiro: { include: { documentos: true } },
    },
  });
  if (!conta || conta.dossieFinanceiro) return null;

  const dossies = await db.dossieFinanceiro.findMany({
    where: { contaPagarId: null },
    include: {
      documentos: true,
      contaPagar: { include: { fornecedor: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });

  const melhor = dossies
    .map((dossie) => ({
      dossie,
      ...pontuarDados(dadosDaConta(conta), dadosDoDossie(dossie)),
    }))
    .filter((c) => c.score >= 75)
    .sort((a, b) => b.score - a.score)[0];

  if (!melhor) return null;

  return vincularDossieAConta(melhor.dossie.id, contaId);
}

export const documentosFinanceirosService = {
  async listarDossies() {
    return db.dossieFinanceiro.findMany({
      include: {
        documentos: { orderBy: { createdAt: "desc" } },
        contaPagar: {
          include: {
            fornecedor: { select: { id: true, nome: true, documento: true } },
            categoria: { select: { id: true, nome: true } },
            movimentacao: {
              select: {
                id: true,
                valor: true,
                dataCaixa: true,
                descricao: true,
                origem: true,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  },

  async processarUpload(input: ProcessarDocumentoInput) {
    const mimeType = input.arquivo.type || "application/octet-stream";
    if (!MIME_ACEITOS.has(mimeType)) {
      throw new Error(`tipo de arquivo nao suportado: ${mimeType}`);
    }

    const buffer = Buffer.from(await input.arquivo.arrayBuffer());
    const hash = sha256(buffer);

    const documentoDuplicado = await db.documentoFinanceiro.findUnique({
      where: { sha256: hash },
      include: { dossie: { include: { documentos: true, contaPagar: true } } },
    });
    if (documentoDuplicado) {
      return {
        acao: "DUPLICADO",
        duplicado: true,
        documento: documentoDuplicado,
        dossie: await serializarDossie(documentoDuplicado.dossieId),
      };
    }

    const { metadados, raw, textoExtraido, protegidoPorSenha } =
      await extrairMetadadosComIA({
        buffer,
        mimeType,
        nomeArquivo: input.arquivo.name,
        senhaPdf: input.senhaPdf,
      });
    const caminhoArquivo = await salvarArquivo(buffer, input.arquivo.name);

    const melhorDossie = await buscarMelhorDossie(metadados);
    if (melhorDossie) {
      const documento = await criarDocumentoNoDossie({
        dossieId: melhorDossie.dossie.id,
        meta: metadados,
        nomeArquivo: input.arquivo.name,
        caminhoArquivo,
        mimeType,
        hash,
        textoExtraido,
        protegidoPorSenha,
      });
      await db.dossieFinanceiro.update({
        where: { id: melhorDossie.dossie.id },
        data: patchResumoDossie(melhorDossie.dossie, metadados),
      });

      const dossieSerializado = await serializarDossie(melhorDossie.dossie.id);
      const anexadoContaPaga =
        dossieSerializado.contaPagar?.status === StatusConta.PAGA;

      return {
        acao: melhorDossie.dossie.contaPagarId
          ? anexadoContaPaga
            ? "ANEXADO_A_CONTA_PAGA"
            : "ANEXADO_A_CONTA"
          : "ANEXADO_A_DOSSIE",
        duplicado: false,
        documento,
        dossie: dossieSerializado,
        match: {
          score: melhorDossie.score,
          motivos: melhorDossie.motivos,
        },
        extracao: raw,
      };
    }

    const melhorConta = await buscarMelhorConta(metadados);
    const melhorPagamento =
      melhorConta?.conta.status === StatusConta.PAGA
        ? null
        : await buscarMelhorPagamento(metadados);
    const contaConciliada =
      melhorPagamento && melhorConta
        ? await conciliarContaComPagamento(
            melhorConta.conta,
            melhorPagamento.pagamento,
            metadados,
          )
        : null;
    const contaCriadaPorPagamento =
      melhorPagamento && !melhorConta
        ? await criarContaPagaPorPagamento(metadados, melhorPagamento.pagamento)
        : null;
    const contaPagarId =
      contaConciliada?.id ??
      contaCriadaPorPagamento?.id ??
      melhorConta?.conta.id ??
      null;
    const dossie = await db.dossieFinanceiro.create({
      data: resumoDossie(metadados, contaPagarId),
    });
    const documento = await criarDocumentoNoDossie({
      dossieId: dossie.id,
      meta: metadados,
      nomeArquivo: input.arquivo.name,
      caminhoArquivo,
      mimeType,
      hash,
      textoExtraido,
      protegidoPorSenha,
    });
    const dossieSerializado = await serializarDossie(dossie.id);
    const anexadoContaPaga =
      dossieSerializado.contaPagar?.status === StatusConta.PAGA;

    return {
      acao: contaPagarId
        ? anexadoContaPaga
          ? "ANEXADO_A_CONTA_PAGA"
          : "ANEXADO_A_CONTA"
        : "NOVO_DOSSIE",
      duplicado: false,
      documento,
      dossie: dossieSerializado,
      match: melhorPagamento
        ? {
            score: melhorPagamento.score,
            motivos: melhorPagamento.motivos,
          }
        : melhorConta
          ? { score: melhorConta.score, motivos: melhorConta.motivos }
          : null,
      extracao: raw,
    };
  },

  vincularDossieAConta,
  vincularMelhorDossieAConta,
};
