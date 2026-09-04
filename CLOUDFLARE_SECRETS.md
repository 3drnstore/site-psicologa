# Secrets e variáveis da Cloudflare

Não coloque credenciais reais no GitHub. Configure-as em **Worker > Settings > Variables and Secrets**.

## Criptografia de prontuários
- `CLINICAL_MASTER_KEY` — segredo exclusivo para envelope encryption dos prontuários clínicos. Deve ser longo, aleatório e tratado como chave crítica. Não reutilize senha, token de setup ou credencial de outro serviço.

Recomendação de geração local: `openssl rand -base64 48` ou equivalente criptograficamente seguro. Cadastre o resultado diretamente como **Secret** no Cloudflare e guarde uma cópia em cofre de senhas/segredos. Não registre o valor no GitHub, em logs ou em documentação.

O sistema usa uma DEK AES-256-GCM aleatória para cada anotação clínica. A DEK é protegida por uma KEK derivada de `CLINICAL_MASTER_KEY`, também com AES-GCM. O D1 armazena somente ciphertext, IVs, DEK encapsulada e versão criptográfica; o campo legado `note_text` permanece vazio. A chave-mestra não é armazenada no banco.

**Importante:** perder `CLINICAL_MASTER_KEY` torna os prontuários cifrados irrecuperáveis. Antes de rotacionar essa chave, implemente/revise o procedimento de reencapsulamento das DEKs.

## Pagamentos

### Mercado Pago (Pix)
- `MERCADOPAGO_ACCESS_TOKEN` — Access Token da aplicação Mercado Pago. Use a credencial de teste enquanto estivermos homologando e depois substitua pela credencial de produção.
- `MERCADOPAGO_WEBHOOK_SECRET` — obrigatório antes de produção. É usado para validar a assinatura `x-signature` das notificações Webhook do Mercado Pago.
- `MERCADOPAGO_TEST_MODE` — mantenha `true` somente durante a homologação e altere para `false` quando a credencial de produção e o fluxo real estiverem validados.

Webhook usado pelo sistema:
- `https://site-psicologa.thiagodrn2.workers.dev/api/payments/webhook/mercadopago`

O sistema usa Checkout Transparente via **API de Orders**. A cobrança é criada explicitamente como Pix, o QR Code e o código copia-e-cola são exibidos dentro do portal do paciente e o sistema consulta `GET /v1/orders/{id}` para validar o status e o valor antes de confirmar a consulta.

Quando `MERCADOPAGO_WEBHOOK_SECRET` estiver configurado, o Worker valida a origem da notificação por HMAC-SHA256 usando os dados enviados pelo Mercado Pago (`data.id`, `x-request-id` e `ts`). Notificações com assinatura inválida recebem HTTP 401 e não disparam confirmação de pagamento.

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
