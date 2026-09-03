# Configuração do ambiente – site-psicologa

O código não deve conter chaves, senhas ou tokens. Configure os itens abaixo como **Secrets/Variables do Worker** na Cloudflare.

## Já configurado no projeto

- Worker: `site-psicologa`
- D1 binding: `DB`
- D1 database: `site-psicologa-db`
- APP_ORIGIN: `https://site-psicologa.thiagodrn2.workers.dev`
- Schema do D1 controlado pelo backend
- Mercado Pago integrado para Pix
- InfinitePay integrado para cartão
- Checkout e webhooks roteados pelo Worker

## Primeiro acesso profissional

Criar um Secret forte chamado:

- `ADMIN_SETUP_TOKEN`

O endpoint `POST /api/admin/setup` só funciona com o header `X-Setup-Token` correspondente e deixa de criar administradores adicionais depois que o primeiro admin existe.

Payload esperado:

```json
{
  "email": "email-da-psicologa@exemplo.com",
  "password": "senha-forte",
  "display_name": "Nome da Psicóloga"
}
```

Depois que o primeiro administrador já existir, o token de setup não deve ser usado para criar administradores adicionais.

## Login de pacientes com Google

Criar um OAuth Client do tipo Web no Google Cloud e configurar:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Redirect URI autorizada:

`https://site-psicologa.thiagodrn2.workers.dev/api/auth/google/callback`

Após domínio próprio, adicionar também o callback do domínio definitivo.

## Google Calendar da profissional

O backend já cria o evento após confirmação de pagamento ou confirmação manual. Configurar:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID` (pode ser `primary` ou o ID de um calendário exclusivo de consultas)

Recomendação: usar um calendário separado chamado `Consultas`. O evento deve conter apenas dados administrativos essenciais; não registrar conteúdo clínico no Google Calendar.

## Pagamentos

### Mercado Pago — Pix

O Pix usa Checkout Transparente via API do Mercado Pago. O QR Code e o código copia-e-cola são exibidos dentro do Portal do Paciente.

Configurar na Cloudflare:

- `MERCADOPAGO_ACCESS_TOKEN` — usar credencial de teste durante homologação e trocar pela credencial de produção antes de liberar cobranças reais.
- `MERCADOPAGO_WEBHOOK_SECRET` — quando a validação de assinatura estiver habilitada/configurada no painel.
- `MERCADOPAGO_TEST_MODE` — manter `true` somente durante homologação; alterar para `false` quando a credencial e o fluxo de produção estiverem validados.

Webhook do Mercado Pago:

`https://site-psicologa.thiagodrn2.workers.dev/api/payments/webhook/mercadopago`

No painel Mercado Pago, utilizar o evento/tópico de **Order** compatível com a integração utilizada pelo Worker.

### InfinitePay — cartão

O cartão permanece na InfinitePay.

Configurar na Cloudflare:

- `INFINITEPAY_HANDLE` — InfiniteTag sem o símbolo `$`.

Webhook da InfinitePay:

`https://site-psicologa.thiagodrn2.workers.dev/api/payments/webhook/infinitepay`

O Worker só confirma a consulta depois de validar o pagamento e conferir o valor recebido.

### Fluxo após aprovação

Quando o pagamento é validado como aprovado, o sistema:

1. marca o pagamento como aprovado;
2. marca a consulta como confirmada;
3. bloqueia definitivamente o horário;
4. cria o evento no Google Calendar, quando a integração estiver configurada;
5. registra a ação no audit log.

## Checklist antes de produção

- Confirmar que `MERCADOPAGO_ACCESS_TOKEN` é a credencial de produção.
- Desativar `MERCADOPAGO_TEST_MODE`.
- Cadastrar e testar o webhook do Mercado Pago.
- Confirmar `INFINITEPAY_HANDLE` e validar um pagamento de cartão.
- Testar Pix aprovado, expirado e cancelado.
- Testar cartão aprovado e falho.
- Confirmar Google Calendar e callback OAuth.
- Revisar política de privacidade, termos de uso, base legal e rotinas de retenção/exclusão conforme LGPD e obrigações profissionais aplicáveis.

## Dados clínicos

As anotações clínicas ficam em `clinical_notes` e só existem nas rotas `/api/admin/*`. Não existe endpoint de paciente que retorne essas anotações.
