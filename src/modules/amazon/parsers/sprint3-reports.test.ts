import { describe, expect, it } from "vitest";
import { parseFbaReimbursementsTsv } from "./fba-reimbursements-tsv";
import { parseFbaReturnsTsv } from "./fba-returns-tsv";
import { parseFbaStorageFeesTsv } from "./fba-storage-fees-tsv";
import { parseSalesTrafficJson } from "./sales-traffic-json";

describe("Sprint 3 Amazon report parsers", () => {
  it("parses FBA reimbursements TSV with normalized headers and money", () => {
    const input = [
      "reimbursement-id\tcase-id\tapproval-date\tsku\tfnsku\tasin\treason\tamount-total\tquantity-reimbursed-total\tcurrency-unit",
      "R123\tCASE-1\t2026-04-20\tMFS-001\tFN001\tB000001\tLost_Warehouse\t1,234.56\t2\tBRL",
      "",
    ].join("\n");

    const rows = parseFbaReimbursementsTsv(input);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reimbursementId: "R123",
      caseId: "CASE-1",
      sku: "MFS-001",
      fnSku: "FN001",
      asin: "B000001",
      reason: "Lost_Warehouse",
      amountTotalCentavos: 123456,
      quantityTotal: 2,
      currency: "BRL",
    });
    expect(rows[0]?.naturalKey).toContain("R123");
  });

  it("parses FBA returns TSV with default quantity and absent optional fields", () => {
    const input = [
      "return_date\torder-id\tsku\tasin\treason\tstatus\tdetailed-disposition",
      "27/04/2026\tORDER-1\tMFS-002\tB000002\tCustomerReturn\tCompleted\tSELLABLE",
    ].join("\n");

    const rows = parseFbaReturnsTsv(input);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tipoReport: "FBA",
      amazonOrderId: "ORDER-1",
      sku: "MFS-002",
      asin: "B000002",
      quantity: 1,
      reason: "CustomerReturn",
      status: "Completed",
      detailedDisposition: "SELLABLE",
    });
    expect(rows[0]?.returnDate?.toISOString()).toContain("2026-04-27");
  });

  it("parses FBA storage fees TSV with Brazilian decimal format", () => {
    const input = [
      "asin\tfnsku\tmonth-of-charge\tfulfillment-center\tcountry-code\testimated-monthly-storage-fee\testimated-total-item-volume\taverage-quantity-on-hand",
      "B000003\tFN003\t04/2026\tGRU1\tBR\t1.234,56\t12,5\t30",
    ].join("\n");

    const rows = parseFbaStorageFeesTsv(input);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      asin: "B000003",
      fnSku: "FN003",
      fulfillmentCenter: "GRU1",
      countryCode: "BR",
      storageFeeCentavos: 123456,
      estimatedTotalItemVolume: 12.5,
      averageQuantityOnHand: 30,
    });
    expect(rows[0]?.monthOfCharge?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("parses Sales & Traffic JSON at SKU/day granularity", () => {
    const rows = parseSalesTrafficJson(
      JSON.stringify({
        salesAndTrafficByAsin: [
          {
            date: "2026-04-25",
            parentAsin: "PARENT1",
            childAsin: "CHILD1",
            sku: "MFS-004",
            salesByAsin: {
              unitsOrdered: 7,
              orderedProductSales: { amount: "345.67", currencyCode: "BRL" },
            },
            trafficByAsin: {
              sessions: 100,
              pageViews: 160,
              buyBoxPercentage: 92.5,
              unitSessionPercentage: 7,
            },
          },
        ],
      }),
      new Date("2026-04-24T00:00:00.000Z"),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      naturalKey: "MFS-004|2026-04-25T00:00:00.000Z",
      sku: "MFS-004",
      parentAsin: "PARENT1",
      childAsin: "CHILD1",
      sessoes: 100,
      pageViews: 160,
      unitsOrdered: 7,
      buyBoxPercent: 92.5,
      conversaoPercent: 7,
      orderedRevenueCentavos: 34567,
      currency: "BRL",
    });
  });
});
