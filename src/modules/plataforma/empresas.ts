import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { runWithTenant } from "@/lib/tenant-context";
import { validarSlug } from "./slug";
import { semearEmpresa } from "./seed-empresa";
import { gerarTokenConvite, expiracaoConvite } from "./convite";

export type CriarEmpresaInput = {
  nome: string;
  slug: string;
  admin: { nome: string; email: string };
};

export type CriarEmpresaResult = {
  empresaId: string;
  adminId: string;
  rawToken: string;
};

/** Hash bcrypt de bytes aleatórios — senha inutilizável até o admin definir a real. */
async function hashAleatorio(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(24).toString("base64"), 10);
}

// NOTA: a auditoria (AuditPlataforma "EMPRESA_CRIADA"/"ADMIN_CONVIDADO") é
// responsabilidade do chamador na CAMADA DE API (rota /api/plataforma/empresas),
// que tem o ator superadmin + IP da requisição. Este service permanece puro e
// testável, sem dependência de sessão/request.
export async function criarEmpresa(input: CriarEmpresaInput): Promise<CriarEmpresaResult> {
  const slugCheck = validarSlug(input.slug);
  if (!slugCheck.ok) throw new Error(`SLUG_INVALIDO: ${slugCheck.motivo}`);

  const email = input.admin.email.toLowerCase().trim();
  const { rawToken, tokenHash } = gerarTokenConvite();
  const senhaHash = await hashAleatorio();

  return db.$transaction(async (tx) => {
    // Empresa: model GLOBAL — nao precisa de contexto de tenant.
    const empresa = await tx.empresa.create({
      data: { nome: input.nome.trim(), slug: input.slug },
    });

    // Demais writes precisam de contexto (Categoria/Fornecedor sao TENANT).
    return runWithTenant(
      { empresaId: empresa.id, isSuperAdmin: false, source: "system" },
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await semearEmpresa(tx as unknown as Parameters<typeof semearEmpresa>[0], empresa.id);

        const admin = await tx.usuario.create({
          data: {
            nome: input.admin.nome.trim(),
            email,
            role: "ADMIN",
            ativo: true,
            senhaHash,
            empresaId: empresa.id,
          },
        });

        await tx.conviteUsuario.create({
          data: { usuarioId: admin.id, tokenHash, expiresAt: expiracaoConvite() },
        });

        return { empresaId: empresa.id, adminId: admin.id, rawToken };
      },
    );
  });
}

export async function listarEmpresas() {
  return db.empresa.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, nome: true, slug: true, ativa: true, createdAt: true,
      _count: { select: { usuarios: true, amazonAccounts: true } },
    },
  });
}

export async function desativarEmpresa(empresaId: string) {
  return db.empresa.update({ where: { id: empresaId }, data: { ativa: false } });
}

export async function reativarEmpresa(empresaId: string) {
  return db.empresa.update({ where: { id: empresaId }, data: { ativa: true } });
}
