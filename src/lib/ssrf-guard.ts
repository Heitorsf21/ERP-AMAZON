// Guard contra SSRF para URLs/endpoints configuráveis.
//
// Limitação consciente: não resolvemos DNS (sem checagem do IP resolvido), então
// é defesa por host/esquema, não anti-rebinding completo. Mesmo assim fecha os
// vetores reais do audit: (1) endpoint da SP-API trocado para host não-Amazon
// vazando o token LWA; (2) URL do WAHA apontada para esquema perigoso.

const AMAZON_HOST_SUFFIXES = [
  ".amazon.com",
  ".amazon.com.br",
  ".amazon.co.uk",
  ".amazon.co.jp",
  ".amazon.de",
  ".amazon.es",
  ".amazon.fr",
  ".amazon.it",
  ".amazon.ca",
];

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reservado
  return false;
}

export function isPrivateOrReservedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "metadata.google.internal") return true;
  // IPv6 loopback (::1), link-local (fe80::/10) e ULA (fc00::/7 → fc.., fd..)
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) {
    if (h.includes(":")) return true;
  }
  return isPrivateIPv4(h);
}

export function isAllowedAmazonHost(
  hostname: string,
  allowedSuffixes: string[] = AMAZON_HOST_SUFFIXES,
): boolean {
  const h = hostname.toLowerCase();
  if (isPrivateOrReservedHost(h)) return false;
  return allowedSuffixes.some((sfx) => h === sfx.replace(/^\./, "") || h.endsWith(sfx));
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`[ssrf-guard] URL inválida: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`[ssrf-guard] esquema não permitido: ${url.protocol}`);
  }
  return url;
}

/**
 * Valida que `endpoint` é um host oficial da Amazon (SP-API / Ads / LWA). Usado
 * ANTES de enviar o access token LWA — impede que um endpoint mal configurado
 * exfiltre o token para um host arbitrário. Lança em caso inválido.
 */
export function assertAmazonEndpoint(
  endpoint: string,
  allowedSuffixes: string[] = AMAZON_HOST_SUFFIXES,
): URL {
  const url = parseHttpUrl(endpoint);
  if (!isAllowedAmazonHost(url.hostname, allowedSuffixes)) {
    throw new Error(
      `[ssrf-guard] endpoint Amazon não permitido: ${url.hostname}. ` +
        `Use um host oficial (ex: sellingpartnerapi-na.amazon.com).`,
    );
  }
  return url;
}

/**
 * Guard genérico para URLs http(s) configuráveis (ex: WAHA). Valida o esquema e,
 * se `allowedHosts` for informado, exige que o host:porta esteja na lista. NÃO
 * bloqueia IP privado por padrão (o WAHA legítimo roda em 127.0.0.1) — para
 * travar, configure `allowedHosts`.
 */
export function assertSafeHttpUrl(
  raw: string,
  opts: { allowedHosts?: string[] } = {},
): URL {
  const url = parseHttpUrl(raw);
  const allow = (opts.allowedHosts ?? []).map((h) => h.toLowerCase().trim()).filter(Boolean);
  if (allow.length > 0) {
    const host = url.host.toLowerCase(); // inclui porta
    const hostname = url.hostname.toLowerCase();
    if (!allow.includes(host) && !allow.includes(hostname)) {
      throw new Error(`[ssrf-guard] host fora da allowlist: ${url.host}`);
    }
  }
  return url;
}

/** Lê uma lista separada por vírgula de uma env var (host[:porta]). */
export function parseHostAllowlistEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
