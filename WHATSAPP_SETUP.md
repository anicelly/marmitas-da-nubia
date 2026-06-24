# WhatsApp automatico - Marmitas da Nubia

O sistema ja esta preparado para envio automatico real via Z-API.

## 1. Criar o arquivo `.env`

Copie `.env.example` para `.env` e preencha:

```env
PORT=8052
WHATSAPP_REMETENTE_TESTE=5561993126544
WHATSAPP_NUBIA=5561993126544
WHATSAPP_PROVIDER=zapi
ZAPI_INSTANCE_ID=seu_instance_id
ZAPI_TOKEN=seu_token
ZAPI_CLIENT_TOKEN=seu_client_token
```

## 2. Reiniciar o backend

Para o teste do robo, o numero `61993126544` recebe os pedidos.
Depois do teste, troque `WHATSAPP_NUBIA` para o numero real da Nubia.

```powershell
npm start
```

## 3. Testar no Admin

Entre em `/admin`, use o PIN `2026` e clique em `Testar envio automatico`.

Se o WhatsApp estiver conectado na Z-API, a Nubia recebe:

```text
Teste de integracao - Marmitas da Nubia. Se esta mensagem chegou, o envio automatico esta ativo.
```

## 4. Webhook para aceitar ou recusar

Configure na Z-API o webhook de mensagens recebidas para:

```text
https://SEU_DOMINIO/api/whatsapp/webhook
```

Importante: a Z-API nao consegue chamar `localhost`. Para o `1` aceitar o pedido de verdade,
esse endpoint precisa estar publicado em um dominio ou tunnel publico.

Quando a Nubia responder:

- `1`: o pedido mais recente aguardando confirmacao e aceito.
- `2`: o pedido mais recente aguardando confirmacao e recusado.

O backend tambem tenta avisar o cliente automaticamente.

## Observacao

Sem as credenciais da Z-API, o sistema registra o pedido, mas nao envia WhatsApp automatico. Ele nao abre envio manual para nao parecer falso.
