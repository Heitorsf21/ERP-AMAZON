/**
 * Helpers para resolver URL de imagem de produto Amazon.
 *
 * Ordem de preferência:
 *   1. imagemUrl manual (upload do usuário, servido por /api/produtos/[id]/imagem)
 *   2. amazonImagemUrl da Catalog Items API (quando o app SP-API tem role autorizada)
 *   3. URL pública via ASIN (último recurso — pode retornar pixel placeholder)
 *
 * Nota: a URL pública `images-na.ssl-images-amazon.com/images/P/{asin}` muitas
 * vezes serve um pixel transparente de 43 bytes quando o produto não está
 * indexado naquele CDN. O componente <ProdutoThumbnail> detecta isso via
 * naturalWidth e troca pelo ícone de placeholder.
 */

const AMAZON_IMAGE_HOST = "https://images-na.ssl-images-amazon.com/images/P";

export function imagemDoAsin(asin: string | null | undefined): string | null {
  if (!asin) return null;
  return `${AMAZON_IMAGE_HOST}/${encodeURIComponent(asin)}.01._SCLZZZZZZZ_SL300_.jpg`;
}

export function resolverImagemProduto(
  amazonImagemUrl: string | null | undefined,
  asin: string | null | undefined,
  imagemUrlManual?: string | null,
): string | null {
  if (imagemUrlManual && imagemUrlManual.trim()) return imagemUrlManual;
  if (amazonImagemUrl && amazonImagemUrl.trim()) return amazonImagemUrl;
  return imagemDoAsin(asin);
}
