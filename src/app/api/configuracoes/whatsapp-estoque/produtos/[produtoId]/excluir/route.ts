import { handleAuth, ok, erro } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  excluirProdutoDoResumo,
  reativarProdutoNoResumo,
} from "@/modules/whatsapp-estoque/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ produtoId: string }> };

/** Marca o produto como excluido do resumo de estoque. */
export const POST = handleAuth(
  [UsuarioRole.ADMIN],
  async (_req: Request, { params }: Params) => {
    const { produtoId } = await params;
    const produto = await db.produto.findUnique({
      where: { id: produtoId },
      select: { sku: true },
    });
    if (!produto) return erro(404, "produto nao encontrado");

    await excluirProdutoDoResumo(produtoId, produto.sku);
    return ok({ produtoId, excluido: true });
  },
);

/** Reativa o produto no resumo de estoque. */
export const DELETE = handleAuth(
  [UsuarioRole.ADMIN],
  async (_req: Request, { params }: Params) => {
    const { produtoId } = await params;
    await reativarProdutoNoResumo(produtoId);
    return ok({ produtoId, excluido: false });
  },
);
