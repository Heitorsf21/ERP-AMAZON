import { NextRequest, NextResponse } from "next/server";
import { handle, ok } from "@/lib/api";
import { enqueueAmazonSyncJob } from "@/modules/amazon/jobs";
import { processAmazonSyncJobs } from "@/modules/amazon/worker";
import { TipoAmazonSyncJob } from "@/modules/shared/domain";

export const dynamic = "force-dynamic";

// Chamado pelo Vercel Cron uma vez por dia (ver vercel.json).
// Vercel envia o header `authorization: Bearer <CRON_SECRET>` quando a env var existe.
// Em execução manual via UI, aceita também um token no body ou query para testes locais.
export const POST = handle(async (req: NextRequest) => {
  const auth = verifyCronRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ erro: auth.motivo }, { status: 401 });
  }

  const resultado = await enqueueReviewJobs();
  return ok(resultado);
});

// Vercel também pode chamar via GET — aceitamos ambos.
export const GET = handle(async (req: NextRequest) => {
  const auth = verifyCronRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ erro: auth.motivo }, { status: 401 });
  }

  const resultado = await enqueueReviewJobs();
  return ok(resultado);
});

async function enqueueReviewJobs() {
  const discovery = await enqueueAmazonSyncJob(
    TipoAmazonSyncJob.REVIEWS_DISCOVERY,
    {},
    {
      priority: 50,
      dedupeKey: `cron:${TipoAmazonSyncJob.REVIEWS_DISCOVERY}:${Math.floor(Date.now() / (24 * 60 * 60_000))}`,
      dedupeAnyStatus: true,
    },
  );
  const send = await enqueueAmazonSyncJob(
    TipoAmazonSyncJob.REVIEWS_SEND,
    {},
    {
      priority: 49,
      dedupeKey: `cron:${TipoAmazonSyncJob.REVIEWS_SEND}:${Math.floor(Date.now() / (60 * 60_000))}`,
      dedupeAnyStatus: true,
    },
  );
  const worker = await processAmazonSyncJobs({ limit: 2, schedule: false });
  return { queued: true, jobs: [discovery, send], worker };
}

function verifyCronRequest(req: NextRequest): { ok: boolean; motivo?: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Sem secret configurado: só aceita em desenvolvimento.
    if (process.env.NODE_ENV !== "production") return { ok: true };
    return { ok: false, motivo: "CRON_SECRET não configurado" };
  }

  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return { ok: true };
  return { ok: false, motivo: "Token inválido" };
}
