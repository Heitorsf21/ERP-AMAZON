/**
 * Amazon Notifications API -> SQS consumer.
 *
 * Official SP-API docs require SQS standard queues, duplicate-safe processing
 * and no ordering assumptions. We dedupe by NotificationMetadata.NotificationId
 * and keep AmazonNotification as an audit trail before creating local jobs.
 */
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from "@aws-sdk/client-sqs";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { enqueueAmazonSyncJob } from "@/modules/amazon/jobs";
import {
  getMarketingStreamDataset,
  type MarketingStreamDataset,
} from "@/modules/amazon/parsers/marketing-stream-events";
import { TipoAmazonSyncJob } from "@/modules/shared/domain";

const STREAM_INGEST_CHUNK = 500;

export type SqsConfig = {
  queueUrl: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export type PollSqsOptions = {
  maxMessages?: number;
  waitTimeSeconds?: number;
};

export type PollSqsResult = {
  processed: number;
  deleted: number;
  errors: number;
  enabled: boolean;
};

export type AmazonSqsNotification = {
  NotificationType?: string;
  notificationType?: string;
  EventTime?: string;
  eventTime?: string;
  Payload?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  NotificationMetadata?: NotificationMetadata;
  NotificationMetaData?: NotificationMetadata;
  notificationMetadata?: NotificationMetadata;
  [key: string]: unknown;
};

type NotificationMetadata = {
  ApplicationId?: string;
  SubscriptionId?: string;
  PublishTime?: string;
  NotificationId?: string;
  applicationId?: string;
  subscriptionId?: string;
  publishTime?: string;
  notificationId?: string;
};

const ORDER_ID_KEYS = new Set([
  "amazonorderid",
  "amazonorderids",
  "orderid",
  "orderids",
]);

const SETTLEMENT_REPORT_TYPE = "GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2";
const REPORT_TYPE_KEYS = new Set(["reporttype"]);
const REPORT_ID_KEYS = new Set(["reportid", "generatedreportid"]);

export function getSqsConfig(): SqsConfig | null {
  const queueUrl = process.env.AMAZON_SQS_QUEUE_URL;
  const region = process.env.AMAZON_SQS_REGION ?? process.env.AWS_REGION ?? "us-east-1";
  if (!queueUrl) {
    if (
      process.env.AMAZON_SQS_PRIMARY === "true" &&
      process.env.NODE_ENV === "production"
    ) {
      throw new Error("AMAZON_SQS_PRIMARY=true, mas AMAZON_SQS_QUEUE_URL nao foi configurado.");
    }
    return null;
  }

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  return {
    queueUrl,
    region,
    ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
  };
}

export async function pollSqsNotifications(
  options: PollSqsOptions = {},
): Promise<PollSqsResult> {
  const cfg = getSqsConfig();
  if (!cfg) return { processed: 0, deleted: 0, errors: 0, enabled: false };

  const client = new SQSClient({
    region: cfg.region,
    credentials:
      cfg.accessKeyId && cfg.secretAccessKey
        ? {
            accessKeyId: cfg.accessKeyId,
            secretAccessKey: cfg.secretAccessKey,
          }
        : undefined,
  });

  const response = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: cfg.queueUrl,
      MaxNumberOfMessages: Math.min(Math.max(options.maxMessages ?? 10, 1), 10),
      WaitTimeSeconds: Math.min(Math.max(options.waitTimeSeconds ?? 20, 0), 20),
      MessageAttributeNames: ["All"],
      AttributeNames: ["All"],
    }),
  );

  let processed = 0;
  let deleted = 0;
  let errors = 0;

  for (const message of response.Messages ?? []) {
    try {
      const result = await recordAndDispatchSqsMessage(message);
      processed += result.processed ? 1 : 0;

      if (message.ReceiptHandle) {
        await client.send(
          new DeleteMessageCommand({
            QueueUrl: cfg.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
        deleted += 1;
      }
    } catch (error) {
      errors += 1;
      console.error(
        "[amazon-sqs] erro ao processar mensagem:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { processed, deleted, errors, enabled: true };
}

export async function recordAndDispatchSqsMessage(
  message: Pick<Message, "Body" | "MessageId">,
): Promise<{ processed: boolean; notificationId: string; jobsCriadosIds: string[] }> {
  if (!message.Body) {
    throw new Error("Mensagem SQS sem Body.");
  }

  const notification = parseSqsNotificationBody(message.Body);

  // SNS SubscriptionConfirmation: precisa GET no SubscribeURL pra ativar o fluxo.
  // Marketing Stream entrega via SNS topics dedicados por dataset (primeira
  // mensagem de cada e sempre uma confirmacao). Confirmamos e marcamos como
  // processada — nao gera job de ingest.
  const snsType = typeof (notification as { Type?: string }).Type === "string"
    ? (notification as { Type?: string }).Type
    : null;
  if (snsType === "SubscriptionConfirmation") {
    const notificationId =
      message.MessageId ??
      createHash("sha256").update(message.Body).digest("hex");
    const result = await confirmSnsSubscription(notification);
    const topicArn = result.topicArn ?? "";
    const notificationType = `SNS_SUBSCRIPTION_CONFIRMATION:${topicArn}`;
    await db.amazonNotification.upsert({
      where: { notificationId },
      create: {
        notificationId,
        notificationType,
        payloadJson: JSON.stringify(notification),
        rawJson: message.Body,
        processadoEm: result.confirmed ? new Date() : null,
        erro: result.error ?? null,
        jobsCriadosIds: JSON.stringify([]),
      },
      update: {
        notificationType,
        payloadJson: JSON.stringify(notification),
        rawJson: message.Body,
        processadoEm: result.confirmed ? new Date() : null,
        erro: result.error ?? null,
      },
    });
    if (!result.confirmed) {
      throw new Error(`SubscriptionConfirmation falhou: ${result.error}`);
    }
    return { processed: true, notificationId, jobsCriadosIds: [] };
  }

  const streamDataset = getMarketingStreamDataset(notification);
  const notificationType = streamDataset
    ? `MARKETING_STREAM:${streamDataset}`
    : getNotificationType(notification);
  if (!notificationType) {
    throw new Error("Notificacao SQS sem NotificationType.");
  }

  const notificationId =
    getNotificationId(notification) ??
    message.MessageId ??
    createHash("sha256").update(message.Body).digest("hex");

  const existing = await db.amazonNotification.findUnique({
    where: { notificationId },
    select: { processadoEm: true, jobsCriadosIds: true },
  });

  if (existing?.processadoEm) {
    return {
      processed: false,
      notificationId,
      jobsCriadosIds: parseJobsCriadosIds(existing.jobsCriadosIds),
    };
  }

  const payload = getPayload(notification);
  const metadata = getMetadata(notification);
  const eventTime = parseOptionalDate(notification.EventTime ?? notification.eventTime);
  const publishTime = parseOptionalDate(metadata?.PublishTime ?? metadata?.publishTime);

  await db.amazonNotification.upsert({
    where: { notificationId },
    create: {
      notificationId,
      notificationType,
      eventTime,
      publishTime,
      payloadJson: JSON.stringify(payload ?? {}),
      rawJson: JSON.stringify(notification),
    },
    update: {
      notificationType,
      eventTime,
      publishTime,
      payloadJson: JSON.stringify(payload ?? {}),
      rawJson: JSON.stringify(notification),
      erro: null,
    },
  });

  try {
    const jobsCriadosIds = streamDataset
      ? await dispatchMarketingStreamNotification(
          notification,
          notificationId,
          streamDataset,
        )
      : await dispatchNotification(notification, notificationId);
    await db.amazonNotification.update({
      where: { notificationId },
      data: {
        processadoEm: new Date(),
        jobsCriadosIds: JSON.stringify(jobsCriadosIds),
        erro: null,
      },
    });
    return { processed: true, notificationId, jobsCriadosIds };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await db.amazonNotification.update({
      where: { notificationId },
      data: { erro: messageText },
    });
    throw error;
  }
}

export async function dispatchNotification(
  notif: AmazonSqsNotification,
  notificationId = getNotificationId(notif) ?? minuteSlot(),
): Promise<string[]> {
  const tipo = getNotificationType(notif);
  if (!tipo) return [];

  const basePayload = {
    notificationId,
    eventTime: notif.EventTime ?? notif.eventTime ?? null,
    payload: getPayload(notif) ?? {},
  };

  switch (tipo) {
    case "ORDER_CHANGE": {
      const orderIds = extractOrderIdsFromNotification(notif);
      const job = await enqueueAmazonSyncJob(
        TipoAmazonSyncJob.ORDERS_SYNC,
        {
          ...(orderIds.length > 0
            ? { orderIds }
            : { diasAtras: 1, maxPages: 1 }),
          ...basePayload,
        },
        { dedupeKey: `sqs:${tipo}:${notificationId}`, priority: 50 },
      );
      return [job.id];
    }
    case "ANY_OFFER_CHANGED": {
      const job = await enqueueAmazonSyncJob(
        TipoAmazonSyncJob.BUYBOX_CHECK,
        basePayload,
        { dedupeKey: `sqs:${tipo}:${notificationId}`, priority: 40 },
      );
      return [job.id];
    }
    case "FBA_INVENTORY_AVAILABILITY_CHANGES": {
      const dedupeSlot = Math.floor(Date.now() / (5 * 60_000));
      const job = await enqueueAmazonSyncJob(
        TipoAmazonSyncJob.INVENTORY_SYNC,
        basePayload,
        {
          dedupeKey: `sqs:${tipo}:${dedupeSlot}`,
          dedupeAnyStatus: true,
          priority: 35,
        },
      );
      return [job.id];
    }
    case "REPORT_PROCESSING_FINISHED": {
      const reportInfo = extractReportProcessingInfo(notif);
      if (reportInfo.reportType !== SETTLEMENT_REPORT_TYPE) return [];

      const job = await enqueueAmazonSyncJob(
        TipoAmazonSyncJob.SETTLEMENT_REPORT_SYNC,
        {
          ...basePayload,
          reportType: reportInfo.reportType,
          reportId: reportInfo.reportId ?? null,
        },
        {
          dedupeKey: `sqs:${tipo}:${reportInfo.reportId ?? notificationId}`,
          priority: 45,
        },
      );
      return [job.id];
    }
    case "LISTINGS_ITEM_STATUS_CHANGE":
      // Sprint 5 keeps Listings read-only. The notification is audited here;
      // the user can inspect the SKU through the read-only diff action.
      return [];
    default:
      return [];
  }
}

export async function dispatchMarketingStreamNotification(
  notif: AmazonSqsNotification,
  notificationId: string,
  dataset: MarketingStreamDataset,
): Promise<string[]> {
  const records = extractMarketingStreamRecords(notif);
  const chunks: unknown[][] = [];
  if (records.length === 0) {
    chunks.push([]);
  } else {
    for (let i = 0; i < records.length; i += STREAM_INGEST_CHUNK) {
      chunks.push(records.slice(i, i + STREAM_INGEST_CHUNK));
    }
  }

  const jobIds: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const job = await enqueueAmazonSyncJob(
      TipoAmazonSyncJob.AMAZON_ADS_STREAM_INGEST,
      {
        dataset,
        records: chunks[i],
        notificationId,
      },
      {
        dedupeKey: `sqs:MARKETING_STREAM:${dataset}:${notificationId}:${i}`,
        priority: 30,
      },
    );
    jobIds.push(job.id);
  }
  return jobIds;
}

function extractMarketingStreamRecords(notif: AmazonSqsNotification): unknown[] {
  const payload = getPayload(notif);
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.records)) return obj.records;
    if (Array.isArray(obj.Records)) return obj.Records;
    return [payload];
  }
  return [notif as unknown];
}

export function parseSqsNotificationBody(body: string): AmazonSqsNotification {
  const parsed = parseJsonObject(body);

  // SubscriptionConfirmation / UnsubscribeConfirmation: o campo Message e texto plano
  // ("You have chosen to subscribe..."). NAO tentar parsear como JSON.
  const type = typeof parsed.Type === "string" ? parsed.Type : null;
  if (type === "SubscriptionConfirmation" || type === "UnsubscribeConfirmation") {
    return parsed as AmazonSqsNotification;
  }

  // Envelope SNS "Notification" tipico: Message contem JSON encadeado.
  if (typeof parsed.Message === "string") {
    try {
      return parseJsonObject(parsed.Message) as AmazonSqsNotification;
    } catch {
      // Message nao e JSON — retorna o envelope cru pra o dispatcher decidir.
      return parsed as AmazonSqsNotification;
    }
  }

  return parsed as AmazonSqsNotification;
}

/**
 * Allowlist defense-in-depth: SubscribeURL legitima da AWS sempre vem de
 * sns.<region>.amazonaws.com. Bloqueia SSRF via payload SQS adulterado
 * apontando para IMDS (169.254.169.254), hosts internos ou domínios externos.
 */
export const AWS_SNS_URL_RE = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//i;

/**
 * Confirma uma subscription SNS pendente (fetch GET no SubscribeURL).
 * Marketing Stream entrega via SNS topics dedicados por dataset; a primeira
 * mensagem de cada subscription e um SubscriptionConfirmation que precisa
 * de HTTP GET no SubscribeURL para ativar o fluxo de dados.
 */
async function confirmSnsSubscription(
  notification: AmazonSqsNotification,
): Promise<{ confirmed: boolean; topicArn: string | null; error?: string }> {
  const subscribeUrl =
    (notification as { SubscribeURL?: string }).SubscribeURL ??
    (notification as { subscribeURL?: string }).subscribeURL ??
    null;
  const topicArn =
    (notification as { TopicArn?: string }).TopicArn ??
    (notification as { topicArn?: string }).topicArn ??
    null;
  if (!subscribeUrl) {
    return { confirmed: false, topicArn, error: "SubscribeURL ausente." };
  }
  if (!AWS_SNS_URL_RE.test(subscribeUrl)) {
    return {
      confirmed: false,
      topicArn,
      error: "SubscribeURL host invalido (fora do allowlist sns.<region>.amazonaws.com).",
    };
  }
  const response = await fetch(subscribeUrl, { method: "GET" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      confirmed: false,
      topicArn,
      error: `SubscribeURL ${response.status}: ${text.slice(0, 200)}`,
    };
  }
  return { confirmed: true, topicArn };
}

export function extractOrderIdsFromNotification(
  notification: AmazonSqsNotification,
): string[] {
  const ids = new Set<string>();
  visitNotificationRecords(getPayload(notification) ?? notification, (record) => {
    for (const [key, value] of Object.entries(record)) {
      if (!ORDER_ID_KEYS.has(normalizeNotificationKey(key))) continue;
      for (const id of normalizeOrderIdValues(value)) ids.add(id);
    }
  });
  return [...ids];
}

export function extractReportProcessingInfo(
  notification: AmazonSqsNotification,
): { reportType: string | null; reportId: string | null } {
  let reportType: string | null = null;
  let reportId: string | null = null;

  visitNotificationRecords(getPayload(notification) ?? notification, (record) => {
    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = normalizeNotificationKey(key);
      if (!reportType && REPORT_TYPE_KEYS.has(normalizedKey)) {
        reportType = normalizeSingleString(value);
      }
      if (!reportId && REPORT_ID_KEYS.has(normalizedKey)) {
        reportId = normalizeSingleString(value);
      }
    }
  });

  return { reportType, reportId };
}

function getNotificationType(notification: AmazonSqsNotification): string | null {
  return notification.NotificationType ?? notification.notificationType ?? null;
}

function getPayload(notification: AmazonSqsNotification): Record<string, unknown> | null {
  return notification.Payload ?? notification.payload ?? null;
}

function getMetadata(notification: AmazonSqsNotification): NotificationMetadata | null {
  return (
    notification.NotificationMetadata ??
    notification.NotificationMetaData ??
    notification.notificationMetadata ??
    null
  );
}

function getNotificationId(notification: AmazonSqsNotification): string | null {
  const metadata = getMetadata(notification);
  return metadata?.NotificationId ?? metadata?.notificationId ?? null;
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Body SQS nao e um objeto JSON.");
  }
  return parsed as Record<string, unknown>;
}

function parseOptionalDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseJobsCriadosIds(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function minuteSlot(): string {
  return Math.floor(Date.now() / 60_000).toString();
}

function normalizeNotificationKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeOrderIdValues(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(normalizeOrderIdValues);
  }
  return [];
}

function normalizeSingleString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function visitNotificationRecords(
  value: unknown,
  visitor: (record: Record<string, unknown>) => void,
  depth = 0,
) {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) visitNotificationRecords(item, visitor, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  visitor(record);
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      visitNotificationRecords(child, visitor, depth + 1);
    }
  }
}
