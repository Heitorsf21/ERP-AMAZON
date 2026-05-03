import { describe, expect, it } from "vitest";
import {
  extractOrderIdsFromNotification,
  parseSqsNotificationBody,
} from "@/lib/amazon-sqs";

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
});
