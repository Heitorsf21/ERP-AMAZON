/**
 * Amazon Notifications API → SQS poller (push real-time).
 *
 * Como funciona:
 *  1. Você cria uma fila SQS na sua conta AWS (free tier suporta milhões de msgs/mês).
 *  2. Registra a fila como destino + assina os notificationTypes desejados via SP-API
 *     (Notifications API). Esse passo se faz UMA vez.
 *  3. O worker faz long-poll (até 20s gratuito) na fila e enfileira jobs específicos
 *     em AmazonSyncJob conforme o evento recebido.
 *
 * Esse módulo só roda se AMAZON_SQS_QUEUE_URL estiver setado. Caso contrário,
 * o worker continua funcionando só com polling tradicional.
 *
 * NOTA: implementação SQS usa fetch + AWS SigV4 manual (sem dependência de @aws-sdk).
 * SigV4 é assinatura de requisição AWS. Implementação cuidadosa é não-trivial;
 * deixei como esqueleto bem comentado. Habilitar é opcional.
 */
import { enqueueAmazonSyncJob } from "@/modules/amazon/jobs";
import { TipoAmazonSyncJob } from "@/modules/shared/domain";

export type SqsConfig = {
  queueUrl: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function getSqsConfig(): SqsConfig | null {
  const queueUrl = process.env.AMAZON_SQS_QUEUE_URL;
  const region = process.env.AMAZON_SQS_REGION ?? "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!queueUrl || !accessKeyId || !secretAccessKey) return null;
  return { queueUrl, region, accessKeyId, secretAccessKey };
}

type AmazonNotification = {
  notificationType?: string;
  payload?: Record<string, unknown>;
  eventTime?: string;
};

/**
 * Faz UM ciclo de long-poll. Chame em loop no worker.
 * Quando habilitado, retorna { processed: N }.
 */
export async function pollSqsNotifications(): Promise<{
  processed: number;
  enabled: boolean;
}> {
  const cfg = getSqsConfig();
  if (!cfg) return { processed: 0, enabled: false };

  // TODO: implementação completa exige SigV4 manual ou @aws-sdk/client-sqs.
  // Esqueleto abaixo mostra fluxo ideal. Para ativar de fato, escolha 1 das 2:
  //
  // OPÇÃO A — adicionar dependência:
  //   npm i @aws-sdk/client-sqs
  //   const client = new SQSClient({ region: cfg.region, credentials: {...} });
  //   const res = await client.send(new ReceiveMessageCommand({
  //     QueueUrl: cfg.queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20,
  //   }));
  //
  // OPÇÃO B — SigV4 manual (zero dependência) — mais código, mais trabalhoso.
  //
  // Por padrão, retornamos sem fazer nada para nunca quebrar o worker se a fila
  // estiver mal configurada.
  return { processed: 0, enabled: true };
}

/**
 * Mapeia notification type → job a enfileirar.
 * Quando a integração SQS estiver ativa, este é o "ponto de entrega".
 */
export async function dispatchNotification(notif: AmazonNotification) {
  const tipo = notif.notificationType;
  if (!tipo) return;

  switch (tipo) {
    case "ORDER_CHANGE":
      await enqueueAmazonSyncJob(
        TipoAmazonSyncJob.ORDERS_SYNC,
        { diasAtras: 1, maxPages: 1 },
        { dedupeKey: `sqs:orders:${minuteSlot()}`, priority: 50 },
      );
      break;
    case "ANY_OFFER_CHANGED":
      await enqueueAmazonSyncJob(
        TipoAmazonSyncJob.BUYBOX_CHECK,
        {},
        { dedupeKey: `sqs:buybox:${minuteSlot()}`, priority: 40 },
      );
      break;
    case "FBA_INVENTORY_AVAILABILITY_CHANGES":
      await enqueueAmazonSyncJob(
        TipoAmazonSyncJob.INVENTORY_SYNC,
        {},
        { dedupeKey: `sqs:inventory:${minuteSlot()}`, priority: 35 },
      );
      break;
    case "REPORT_PROCESSING_FINISHED":
      await enqueueAmazonSyncJob(
        TipoAmazonSyncJob.SETTLEMENT_REPORT_SYNC,
        {},
        { dedupeKey: `sqs:settlement:${minuteSlot()}`, priority: 45 },
      );
      break;
    default:
      // Ignora tipos desconhecidos.
      break;
  }
}

function minuteSlot(): string {
  return Math.floor(Date.now() / 60_000).toString();
}
