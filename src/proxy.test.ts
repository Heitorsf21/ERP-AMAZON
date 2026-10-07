import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signSession } from "@/lib/session";
import { proxy } from "./proxy";

vi.stubEnv("SESSION_SECRET", "segredo-de-teste-do-proxy-0123456789abcdef0123456789");

async function requisicao(metodo: string, caminho: string, role: string) {
  const token = await signSession({
    uid: "u1",
    email: "u1@atlas.test",
    nome: "Usuário",
    role,
    exp: Math.floor(Date.now() / 1000) + 3600,
    v: 0,
    empresaId: "mundofs",
  });
  return new NextRequest(`http://localhost${caminho}`, {
    method: metodo,
    headers: { cookie: `erp_session=${token}`, host: "localhost" },
  });
}

function passou(res: Response) {
  return res.headers.get("x-middleware-next") === "1";
}

describe("proxy: preferências pessoais valem para qualquer papel", () => {
  it.each(["OPERADOR", "FINANCEIRO", "LEITURA"])(
    "%s abre /configuracoes (aba Menu e Neste celular são pessoais)",
    async (role) => {
      expect(passou(await proxy(await requisicao("GET", "/configuracoes", role)))).toBe(true);
    },
  );

  it("LEITURA salva o próprio menu", async () => {
    expect(passou(await proxy(await requisicao("PUT", "/api/menu/preferencias", "LEITURA")))).toBe(true);
  });

  it.each([
    ["GET", "/api/push/config"],
    ["GET", "/api/push/dispositivos"],
    ["POST", "/api/push/dispositivos"],
    ["PATCH", "/api/push/dispositivos"],
    ["DELETE", "/api/push/dispositivos"],
    ["POST", "/api/push/teste"],
  ])("LEITURA usa o aviso de venda no próprio aparelho: %s %s", async (metodo, caminho) => {
    expect(passou(await proxy(await requisicao(metodo, caminho, "LEITURA")))).toBe(true);
  });

  it("configurações da empresa continuam restritas", async () => {
    const operador = await proxy(await requisicao("POST", "/api/configuracoes/notificacoes", "OPERADOR"));
    expect(operador.status).toBe(403);
    const leitura = await proxy(await requisicao("POST", "/api/configuracoes/notificacoes", "LEITURA"));
    expect(leitura.status).toBe(403);
  });
});
