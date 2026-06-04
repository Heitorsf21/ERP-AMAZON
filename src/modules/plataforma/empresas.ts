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
  admin: { nome: string; email: string; senha?: string };
};

export type CriarEmpresaResult = {
  empresaId: string;
  adminId: string;
  // null quando a senha foi definida direto pelo superadmin (sem convite).
  rawToken: string | null;
  definiuSenha: boolean;
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
  const senha = input.admin.senha?.trim();
  const definiuSenha = !!senha;
  const { rawToken, tokenHash } = gerarTokenConvite();
  // Senha definida pelo superadmin → admin entra direto. Senão, hash aleatório
  // inutilizável + convite por e-mail para o admin definir a própria senha.
  const senhaHash = senha ? await bcrypt.hash(senha, 10) : await hashAleatorio();

  return db.$transaction(async (tx) => {
    // Empresa: model GLOBAL — nao precisa de contexto de tenant.
    const empresa = await tx.empresa.create({
      data: { nome: input.nome.trim(), slug: input.slug },
    });

    // Demais writes precisam de contexto (Categoria/Fornecedor sao TENANT).
    return runWithTenant(
      { empresaId: empresa.id, isSuperAdmin: false, source: "system" },
      async () => {
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

        if (!definiuSenha) {
          await tx.conviteUsuario.create({
            data: { usuarioId: admin.id, tokenHash, expiresAt: expiracaoConvite() },
          });
        }

        return {
          empresaId: empresa.id,
          adminId: admin.id,
          rawToken: definiuSenha ? null : rawToken,
          definiuSenha,
        };
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

// Retorna false quando o empresaId nao existe (updateMany.count === 0) — o
// caller (rota) traduz para 404 em vez de deixar um P2025 virar 500 opaco.
export async function desativarEmpresa(empresaId: string): Promise<boolean> {
  const r = await db.empresa.updateMany({ where: { id: empresaId }, data: { ativa: false } });
  return r.count > 0;
}

export async function reativarEmpresa(empresaId: string): Promise<boolean> {
  const r = await db.empresa.updateMany({ where: { id: empresaId }, data: { ativa: true } });
  return r.count > 0;
}

export type ExcluirEmpresaResult = {
  ok: boolean;
  removidos: Record<string, number>;
  total: number;
};

/**
 * EXCLUSÃO DEFINITIVA de uma empresa e TODOS os seus dados (hard delete).
 * Irreversível. Só permite excluir empresa INATIVA — trava de segurança contra
 * exclusão acidental de empresa em uso (o caller deve desativar antes).
 *
 * Estratégia: as tabelas tenant guardam `empresaId` como coluna simples (sem FK
 * para Empresa), então não há cascade no banco. Descobrimos via information_schema
 * todas as tabelas com coluna `empresaId` e apagamos cada uma escopada por
 * empresaId. A ORDEM entre tabelas tenant é resolvida por um loop com retry: FKs
 * Restrict entre elas (ex: Movimentacao→Categoria) falham numa passada e passam
 * na seguinte, depois que os filhos saem. Por fim apagamos a Empresa (cascateia
 * AmazonAccount; Usuario e seus filhos 2FA/Convite/Token já saíram pelo loop).
 *
 * Raw SQL é intencional (manutenção superadmin cross-tenant) e empresaId é sempre
 * parametrizado. NÃO é transação única porque o Postgres aborta a transação
 * inteira no 1º erro de FK, inviabilizando o retry — a operação é idempotente e
 * re-executável.
 */
export async function excluirEmpresa(empresaId: string): Promise<ExcluirEmpresaResult> {
  const empresa = await db.empresa.findUnique({
    where: { id: empresaId },
    select: { id: true, ativa: true },
  });
  if (!empresa) return { ok: false, removidos: {}, total: 0 };
  if (empresa.ativa) {
    throw new Error("EMPRESA_ATIVA: desative a empresa antes de excluir");
  }

  const colunas = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'empresaId'
      AND table_name <> 'Empresa'
    ORDER BY table_name
  `;
  // Defesa em profundidade: só aceitamos identificadores simples (a fonte é o
  // catálogo do banco, mas validamos antes de interpolar no SQL).
  const tabelas = colunas
    .map((c) => c.table_name)
    .filter((t) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t));

  const removidos: Record<string, number> = {};
  let restantes = [...tabelas];
  for (let passada = 0; passada < 20 && restantes.length > 0; passada++) {
    const aindaFalhando: string[] = [];
    let progrediu = false;
    for (const t of restantes) {
      try {
        const n = await db.$executeRawUnsafe(
          `DELETE FROM "${t}" WHERE "empresaId" = $1`,
          empresaId,
        );
        removidos[t] = Number(n);
        progrediu = true;
      } catch {
        // Provável FK restrict (filhos ainda não apagados) — tenta na próxima passada.
        aindaFalhando.push(t);
      }
    }
    if (!progrediu) {
      throw new Error(`FALHA_DEPENDENCIAS: não consegui apagar ${aindaFalhando.join(", ")}`);
    }
    restantes = aindaFalhando;
  }
  if (restantes.length > 0) {
    throw new Error(`FALHA_DEPENDENCIAS: restaram ${restantes.join(", ")}`);
  }

  // Empresa por último: cascateia AmazonAccount (onDelete: Cascade).
  await db.$executeRawUnsafe(`DELETE FROM "Empresa" WHERE id = $1`, empresaId);

  const total = Object.values(removidos).reduce((a, b) => a + b, 0);
  return { ok: true, removidos, total };
}

export async function reenviarConvite(empresaId: string): Promise<{
  ok: boolean; rawToken?: string; admin?: { nome: string; email: string }; empresaNome?: string; slug?: string;
}> {
  const empresa = await db.empresa.findUnique({ where: { id: empresaId }, select: { nome: true, slug: true } });
  if (!empresa) return { ok: false };
  // admin = usuario ADMIN mais antigo da empresa (o convite reemitido invalida
  // os pendentes e cria um novo; ver transacao abaixo).
  const admin = await db.usuario.findFirst({
    where: { empresaId, role: "ADMIN" }, orderBy: { createdAt: "asc" },
    select: { id: true, nome: true, email: true },
  });
  if (!admin) return { ok: false };
  const { rawToken, tokenHash } = gerarTokenConvite();
  await db.$transaction([
    db.conviteUsuario.updateMany({ where: { usuarioId: admin.id, usadoEm: null }, data: { usadoEm: new Date() } }),
    db.conviteUsuario.create({ data: { usuarioId: admin.id, tokenHash, expiresAt: expiracaoConvite() } }),
  ]);
  return { ok: true, rawToken, admin: { nome: admin.nome, email: admin.email }, empresaNome: empresa.nome, slug: empresa.slug };
}
