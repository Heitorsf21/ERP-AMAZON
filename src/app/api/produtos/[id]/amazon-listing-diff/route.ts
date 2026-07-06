import { handle, ok } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { assertEmpresaPrimaria, requireRole, UsuarioRole } from "@/lib/auth";
import { getProdutoAmazonListingDiff } from "@/modules/amazon/listings-diff";
import { TipoAuditLog } from "@/modules/shared/domain";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, { params }: Params) => {
  const session = await requireRole(
    UsuarioRole.ADMIN,
    UsuarioRole.OPERADOR,
    UsuarioRole.FINANCEIRO,
    UsuarioRole.LEITURA,
  );
  // O diff consulta a Listings API com a credencial SP-API GLOBAL legada
  // (ConfiguracaoSistema da empresa primária) — outra empresa não a usa.
  assertEmpresaPrimaria(session);
  const { id } = await params;
  const diff = await getProdutoAmazonListingDiff(id);

  await auditLog({
    session,
    req,
    acao: TipoAuditLog.LISTING_DIFF_CONSULTADO,
    entidade: "Produto",
    entidadeId: id,
    metadata: { sku: diff.produto.sku, sellerId: diff.amazon.sellerId },
  });

  return ok(diff);
});
