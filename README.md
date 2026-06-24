# Marmitas da Núbia

Sistema de pedidos, gestão e automações para a **Marmitas da Núbia**, com identidade visual delicada, cardápio semanal, loja para clientes, painel administrativo, modo cozinha e integração preparada para WhatsApp via Z-API.

## Visão geral

O projeto foi pensado para transformar a rotina de venda de marmitas em uma operação mais profissional:

- cliente escolhe as marmitas pela loja;
- pedido entra no painel da Núbia;
- cozinha acompanha novos pedidos, preparo e retirada/entrega;
- comprovante é gerado com a identidade visual da marca;
- backend salva dados localmente;
- integração com WhatsApp fica pronta para envio automático via API.

## Principais recursos

- **Loja do cliente** em `/loja`
  - cardápio da semana;
  - carrinho de pedido;
  - retirada com Núbia ou entrega pela Núbia;
  - pagamento por Pix, crédito, débito ou dinheiro;
  - comprovante do pedido com logo.

- **Painel administrativo** em `/admin`
  - PIN local para acesso;
  - visão de pedidos, clientes, pratos, financeiro e entregas;
  - modo cozinha com pedidos novos, em preparo e prontos;
  - som de alerta para novos pedidos;
  - configuração do WhatsApp de recebimento.

- **Clientes e recompras**
  - cadastro de clientes;
  - identificação de clientes ativos;
  - clientes sem pedido recente para retomada de contato;
  - mensagens prontas para WhatsApp.

- **Cardápio e PDF**
  - montagem de cardápio de segunda a sexta;
  - fotos dos pratos;
  - PDF/impressão do cardápio semanal.

- **IA de compras**
  - pesquisa de ofertas por item;
  - varredura de páginas de mercados;
  - histórico de cotações;
  - comparação de economia frente a compras anteriores.

- **WhatsApp automático**
  - envio preparado via Z-API;
  - webhook para resposta `1` aceitar pedido e `2` recusar pedido;
  - sem fallback manual para não parecer automação falsa.

## Como rodar localmente

Requisitos:

- Node.js instalado.
- PowerShell ou terminal equivalente.

```powershell
npm start
```

Por padrão, o backend usa a porta configurada no `.env`.

Depois acesse:

```text
http://127.0.0.1:8052/loja
http://127.0.0.1:8052/admin
```

Se o `.env` estiver usando outra porta, troque a porta na URL.

## Configuração do WhatsApp

Copie `.env.example` para `.env` e preencha:

```env
PORT=8052
WHATSAPP_REMETENTE_TESTE=5561993126544
WHATSAPP_NUBIA=5561993126544
WHATSAPP_PROVIDER=zapi
ZAPI_INSTANCE_ID=seu_id_da_instancia
ZAPI_TOKEN=seu_token_da_instancia
ZAPI_CLIENT_TOKEN=seu_client_token
```

Observações:

- O `.env` não deve ser publicado.
- O envio automático depende da Z-API estar conectada.
- Para aceitar pedido respondendo `1`, a Z-API precisa apontar o webhook para:

```text
https://SEU_DOMINIO/api/whatsapp/webhook
```

Em ambiente local (`localhost`), a Z-API não consegue chamar o webhook externo. Para teste real do webhook, use uma hospedagem pública ou túnel.

## GitHub Pages

O frontend estático pode ser publicado no GitHub Pages.

URL esperada:

```text
https://anicelly.github.io/marmitas-da-nubia/
```

Importante: GitHub Pages publica apenas HTML, CSS, JS e imagens. O backend Node, banco local e WhatsApp automático precisam de uma hospedagem separada, como Render, Railway, VPS ou outro serviço Node.

## Estrutura do projeto

```text
.
├── assets/
│   ├── logo-nubia.jpeg
│   └── logo-nubia.png
├── backend/
│   └── server.js
├── index.html
├── manifest.webmanifest
├── package.json
├── script.js
├── style.css
├── sw.js
├── WHATSAPP_SETUP.md
└── .env.example
```

## Segurança

- `.env` fica no `.gitignore`.
- Tokens da Z-API não devem ser enviados ao GitHub.
- O PIN do Admin é local e simples; para produção, o próximo passo é autenticação real.
- O armazenamento atual é local/JSON; para produção, recomenda-se banco em nuvem.

## Próximos passos recomendados

- Hospedar o backend Node.
- Configurar domínio público para webhook da Z-API.
- Trocar PIN local por login real.
- Migrar dados para banco em nuvem.
- Criar confirmação automática para cliente após aceite do pedido.
- Criar dashboard de compras com alertas de economia por mercado.

## Status

Projeto em evolução, com foco em operação real de pedidos, experiência profissional para clientes e automações para facilitar a rotina da Núbia.
