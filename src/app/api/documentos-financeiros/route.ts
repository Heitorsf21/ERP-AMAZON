import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { documentosFinanceirosService } from "@/modules/documentos-financeiros/service";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const TIPOS_VALIDOS = new Set(["BOLETO", "NOTA_FISCAL", "OUTRO"]);
const STATUS_VALIDOS = new Set(["PENDENTE", "VINCULADO_CONTA"]);

function parseDataInicio(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDataFim(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(`${raw}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const busca = url.searchParams.get("busca")?.trim() ?? "";
    const tipoRaw = url.searchParams.get("tipo");
    const statusRaw = url.searchParams.get("statusDossie");
    const de = parseDataInicio(url.searchParams.get("de"));
    const ate = parseDataFim(url.searchParams.get("ate"));

    const semFiltros =
      !busca && !tipoRaw && !statusRaw && !de && !ate;

    if (semFiltros) {
      // Caminho original — preserva contrato existente.
      const dossies = await documentosFinanceirosService.listarDossies();
      return NextResponse.json(dossies);
    }

    const where: Prisma.DossieFinanceiroWhereInput = {};

    if (statusRaw && STATUS_VALIDOS.has(statusRaw)) {
      where.status = statusRaw;
    }

    if (de || ate) {
      where.vencimento = {};
      if (de) (where.vencimento as Prisma.DateTimeFilter).gte = de;
      if (ate) (where.vencimento as Prisma.DateTimeFilter).lte = ate;
    }

    const filtrosDocumentos: Prisma.DocumentoFinanceiroWhereInput[] = [];
    if (tipoRaw && TIPOS_VALIDOS.has(tipoRaw)) {
      filtrosDocumentos.push({ tipo: tipoRaw });
    }
    if (busca) {
      // SQLite: 'contains' já é case-insensitive por padrão (NOCASE collation
      // não está garantida) — para garantir, usamos contains simples; o
      // cliente envia o termo normalizado.
      filtrosDocumentos.push({
        OR: [
          { fornecedorNome: { contains: busca } },
          { numeroDocumento: { contains: busca } },
          { descricao: { contains: busca } },
        ],
      });
    }

    if (filtrosDocumentos.length > 0) {
      where.documentos = { some: { AND: filtrosDocumentos } };
    }

    // Busca também olha campos do próprio dossiê.
    if (busca) {
      where.OR = [
        ...(where.OR ?? []),
        { fornecedorNome: { contains: busca } },
        { numeroDocumento: { contains: busca } },
        { descricao: { contains: busca } },
      ];
    }

    const dossies = await db.dossieFinanceiro.findMany({
      where,
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

    return NextResponse.json(dossies);
  } catch (err) {
    logger.error({ err }, "falha ao listar documentos financeiros");
    return NextResponse.json(
      { error: "falha ao listar documentos financeiros" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const arquivo = formData.get("arquivo");
    const senhaPdfRaw = formData.get("senhaPdf");

    if (!(arquivo instanceof File)) {
      return NextResponse.json(
        { error: "arquivo obrigatorio" },
        { status: 400 },
      );
    }

    const senhaPdf = typeof senhaPdfRaw === "string" ? senhaPdfRaw : undefined;
    const resultado = await documentosFinanceirosService.processarUpload({
      arquivo,
      senhaPdf,
    });

    return NextResponse.json(resultado, { status: resultado.duplicado ? 200 : 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha ao processar documento";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
