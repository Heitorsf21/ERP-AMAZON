/**
 * Upload e leitura de imagem manual do produto.
 *
 * POST: multipart/form-data com `file` (image/jpeg|png|webp). Salva em
 *       `uploads/produtos/<id>.<ext>` e atualiza `Produto.imagemUrl` com o
 *       caminho relativo. Substitui imagem anterior se houver.
 *
 * GET:  serve o arquivo apontado por `Produto.imagemUrl` (se for caminho
 *       local em `uploads/`). Se for URL externa, faz redirect 302.
 *       Se nao houver imagem, retorna 404.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fileMatchesDeclaredMime } from "@/lib/file-validation";

export const dynamic = "force-dynamic";

const ALLOWED_MIMES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads", "produtos");

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const produto = await db.produto.findUnique({ where: { id } });
  if (!produto) {
    return NextResponse.json({ erro: "Produto nao encontrado" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ erro: "Arquivo ausente" }, { status: 400 });
  }
  const ext = ALLOWED_MIMES[file.type];
  if (!ext) {
    return NextResponse.json(
      { erro: "Tipo nao suportado. Use JPEG, PNG ou WEBP." },
      { status: 400 },
    );
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ erro: "Imagem muito grande (max 5MB)" }, { status: 400 });
  }

  await fs.mkdir(UPLOADS_ROOT, { recursive: true });

  // Apaga arquivos antigos do mesmo produto (qualquer extensao).
  for (const e of Object.values(ALLOWED_MIMES)) {
    await fs.rm(path.join(UPLOADS_ROOT, `${id}.${e}`), { force: true });
  }

  const filename = `${id}.${ext}`;
  const fullPath = path.join(UPLOADS_ROOT, filename);
  const ab = await file.arrayBuffer();
  const buffer = Buffer.from(ab);
  if (!fileMatchesDeclaredMime(buffer, file.type)) {
    return NextResponse.json({ erro: "Conteudo de imagem invalido" }, { status: 400 });
  }
  await fs.writeFile(fullPath, buffer);

  const relativePath = `uploads/produtos/${filename}`;
  await db.produto.update({
    where: { id },
    data: { imagemUrl: relativePath },
  });

  return NextResponse.json({ ok: true, imagemUrl: relativePath });
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const produto = await db.produto.findUnique({
    where: { id },
    select: { imagemUrl: true, amazonImagemUrl: true },
  });
  if (!produto) return new Response("Not found", { status: 404 });

  const url = produto.imagemUrl || produto.amazonImagemUrl;
  if (!url) return new Response("Not found", { status: 404 });

  // URL externa (catalogo Amazon) — redireciona.
  if (/^https?:\/\//.test(url)) {
    return NextResponse.redirect(url, { status: 302 });
  }

  // Caminho local em uploads/. Validacao path traversal.
  const resolved = path.resolve(process.cwd(), url);
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
    ext === ".png"
      ? "image/png"
      : ext === ".webp"
        ? "image/webp"
        : "image/jpeg";

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=120",
    },
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  for (const e of Object.values(ALLOWED_MIMES)) {
    await fs.rm(path.join(UPLOADS_ROOT, `${id}.${e}`), { force: true });
  }
  await db.produto.update({
    where: { id },
    data: { imagemUrl: null },
  });
  return NextResponse.json({ ok: true });
}
