import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { semearEmpresa, CATEGORIAS_PADRAO } from "./seed-empresa";

const prisma = new PrismaClient();
const EMP = "test-seed-emp";

beforeAll(async () => {
  await prisma.empresa.upsert({
    where: { id: EMP },
    update: {},
    create: { id: EMP, nome: "Seed Test", slug: "seed-test-emp" },
  });
});
afterAll(async () => {
  await prisma.categoria.deleteMany({ where: { empresaId: EMP } });
  await prisma.fornecedor.deleteMany({ where: { empresaId: EMP } });
  await prisma.empresa.delete({ where: { id: EMP } }).catch(() => {});
  await prisma.$disconnect();
});

describe("semearEmpresa", () => {
  it("cria 18 categorias + sentinelas Contas Fixas (categoria e fornecedor)", async () => {
    await semearEmpresa(prisma, EMP);
    const cats = await prisma.categoria.count({ where: { empresaId: EMP } });
    expect(cats).toBe(CATEGORIAS_PADRAO.length + 1); // +1 sentinela "Contas Fixas"
    const sentinelaCat = await prisma.categoria.findFirst({
      where: { empresaId: EMP, nome: "Contas Fixas" },
    });
    const sentinelaForn = await prisma.fornecedor.findFirst({
      where: { empresaId: EMP, nome: "Contas Fixas" },
    });
    expect(sentinelaCat).not.toBeNull();
    expect(sentinelaForn).not.toBeNull();
  });
  it("é idempotente (rodar 2x não duplica)", async () => {
    await semearEmpresa(prisma, EMP);
    const cats = await prisma.categoria.count({ where: { empresaId: EMP } });
    expect(cats).toBe(CATEGORIAS_PADRAO.length + 1);
  });
});
