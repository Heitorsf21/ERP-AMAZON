/**
 * Upload, leitura e remoção do avatar do usuário autenticado.
 * Mesmo padrão de /api/produtos/[id]/imagem mas indexado por session.uid.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { fileMatchesDeclaredMime } from "@/lib/file-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_MIMES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads", "avatars");

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ erro: "NAO_AUTENTICADO" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ erro: "Arquivo ausente" }, { status: 400 });
  }
  const ext = ALLOWED_MIMES[file.type];
  if (!ext) {
    return NextResponse.json(
      { erro: "Tipo não suportado. Use JPEG, PNG ou WEBP." },
      { status: 400 },
    );
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ erro: "Imagem muito grande (máx 5MB)" }, { status: 400 });
  }

  await fs.mkdir(UPLOADS_ROOT, { recursive: true });

  // Remove arquivos antigos
  for (const e of Object.values(ALLOWED_MIMES)) {
    await fs.rm(path.join(UPLOADS_ROOT, `${session.uid}.${e}`), { force: true });
  }

  const filename = `${session.uid}.${ext}`;
  const fullPath = path.join(UPLOADS_ROOT, filename);
  const ab = await file.arrayBuffer();
  const buffer = Buffer.from(ab);
  if (!fileMatchesDeclaredMime(buffer, file.type)) {
    return NextResponse.json({ erro: "Conteudo de imagem invalido" }, { status: 400 });
  }
  await fs.writeFile(fullPath, buffer);

  const relativePath = `uploads/avatars/${filename}`;
  await db.usuario.update({
    where: { id: session.uid },
    data: { avatarUrl: relativePath },
  });

  return NextResponse.json({ ok: true, avatarUrl: relativePath });
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  const usuario = await db.usuario.findUnique({
    where: { id: session.uid },
    select: { avatarUrl: true },
  });
  if (!usuario || !usuario.avatarUrl) {
    return new Response("Not found", { status: 404 });
  }

  // URL externa (improvável aqui, mas suporta)
  if (/^https?:\/\//.test(usuario.avatarUrl)) {
    return NextResponse.redirect(usuario.avatarUrl, { status: 302 });
  }

  const resolved = path.resolve(process.cwd(), usuario.avatarUrl);
  const root = path.resolve(process.cwd(), "uploads");
  if (!resolved.startsWith(root + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  let buf: Buffer;
  try {
    buf = await fs.readFile(resolved);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=120",
    },
  });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ erro: "NAO_AUTENTICADO" }, { status: 401 });
  }

  for (const e of Object.values(ALLOWED_MIMES)) {
    await fs.rm(path.join(UPLOADS_ROOT, `${session.uid}.${e}`), { force: true });
  }
  await db.usuario.update({
    where: { id: session.uid },
    data: { avatarUrl: null },
  });
  return NextResponse.json({ ok: true });
}
