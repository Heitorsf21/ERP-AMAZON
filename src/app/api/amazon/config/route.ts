import { NextRequest } from "next/server";
import { handle, ok } from "@/lib/api";
import {
  AMAZON_CONFIG_KEYS,
  getAmazonConfig,
  isAmazonConfigured,
  saveAmazonConfig,
} from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const config = await getAmazonConfig();
  // Mascarar chaves secretas na resposta
  const safe: Record<string, string> = {};
  for (const key of AMAZON_CONFIG_KEYS) {
    const val = config[key] ?? "";
    if (
      val &&
      (key.includes("secret") || key.includes("token"))
    ) {
      safe[key] = val.length > 8 ? `${"*".repeat(val.length - 4)}${val.slice(-4)}` : "****";
    } else {
      safe[key] = val;
    }
  }
  return ok({ config: safe, configurado: isAmazonConfigured(config) });
});

export const POST = handle(async (req: NextRequest) => {
  const body = await req.json() as Record<string, string>;
  // Aceitar apenas chaves conhecidas; ignorar campos extras
  const updates: Record<string, string> = {};
  for (const key of AMAZON_CONFIG_KEYS) {
    if (key in body) updates[key] = String(body[key] ?? "");
  }
  await saveAmazonConfig(updates);
  return ok({ ok: true });
});
