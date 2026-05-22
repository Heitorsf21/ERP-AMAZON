/**
 * Aplica (ou remove) o Statement de Marketing Stream na policy SQS.
 *
 * Marketing Stream precisa de:
 *  - Principal: marketing-stream.amazonaws.com (service)
 *  - Actions: sqs:SendMessage + sqs:GetQueueAttributes
 *  - Condition: aws:SourceAccount = <conta Amazon Ads NA = 906013806264>
 *
 * Esse script:
 *  1. Le a Policy atual da fila (preserva Statements existentes — ex: SP-API)
 *  2. Adiciona (idempotente) o Statement "AllowMarketingStreamSend"
 *  3. SetQueueAttributes
 *
 * Uso:
 *   npx tsx scripts/marketing-stream-aws-policy.ts            # dry-run (mostra policy proposta)
 *   npx tsx scripts/marketing-stream-aws-policy.ts --apply    # aplica
 *   npx tsx scripts/marketing-stream-aws-policy.ts --remove   # remove o Statement
 *
 * Le credenciais e queue URL do .env (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 * AMAZON_SQS_QUEUE_URL, AMAZON_SQS_REGION).
 */

import {
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

const STATEMENT_SID_DELIVERY = "AllowMarketingStreamDelivery";
const STATEMENT_SID_REVIEW = "AllowMarketingStreamReview";

// IAM role da Amazon que valida a fila SQS quando uma subscription e criada.
// Source: amzn/amazon-marketing-stream-examples / stream_infrastructure_config.yml
const REVIEWER_ROLE_ARN = "arn:aws:iam::926844853897:role/ReviewerRole";

// Cada dataset tem seu proprio SNS topic — entrega vem via SNS, nao direto.
// Listamos todos os 6 datasets relevantes por regiao; a Condition ArnLike
// aceita qualquer dos topics nesta lista. Adicione outros se quiser expandir
// (campaigns, adgroups, ads, targets, sb-clickstream, sb-rich-media, etc).
const SNS_SOURCE_ARNS_BY_REGION: Record<string, string[]> = {
  "us-east-1": [
    "arn:aws:sns:us-east-1:906013806264:*", // sp-traffic
    "arn:aws:sns:us-east-1:802324068763:*", // sp-conversion
    "arn:aws:sns:us-east-1:370941301809:*", // sd-traffic
    "arn:aws:sns:us-east-1:877712924581:*", // sd-conversion
    "arn:aws:sns:us-east-1:709476672186:*", // sb-traffic
    "arn:aws:sns:us-east-1:154357381721:*", // sb-conversion
  ],
  "eu-west-1": [
    "arn:aws:sns:eu-west-1:668473351658:*", // sp-traffic
    "arn:aws:sns:eu-west-1:562877083794:*", // sp-conversion
    "arn:aws:sns:eu-west-1:947153514089:*", // sd-traffic
    "arn:aws:sns:eu-west-1:664093967423:*", // sd-conversion
    "arn:aws:sns:eu-west-1:623198756881:*", // sb-traffic
    "arn:aws:sns:eu-west-1:195770945541:*", // sb-conversion
  ],
  "us-west-2": [
    "arn:aws:sns:us-west-2:074266271188:*", // sp-traffic
    "arn:aws:sns:us-west-2:622939981599:*", // sp-conversion
    "arn:aws:sns:us-west-2:310605068565:*", // sd-traffic
    "arn:aws:sns:us-west-2:818973306977:*", // sd-conversion
    "arn:aws:sns:us-west-2:485899199471:*", // sb-traffic
    "arn:aws:sns:us-west-2:112347756703:*", // sb-conversion
  ],
};

type Statement = {
  Sid?: string;
  Effect: "Allow" | "Deny";
  Principal: unknown;
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, unknown>;
};

type Policy = {
  Version: string;
  Id?: string;
  Statement: Statement[];
};

function arg(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function deriveArnFromUrl(url: string): string {
  // https://sqs.us-east-1.amazonaws.com/238788379344/queue-name
  const match = url.match(/^https:\/\/sqs\.([^.]+)\.amazonaws\.com\/(\d+)\/(.+)$/);
  if (!match) throw new Error(`URL SQS invalido: ${url}`);
  const [, region, account, name] = match;
  return `arn:aws:sqs:${region}:${account}:${name}`;
}

async function main() {
  const queueUrl = process.env.AMAZON_SQS_QUEUE_URL;
  if (!queueUrl) throw new Error("AMAZON_SQS_QUEUE_URL ausente.");
  const region = process.env.AMAZON_SQS_REGION ?? process.env.AWS_REGION ?? "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY ausentes.");
  }

  const snsSourceArns = SNS_SOURCE_ARNS_BY_REGION[region];
  if (!snsSourceArns) {
    throw new Error(
      `Regiao ${region} sem SNS source ARNs conhecidos. ` +
        "Confira amzn/amazon-marketing-stream-examples/stream_infrastructure_config.yml " +
        "e atualize SNS_SOURCE_ARNS_BY_REGION.",
    );
  }

  const queueArn = process.env.AMAZON_SQS_QUEUE_ARN ?? deriveArnFromUrl(queueUrl);
  const client = new SQSClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  const current = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: ["Policy"],
    }),
  );

  const currentPolicyRaw = current.Attributes?.Policy ?? null;
  const currentPolicy: Policy = currentPolicyRaw
    ? (JSON.parse(currentPolicyRaw) as Policy)
    : { Version: "2012-10-17", Statement: [] };

  const remove = arg("remove");
  const apply = arg("apply");

  const filteredStatements = currentPolicy.Statement.filter(
    (s) =>
      s.Sid !== STATEMENT_SID_DELIVERY &&
      s.Sid !== STATEMENT_SID_REVIEW &&
      s.Sid !== "AllowMarketingStreamSend", // legacy do dry-run anterior
  );

  if (remove) {
    const newPolicy: Policy = { ...currentPolicy, Statement: filteredStatements };
    console.log("--- Policy apos remocao ---");
    console.log(JSON.stringify(newPolicy, null, 2));
    if (!apply) {
      console.log("\n(dry-run — passe --apply para gravar)");
      return;
    }
    await client.send(
      new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: { Policy: JSON.stringify(newPolicy) },
      }),
    );
    console.log("Statement removido.");
    return;
  }

  const reviewStatement: Statement = {
    Sid: STATEMENT_SID_REVIEW,
    Effect: "Allow",
    Principal: { AWS: REVIEWER_ROLE_ARN },
    Action: ["sqs:GetQueueAttributes", "sqs:GetQueueUrl"],
    Resource: queueArn,
  };

  const deliveryStatement: Statement = {
    Sid: STATEMENT_SID_DELIVERY,
    Effect: "Allow",
    Principal: { Service: "sns.amazonaws.com" },
    Action: "sqs:SendMessage",
    Resource: queueArn,
    Condition: {
      ArnLike: { "aws:SourceArn": snsSourceArns },
    },
  };

  const newPolicy: Policy = {
    ...currentPolicy,
    Version: currentPolicy.Version ?? "2012-10-17",
    Statement: [...filteredStatements, reviewStatement, deliveryStatement],
  };

  console.log("--- Policy atual ---");
  console.log(currentPolicyRaw ? JSON.stringify(currentPolicy, null, 2) : "(nenhuma)");
  console.log("\n--- Policy proposta ---");
  console.log(JSON.stringify(newPolicy, null, 2));

  if (!apply) {
    console.log("\n(dry-run — passe --apply para gravar)");
    return;
  }

  await client.send(
    new SetQueueAttributesCommand({
      QueueUrl: queueUrl,
      Attributes: { Policy: JSON.stringify(newPolicy) },
    }),
  );
  console.log("\nPolicy aplicada com sucesso.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
