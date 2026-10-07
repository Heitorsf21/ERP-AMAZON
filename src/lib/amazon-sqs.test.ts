import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, pushMock, jobsMock } = vi.hoisted(() => ({
  dbMock: {
    amazonAccount: { findFirst: vi.fn() },
    amazonNotification: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    configuracaoSistema: { findUnique: vi.fn() },
  },
  pushMock: { notificarVendaDeOrderChange: vi.fn() },
  jobsMock: { enqueueAmazonSyncJob: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/modules/push/vendas", () => pushMock);
vi.mock("@/modules/amazon/jobs", () => jobsMock);

import {
  extrairSellerIdDaNotification,
  extractReportProcessingInfo,
  extractOrderIdsFromNotification,
  parseSqsNotificationBody,
  podeAvisarVendaDaNotification,
  recordAndDispatchSqsMessage,
} from "@/lib/amazon-sqs";
import { getEmpresaId, runWithTenant } from "@/lib/tenant-context";
import { getMarketingStreamDataset } from "@/modules/amazon/parsers/marketing-stream-events";

describe("extrairSellerIdDaNotification", () => {
  it("ORDER_CHANGE: SellerId no nivel do OrderChangeNotification", () => {
    expect(
      extrairSellerIdDaNotification({
        NotificationType: "ORDER_CHANGE",
        Payload: {
          OrderChangeNotification: {
            SellerId: "A3GE607PEM4478",
            AmazonOrderId: "702-1",
          },
        },
      }),
    ).toBe("A3GE607PEM4478");
  });

  it("ANY_OFFER_CHANGED: sellerId aninhado no trigger", () => {
    expect(
      extrairSellerIdDaNotification({
        NotificationType: "ANY_OFFER_CHANGED",
        Payload: {
          AnyOfferChangedNotification: {
            OfferChangeTrigger: { MarketplaceId: "A2Q3Y263D00KWC" },
            SellerId: "AUDN123456789",
          },
        },
      }),
    ).toBe("AUDN123456789");
  });

  it("FBA_INVENTORY: sellingPartnerId em camelCase", () => {
    expect(
      extrairSellerIdDaNotification({
        NotificationType: "FBA_INVENTORY_AVAILABILITY_CHANGES",
        payload: { sellingPartnerId: "A3GE607PEM4478" },
      }),
    ).toBe("A3GE607PEM4478");
  });

  it("sem sellerId em lugar nenhum: null (segue na empresa do contexto)", () => {
    expect(
      extrairSellerIdDaNotification({
        NotificationType: "REPORT_PROCESSING_FINISHED",
        Payload: {
          ReportProcessingFinishedNotification: {
            ReportId: "123",
            ReportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2",
          },
        },
      }),
    ).toBeNull();
  });
});

describe("amazon-sqs", () => {
  it("parseia notificacao SP-API direta", () => {
    const notification = parseSqsNotificationBody(
      JSON.stringify({
        NotificationType: "ORDER_CHANGE",
        EventTime: "2026-04-29T12:00:00Z",
        Payload: { AmazonOrderId: "123-1234567-1234567" },
        NotificationMetadata: {
          NotificationId: "notif-1",
          PublishTime: "2026-04-29T12:00:01Z",
        },
      }),
    );

    expect(notification.NotificationType).toBe("ORDER_CHANGE");
    expect(notification.NotificationMetadata?.NotificationId).toBe("notif-1");
  });

  it("parseia envelope SNS quando a fila estiver encadeada", () => {
    const notification = parseSqsNotificationBody(
      JSON.stringify({
        Type: "Notification",
        Message: JSON.stringify({
          NotificationType: "LISTINGS_ITEM_STATUS_CHANGE",
          Payload: { SellerID: "seller", Sku: "MFS-001" },
          NotificationMetadata: { NotificationId: "notif-2" },
        }),
      }),
    );

    expect(notification.NotificationType).toBe("LISTINGS_ITEM_STATUS_CHANGE");
    expect(notification.Payload?.Sku).toBe("MFS-001");
  });

  it("extrai AmazonOrderId de ORDER_CHANGE direto ou aninhado", () => {
    const notification = parseSqsNotificationBody(
      JSON.stringify({
        NotificationType: "ORDER_CHANGE",
        Payload: {
          OrderChangeNotification: {
            AmazonOrderId: "701-1234567-1234567",
          },
          OrderIds: ["702-1234567-1234567"],
        },
      }),
    );

    expect(extractOrderIdsFromNotification(notification).sort()).toEqual([
      "701-1234567-1234567",
      "702-1234567-1234567",
    ]);
  });

  it("extrai reportType e reportId de REPORT_PROCESSING_FINISHED aninhado", () => {
    const notification = parseSqsNotificationBody(
      JSON.stringify({
        NotificationType: "REPORT_PROCESSING_FINISHED",
        Payload: {
          ReportProcessingFinishedNotification: {
            ReportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2",
            ReportId: "1234567890",
          },
        },
      }),
    );

    expect(extractReportProcessingInfo(notification)).toEqual({
      reportType: "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2",
      reportId: "1234567890",
    });
  });

  it("detecta mensagem Marketing Stream via payload.datasetId", () => {
    const notification = parseSqsNotificationBody(
      JSON.stringify({
        notificationVersion: "1.0",
        notificationType: "marketing-stream:sp-traffic",
        payload: {
          datasetId: "sp-traffic",
          timeWindowStart: "2026-05-21T14:00:00.000Z",
          campaignId: "C1",
          profileId: "1",
          cost: 1_000_000,
        },
      }),
    );

    expect(getMarketingStreamDataset(notification)).toBe("sp-traffic");
  });

  it("nao confunde notificacao SP-API normal com Marketing Stream", () => {
    const notification = parseSqsNotificationBody(
      JSON.stringify({
        NotificationType: "ORDER_CHANGE",
        Payload: { AmazonOrderId: "1" },
      }),
    );
    expect(getMarketingStreamDataset(notification)).toBeNull();
  });

  it("extrai reportType de reports nao-settlement para o dispatcher ignorar", () => {
    const notification = parseSqsNotificationBody(
      JSON.stringify({
        NotificationType: "REPORT_PROCESSING_FINISHED",
        Payload: {
          reportType: "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
          reportId: "orders-report",
        },
      }),
    );

    expect(extractReportProcessingInfo(notification)).toEqual({
      reportType: "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
      reportId: "orders-report",
    });
  });
});

describe("aviso de venda só na loja dona do SellerId", () => {
  it("regra pura: resolvido avisa; não resolvido só se for o seller do contexto", () => {
    expect(
      podeAvisarVendaDaNotification({ sellerIdNotificacao: "AUDN1", empresaResolvida: "udncd", sellerIdDoContexto: null }),
    ).toBe(true);
    expect(
      podeAvisarVendaDaNotification({ sellerIdNotificacao: "AMFS1", empresaResolvida: null, sellerIdDoContexto: "AMFS1" }),
    ).toBe(true);
    expect(
      podeAvisarVendaDaNotification({ sellerIdNotificacao: "AUDN1", empresaResolvida: null, sellerIdDoContexto: "AMFS1" }),
    ).toBe(false);
    expect(
      podeAvisarVendaDaNotification({ sellerIdNotificacao: "AUDN1", empresaResolvida: null, sellerIdDoContexto: null }),
    ).toBe(false);
    expect(
      podeAvisarVendaDaNotification({ sellerIdNotificacao: null, empresaResolvida: null, sellerIdDoContexto: "AMFS1" }),
    ).toBe(false);
  });

  function mensagem(sellerId: string, id: string) {
    return {
      MessageId: id,
      Body: JSON.stringify({
        NotificationType: "ORDER_CHANGE",
        Payload: {
          OrderChangeNotification: {
            SellerId: sellerId,
            AmazonOrderId: "702-4417820-3391045",
            Summary: { OrderStatus: "Pending", PurchaseDate: "2026-10-06T22:33:10Z" },
          },
        },
        NotificationMetadata: { NotificationId: id },
      }),
    };
  }

  const contextoConsumidor = <T>(fn: () => T) =>
    runWithTenant({ empresaId: "mundofs", isSuperAdmin: false, source: "worker" }, fn);

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.amazonNotification.findUnique.mockResolvedValue(null);
    dbMock.amazonNotification.upsert.mockResolvedValue({});
    dbMock.amazonNotification.update.mockResolvedValue({});
    jobsMock.enqueueAmazonSyncJob.mockResolvedValue({ id: "job1" });
    pushMock.notificarVendaDeOrderChange.mockResolvedValue(undefined);
  });

  it("SellerId sem AmazonAccount ativa e diferente do seller da primária: não avisa na loja errada", async () => {
    dbMock.amazonAccount.findFirst.mockResolvedValue(null);
    dbMock.configuracaoSistema.findUnique.mockResolvedValue({ valor: "AMFS-PRIMARIA" });
    await contextoConsumidor(() => recordAndDispatchSqsMessage(mensagem("AUDN-SEM-CONTA", "n-1")));
    expect(pushMock.notificarVendaDeOrderChange).not.toHaveBeenCalled();
    expect(jobsMock.enqueueAmazonSyncJob).toHaveBeenCalledTimes(1);
  });

  it("SellerId sem AmazonAccount mas igual ao seller legado da primária: avisa", async () => {
    dbMock.amazonAccount.findFirst.mockResolvedValue(null);
    dbMock.configuracaoSistema.findUnique.mockResolvedValue({ valor: "AMFS-LEGADO" });
    await contextoConsumidor(() => recordAndDispatchSqsMessage(mensagem("AMFS-LEGADO", "n-2")));
    expect(pushMock.notificarVendaDeOrderChange).toHaveBeenCalledTimes(1);
  });

  it("SellerId resolvido: avisa dentro do tenant da empresa dona", async () => {
    dbMock.amazonAccount.findFirst.mockResolvedValue({ empresaId: "udncd" });
    let empresaNoAviso: string | null = null;
    pushMock.notificarVendaDeOrderChange.mockImplementation(async () => {
      empresaNoAviso = getEmpresaId();
    });
    await contextoConsumidor(() => recordAndDispatchSqsMessage(mensagem("AUDN-COM-CONTA", "n-3")));
    expect(pushMock.notificarVendaDeOrderChange).toHaveBeenCalledTimes(1);
    expect(empresaNoAviso).toBe("udncd");
  });
});
