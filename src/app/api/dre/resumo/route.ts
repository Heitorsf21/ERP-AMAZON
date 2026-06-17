import { NextRequest } from "next/server";
import { fromZonedTime } from "date-fns-tz";
import { ok } from "@/lib/api";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  calcularDreCaixa,
  calcularDreCompetencia,
} from "@/modules/dre/service";

export const dynamic = "force-dynamic";

const TZ = "America/Sao_Paulo";

function inicioDia(ano: number, mes: number, dia: number): Date {
  return fromZonedTime(new Date(ano, mes, dia, 0, 0, 0), TZ);
}

function fimDia(ano: number, mes: number, dia: number): Date {
  return fromZonedTime(new Date(ano, mes, dia, 23, 59, 59, 999), TZ);
}

type Regime = "competencia" | "caixa";

function parseRegime(value: string | null): Regime {
  return value === "caixa" ? "caixa" : "competencia";
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(UsuarioRole.FINANCEIRO);
  } catch (e) {
    if (e instanceof Response) return e;
    logger.error({ err: e }, "[dre/resumo] auth falhou");
    throw e;
  }
  const { searchParams } = req.nextUrl;

  const regime = parseRegime(searchParams.get("regime"));
  const modo = searchParams.get("modo"); // "mensal" para visão anual

  if (modo === "mensal") {
    const ano = parseInt(
      searchParams.get("ano") ?? String(new Date().getFullYear()),
    );
    const meses = [];
    for (let m = 0; m < 12; m++) {
      const de = inicioDia(ano, m, 1);
      const ate = fimDia(ano, m + 1, 0);
      // Não processar meses no futuro
      if (de > new Date()) {
        meses.push({
          mes: m + 1,
          nome: de.toLocaleDateString("pt-BR", { month: "short" }),
          de: de.toISOString().split("T")[0],
          ate: ate.toISOString().split("T")[0],
          vazio: true,
        });
        continue;
      }
      const dre =
        regime === "caixa"
          ? await calcularDreCaixa(de, ate)
          : await calcularDreCompetencia(de, ate);
      meses.push({
        mes: m + 1,
        nome: de.toLocaleDateString("pt-BR", { month: "short" }),
        de: de.toISOString().split("T")[0],
        ate: ate.toISOString().split("T")[0],
        vazio: false,
        ...dre,
      });
    }
    return ok({ ano, regime, meses });
  }

  // Modo padrão — período personalizado
  const hoje = new Date();
  const inicioMes = inicioDia(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimMes = fimDia(hoje.getFullYear(), hoje.getMonth() + 1, 0);

  const deStr = searchParams.get("de");
  const ateStr = searchParams.get("ate");

  const de = deStr ? fromZonedTime(new Date(deStr + "T00:00:00"), TZ) : inicioMes;
  const ate = ateStr
    ? fromZonedTime(new Date(ateStr + "T23:59:59"), TZ)
    : fimMes;

  const dre =
    regime === "caixa"
      ? await calcularDreCaixa(de, ate)
      : await calcularDreCompetencia(de, ate);

  return ok({
    periodo: {
      de: de.toISOString().split("T")[0],
      ate: ate.toISOString().split("T")[0],
    },
    regime,
    ...dre,
  });
}
