import { handle, ok, erro } from "@/lib/api";
import { salvarCredenciais, getStatus } from "@/lib/gmail";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: z.string().min(10, "Client ID inválido"),
  clientSecret: z.string().min(5, "Client Secret inválido"),
  redirectUri: z.string().url().optional(),
});

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const { clientId, clientSecret, redirectUri } = schema.parse(body);
  await salvarCredenciais(clientId, clientSecret, redirectUri);
  return ok({ ok: true });
});

export const GET = handle(async () => {
  const status = await getStatus();
  // Mask client_id (only show last 8 chars)
  const { db } = await import("@/lib/db");
  const clientIdRow = await db.configuracaoSistema.findUnique({ where: { chave: "gmail_client_id" } });
  const clientId = clientIdRow?.valor ?? "";
  return ok({
    ...status,
    clientIdMasked: clientId ? `...${clientId.slice(-8)}` : null,
  });
});
