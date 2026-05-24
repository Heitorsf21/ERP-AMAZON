import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { processarBuffer } from "@/lib/fba-importer";
import { requireRole, UsuarioRole } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const ARQUIVOS = {
  vendas: "reports_sales.xlsx",
  estoque: "reports_fba_stock.xlsx",
  produtos: "products_report.xlsx",
} as const;

type Relatorio = keyof typeof ARQUIVOS;

// Datas no formato YYYY-MM-DD (somente). Bloqueia qualquer metacaractere de shell.
const dataIsoSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser YYYY-MM-DD");

const querySchema = z.object({
  relatorio: z.enum(["vendas", "estoque", "produtos", "todos"]).default("vendas"),
  de: dataIsoSchema.optional(),
  ate: dataIsoSchema.optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireRole(UsuarioRole.ADMIN);

    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { erro: "PARAMS_INVALIDOS", detalhes: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { relatorio, de, ate } = parsed.data;

    const scriptDir = process.env.GS_SCRIPT_DIR;
    if (!scriptDir) {
      return NextResponse.json(
        {
          erro: "GS_SCRIPT_DIR não configurado no .env do ERP. Defina o caminho para a pasta do script Python.",
        },
        { status: 503 },
      );
    }

    const scriptPath = path.join(scriptDir, "atualizar_relatorios.py");
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        { erro: `Script não encontrado em: ${scriptPath}` },
        { status: 503 },
      );
    }

    // execFile NÃO interpreta shell — args passados como array são seguros.
    const args: string[] = [scriptPath];
    if (relatorio !== "todos") args.push("--relatorio", relatorio);
    if (de) args.push("--inicio", de);
    if (ate) args.push("--fim", ate);
    args.push("--espera", "0");

    let scriptLog = "";
    try {
      const { stdout, stderr } = await execFileAsync("python", args, {
        cwd: scriptDir,
        timeout: 120_000,
        // Não passa `env: { ...process.env }` — herda o env minimo do parent.
      });
      scriptLog = stdout + (stderr ? `\nSTDERR: ${stderr}` : "");
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      scriptLog = (e.stdout ?? "") + "\n" + (e.stderr ?? "") + "\n" + (e.message ?? "");
      logger.warn({ scriptLog: scriptLog.slice(0, 800) }, "[sincronizar] script retornou erro");
      // Continua mesmo com erro — pode ter baixado arquivos parcialmente.
    }

    const alvos: Relatorio[] =
      relatorio === "todos" ? (Object.keys(ARQUIVOS) as Relatorio[]) : [relatorio];

    const resultados: Record<string, unknown>[] = [];
    const erros: { relatorio: string; erro: string }[] = [];

    for (const rel of alvos) {
      const filePath = path.join(scriptDir, ARQUIVOS[rel]);
      if (!fs.existsSync(filePath)) {
        erros.push({ relatorio: rel, erro: "Arquivo não gerado pelo script" });
        continue;
      }

      try {
        const buffer = fs.readFileSync(filePath);
        const resultado = await processarBuffer(buffer, ARQUIVOS[rel]);
        resultados.push(resultado);
      } catch (err) {
        erros.push({
          relatorio: rel,
          erro: err instanceof Error ? err.message : "Erro ao importar",
        });
      }
    }

    return NextResponse.json({
      scriptLog: scriptLog.slice(0, 2000),
      resultados,
      erros,
    });
  } catch (err) {
    if (err instanceof Response) return err as NextResponse;
    logger.error({ err }, "[vendas/sincronizar] falha inesperada");
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
