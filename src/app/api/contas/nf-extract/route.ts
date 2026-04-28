import { NextResponse } from "next/server";
import OpenAI from "openai";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { contasService } from "@/modules/contas-a-pagar/service";
import { fileMatchesDeclaredMime } from "@/lib/file-validation";

// Tipos aceitos pelo endpoint.
const MIME_ACEITOS = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const PROMPT_EXTRACAO = `Você é um assistente especializado em extração de dados de notas fiscais e boletos brasileiros.

Analise o documento e extraia as seguintes informações no formato JSON:
{
  "fornecedor": "razão social ou nome do emitente/prestador/cedente",
  "cnpj": "CNPJ do emitente (apenas dígitos, sem pontuação, ou null se não encontrar)",
  "valor": 0.00,
  "vencimento": "YYYY-MM-DD",
  "descricao": "descrição resumida do serviço, produto ou cobrança (máximo 150 caracteres)",
  "numero": "número da nota fiscal ou boleto (ou null se não encontrar)"
}

Regras importantes:
- "valor" deve ser um número decimal (ex: 1234.56), não string. Use o valor total a pagar.
- "vencimento" deve ser uma data no formato YYYY-MM-DD. Se não houver vencimento explícito, use a data de emissão.
- "fornecedor" deve ser o nome da empresa/pessoa que está cobrando (emitente, não o tomador).
- Retorne SOMENTE o JSON válido, sem markdown, sem texto adicional, sem explicações.`;

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY não configurada no servidor" },
      { status: 500 },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "corpo da requisição inválido" }, { status: 400 });
  }

  const arquivo = formData.get("arquivo") as File | null;
  if (!arquivo) {
    return NextResponse.json({ error: "campo 'arquivo' obrigatório" }, { status: 400 });
  }
  if (arquivo.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "arquivo muito grande (max 10MB)" },
      { status: 413 },
    );
  }

  const mimeType = arquivo.type || "application/octet-stream";
  if (!MIME_ACEITOS.has(mimeType)) {
    return NextResponse.json(
      { error: `tipo de arquivo não suportado: ${mimeType}. Use JPG, PNG, WEBP ou PDF.` },
      { status: 400 },
    );
  }

  const bytes = await arquivo.arrayBuffer();
  const buffer = Buffer.from(bytes);
  if (!fileMatchesDeclaredMime(buffer, mimeType)) {
    return NextResponse.json({ error: "conteudo do arquivo invalido" }, { status: 400 });
  }
  const base64 = buffer.toString("base64");

  // Persiste o arquivo em uploads/nf/ (fora do public — não exposto diretamente).
  let nfAnexoPath: string | null = null;
  try {
    const uploadDir = path.join(process.cwd(), "uploads", "nf");
    await mkdir(uploadDir, { recursive: true });
    const ext = arquivo.name.split(".").pop() ?? "bin";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);
    nfAnexoPath = path.join("uploads", "nf", filename);
  } catch {
    // Falha de escrita não deve bloquear a extração; apenas não teremos o arquivo salvo.
    nfAnexoPath = null;
  }

  const client = new OpenAI({ apiKey });

  // PDFs precisam entrar como input_file na Responses API; image_url aceita
  // apenas tipos de imagem. Para JPG/PNG/WEBP seguimos com data URL.
  const conteudo =
    mimeType === "application/pdf"
      ? [
          {
            type: "input_file" as const,
            filename: arquivo.name,
            file_data: `data:application/pdf;base64,${base64}`,
          },
          {
            type: "input_text" as const,
            text: PROMPT_EXTRACAO,
          },
        ]
      : [
          {
            type: "input_image" as const,
            image_url: `data:${mimeType === "image/jpg" ? "image/jpeg" : mimeType};base64,${base64}`,
            detail: "high" as const,
          },
          {
            type: "input_text" as const,
            text: PROMPT_EXTRACAO,
          },
        ];

  let jsonText = "";
  try {
    const resposta = await client.responses.create({
      model: "gpt-4o",
      input: [{ role: "user", content: conteudo }],
      text: {
        format: {
          type: "json_object",
        },
      },
    });
    jsonText = resposta.output_text.trim();
  } catch (e) {
    console.error("[nf-extract] erro OpenAI:", e);
    return NextResponse.json({ error: "falha ao analisar documento com IA" }, { status: 502 });
  }

  // Limpa possível markdown que o modelo ainda retorne.
  const limpo = jsonText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let dados: Record<string, unknown>;
  try {
    dados = JSON.parse(limpo);
  } catch {
    console.error("[nf-extract] JSON inválido retornado pelo modelo:", jsonText);
    return NextResponse.json(
      {
        error: "não foi possível extrair dados da nota fiscal",
        ...(process.env.NODE_ENV !== "production" ? { raw: jsonText } : {}),
      },
      { status: 422 },
    );
  }

  const sugestaoConta = await contasService.sugerirPorDocumento({
    fornecedor:
      typeof dados.fornecedor === "string" ? dados.fornecedor : null,
    cnpj: typeof dados.cnpj === "string" ? dados.cnpj : null,
    valor: typeof dados.valor === "number" ? dados.valor : null,
    vencimento:
      typeof dados.vencimento === "string" ? dados.vencimento : null,
    numero: typeof dados.numero === "string" ? dados.numero : null,
  });

  return NextResponse.json({
    ...dados,
    nfAnexo: nfAnexoPath,
    nfNome: arquivo.name,
    sugestaoConta,
  });
}
