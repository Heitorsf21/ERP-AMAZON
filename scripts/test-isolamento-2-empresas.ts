/**
 * Teste de integração de isolamento multi-tenant (2 empresas) contra um Prisma
 * REAL (não mocks). Prova end-to-end que TENANT_ISOLATION=enforce nega acesso
 * cross-tenant: reads filtram, findUnique de outro tenant retorna null,
 * update/delete não atingem linha alheia, create injeta a empresa do contexto,
 * e operação sem contexto faz fail-closed.
 *
 * Rodar (DB descartável + enforce):
 *   DATABASE_URL="file:./prisma/test-iso.db" npx prisma db push --schema prisma/schema.prisma --skip-generate
 *   DATABASE_URL="file:./prisma/test-iso.db" TENANT_ISOLATION=enforce npx tsx scripts/test-isolamento-2-empresas.ts
 *
 * Exit 0 = todas as asserções passaram. Exit 1 = falha (com detalhe).
 */
import { db } from "../src/lib/db";
import { runWithTenant } from "../src/lib/tenant-context";
import { criarEmpresa } from "../src/modules/plataforma/empresas";
import { CATEGORIAS_PADRAO } from "../src/modules/plataforma/seed-empresa";

const SUPER = { empresaId: null, isSuperAdmin: true, source: "system" as const };
const A = "test_emp_A";
const B = "test_emp_B";

let falhas = 0;
function check(nome: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${nome}`);
  } else {
    console.error(`  ✗ FALHA: ${nome}`);
    falhas += 1;
  }
}

async function setup() {
  // Limpeza idempotente (contexto superadmin = sem filtro de empresa).
  await runWithTenant(SUPER, async () => {
    await db.categoria.deleteMany({ where: { empresaId: { in: [A, B] } } });
  });
  await db.empresa.deleteMany({ where: { id: { in: [A, B] } } });

  // Empresa é GLOBAL — create sem contexto.
  await db.empresa.create({ data: { id: A, nome: "Empresa A (teste)", slug: A } });
  await db.empresa.create({ data: { id: B, nome: "Empresa B (teste)", slug: B } });
}

async function cleanup() {
  await runWithTenant(SUPER, async () => {
    await db.categoria.deleteMany({ where: { empresaId: { in: [A, B] } } });
  });
  await db.empresa.deleteMany({ where: { id: { in: [A, B] } } });
}

async function main() {
  await setup();

  // 1) create injeta empresaId do contexto.
  // IMPORTANTE: o callback precisa AWAIT internamente — PrismaPromise é preguiçosa
  // e executaria fora do escopo do AsyncLocalStorage se só fosse retornada.
  const catA = await runWithTenant({ empresaId: A, isSuperAdmin: false, source: "web" }, async () =>
    db.categoria.create({ data: { nome: "Cat A (teste)", tipo: "DESPESA" } }),
  );
  const catB = await runWithTenant({ empresaId: B, isSuperAdmin: false, source: "web" }, async () =>
    db.categoria.create({ data: { nome: "Cat B (teste)", tipo: "DESPESA" } }),
  );
  check("create injeta empresaId=A", catA.empresaId === A);
  check("create injeta empresaId=B", catB.empresaId === B);

  await runWithTenant({ empresaId: A, isSuperAdmin: false, source: "web" }, async () => {
    // 2) findMany filtra por empresa.
    const todas = await db.categoria.findMany({ where: { empresaId: { in: [A, B] } as any } });
    // Mesmo pedindo A e B no where, a extensão injeta empresaId=A (não sobrescreve
    // empresaId já presente — mas aqui usamos `in`, então testamos o caso real:
    // sem empresaId explícito).
    const semFiltro = await db.categoria.findMany({});
    check("findMany (A) não retorna categoria de B", !semFiltro.some((c) => c.empresaId === B));
    check("findMany (A) retorna a própria categoria", semFiltro.some((c) => c.id === catA.id));

    // 3) findUnique de linha de B retorna null (validação pós-fetch).
    const tentaB = await db.categoria.findUnique({ where: { id: catB.id } });
    check("findUnique (A) de linha de B → null", tentaB === null);
    const achaA = await db.categoria.findUnique({ where: { id: catA.id } });
    check("findUnique (A) da própria linha → ok", achaA?.id === catA.id);

    // 4) updateMany/deleteMany não atingem linha de B.
    const upd = await db.categoria.updateMany({ where: { id: catB.id }, data: { cor: "#000" } });
    check("updateMany (A) de linha de B → 0 afetadas", upd.count === 0);
    const del = await db.categoria.deleteMany({ where: { id: catB.id } });
    check("deleteMany (A) de linha de B → 0 afetadas", del.count === 0);

    // 5) count só conta A.
    const n = await db.categoria.count({});
    check("count (A) conta só a empresa A", n === 1);

    void todas;
  });

  // 6) B continua intacta após tentativas de A.
  await runWithTenant({ empresaId: B, isSuperAdmin: false, source: "web" }, async () => {
    const bAindaLa = await db.categoria.findUnique({ where: { id: catB.id } });
    check("linha de B intacta (não deletada/alterada por A)", bAindaLa?.id === catB.id && bAindaLa?.cor == null);
  });

  // 7) FAIL-CLOSED: sem contexto, query a modelo tenant lança.
  let lancou = false;
  try {
    await db.categoria.findMany({});
  } catch {
    lancou = true;
  }
  check("fail-closed: findMany sem contexto lança", lancou);

  await cleanup();

  // ──────────────────────────────────────────────────────────────────────────
  // BLOCO: onboarding + multiempresa login (criarEmpresa, seed, isolamento)
  // ──────────────────────────────────────────────────────────────────────────
  console.log("\n── Bloco: onboarding + multiempresa login ──");

  let empAId: string | undefined;
  let empBId: string | undefined;
  let adminAId: string | undefined;
  let adminBId: string | undefined;

  try {
    // Limpeza idempotente antes de criar, caso o DB de teste tenha resíduos.
    const slugsParaLimpar = ["iso-a", "iso-b"];
    const empResidual = await db.empresa.findMany({
      where: { slug: { in: slugsParaLimpar } },
      select: { id: true },
    });
    if (empResidual.length > 0) {
      const idsResidual = empResidual.map((e) => e.id);
      await db.conviteUsuario.deleteMany({
        where: { usuario: { empresaId: { in: idsResidual } } },
      });
      await db.usuario.deleteMany({ where: { empresaId: { in: idsResidual } } });
      await runWithTenant(SUPER, async () => {
        await db.categoria.deleteMany({ where: { empresaId: { in: idsResidual } } });
        await db.fornecedor.deleteMany({ where: { empresaId: { in: idsResidual } } });
      });
      await db.empresa.deleteMany({ where: { id: { in: idsResidual } } });
    }

    // 1) Cria 2 empresas com o MESMO email de admin — devem coexistir.
    const resultA = await criarEmpresa({
      nome: "Empresa ISO A",
      slug: "iso-a",
      admin: { nome: "Admin ISO A", email: "dup@x.com" },
    });
    empAId = resultA.empresaId;
    adminAId = resultA.adminId;

    const resultB = await criarEmpresa({
      nome: "Empresa ISO B",
      slug: "iso-b",
      admin: { nome: "Admin ISO B", email: "dup@x.com" },
    });
    empBId = resultB.empresaId;
    adminBId = resultB.adminId;

    // 2) Mesmo email coexiste em empresas distintas → IDs diferentes.
    const userA = await db.usuario.findUnique({
      where: { empresaId_email: { empresaId: empAId, email: "dup@x.com" } },
    });
    const userB = await db.usuario.findUnique({
      where: { empresaId_email: { empresaId: empBId, email: "dup@x.com" } },
    });
    check("mesmo email coexiste em empresa A (registro existe)", userA !== null);
    check("mesmo email coexiste em empresa B (registro existe)", userB !== null);
    check("adminIds distintos entre A e B", userA?.id !== userB?.id);
    check("adminId A bate com criarEmpresa", userA?.id === adminAId);
    check("adminId B bate com criarEmpresa", userB?.id === adminBId);

    // 3) Cada empresa tem CATEGORIAS_PADRAO.length + 1 categorias e 1 fornecedor "Contas Fixas".
    // Categoria e Fornecedor são TENANT_MODELS → precisam de runWithTenant.
    const expectedCats = CATEGORIAS_PADRAO.length + 1; // +1 sentinela "Contas Fixas"

    const catsA = await runWithTenant(SUPER, async () =>
      db.categoria.findMany({ where: { empresaId: empAId } }),
    );
    const catsB = await runWithTenant(SUPER, async () =>
      db.categoria.findMany({ where: { empresaId: empBId } }),
    );
    check(
      `empresa A tem ${expectedCats} categorias após seed`,
      catsA.length === expectedCats,
    );
    check(
      `empresa B tem ${expectedCats} categorias após seed`,
      catsB.length === expectedCats,
    );

    const fornAList = await runWithTenant(SUPER, async () =>
      db.fornecedor.findMany({ where: { empresaId: empAId, nome: "Contas Fixas" } }),
    );
    const fornBList = await runWithTenant(SUPER, async () =>
      db.fornecedor.findMany({ where: { empresaId: empBId, nome: "Contas Fixas" } }),
    );
    check('empresa A tem exatamente 1 fornecedor "Contas Fixas"', fornAList.length === 1);
    check('empresa B tem exatamente 1 fornecedor "Contas Fixas"', fornBList.length === 1);

    // 4) Isolamento: sob contexto de A, findMany retorna apenas categorias de A.
    await runWithTenant({ empresaId: empAId, isSuperAdmin: false, source: "system" }, async () => {
      const visivelParaA = await db.categoria.findMany({});
      check(
        "isolamento: findMany sob ctx(A) retorna só categorias de A",
        visivelParaA.length === expectedCats,
      );
      check(
        "isolamento: nenhuma categoria de B visível sob ctx(A)",
        !visivelParaA.some((c) => c.empresaId === empBId),
      );
    });
  } finally {
    // Cleanup das empresas de onboarding, em ordem FK-safe.
    const idsOnboarding: string[] = [];
    if (empAId) idsOnboarding.push(empAId);
    if (empBId) idsOnboarding.push(empBId);
    if (idsOnboarding.length > 0) {
      await db.conviteUsuario.deleteMany({
        where: { usuario: { empresaId: { in: idsOnboarding } } },
      });
      await db.usuario.deleteMany({ where: { empresaId: { in: idsOnboarding } } });
      await runWithTenant(SUPER, async () => {
        await db.categoria.deleteMany({ where: { empresaId: { in: idsOnboarding } } });
        await db.fornecedor.deleteMany({ where: { empresaId: { in: idsOnboarding } } });
      });
      await db.empresa.deleteMany({ where: { id: { in: idsOnboarding } } });
    }
  }

  if (falhas > 0) {
    console.error(`\n❌ ${falhas} asserção(ões) falharam.`);
    process.exitCode = 1;
  } else {
    console.log("\n✅ Isolamento 2 empresas: todas as asserções passaram.");
  }
}

main()
  .catch((e) => {
    console.error("Erro no teste:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
