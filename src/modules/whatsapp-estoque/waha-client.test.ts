import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enviarTextoWaha,
  mascararDestino,
  normalizarChatId,
  obterQrSessaoWaha,
  obterStatusSessaoWaha,
  reiniciarSessaoWaha,
} from "./waha-client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("normalizarChatId", () => {
  it("adiciona sufixo @c.us a numeros crus", () => {
    expect(normalizarChatId("5511999999999")).toBe("5511999999999@c.us");
  });

  it("remove formatacao antes de montar o chatId", () => {
    expect(normalizarChatId("+55 (11) 99999-9999")).toBe("5511999999999@c.us");
  });

  it("preserva chatId/group id que ja contem @", () => {
    expect(normalizarChatId("123456789@g.us")).toBe("123456789@g.us");
    expect(normalizarChatId("5511999999999@c.us")).toBe("5511999999999@c.us");
  });
});

describe("mascararDestino", () => {
  it("mantem apenas os ultimos 4 digitos", () => {
    expect(mascararDestino("5511999998888")).toBe("****8888");
  });

  it("mascara totalmente numeros muito curtos", () => {
    expect(mascararDestino("12")).toBe("****");
  });
});

describe("enviarTextoWaha SSRF guard", () => {
  const input = {
    baseUrl: "http://10.0.0.9:3002",
    session: "default",
    destino: "5511999999999",
    texto: "teste",
    timeoutMs: 1,
  };

  it("em producao bloqueia quando WAHA_ALLOWED_HOSTS esta ausente", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WAHA_ALLOWED_HOSTS", undefined);

    const result = await enviarTextoWaha({ ...input, baseUrl: "http://127.0.0.1:3002" });

    expect(result.ok).toBe(false);
    expect(result.erro).toBe("WAHA_ALLOWED_HOSTS nao configurado no servidor");
  });

  it("em producao bloqueia host fora da allowlist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WAHA_ALLOWED_HOSTS", "127.0.0.1:3002");

    const result = await enviarTextoWaha(input);

    expect(result.ok).toBe(false);
    expect(result.erro).toBe(
      "URL do WAHA invalida ou fora de WAHA_ALLOWED_HOSTS",
    );
  });

  it("em producao permite o host presente na allowlist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WAHA_ALLOWED_HOSTS", "127.0.0.1:3002");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "msg-1" }), { status: 200 }),
      ),
    );

    const result = await enviarTextoWaha({
      ...input,
      baseUrl: "http://127.0.0.1:3002",
    });

    expect(result).toMatchObject({ ok: true, status: 200, idMensagem: "msg-1" });
  });
});

// ── Sessão do WAHA (status / reinício / QR) ─────────────────────────────

const BASE = "http://127.0.0.1:3002";
const API_KEY = "chave-super-secreta-123";
const sessaoInput = { baseUrl: BASE, session: "default", apiKey: API_KEY, timeoutMs: 50 };

/** PNG mínimo: assinatura de 8 bytes + alguns bytes de "conteúdo". */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

function respostaJson(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** fetch que só termina quando o AbortController do cliente dispara. */
function fetchQueNuncaResponde() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      }),
  );
}

describe("obterStatusSessaoWaha", () => {
  it("consulta GET /api/sessions/{session} com X-Api-Key e devolve status + 4 últimos dígitos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respostaJson({
        name: "default",
        status: "WORKING",
        me: { id: "5511999998888@c.us", pushName: "Loja" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await obterStatusSessaoWaha(sessaoInput);

    expect(r).toEqual({ ok: true, status: "WORKING", conta: "8888" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/sessions/default`);
    expect((init.method ?? "GET").toUpperCase()).toBe("GET");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe(API_KEY);
  });

  it("sem conta pareada (me null) devolve conta indefinida", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          respostaJson({ name: "default", status: "SCAN_QR_CODE", me: null }),
        ),
    );

    const r = await obterStatusSessaoWaha(sessaoInput);

    expect(r.ok).toBe(true);
    expect(r.status).toBe("SCAN_QR_CODE");
    expect(r.conta).toBeUndefined();
  });

  it("codifica o nome da sessão no caminho", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respostaJson({ status: "WORKING", me: null }));
    vi.stubGlobal("fetch", fetchMock);

    await obterStatusSessaoWaha({ ...sessaoInput, session: "../admin" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}/api/sessions/..%2Fadmin`);
  });

  it("não reflete status fora do conjunto conhecido", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(respostaJson({ status: "dado-interno-vazado", me: null })),
    );

    const r = await obterStatusSessaoWaha(sessaoInput);

    expect(r.ok).toBe(true);
    expect(r.status).toBe("DESCONHECIDO");
    expect(JSON.stringify(r)).not.toContain("dado-interno-vazado");
  });

  it("erro HTTP vira resultado sem refletir o corpo nem a API key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("segredo-do-upstream", { status: 500 })),
    );

    const r = await obterStatusSessaoWaha(sessaoInput);

    expect(r).toEqual({ ok: false, erro: "WAHA respondeu 500" });
    expect(JSON.stringify(r)).not.toContain("segredo-do-upstream");
    expect(JSON.stringify(r)).not.toContain(API_KEY);
  });

  it("corpo não-JSON vira erro sem lançar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>oi</html>", { status: 200 })),
    );

    const r = await obterStatusSessaoWaha(sessaoInput);

    expect(r).toEqual({ ok: false, erro: "Resposta inesperada do WAHA" });
  });

  it("timeout não lança", async () => {
    vi.stubGlobal("fetch", fetchQueNuncaResponde());

    const r = await obterStatusSessaoWaha({ ...sessaoInput, timeoutMs: 5 });

    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Timeout");
  });

  it("falha de rede não lança", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const r = await obterStatusSessaoWaha(sessaoInput);

    expect(r.ok).toBe(false);
    expect(r.erro).toBeTruthy();
  });

  it("em produção sem WAHA_ALLOWED_HOSTS bloqueia sem chamar o fetch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WAHA_ALLOWED_HOSTS", undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await obterStatusSessaoWaha(sessaoInput);

    expect(r).toEqual({
      ok: false,
      erro: "WAHA_ALLOWED_HOSTS nao configurado no servidor",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("em produção bloqueia host fora da allowlist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WAHA_ALLOWED_HOSTS", "127.0.0.1:3002");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await obterStatusSessaoWaha({
      ...sessaoInput,
      baseUrl: "http://10.0.0.9:3002",
    });

    expect(r).toEqual({
      ok: false,
      erro: "URL do WAHA invalida ou fora de WAHA_ALLOWED_HOSTS",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reiniciarSessaoWaha", () => {
  it("faz POST /api/sessions/{session}/restart e aceita 201", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respostaJson({ name: "default", status: "STARTING" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const r = await reiniciarSessaoWaha(sessaoInput);

    expect(r).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/sessions/default/restart`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe(API_KEY);
  });

  it("erro HTTP vira resultado sem refletir o corpo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("detalhe-interno", { status: 404 })),
    );

    const r = await reiniciarSessaoWaha(sessaoInput);

    expect(r).toEqual({ ok: false, erro: "WAHA respondeu 404" });
  });

  it("timeout não lança", async () => {
    vi.stubGlobal("fetch", fetchQueNuncaResponde());

    const r = await reiniciarSessaoWaha({ ...sessaoInput, timeoutMs: 5 });

    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Timeout");
  });

  it("URL vazia não chama o fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await reiniciarSessaoWaha({ ...sessaoInput, baseUrl: "  " });

    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("obterQrSessaoWaha", () => {
  it("pede o QR como PNG e devolve data URL base64", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(PNG_BYTES, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const r = await obterQrSessaoWaha(sessaoInput);

    expect(r).toEqual({
      ok: true,
      dataUrl: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/default/auth/qr?format=image`);
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe("image/png");
    expect(headers["X-Api-Key"]).toBe(API_KEY);
  });

  it("não reflete conteúdo que não seja PNG", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>painel interno</html>", {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      ),
    );

    const r = await obterQrSessaoWaha(sessaoInput);

    expect(r.ok).toBe(false);
    expect(r.dataUrl).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain("painel interno");
  });

  it("erro HTTP vira resultado sem refletir o corpo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("detalhe", { status: 422 })),
    );

    const r = await obterQrSessaoWaha(sessaoInput);

    expect(r).toEqual({ ok: false, erro: "WAHA respondeu 422" });
  });

  it("timeout não lança", async () => {
    vi.stubGlobal("fetch", fetchQueNuncaResponde());

    const r = await obterQrSessaoWaha({ ...sessaoInput, timeoutMs: 5 });

    expect(r.ok).toBe(false);
    expect(r.erro).toContain("Timeout");
  });
});
