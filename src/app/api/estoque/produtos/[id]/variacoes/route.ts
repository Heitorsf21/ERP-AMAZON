import { z } from "zod";
import { handle, ok, erro } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { TipoAuditLog } from "@/modules/shared/domain";

type Params = { params: Promise<{ id: string }> };

const criarVariacaoSchema = z.object({
  produtoFilhoId: z.string().min(1).optional().nullable(),
  skuFilho: z.string().min(1).max(80).optional().nullable(),
  nome: z.string().max(200).optional().nullable(),
  tipo: z.string().max(80).optional().nullable(),
  atributos: z.record(z.unknown()).optional().nullable(),
});

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Params) => {
  const { id } = await params;
  const variacoes = await db.produtoVariacao.findMany({
    where: { produtoPaiId: id },
    include: {
      produtoFilho: {
        select: { id: true, sku: true, nome: true, asin: true, ativo: true },
      },
    },
    orderBy: [{ skuFilho: "asc" }, { criadoEm: "asc" }],
  });
  return ok(variacoes);
});

export const POST = handle(async (req: Request, { params }: Params) => {
  const session = await requireRole(UsuarioRole.ADMIN, UsuarioRole.OPERADOR);
  const { id } = await params;
  const body = criarVariacaoSchema.parse(await req.json());

  const produtoPai = await db.produto.findUnique({
    where: { id },
    select: { id: true, sku: true },
  });
  if (!produtoPai) return erro(404, "produto pai nao encontrado");

  const produtoFilho = body.produtoFilhoId
    ? await db.produto.findUnique({
        where: { id: body.produtoFilhoId },
        select: { id: true, sku: true, nome: true },
      })
    : null;

  if (body.produtoFilhoId && !produtoFilho) {
    return erro(404, "produto filho nao encontrado");
  }

  const skuFilho = produtoFilho?.sku ?? body.skuFilho ?? null;
  const variacao = await db.produtoVariacao.create({
    data: {
      produtoPaiId: produtoPai.id,
      produtoFilhoId: produtoFilho?.id ?? null,
      skuPai: produtoPai.sku,
      skuFilho,
      nome: body.nome ?? produtoFilho?.nome ?? null,
      tipo: body.tipo ?? null,
      atributosJson: body.atributos ? JSON.stringify(body.atributos) : null,
    },
  });

  await auditLog({
    session,
    req,
    acao: TipoAuditLog.PRODUTO_VARIACAO_CRIADA,
    entidade: "ProdutoVariacao",
    entidadeId: variacao.id,
    depois: variacao,
  });

  return ok(variacao, { status: 201 });
});
