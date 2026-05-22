# Amazon Marketing Stream — Setup AWS + Subscription

Marketing Stream entrega eventos hourly (sp-traffic, sp-conversion, sd-*, sb-*) para uma fila SQS. Esse documento cobre o setup unico necessario:

1. Resource policy na fila SQS para aceitar mensagens da Amazon.
2. (Opcional) Permissoes KMS se a fila for encrypted.
3. Subscription via Ads API (chamada `POST /api/amazon/ads/marketing-stream`).

---

## Pre-requisitos

- Fila SQS standard (NAO FIFO) ja criada e usada como `AMAZON_SQS_QUEUE_URL`. Marketing Stream e SP-API Notifications podem dividir a mesma fila — o consumer (`erp-sqs-consumer`) distingue automaticamente pelo body.
- Credenciais Ads configuradas em `ConfiguracaoSistema` (`amazon_ads_*`) ou env (`AMAZON_ADS_CLIENT_ID/SECRET/REFRESH_TOKEN/PROFILE_ID`).
- Variavel `AMAZON_SQS_QUEUE_ARN` setada no `.env` da VPS (formato `arn:aws:sqs:us-east-1:123456789012:erp-amazon-sqs`).

---

## 1. Resource policy SQS

Marketing Stream precisa de permissao para `sqs:SendMessage`. A condicao `aws:SourceAccount` deve apontar para a conta da Amazon que opera o Marketing Stream **na regiao da sua fila**.

> A conta varia por regiao. Consultar a doc oficial no momento do setup:
> https://advertising.amazon.com/API/docs/en-us/amazon-marketing-stream/onboarding

Exemplo para US East (us-east-1) — conta `906013806264` (verificar antes!):

```bash
QUEUE_URL="https://sqs.us-east-1.amazonaws.com/<sua-conta>/erp-amazon-sqs"
QUEUE_ARN="arn:aws:sqs:us-east-1:<sua-conta>:erp-amazon-sqs"
SOURCE_ACCOUNT="906013806264"  # CONFIRMAR NA DOC AMAZON

aws sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attributes Policy='{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "AllowMarketingStreamSend",
        "Effect": "Allow",
        "Principal": { "Service": "marketing-stream.amazonaws.com" },
        "Action": "sqs:SendMessage",
        "Resource": "'"$QUEUE_ARN"'",
        "Condition": {
          "StringEquals": { "aws:SourceAccount": "'"$SOURCE_ACCOUNT"'" }
        }
      }
    ]
  }'
```

Cuidado: substituir a policy completa apaga policies pre-existentes (ex: SP-API Notifications). Use `aws sqs get-queue-attributes --queue-url $QUEUE_URL --attribute-names Policy` para baixar a atual e mesclar os Statements antes de aplicar.

---

## 2. KMS (so se a fila for encrypted)

```bash
KMS_KEY_ID="alias/erp-amazon-sqs"

aws kms put-key-policy --key-id "$KMS_KEY_ID" --policy-name default --policy '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowMarketingStreamUseKey",
      "Effect": "Allow",
      "Principal": { "Service": "marketing-stream.amazonaws.com" },
      "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
      "Resource": "*",
      "Condition": {
        "StringEquals": { "aws:SourceAccount": "'"$SOURCE_ACCOUNT"'" }
      }
    }
  ]
}'
```

---

## 3. Criar subscriptions via API

Depois da policy aplicada, chame o endpoint admin para assinar cada dataset desejado:

```bash
# Listar estado atual
curl -X GET "$ERP_BASE_URL/api/amazon/ads/marketing-stream" \
  -H "Cookie: $SESSION_COOKIE"

# Assinar todos os 6 datasets relevantes
curl -X POST "$ERP_BASE_URL/api/amazon/ads/marketing-stream" \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION_COOKIE" \
  -d '{"datasets":["sp-traffic","sp-conversion","sd-traffic","sd-conversion","sb-traffic","sb-conversion"]}'

# Arquivar uma subscription
curl -X DELETE "$ERP_BASE_URL/api/amazon/ads/marketing-stream" \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION_COOKIE" \
  -d '{"dataset":"sb-conversion"}'
```

---

## 4. Validacao end-to-end

Apos a primeira subscription, esperar ~1h e:

```bash
# Conta de mensagens entrando
aws sqs get-queue-attributes \
  --queue-url "$AMAZON_SQS_QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages

# Verificar que linhas estao chegando
ssh erp-vps "sudo -u erp psql -d erp_amazon -c \
  \"SELECT dataset, COUNT(*), MAX(\\\"eventoTimeMax\\\") FROM \\\"AmazonAdsMetricaHoraria\\\" \
   GROUP BY dataset ORDER BY dataset\""

# Ver o estado consolidado pelo endpoint admin
curl -s "$ERP_BASE_URL/api/amazon/ads/marketing-stream" | jq
```

---

## Troubleshooting

- **AccessDeniedException ao testar `PUT /streams/subscriptions/{id}`**: revisar policy SQS (Principal/SourceAccount errado pra regiao).
- **Mensagens nao chegam apos 2h**: SQS vazia mas subscription marcada ACTIVE → policy denegando silenciosamente. Use `aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=SendMessage` na conta Amazon (impossivel — chamar Amazon Ads Support).
- **Mensagens chegam mas nao virao rows**: rodar `npm run amazon:sqs:once` e checar logs do consumer. Comum: payload em formato inesperado — o parser loga `descartando record antigo` ou `upsert falhou`.
- **Dupla contagem com daily report**: cleanup acontece em `upsertAdsRows` ao final de cada run de `AMAZON_ADS_REPORT_SYNC`. Se notar duplicidade, conferir se o cleanup esta rodando (`SELECT COUNT(*) FROM "AmazonAdsMetricaHoraria" WHERE "horaInicio" < date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')`).
