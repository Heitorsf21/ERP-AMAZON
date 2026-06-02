// Next.js instrumentation — roda UMA vez no boot do servidor.
// Usamos para os guards de segurança fail-fast (ver src/lib/startup-checks.ts):
// em produção, abortar o boot se faltarem segredos obrigatórios ou se o
// isolamento multi-tenant estiver desligado com mais de uma empresa cadastrada.
export async function register() {
  // Só pula explicitamente no Edge; em Node o NEXT_RUNTIME pode vir "nodejs" ou
  // ausente dependendo da fase do Next.
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { runStartupChecks } = await import("@/lib/startup-checks");
  await runStartupChecks();
}
