import { describe, expect, it } from "vitest";
import type { AdsReportRow } from "@/lib/amazon-ads-api";
import { parseSpSearchTermRows, parseSpTargetingRows } from "./sp-optimizer-reports";

describe("sp optimizer report parsers", () => {
  it("parses Sponsored Products targeting keyword rows", () => {
    const rows: AdsReportRow[] = [
      {
        date: "2026-05-30",
        campaignId: "camp-1",
        campaignName: "Campanha manual",
        adGroupId: "ag-1",
        adGroupName: "Grupo 1",
        keywordId: "kw-1",
        keywordText: "garrafa termica",
        matchType: "BROAD",
        advertisedSku: "SKU-1",
        impressions: 100,
        clicks: 25,
        cost: 12.34,
        sales7d: 0,
        purchases7d: 0,
        unitsSoldClicks7d: 0,
      },
    ];

    const parsed = parseSpTargetingRows(rows);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      campaignId: "camp-1",
      adGroupId: "ag-1",
      entityType: "KEYWORD",
      entityId: "kw-1",
      keywordId: "kw-1",
      keywordText: "garrafa termica",
      sku: "SKU-1",
      cliques: 25,
      gastoCentavos: 1234,
      vendasCentavos: 0,
      pedidos: 0,
      acos: null,
    });
    expect(parsed[0]?.data.toISOString()).toBe("2026-05-30T00:00:00.000Z");
    expect(parsed[0]?.naturalKey).toHaveLength(24);
  });

  it("parses Sponsored Products targeting target rows", () => {
    const parsed = parseSpTargetingRows([
      {
        date: "2026-05-30",
        campaignId: "camp-2",
        adGroupId: "ag-2",
        targetId: "target-1",
        targeting: "asin=ABC123",
        targetingType: "MANUAL",
        clicks: 10,
        cost: "10,50",
        sales7d: "100,00",
        purchases7d: "2",
      },
    ]);

    expect(parsed[0]).toMatchObject({
      entityType: "TARGET",
      entityId: "target-1",
      targetId: "target-1",
      targetingText: "asin=ABC123",
      matchType: "MANUAL",
      gastoCentavos: 1050,
      vendasCentavos: 10000,
      pedidos: 2,
      acos: 0.105,
    });
  });

  it("parses search term rows and includes the term in the natural key", () => {
    const baseRow: AdsReportRow = {
      date: "2026-05-30",
      campaignId: "camp-1",
      adGroupId: "ag-1",
      keywordId: "kw-1",
      keywordText: "garrafa",
      searchTerm: "garrafa termica inox",
      matchType: "BROAD",
      clicks: 8,
      cost: 5,
      sales7d: 50,
      purchases7d: 1,
    };

    const targeting = parseSpTargetingRows([baseRow])[0];
    const searchTerms = parseSpSearchTermRows([baseRow]);

    expect(searchTerms).toHaveLength(1);
    expect(searchTerms[0]).toMatchObject({
      entityType: "KEYWORD",
      keywordId: "kw-1",
      searchTerm: "garrafa termica inox",
      gastoCentavos: 500,
      vendasCentavos: 5000,
      pedidos: 1,
    });
    expect(searchTerms[0]?.naturalKey).not.toBe(targeting?.naturalKey);
  });

  it("drops search term rows without campaign or term", () => {
    expect(parseSpSearchTermRows([{ campaignId: "camp-1" }])).toEqual([]);
    expect(parseSpSearchTermRows([{ searchTerm: "missing campaign" }])).toEqual([]);
  });
});
