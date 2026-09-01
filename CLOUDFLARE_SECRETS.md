# Secrets e variáveis da Cloudflare

Não coloque credenciais reais no GitHub. Configure-as em **Worker > Settings > Variables and Secrets**.

## Pagamentos

### SumUp (Pix)
- `SUMUP_API_KEY` — chave secreta da API SumUp
- `SUMUP_MERCHANT_CODE` — código do estabelecimento/merchant SumUp

Webhook usado pelo sistema:
- `https://site-psicologa.thiagodrn2.workers.dev/api/payments/webhook/sumup`

O Worker recebe o aviso e consulta `GET /v0.1/checkouts/{checkout_id}` na SumUp. A consulta só é confirmada quando o checkout consultado estiver `PAID` e o valor conferir.

### InfinitePay (cartão)
- `INFINITEPAY_HANDLE` — InfiniteTag sem o símbolo `$`

Webhook usado pelo sistema:
- `https://site-psicologa.thiagodrn2.workers.dev/api/payments/webhook/infinitepay`

O Worker recebe o aviso e valida a venda com `POST https://api.checkout.infinitepay.io/payment_check`. A consulta só é confirmada quando `paid=true` e o valor conferir.

## Google
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID` (opcional; padrão: `primary`)

## Primeiro administrador
- `ADMIN_SETUP_TOKEN` — token temporário e forte usado apenas para criar o primeiro usuário profissional.

## Origem do app
`APP_ORIGIN` está definido no `wrangler.jsonc` para o endereço principal do Worker.
