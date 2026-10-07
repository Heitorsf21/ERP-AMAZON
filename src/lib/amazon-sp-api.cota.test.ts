import { beforeEach, describe, expect, it, vi } from "vitest";

// Emula a tabela AmazonApiQuota: o slot reservado vale para a empresa+operação.
const { quota, dbMock } = vi.hoisted(() => {
  const quota = new Map<string, Date>();
  const dbMock = {
    amazonApiQuota: {
      findFirst: vi.fn(async ({ where }: { where: { operation: string } }) => {
        const nextAllowedAt = quota.get(where.operation);
        return nextAllowedAt ? { nextAllowedAt, observedRps: null } : null;
      }),
      upsert: vi.fn(
        async (args: {
          where: { empresaId_operation: { operation: string } };
          update: { nextAllowedAt?: Date };
          create: { nextAllowedAt?: Date };
        }) => {
          const op = args.where.empresaId_operation.operation;
          const next = args.update.nextAllowedAt ?? args.create.nextAllowedAt;
          if (next) quota.set(op, next);
          return {};
        },
      ),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return { quota, dbMock };
});
vi.mock("@/lib/db", () => ({ db: dbMock }));

import { getInventorySummaries } from "./amazon-sp-api";

const CREDS = {
  clientId: "c",
  clientSecret: "s",
  refreshToken: "r",
  marketplaceId: "A2Q3Y263D00KWC",
};

function resposta(json: unknown) {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  quota.clear();
  vi.restoreAllMocks();
});

describe("chamadas seguidas à SP-API respeitam o slot local em vez de falhar", () => {
  it("estoque com 2 páginas (caso do INVENTORY_SNAPSHOT): a 2ª página espera o slot e não derruba o job", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        resposta({ payload: { inventorySummaries: [{ sellerSku: "MFS-1" }] }, pagination: { nextToken: "p2" } }),
      )
      .mockResolvedValueOnce(resposta({ payload: { inventorySummaries: [{ sellerSku: "MFS-2" }] } }));

    // Resposta instantânea: sem esperar, a 2ª página cai no cooldown de 500 ms (2 rps).
    const resumo = await getInventorySummaries(CREDS, { accessToken: "token" });

    expect(resumo.map((s) => s.sellerSku)).toEqual(["MFS-1", "MFS-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("catálogo item a item (caso do CATALOG_REFRESH, 7/7 dias falhando): 3 ASINs seguidos passam", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/auth/o2/token")) {
        return resposta({ access_token: "token", expires_in: 3600 });
      }
      const asin = String(url).match(/items\/([^?]+)/)?.[1];
      return resposta({ asin, summaries: [{ itemName: `Produto ${asin}` }] });
    });

    const { getCatalogItem } = await import("./amazon-sp-api");
    const itens = [];
    for (const asin of ["B0001", "B0002", "B0003"]) {
      itens.push(await getCatalogItem(CREDS, asin));
    }

    expect(itens.map((i) => i?.summaries?.[0]?.itemName)).toEqual([
      "Produto B0001",
      "Produto B0002",
      "Produto B0003",
    ]);
    const chamadasCatalogo = fetchMock.mock.calls.filter(([u]) => String(u).includes("/catalog/"));
    expect(chamadasCatalogo).toHaveLength(3);
  });

  it("cooldown LONGO (429 real da Amazon) continua virando erro na hora, sem esperar", async () => {
    quota.set("INVENTORY_SUMMARIES", new Date(Date.now() + 60_000));
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const inicio = Date.now();

    await expect(getInventorySummaries(CREDS, { accessToken: "token" })).rejects.toThrow(
      /INVENTORY_SUMMARIES em cooldown/,
    );
    expect(Date.now() - inicio).toBeLessThan(1_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
