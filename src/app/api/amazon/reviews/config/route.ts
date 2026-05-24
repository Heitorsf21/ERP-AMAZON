import { NextRequest } from "next/server";
import { handleAuth, ok } from "@/lib/api";
import { UsuarioRole } from "@/lib/auth";
import {
  getReviewAutomationConfig,
  setReviewAutomationSettings,
} from "@/modules/amazon/service";

export const dynamic = "force-dynamic";

export const GET = handleAuth([UsuarioRole.ADMIN], async () => {
  const config = await getReviewAutomationConfig();
  return ok(config);
});

export const PATCH = handleAuth(
  [UsuarioRole.ADMIN],
  async (req: NextRequest) => {
    const body = (await req.json().catch(() => ({}))) as {
      automacaoAtiva?: boolean;
      backfillStartDate?: string;
      delayDays?: number;
      dailyBatchSize?: number;
    };
    if (
      body.automacaoAtiva != null &&
      typeof body.automacaoAtiva !== "boolean"
    ) {
      throw new Error("automacaoAtiva deve ser boolean");
    }
    const config = await setReviewAutomationSettings(body);
    return ok(config);
  },
);
