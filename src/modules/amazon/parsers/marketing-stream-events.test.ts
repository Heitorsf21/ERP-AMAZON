import { describe, expect, it } from "vitest";
import type { AmazonSqsNotification } from "@/lib/amazon-sqs";
import {
  getMarketingStreamDataset,
  isMarketingStreamNotification,
  parseMarketingStreamMessage,
} from "./marketing-stream-events";

const FROZEN_NOW = new Date("2026-05-21T15:30:00.000Z");

function buildTraffic(overrides: Record<string, unknown> = {}): AmazonSqsNotification {
  return {
    notificationVersion: "1.0",
    notificationType: "marketing-stream:sp-traffic",
    payload: {
      datasetId: "sp-traffic",
      marketplaceId: "ATVPDKIKX0DER",
      profileId: 123456789012345,
      timeWindowStart: "2026-05-21T14:00:00.000Z",
      timeWindowEnd: "2026-05-21T15:00:00.000Z",
      campaignId: "CAMP-1",
      adGroupId: "ADG-1",
      adId: "AD-1",
      currency: "BRL",
      clicks: 12,
      impressions: 1000,
      cost: 1_500_000, // 1.5 BRL → 150 centavos
      ...overrides,
    },
  };
}

function buildConversion(overrides: Record<string, unknown> = {}): AmazonSqsNotification {
  return {
    notificationType: "marketing-stream:sp-conversion",
    payload: {
      datasetId: "sp-conversion",
      marketplaceId: "ATVPDKIKX0DER",
      profileId: "999",
      timeWindowStart: "2026-05-21T14:00:00.000Z",
      campaignId: "CAMP-1",
      adGroupId: "ADG-1",
      adId: "AD-1",
      advertisedSku: "MFS-001",
      advertisedAsin: "B000001",
      currency: "BRL",
      attributedSales7d: 50_000_000, // 50 BRL → 5000 centavos
      attributedSales1d: 10_000_000,
      attributedUnitsOrdered7d: 2,
      attributedPurchases7d: 1,
      ...overrides,
    },
  };
}

describe("marketing-stream-events parser", () => {
  it("detecta dataset via payload.datasetId", () => {
    const notif = buildTraffic();
    expect(isMarketingStreamNotification(notif)).toBe(true);
    expect(getMarketingStreamDataset(notif)).toBe("sp-traffic");
  });

  it("detecta dataset via notificationType marketing-stream:<dataset>", () => {
    const notif: AmazonSqsNotification = {
      notificationType: "marketing-stream:sb-conversion",
      payload: {
        timeWindowStart: "2026-05-21T14:00:00.000Z",
        campaignId: "CAMP-2",
        profileId: "1",
      },
    };
    expect(getMarketingStreamDataset(notif)).toBe("sb-conversion");
  });

  it("retorna null para notificacao SP-API normal (ORDER_CHANGE)", () => {
    const notif: AmazonSqsNotification = {
      NotificationType: "ORDER_CHANGE",
      Payload: { OrderChangeNotification: { AmazonOrderId: "1" } },
    };
    expect(isMarketingStreamNotification(notif)).toBe(false);
    expect(getMarketingStreamDataset(notif)).toBeNull();
  });

  it("converte cost micro-BRL para centavos no sp-traffic", () => {
    const rows = parseMarketingStreamMessage(buildTraffic(), FROZEN_NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dataset: "sp-traffic",
      campaignId: "CAMP-1",
      adGroupId: "ADG-1",
      adId: "AD-1",
      profileId: "123456789012345",
      impressoes: 1000,
      cliques: 12,
      gastoCentavos: 150,
      vendasCentavos: 0,
      currencyCode: "BRL",
    });
  });

  it("snapa timeWindowStart para inicio da hora UTC", () => {
    const rows = parseMarketingStreamMessage(
      buildTraffic({ timeWindowStart: "2026-05-21T14:37:42.123Z" }),
      FROZEN_NOW,
    );
    expect(rows[0]?.horaInicio.toISOString()).toBe("2026-05-21T14:00:00.000Z");
  });

  it("usa attributedSales7d em sp-conversion (alinha com daily report)", () => {
    const rows = parseMarketingStreamMessage(buildConversion(), FROZEN_NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dataset: "sp-conversion",
      impressoes: 0,
      cliques: 0,
      gastoCentavos: 0,
      vendasCentavos: 5000,
      unidades: 2,
      pedidos: 1,
      sku: "MFS-001",
      asin: "B000001",
    });
  });

  it("cai para attributedSales1d se 7d ausente", () => {
    const notif = buildConversion({
      attributedSales7d: undefined,
      attributedSales1d: 20_000_000,
    });
    const rows = parseMarketingStreamMessage(notif, FROZEN_NOW);
    expect(rows[0]?.vendasCentavos).toBe(2000);
  });

  it("rejeita records sem timeWindowStart", () => {
    const notif = buildTraffic({ timeWindowStart: undefined });
    const rows = parseMarketingStreamMessage(notif, FROZEN_NOW);
    expect(rows).toHaveLength(0);
  });

  it("rejeita records sem campaignId", () => {
    const notif = buildTraffic({ campaignId: undefined });
    const rows = parseMarketingStreamMessage(notif, FROZEN_NOW);
    expect(rows).toHaveLength(0);
  });

  it("descarta records com mais de 7 dias de idade", () => {
    const notif = buildTraffic({ timeWindowStart: "2026-05-10T00:00:00.000Z" });
    const rows = parseMarketingStreamMessage(notif, FROZEN_NOW);
    expect(rows).toHaveLength(0);
  });

  it("aceita arrays de records no payload.records", () => {
    const notif: AmazonSqsNotification = {
      payload: {
        datasetId: "sp-traffic",
        records: [
          {
            timeWindowStart: "2026-05-21T14:00:00.000Z",
            campaignId: "C1",
            profileId: "1",
            cost: 1_000_000,
            clicks: 5,
            impressions: 100,
          },
          {
            timeWindowStart: "2026-05-21T15:00:00.000Z",
            campaignId: "C2",
            profileId: "1",
            cost: 2_000_000,
            clicks: 10,
            impressions: 200,
          },
        ],
      },
    };
    const rows = parseMarketingStreamMessage(notif, FROZEN_NOW);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.campaignId).toBe("C1");
    expect(rows[0]?.gastoCentavos).toBe(100);
    expect(rows[1]?.campaignId).toBe("C2");
    expect(rows[1]?.gastoCentavos).toBe(200);
  });

  it("zera gasto em datasets de conversao (so traffic carrega cost)", () => {
    const notif = buildConversion({ cost: 99_999_999 });
    const rows = parseMarketingStreamMessage(notif, FROZEN_NOW);
    expect(rows[0]?.gastoCentavos).toBe(0);
  });

  it("zera impressoes/cliques em datasets de conversao", () => {
    const notif = buildConversion({ impressions: 5, clicks: 2 });
    const rows = parseMarketingStreamMessage(notif, FROZEN_NOW);
    expect(rows[0]?.impressoes).toBe(0);
    expect(rows[0]?.cliques).toBe(0);
  });

  it("aceita sd-traffic e sb-traffic", () => {
    for (const dataset of ["sd-traffic", "sb-traffic"]) {
      const notif: AmazonSqsNotification = {
        payload: {
          datasetId: dataset,
          timeWindowStart: "2026-05-21T14:00:00.000Z",
          campaignId: "CAMP-X",
          profileId: "1",
          cost: 500_000,
          clicks: 3,
          impressions: 50,
        },
      };
      const rows = parseMarketingStreamMessage(notif, FROZEN_NOW);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.dataset).toBe(dataset);
      expect(rows[0]?.gastoCentavos).toBe(50);
    }
  });
});
