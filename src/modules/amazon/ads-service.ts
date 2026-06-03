/**
 * Service helpers para Amazon Advertising API.
 *
 * Mantemos separado de service.ts (SP-API) porque:
 *  - Auth tem refresh_token diferente (scope Ads).
 *  - Config keys nao devem se misturar com `amazon_*` da SP-API.
 *  - Endpoint, rate limits e modelo de profileId sao distintos.
 *
 * Convencao de chaves em ConfiguracaoSistema:
 *  - amazon_ads_client_id     (texto)
 *  - amazon_ads_client_secret (cifrado via crypto: contem `_secret`)
 *  - amazon_ads_refresh_token (cifrado via crypto: contem `_token`)
 *  - amazon_ads_profile_id    (texto)
 *  - amazon_ads_endpoint      (texto, opcional override regional)
 */

import { db } from "@/lib/db";
import { getEmpresaId } from "@/lib/tenant-context";
import {
  decryptConfigValue,
  encryptConfigValue,
  isSecretConfigKey,
} from "@/lib/crypto";
import type { AdsAPICredentials } from "@/lib/amazon-ads-api";

export const ADS_CONFIG_KEYS = [
  "amazon_ads_client_id",
  "amazon_ads_client_secret",
  "amazon_ads_refresh_token",
  "amazon_ads_profile_id",
  "amazon_ads_endpoint",
] as const;

export type AdsConfigKey = (typeof ADS_CONFIG_KEYS)[number];

export const ADS_REQUIRED_CONFIG_KEYS = [
  "amazon_ads_client_id",
  "amazon_ads_client_secret",
  "amazon_ads_refresh_token",
] as const;

export type AmazonAdsCredentialsOptions = {
  requireProfile?: boolean;
};

export function canUseLegacyAdsFallback(empresaId?: string | null): boolean {
  if (!empresaId) return true;
  return empresaId === (process.env.WORKER_EMPRESA_ID || "mundofs");
}

export async function getAmazonAdsConfig(): Promise<Record<string, string>> {
  const registros = await db.configuracaoSistema.findMany({
    where: { chave: { in: [...ADS_CONFIG_KEYS] } },
  });
  const config: Record<string, string> = {};
  for (const r of registros) {
    config[r.chave] = decryptConfigValue(r.valor) ?? "";
  }

  config.amazon_ads_client_id ||= process.env.AMAZON_ADS_CLIENT_ID ?? "";
  config.amazon_ads_client_secret ||= process.env.AMAZON_ADS_CLIENT_SECRET ?? "";
  config.amazon_ads_refresh_token ||= process.env.AMAZON_ADS_REFRESH_TOKEN ?? "";
  config.amazon_ads_profile_id ||= process.env.AMAZON_ADS_PROFILE_ID ?? "";
  config.amazon_ads_endpoint ||= process.env.AMAZON_ADS_ENDPOINT ?? "";

  return config;
}

export async function getAmazonAdsAppCredentials(config?: Record<string, string>): Promise<{
  clientId: string;
  clientSecret: string;
}> {
  const cfg = config ?? (await getAmazonAdsConfig());
  const oauthClientId = process.env.AMAZON_ADS_OAUTH_CLIENT_ID?.trim();
  const oauthClientSecret = process.env.AMAZON_ADS_OAUTH_CLIENT_SECRET?.trim();
  if (oauthClientId || oauthClientSecret) {
    if (!oauthClientId || !oauthClientSecret) {
      throw new Error(
        "AMAZON_ADS_OAUTH_CLIENT_ID e AMAZON_ADS_OAUTH_CLIENT_SECRET devem ser definidos juntos.",
      );
    }
    return { clientId: oauthClientId, clientSecret: oauthClientSecret };
  }

  const envClientId = process.env.AMAZON_ADS_CLIENT_ID?.trim();
  const envClientSecret = process.env.AMAZON_ADS_CLIENT_SECRET?.trim();
  if (envClientId || envClientSecret) {
    if (!envClientId || !envClientSecret) {
      throw new Error(
        "AMAZON_ADS_CLIENT_ID e AMAZON_ADS_CLIENT_SECRET devem ser definidos juntos.",
      );
    }
    return { clientId: envClientId, clientSecret: envClientSecret };
  }

  const clientId = cfg.amazon_ads_client_id || "";
  const clientSecret = cfg.amazon_ads_client_secret || "";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Credenciais do app Amazon Ads ausentes (clientId/clientSecret).",
    );
  }

  return { clientId, clientSecret };
}

export function isAmazonAdsConfigured(config: Record<string, string>) {
  return ADS_REQUIRED_CONFIG_KEYS.every((key) => !!config[key]);
}

export async function saveAmazonAdsConfig(
  updates: Record<string, string>,
): Promise<void> {
  for (const [chave, valor] of Object.entries(updates)) {
    if (!ADS_CONFIG_KEYS.includes(chave as AdsConfigKey)) continue;

    // GET da tela retorna mascarado; ignora reescrita sem alteracao.
    if (isSecretConfigKey(chave) && valor.includes("*")) continue;

    if (!valor) {
      await db.configuracaoSistema.deleteMany({ where: { chave } });
    } else {
      const armazenado = isSecretConfigKey(chave)
        ? encryptConfigValue(valor)
        : valor;
      await db.configuracaoSistema.upsert({
        where: { chave },
        create: { chave, valor: armazenado },
        update: { valor: armazenado },
      });
    }
  }
}

export function buildAdsCredentials(
  config: Record<string, string>,
  options: AmazonAdsCredentialsOptions = {},
): AdsAPICredentials | null {
  if (!isAmazonAdsConfigured(config)) return null;
  if (options.requireProfile && !config.amazon_ads_profile_id) return null;
  return {
    clientId: config.amazon_ads_client_id as string,
    clientSecret: config.amazon_ads_client_secret as string,
    refreshToken: config.amazon_ads_refresh_token as string,
    profileId: config.amazon_ads_profile_id || undefined,
    endpoint: config.amazon_ads_endpoint || undefined,
  };
}

export async function resolverAdsCredenciaisDaConta(
  empresaId: string,
  options: AmazonAdsCredentialsOptions = {},
): Promise<AdsAPICredentials | null> {
  const conta = await db.amazonAccount.findFirst({
    where: { empresaId, ativa: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!conta?.adsRefreshTokenEnc) return null;
  if (options.requireProfile && !conta.adsProfileId) return null;

  const refreshToken = decryptConfigValue(conta.adsRefreshTokenEnc) ?? "";
  if (!refreshToken) return null;

  const config = await getAmazonAdsConfig();
  const app = await getAmazonAdsAppCredentials(config);
  return {
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    refreshToken,
    profileId: conta.adsProfileId || undefined,
    endpoint:
      conta.adsEndpoint ||
      config.amazon_ads_endpoint ||
      process.env.AMAZON_ADS_ENDPOINT ||
      undefined,
  };
}

export async function getAmazonAdsCredentials(
  options: AmazonAdsCredentialsOptions = {},
): Promise<AdsAPICredentials | null> {
  const empresaId = getEmpresaId();
  if (empresaId) {
    const contaCreds = await resolverAdsCredenciaisDaConta(empresaId, options);
    if (contaCreds) return contaCreds;
    if (!canUseLegacyAdsFallback(empresaId)) return null;
  }

  const config = await getAmazonAdsConfig();
  return buildAdsCredentials(config, options);
}
