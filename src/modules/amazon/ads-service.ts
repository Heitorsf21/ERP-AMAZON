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
  "amazon_ads_profile_id",
] as const;

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
): AdsAPICredentials | null {
  if (!isAmazonAdsConfigured(config)) return null;
  return {
    clientId: config.amazon_ads_client_id as string,
    clientSecret: config.amazon_ads_client_secret as string,
    refreshToken: config.amazon_ads_refresh_token as string,
    profileId: config.amazon_ads_profile_id || undefined,
    endpoint: config.amazon_ads_endpoint || undefined,
  };
}

export async function getAmazonAdsCredentials(): Promise<AdsAPICredentials | null> {
  const config = await getAmazonAdsConfig();
  return buildAdsCredentials(config);
}
