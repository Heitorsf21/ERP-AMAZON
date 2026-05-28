# WAHA — WhatsApp para Resumo Diario de Estoque

O resumo diario de estoque (`/configuracoes` → aba Integracoes → "WhatsApp - Resumo
de estoque") envia mensagens via [WAHA](https://waha.devlike.pro/) (WhatsApp HTTP
API) rodando em Docker na VPS. O ERP chama o WAHA por **URL interna** — o WAHA
**nao** deve ser exposto publicamente.

Arquitetura: `erp-worker` (job `WHATSAPP_ESTOQUE_RESUMO`) e o endpoint de teste
chamam `POST {waha_url}/api/sendText` com header `X-Api-Key` (se configurado).

---

## 1. Subir o WAHA em Docker

Rodar como o usuario com acesso ao Docker na VPS. O container fica em rede local
(`127.0.0.1`), com volume persistente para a sessao do WhatsApp.

```bash
docker run -d \
  --name waha \
  --restart unless-stopped \
  -p 127.0.0.1:3001:3000 \
  -e WAHA_API_KEY="<gere-um-token-forte>" \
  -e WHATSAPP_DEFAULT_ENGINE=WEBJS \
  -v /opt/waha/sessions:/app/.sessions \
  devlikeapro/waha:latest
```

Notas:
- `-p 127.0.0.1:3001:3000` publica **apenas no loopback** da VPS (porta interna
  3001 → 3000 do container). Nao abrir no firewall/Nginx.
- `WAHA_API_KEY` protege a API. O mesmo valor vai no ERP em "API key".
- O volume `/opt/waha/sessions` mantem o pareamento entre reinicios.
- N8N (container existente em `127.0.0.1:5678`) **nao e afetado** — sao
  containers independentes. Escolha uma porta livre (ex: 3001) para o WAHA.

---

## 2. Parear o WhatsApp (uma vez)

1. Iniciar a sessao `default`:

   ```bash
   curl -s -X POST http://127.0.0.1:3001/api/sessions/start \
     -H "X-Api-Key: <token>" \
     -H "Content-Type: application/json" \
     -d '{"name":"default"}'
   ```

2. Obter o QR code para escanear (abre como imagem):

   ```bash
   curl -s http://127.0.0.1:3001/api/default/auth/qr \
     -H "X-Api-Key: <token>" -o /tmp/waha-qr.png
   ```

   Como a VPS nao tem tela, copie o arquivo para a maquina local
   (`scp erp-vps:/tmp/waha-qr.png .`) e escaneie com o WhatsApp do celular
   (Aparelhos conectados → Conectar um aparelho).

3. Conferir que a sessao esta `WORKING`:

   ```bash
   curl -s http://127.0.0.1:3001/api/sessions/default \
     -H "X-Api-Key: <token>"
   ```

---

## 3. Testar envio manualmente

```bash
curl -s -X POST http://127.0.0.1:3001/api/sendText \
  -H "X-Api-Key: <token>" \
  -H "Content-Type: application/json" \
  -d '{"session":"default","chatId":"5511999999999@c.us","text":"teste WAHA"}'
```

`chatId` = numero com codigo do pais + `@c.us`. O ERP normaliza
automaticamente (remove nao-digitos e adiciona `@c.us`), entao no campo
"Numero destinatario" basta `5511999999999`.

---

## 4. Configurar no ERP

Em `/configuracoes` → Integracoes → "WhatsApp - Resumo de estoque":

| Campo               | Valor                                      |
|---------------------|--------------------------------------------|
| Envio diario        | ligado                                     |
| Horario (HH:mm)     | `10:00` (fuso America/Sao_Paulo)           |
| Numero destinatario | `5511999999999`                            |
| URL do WAHA         | `http://127.0.0.1:3001`                    |
| Session             | `default`                                  |
| API key             | o mesmo `WAHA_API_KEY` do container        |

A API key e armazenada criptografada (`whatsapp_estoque_waha_api_key`,
AES-256-GCM). Apos salvar, use "Enviar teste agora" para validar.

> Se o WAHA e o ERP estiverem na mesma rede Docker, use o hostname do
> container (ex: `http://waha:3000`) em vez de `127.0.0.1:3001`.

---

## 5. Operacao

- **Reiniciar o WAHA** sem afetar o ERP (`erp-web`/`erp-worker`/`erp-sqs-consumer`
  sao processos PM2 separados, nao containers):

  ```bash
  docker restart waha
  ```

  A sessao persiste no volume; nao precisa reparear.

- **Logs**: `docker logs -f waha`.

- **Atualizar a imagem**:

  ```bash
  docker pull devlikeapro/waha:latest
  docker stop waha && docker rm waha
  # subir de novo com o mesmo comando da secao 1 (volume preserva a sessao)
  ```

- **Falha de envio**: o job registra `ERRO` em `WhatsAppEstoqueEnvio` e dispara
  uma notificacao no sino (tipo `CONFIG_REVIEW`, dedupe por dia) com link para
  `/configuracoes`. O job nao faz retry agressivo.

---

## 6. Endpoint de envio — variacao por versao

O cliente usa `POST /api/sendText` (padrao do WAHA Core/Plus atual). Se a versao
instalada divergir, confirme o endpoint exato em `http://127.0.0.1:3001/` (Swagger
embutido) e ajuste `src/modules/whatsapp-estoque/waha-client.ts`.
