import { NextRequest } from "next/server";
import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import {
  listReviewProductToggles,
  toggleProdutoReviews,
} from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth(async () => {
  const produtos = await listReviewProductToggles();
  return ok(produtos);
});

export const PATCH = handleAuth(
  [UsuarioRole.OPERADOR],
  async (req: NextRequest) => {
    const body = (await req.json().catch(() => ({}))) as {
      produtoId?: string;
      ativo?: boolean;
    };

    if (!body.produtoId || typeof body.ativo !== "boolean") {
      throw new Error("produtoId e ativo (boolean) são obrigatórios");
    }

    const produto = await toggleProdutoReviews(body.produtoId, body.ativo);
    return ok(produto);
  },
);
