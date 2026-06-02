import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import { auditLog, redactForAudit } from "@/lib/audit";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { isMaskedSecret, maskSecretForDisplay } from "@/lib/crypto";
import {
  ADS_CONFIG_KEYS,
  getAmazonAdsConfig,
  isAmazonAdsConfigured,
  saveAmazonAdsConfig,
} from "@/modules/amazon/ads-service";

export const dynamic = "force-dynamic";

const isSecretKey = (key: string) => key.includes("secret") || key.includes("token");

export const GET = handle(async () => {
  const config = await getAmazonAdsConfig();
  const safe: Record<string, string> = {};
  for (const key of ADS_CONFIG_KEYS) {
    const val = config[key] ?? "";
    // Segredos: máscara FIXA (não vaza tamanho nem últimos 4 caracteres).
    safe[key] = isSecretKey(key) ? maskSecretForDisplay(val) : val;
  }
  return ok({ config: safe, configurado: isAmazonAdsConfigured(config) });
});

export const POST = handle(async (req: NextRequest) => {
  const session = await requireRole(UsuarioRole.ADMIN);
  const antes = await getAmazonAdsConfig();
  const body = (await req.json()) as Record<string, string>;
  const updates: Record<string, string> = {};
  for (const key of ADS_CONFIG_KEYS) {
    if (!(key in body)) continue;
    const value = String(body[key] ?? "");
    // Preserva o segredo existente quando a UI reenvia a máscara (********):
    // não sobrescreve com asteriscos.
    if (isSecretKey(key) && isMaskedSecret(value)) continue;
    updates[key] = value;
  }
  await saveAmazonAdsConfig(updates);
  const depois = await getAmazonAdsConfig();
  await auditLog({
    session,
    req,
    acao: "CONFIG_ATUALIZADA",
    entidade: "AmazonAdsConfig",
    antes: redactForAudit(antes),
    depois: redactForAudit(depois),
    metadata: { chaves: Object.keys(updates) },
  });
  return ok({ ok: true });
});
