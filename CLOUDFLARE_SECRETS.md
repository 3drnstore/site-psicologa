# Secrets e variáveis da Cloudflare

Não coloque credenciais reais no GitHub. Configure-as em **Worker > Settings > Variables and Secrets**.

## Pagamentos

### Mercado Pago (Pix)
- `MERCADOPAGO_ACCESS_TOKEN` — Access Token da aplicação Mercado Pago. Use a credencial de teste enquanto estivermos homologando e depois substitua pela credencial de produção.
- `MERCADOPAGO_WEBHOOK_SECRET` — opcional por enquanto; poderá ser usada para validação adicional da assinatura do Webhook.

Webhook usado pelo sistema:
- `https://site-psicologa.thiagodrn2.workers.dev/api/payments/webhook/mercadopago`

O sistema usa Checkout Transparente via **API de Orders**. A cobrança é criada explicitamente como Pix, o QR Code e o código copia-e-cola são exibidos dentro do portal do paciente e o sistema consulta `GET /v1/orders/{id}` para validar o status e o valor antes de confirmar a consulta.

Para o Webhook no painel Mercado Pago, configure o tópico **Order (Mercado Pago)**.

### InfinitePay (cartão)
- `INFINITEPAY_HANDLE` — InfiniteTag sem o símbolo `$`

Webhook usado pelo sistema:
- `https://site-psicologa.thiagodrn2.workers.dev/api/payments/webhook/infinitepay`

O Worker recebe o aviso e valida a venda com `POST https://api.checkout.infinitepay.io/payment_check`. A consulta só é confirmada quando `paid=true`, o valor confere e o meio recebido não é Pix.

## Google
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID` (opcional; padrão: `primary`)

## Primeiro administrador
- `ADMIN_SETUP_TOKEN` — token temporário e forte usado apenas para criar o primeiro usuário profissional.

## Origem do app
`APP_ORIGIN` está definido no `wrangler.jsonc` para o endereço principal do Worker.
