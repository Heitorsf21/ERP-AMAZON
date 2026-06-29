import { describe, expect, it } from "vitest";
import { parseSalesTrafficByDateJson } from "./sales-traffic-json";

// Fixture extraida de um relatorio GET_SALES_AND_TRAFFIC_REPORT REAL
// (marketplace BR, janela 30/05-29/06/2026) — estrutura confirmada em prod.
const REPORT_REAL = {
  reportSpecification: { reportType: "GET_SALES_AND_TRAFFIC_REPORT" },
  salesAndTrafficByDate: [
    {
      date: "2026-05-30",
      salesByDate: {
        orderedProductSales: { amount: 814.62, currencyCode: "BRL" },
        unitsOrdered: 14,
        totalOrderItems: 14,
        averageSellingPrice: { amount: 58.19, currencyCode: "BRL" },
        unitsRefunded: 0,
      },
      trafficByDate: {
        browserPageViews: 466,
        mobileAppPageViews: 679,
        pageViews: 1145,
        browserSessions: 389,
        mobileAppSessions: 461,
        sessions: 850,
        buyBoxPercentage: 55.39,
        unitSessionPercentage: 1.65,
      },
    },
    {
      date: "2026-06-01",
      salesByDate: {
        orderedProductSales: { amount: 1351.09, currencyCode: "BRL" },
        unitsOrdered: 23,
        totalOrderItems: 22,
      },
      trafficByDate: {
        pageViews: 1217,
        sessions: 898,
        buyBoxPercentage: 60.5,
        unitSessionPercentage: 2.56,
      },
    },
  ],
  salesAndTrafficByAsin: [
    {
      parentAsin: "B0FRJD231P",
      childAsin: "B0FRJD231P",
      sku: "MFS-0017",
      salesByAsin: { unitsOrdered: 95, orderedProductSales: { amount: 7409.15, currencyCode: "BRL" } },
      trafficByAsin: { sessions: 1767, pageViews: 2348 },
    },
  ],
};

describe("parseSalesTrafficByDateJson", () => {
  it("extrai 1 linha por dia, nivel conta, revenue em centavos", () => {
    const rows = parseSalesTrafficByDateJson(JSON.stringify(REPORT_REAL));
    expect(rows).toHaveLength(2);
    const [r0, r1] = rows;
    if (!r0 || !r1) throw new Error("faltaram linhas");

    expect(r0.data.toISOString()).toBe("2026-05-30T00:00:00.000Z");
    expect(r0.sessoes).toBe(850);
    expect(r0.pageViews).toBe(1145);
    expect(r0.unitsOrdered).toBe(14);
    expect(r0.orderedRevenueCentavos).toBe(81462);
    expect(r0.buyBoxPercent).toBe(55.39);
    expect(r0.conversaoPercent).toBe(1.65);
    expect(r0.currency).toBe("BRL");

    expect(r1.data.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(r1.orderedRevenueCentavos).toBe(135109);
    expect(r1.unitsOrdered).toBe(23);
  });

  it("ignora entradas sem date (nao da pra ancorar no tempo)", () => {
    const rows = parseSalesTrafficByDateJson(
      JSON.stringify({ salesAndTrafficByDate: [{ salesByDate: {}, trafficByDate: {} }] }),
    );
    expect(rows).toHaveLength(0);
  });

  it("usa fallback browser+mobile quando sessions/pageViews agregados faltam", () => {
    const rows = parseSalesTrafficByDateJson(
      JSON.stringify({
        salesAndTrafficByDate: [
          {
            date: "2026-06-02",
            salesByDate: { unitsOrdered: 1, orderedProductSales: { amount: 10, currencyCode: "BRL" } },
            trafficByDate: {
              browserSessions: 3,
              mobileAppSessions: 4,
              browserPageViews: 5,
              mobileAppPageViews: 6,
            },
          },
        ],
      }),
    );
    const [r0] = rows;
    if (!r0) throw new Error("faltou linha");
    expect(r0.sessoes).toBe(7);
    expect(r0.pageViews).toBe(11);
  });

  it("revenue ausente => 0 centavos, sem quebrar", () => {
    const rows = parseSalesTrafficByDateJson(
      JSON.stringify({
        salesAndTrafficByDate: [{ date: "2026-06-03", salesByDate: { unitsOrdered: 0 }, trafficByDate: {} }],
      }),
    );
    const [r0] = rows;
    if (!r0) throw new Error("faltou linha");
    expect(r0.orderedRevenueCentavos).toBe(0);
    expect(r0.unitsOrdered).toBe(0);
  });
});
