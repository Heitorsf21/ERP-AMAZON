// Hook de boot do Next (App Router). `register()` roda UMA vez no startup do
// servidor. Aqui rodamos os guards de segurança (startup-checks) também no
// processo WEB — antes só o worker fazia (lacuna F04 do audit 2026-06).
//
// runStartupChecks LANÇA em issue fatal (segredo obrigatório ausente, ou
// TENANT_ISOLATION != enforce com >1 empresa) → o boot do web aborta (fail-fast),
// que é o comportamento desejado. Falha transitória de banco é tratada como warn
// lá dentro (não derruba o boot por indisponibilidade momentânea).
export async function register() {
  // Só no runtime Node (edge não tem acesso a Node/DB).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runStartupChecks } = await import("./lib/startup-checks");
  await runStartupChecks();
}
