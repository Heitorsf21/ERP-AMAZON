/**
 * Configura o resumo diario de estoque via WhatsApp (WAHA) e opcionalmente
 * dispara um envio de TESTE imediato.
 *
 * Carrega o .env com o mesmo loader do Next (igual ao amazon-worker.ts) ANTES
 * de importar qualquer modulo que toque em env/db, para garantir
 * CONFIG_ENCRYPTION_KEY (cifra a API key) e DATABASE_URL.
 *
 * A API key NUNCA e hardcoded aqui: vem da env WAHA_SETUP_API_KEY em runtime.
 *
 * Uso:
 *   WAHA_SETUP_API_KEY=xxxx npx tsx scripts/whatsapp-estoque-config.ts \
 *     --destino 551151085002 \
 *     [--waha-url http://127.0.0.1:3002] \
 *     [--waha-session default] \
 *     [--horario 10:00] \
 *     [--sem-teste] \
 *     [--ativar]
 *
 * Sem --ativar: grava a config com ativo=false (seguro). Com --ativar: so liga
 * ativo=true SE o envio de teste retornar SUCESSO.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import {
  saveWhatsappEstoqueConfig,
  getWhatsappEstoqueConfigPublic,
} from "@/modules/whatsapp-estoque/config";
import { runWhatsappEstoqueResumo } from "@/modules/whatsapp-estoque/jobs";

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}
function flag(nome: string): boolean {
  return process.argv.includes(nome);
}

async function main() {
  const destino = arg("--destino");
  const wahaUrl = arg("--waha-url") ?? "http://127.0.0.1:3002";
  const wahaSession = arg("--waha-session") ?? "default";
  const horario = arg("--horario") ?? "10:00";
  const apiKey = process.env.WAHA_SETUP_API_KEY?.trim();
  const ativar = flag("--ativar");
  const semTeste = flag("--sem-teste");

  if (!destino) {
    console.error("[whatsapp-estoque-config] --destino <numero> e obrigatorio");
    process.exit(1);
  }

  // 1) Grava a config sempre com ativo=false primeiro (seguro).
  await saveWhatsappEstoqueConfig({
    ativo: false,
    horario,
    destinatario: destino,
    wahaUrl,
    wahaSession,
    // So escreve a API key se foi fornecida; sem ela, preserva a ja existente.
    ...(apiKey ? { wahaApiKey: apiKey } : {}),
  });

  const publica = await getWhatsappEstoqueConfigPublic();
  console.log("[whatsapp-estoque-config] Config gravada (ativo=false):");
  console.log(JSON.stringify(publica, null, 2));

  if (semTeste) {
    console.log("[whatsapp-estoque-config] --sem-teste: pulando envio de teste.");
    if (ativar) {
      await saveWhatsappEstoqueConfig({ ativo: true });
      console.log("[whatsapp-estoque-config] ativo=true gravado (sem teste).");
    }
    process.exit(0);
  }

  // 2) Dispara envio de TESTE.
  console.log("[whatsapp-estoque-config] Disparando envio de TESTE...");
  const resultado = await runWhatsappEstoqueResumo({ tipo: "TESTE" });
  console.log("[whatsapp-estoque-config] Resultado do teste:");
  console.log(JSON.stringify(resultado, null, 2));

  if (resultado.status !== "SUCESSO") {
    console.error(
      `[whatsapp-estoque-config] Teste NAO enviado (status=${resultado.status}). ativo permanece false.`,
    );
    process.exit(2);
  }

  // 3) Sucesso: opcionalmente liga ativo=true.
  if (ativar) {
    await saveWhatsappEstoqueConfig({ ativo: true });
    console.log(
      "[whatsapp-estoque-config] Teste OK + --ativar: ativo=true gravado. Resumo diario habilitado.",
    );
  } else {
    console.log(
      "[whatsapp-estoque-config] Teste OK. ativo continua false (rode com --ativar para habilitar o diario).",
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(
    "[whatsapp-estoque-config] Falhou:",
    e instanceof Error ? e.stack ?? e.message : String(e),
  );
  process.exit(1);
});
