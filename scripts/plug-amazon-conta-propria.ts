/**
 * Pluga em uma Empresa uma conta Amazon com APP LWA PRÓPRIO (self-authorization
 * feita no Developer Console do próprio seller — caso UDN).
 *
 * O modelo multi-seller guarda o grant (refresh token) por conta e, quando o
 * seller tem app próprio, também o client_id/secret cifrados (AmazonAccount.
 * lwaClientIdEnc/lwaClientSecretEnc) — `resolverCredenciaisDaConta` prefere o
 * app da conta e NUNCA cai no app global nesses casos.
 *
 * Uso (na VPS, em /opt/erp-amazon, como usuário erp — precisa do .env com
 * DATABASE_URL e CONFIG_ENCRYPTION_KEY):
 *
 *   printf '%s' "$REFRESH_TOKEN" | \
 *     PLUG_EMPRESA_ID=<cuid da Empresa> \
 *     PLUG_LWA_CLIENT_ID=<amzn1.application-oa2-client....> \
 *     PLUG_LWA_CLIENT_SECRET=<amzn1.oa2-cs....> \
 *     npx tsx scripts/plug-amazon-conta-propria.ts
 *
 * Segurança: refresh token via STDIN (nunca em argv/history); valida o trio
 * na LWA + SP-API ANTES de gravar (aborta em invalid_client/invalid_grant);
 * resolve o sellerId via GET /sellers/v1/account; não imprime segredos.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const MARKETPLACE_BR = "A2Q3Y263D00KWC";
const ENDPOINT_NA = "https://sellingpartnerapi-na.amazon.com";

async function lerStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

async function main() {
  const empresaId = process.env.PLUG_EMPRESA_ID?.trim();
  const clientId = process.env.PLUG_LWA_CLIENT_ID?.trim();
  const clientSecret = process.env.PLUG_LWA_CLIENT_SECRET?.trim();
  const refreshToken = process.env.PLUG_REFRESH?.trim() || (await lerStdin());

  if (!empresaId || !clientId || !clientSecret || !refreshToken) {
    console.error(
      "Faltam dados. Requer PLUG_EMPRESA_ID, PLUG_LWA_CLIENT_ID, PLUG_LWA_CLIENT_SECRET e o refresh token via stdin (ou PLUG_REFRESH).",
    );
    process.exit(1);
  }

  // 1) Smoke LWA: o refresh token TEM que trocar com o app próprio informado.
  const tokenRes = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error(
      `LWA exchange FALHOU (HTTP ${tokenRes.status}) — nada foi gravado. Corpo: ${body.slice(0, 300)}`,
    );
    process.exit(1);
  }
  const accessToken = ((await tokenRes.json()) as { access_token: string })
    .access_token;
  console.log("LWA exchange OK (app próprio + refresh token válidos).");

  // 2) Smoke SP-API + marketplace.
  const partRes = await fetch(
    `${ENDPOINT_NA}/sellers/v1/marketplaceParticipations`,
    { headers: { "x-amz-access-token": accessToken } },
  );
  if (!partRes.ok) {
    console.error(
      `SP-API marketplaceParticipations FALHOU (HTTP ${partRes.status}) — nada foi gravado.`,
    );
    process.exit(1);
  }
  console.log("SP-API OK (marketplaceParticipations 200).");

  // 3) sellerId via GET /sellers/v1/account (participations no BR não traz).
  let sellerId: string | null = null;
  try {
    const accRes = await fetch(`${ENDPOINT_NA}/sellers/v1/account`, {
      headers: { "x-amz-access-token": accessToken },
    });
    if (accRes.ok) {
      const payload = (await accRes.json()) as {
        payload?: { businessAddress?: unknown; merchantId?: string; sellerId?: string };
      };
      const p = payload.payload as Record<string, unknown> | undefined;
      sellerId =
        (p?.sellerId as string | undefined) ??
        (p?.merchantId as string | undefined) ??
        null;
    }
  } catch {
    // opcional — resolverSellerIdDoTenant cobre depois via getSellerId(creds)
  }
  console.log(`sellerId: ${sellerId ?? "(não resolvido — worker resolve depois)"}`);

  // 4) Grava (create/update idempotente).
  const { db } = await import("../src/lib/db");
  const { encryptConfigValue } = await import("../src/lib/crypto");

  const empresa = await db.empresa.findUnique({ where: { id: empresaId } });
  if (!empresa) {
    console.error(`Empresa ${empresaId} não existe — nada foi gravado.`);
    process.exit(1);
  }

  const data = {
    refreshTokenEnc: encryptConfigValue(refreshToken),
    lwaClientIdEnc: encryptConfigValue(clientId),
    lwaClientSecretEnc: encryptConfigValue(clientSecret),
    ...(sellerId ? { sellerId } : {}),
    marketplaceId: MARKETPLACE_BR,
    endpoint: ENDPOINT_NA,
    status: "ATIVA",
    ativa: true,
    conectadoEm: new Date(),
  };

  const existente = await db.amazonAccount.findFirst({ where: { empresaId } });
  if (existente) {
    await db.amazonAccount.update({ where: { id: existente.id }, data });
    console.log(`AmazonAccount ${existente.id} ATUALIZADA para a empresa ${empresa.nome}.`);
  } else {
    const criada = await db.amazonAccount.create({
      data: { empresaId, nome: `${empresa.nome} - Amazon`, ...data },
    });
    console.log(`AmazonAccount ${criada.id} CRIADA para a empresa ${empresa.nome}.`);
  }

  const verificacao = await db.amazonAccount.findFirst({
    where: { empresaId },
    select: {
      id: true,
      status: true,
      ativa: true,
      sellerId: true,
      marketplaceId: true,
      lwaClientIdEnc: true,
      refreshTokenEnc: true,
    },
  });
  console.log(
    JSON.stringify(
      {
        id: verificacao?.id,
        status: verificacao?.status,
        ativa: verificacao?.ativa,
        sellerId: verificacao?.sellerId,
        marketplaceId: verificacao?.marketplaceId,
        appProprio: !!verificacao?.lwaClientIdEnc,
        refreshTokenGravado: !!verificacao?.refreshTokenEnc,
      },
      null,
      2,
    ),
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error("Falha:", e instanceof Error ? e.message : e);
  process.exit(1);
});
