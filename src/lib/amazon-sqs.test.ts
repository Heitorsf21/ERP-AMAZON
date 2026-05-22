import { describe, expect, it } from "vitest";
import {
  extractReportProcessingInfo,
  extractOrderIdsFromNotification,
  parseSqsNotificationBody,
} from "@/lib/amazon-sqs";
import { getMarketingStreamDataset } from "@/modules/amazon/parsers/marketing-stream-events";

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
