import { db } from "@/lib/db";
import type { SessionPayload } from "@/lib/session";

type AuditInput = {
  session?: Pick<SessionPayload, "uid" | "email"> | null;
  req?: Request;
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  antes?: unknown;
  depois?: unknown;
  metadata?: unknown;
};

const SECRET_KEY_RE = /(secret|token|senha|password|authorization|key)/i;

export async function auditLog(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        usuarioId: input.session?.uid ?? null,
        usuarioEmail: input.session?.email ?? null,
        acao: input.acao,
        entidade: input.entidade,
        entidadeId: input.entidadeId ?? null,
        antesJson: serializeAuditJson(input.antes),
        depoisJson: serializeAuditJson(input.depois),
        metadataJson: serializeAuditJson(input.metadata),
        ip: getClientIp(input.req),
        userAgent: input.req?.headers.get("user-agent") ?? null,
      },
    });
  } catch (error) {
    console.warn(
      "[auditLog] falha ao gravar auditoria:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function redactForAudit<T>(value: T): T {
  return redactValue(value) as T;
}

function serializeAuditJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(redactValue(value));
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = SECRET_KEY_RE.test(key) ? "[redacted]" : redactValue(nested);
  }
  return out;
}

function getClientIp(req?: Request): string | null {
  if (!req) return null;
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}
