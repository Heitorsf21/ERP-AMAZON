// O app instalado não tem botão de recarregar: ao voltar para o primeiro plano,
// as telas de números do dia são atualizadas. O resto fica no cache normal.
const EXATAS = new Set(["vendas", "vendas-totais", "produto-resumo-mobile", "notificacoes-count"]);

export function deveRecarregarAoVoltar(queryKey: readonly unknown[]): boolean {
  const chave = typeof queryKey[0] === "string" ? queryKey[0] : "";
  return EXATAS.has(chave) || chave.startsWith("dashboard-ecommerce-");
}
