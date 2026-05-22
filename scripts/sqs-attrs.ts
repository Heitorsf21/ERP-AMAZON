/** Inspect SQS queue encryption + attrs. */
import { SQSClient, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";

async function main() {
  const c = new SQSClient({
    region: process.env.AMAZON_SQS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  const r = await c.send(
    new GetQueueAttributesCommand({
      QueueUrl: process.env.AMAZON_SQS_QUEUE_URL,
      AttributeNames: ["All"],
    }),
  );
  console.log(JSON.stringify(r.Attributes, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
