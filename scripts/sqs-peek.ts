/** Peek na fila sem deletar (visibility timeout curto). Mostra body bruto. */
import {
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

async function main() {
  const c = new SQSClient({
    region: process.env.AMAZON_SQS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  const r = await c.send(
    new ReceiveMessageCommand({
      QueueUrl: process.env.AMAZON_SQS_QUEUE_URL,
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 5,
      WaitTimeSeconds: 5,
      MessageAttributeNames: ["All"],
      AttributeNames: ["All"],
    }),
  );

  const msgs = r.Messages ?? [];
  console.log(`# Mensagens visiveis: ${msgs.length}`);
  for (const [i, m] of msgs.entries()) {
    console.log(`\n=== Mensagem ${i + 1} ===`);
    console.log(`MessageId: ${m.MessageId}`);
    console.log(`Body (raw):`);
    console.log(m.Body);
    console.log(`---`);
    console.log(`Body (first 200 chars): ${m.Body?.slice(0, 200)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
