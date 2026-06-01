import { describe, it, expect, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { criarEmpresa } from "./empresas";
import { CATEGORIAS_PADRAO } from "./seed-empresa";

const prisma = new PrismaClient();

async function limpar(slug: string) {
  const emp = await prisma.empresa.findUnique({ where: { slug } });
  if (!emp) return;
  await prisma.conviteUsuario.deleteMany({ where: { usuario: { empresaId: emp.id } } });
  await prisma.usuario.deleteMany({ where: { empresaId: emp.id } });
  await prisma.categoria.deleteMany({ where: { empresaId: emp.id } });
  await prisma.fornecedor.deleteMany({ where: { empresaId: emp.id } });
  await prisma.empresa.delete({ where: { id: emp.id } });
}

afterEach(async () => { await limpar("loja-itest"); });

describe("criarEmpresa", () => {
  it("cria empresa + seed + admin + convite atomicamente", async () => {
    const r = await criarEmpresa({
      nome: "Loja Itest", slug: "loja-itest",
      admin: { nome: "Admin Itest", email: "admin@itest.com" },
    });
    expect(r.empresaId).toBeTruthy();
    expect(r.rawToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const cats = await prisma.categoria.count({ where: { empresaId: r.empresaId } });
    expect(cats).toBe(CATEGORIAS_PADRAO.length + 1);
    const admin = await prisma.usuario.findUnique({ where: { id: r.adminId } });
    expect(admin?.role).toBe("ADMIN");
    expect(admin?.ativo).toBe(true);
    expect(admin?.empresaId).toBe(r.empresaId);
    const convite = await prisma.conviteUsuario.findFirst({ where: { usuarioId: r.adminId } });
    expect(convite).not.toBeNull();
  });

  it("rejeita slug duplicado", async () => {
    await criarEmpresa({ nome: "L1", slug: "loja-itest", admin: { nome: "A", email: "a@x.com" } });
    await expect(
      criarEmpresa({ nome: "L2", slug: "loja-itest", admin: { nome: "B", email: "b@x.com" } }),
    ).rejects.toThrow();
  });

  it("rejeita slug invalido", async () => {
    await expect(
      criarEmpresa({ nome: "L", slug: "X", admin: { nome: "A", email: "a@x.com" } }),
    ).rejects.toThrow();
  });
});
