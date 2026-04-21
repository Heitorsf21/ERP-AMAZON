import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { processarBuffer } from "@/lib/fba-importer";

export const dynamic = "force-dynamic";

const execAsync = promisify(exec);

const ARQUIVOS = {
  vendas: "reports_sales.xlsx",
  estoque: "reports_fba_stock.xlsx",
  produtos: "products_report.xlsx",
} as const;

type Relatorio = keyof typeof ARQUIVOS;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const relatorio = (searchParams.get("relatorio") ?? "vendas") as
      | Relatorio
      | "todos";
    const de = searchParams.get("de");
    const ate = searchParams.get("ate");

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

    // Monta argumentos do script
    const args: string[] = [];
    if (relatorio !== "todos") args.push("--relatorio", relatorio);
    if (de) args.push("--inicio", de);
    if (ate) args.push("--fim", ate);
    // --espera 0: tenta download direto, checa Gmail imediatamente sem aguardar
    args.push("--espera", "0");

    const cmd = `python "${scriptPath}" ${args.join(" ")}`;

    let scriptLog = "";
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: scriptDir,
        timeout: 120_000, // 2 min
        env: { ...process.env },
      });
      scriptLog = stdout + (stderr ? `\nSTDERR: ${stderr}` : "");
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      scriptLog = (e.stdout ?? "") + "\n" + (e.stderr ?? "") + "\n" + (e.message ?? "");
      console.warn("[sincronizar] script retornou erro:", scriptLog);
      // Continua mesmo com erro — pode ter baixado arquivos parcialmente
    }

    // Identifica quais arquivos tentar importar
    const alvos: Relatorio[] =
      relatorio === "todos"
        ? (Object.keys(ARQUIVOS) as Relatorio[])
        : [relatorio as Relatorio];

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
    console.error("[vendas/sincronizar]", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
