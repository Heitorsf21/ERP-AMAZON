/**
 * Catch-up: puxa todos os pedidos das últimas 24h diretamente da SP-API.
 * Roda fora do worker para não disputar rate limit.
 */
import { syncOrders } from "@/modules/amazon/service";
import { subHours } from "date-fns";

async function main() {
  console.log("Iniciando catch-up das últimas 24h...\n");

  // Vai em janelas de 6h para não estourar a quota de uma vez
  const agora = new Date();
  const janelas = [
    { label: "0-6h atrás",   since: subHours(agora, 6),  end: agora },
    { label: "6-12h atrás",  since: subHours(agora, 12), end: subHours(agora, 6) },
    { label: "12-18h atrás", since: subHours(agora, 18), end: subHours(agora, 12) },
    { label: "18-24h atrás", since: subHours(agora, 24), end: subHours(agora, 18) },
  ];

  for (const j of janelas) {
    try {
      console.log(`[${j.label}]`);
      const r = await syncOrders(1, { since: j.since, maxPages: 3 });
      console.log(`  lidas=${r.lidas} criadas=${r.criadas} atualizadas=${r.atualizadas}`);
      if (r.rateLimited) {
        console.log("  ⚠ Rate limit atingido — aguarde e rode novamente");
        break;
      }
      // Pausa entre janelas para respeitar rate limit (1 req/min)
      if (j !== janelas[janelas.length - 1]) {
        console.log("  aguardando 65s para próxima janela...");
        await new Promise((r) => setTimeout(r, 65_000));
      }
    } catch (e) {
      console.error(`  erro: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }

  console.log("\nCatch-up concluído.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
