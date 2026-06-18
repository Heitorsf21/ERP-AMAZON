import { describe, it, expect, afterEach, beforeAll } from "vitest";

// Aponta o singleton `db` para o SQLite local ANTES de importar @/lib/db.
// (mesmo padrão do empresas.integration.test.ts)
process.env.DATABASE_URL ||= "file:./prisma/dev.db";

let db: typeof import("@/lib/db").db;
let custo: typeof import("./custo-historico");

const PRODUTO_ID = "itest-custo-piso";
const SKU = "ITEST-CUSTO-PISO";

async function limpar() {
  await db.produtoCustoHistorico.deleteMany({ where: { produtoId: PRODUTO_ID } });
  await db.vendaAmazon.deleteMany({ where: { sku: SKU } });
  await db.produto.deleteMany({ where: { id: PRODUTO_ID } });
}

beforeAll(async () => {
  db = (await import("@/lib/db")).db;
  custo = await import("./custo-historico");
});

afterEach(async () => {
  await limpar();
});

describe("aplicarCustoAPartirDeHoje preserva o custo do passado", () => {
  it("nao aplica o custo novo a vendas anteriores ao inicio da vigencia", async () => {
    await limpar();

    // Produto com custo antigo R$22,26, SEM histórico de vigência — exatamente
    // o estado do MFS-0035 antes do bug.
    await db.produto.create({
      data: { id: PRODUTO_ID, sku: SKU, nome: "Itest custo piso", custoUnitario: 2226 },
    });

    const trintaDiasAtras = new Date();
    trintaDiasAtras.setUTCDate(trintaDiasAtras.getUTCDate() - 30);

    // Usuário troca o custo "a partir de hoje" para R$27,30.
    await custo.aplicarCustoAPartirDeHoje({
      produtoId: PRODUTO_ID,
      custoCentavos: 2730,
    });

    // Venda de 30 dias atrás DEVE manter o custo antigo (não foi comprada mais
    // cara). Antes do fix, isto retorna 2730 via fallback Produto.custoUnitario.
    const custoPassado = await custo.resolverCustoUnitario(PRODUTO_ID, trintaDiasAtras);
    expect(custoPassado).toBe(2226);

    // Venda de hoje usa o custo novo.
    const custoHoje = await custo.resolverCustoUnitario(PRODUTO_ID, new Date());
    expect(custoHoje).toBe(2730);
  });
});

describe("aplicarCustoNoPeriodo so afeta o intervalo escolhido", () => {
  it("nao altera vendas fora do periodo (passado e futuro usam o custo antigo)", async () => {
    await limpar();
    await db.produto.create({
      data: { id: PRODUTO_ID, sku: SKU, nome: "Itest periodo", custoUnitario: 2226 },
    });

    const hoje = new Date();
    const de = new Date(hoje);
    de.setUTCDate(de.getUTCDate() - 10);
    const ate = new Date(hoje);
    ate.setUTCDate(ate.getUTCDate() - 5);

    await custo.aplicarCustoNoPeriodo({
      produtoId: PRODUTO_ID,
      custoCentavos: 9999,
      de,
      ate,
    });

    // Dentro do intervalo → custo do período.
    const dentro = new Date(hoje);
    dentro.setUTCDate(dentro.getUTCDate() - 7);
    expect(await custo.resolverCustoUnitario(PRODUTO_ID, dentro)).toBe(9999);

    // Antes do intervalo → custo antigo (PERIODO não toca Produto.custoUnitario).
    const antes = new Date(hoje);
    antes.setUTCDate(antes.getUTCDate() - 30);
    expect(await custo.resolverCustoUnitario(PRODUTO_ID, antes)).toBe(2226);

    // Depois do intervalo → custo antigo.
    expect(await custo.resolverCustoUnitario(PRODUTO_ID, hoje)).toBe(2226);
  });
});

describe("aplicarCustoHistoricoCompleto aplica a todo o tempo (intencional)", () => {
  it("cobre passado e presente com o custo unico", async () => {
    await limpar();
    await db.produto.create({
      data: { id: PRODUTO_ID, sku: SKU, nome: "Itest historico", custoUnitario: 2226 },
    });

    await custo.aplicarCustoHistoricoCompleto({
      produtoId: PRODUTO_ID,
      custoCentavos: 2730,
    });

    const trintaDiasAtras = new Date();
    trintaDiasAtras.setUTCDate(trintaDiasAtras.getUTCDate() - 30);
    // Aqui o passado MUDA de propósito — é o significado de "histórico completo".
    expect(await custo.resolverCustoUnitario(PRODUTO_ID, trintaDiasAtras)).toBe(2730);
    expect(await custo.resolverCustoUnitario(PRODUTO_ID, new Date())).toBe(2730);
  });
});
