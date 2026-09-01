# Configuração do ambiente – site-psicologa

O código não deve conter chaves, senhas ou tokens. Configure os itens abaixo como **Secrets/Variables do Worker** na Cloudflare.

## Já configurado

- Worker: `site-psicologa`
- D1 binding: `DB`
- D1 database: `site-psicologa-db`
- APP_ORIGIN: `https://site-psicologa.thiagodrn2.workers.dev`
- O Worker inicializa o schema do D1 automaticamente ao acessar qualquer rota `/api/*`.

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

## Gateway de pagamento

O backend possui adapter para checkout e webhook. Como o gateway ainda não foi escolhido para este projeto, definir após selecionar o provedor:

- `PAYMENT_PROVIDER`
- `PAYMENT_API_URL`
- `PAYMENT_API_KEY`
- `PAYMENT_WEBHOOK_SECRET`

O checkout envia: valor em centavos, método (`pix` ou `credit_card`), referência, cliente, URLs de sucesso/cancelamento e URL de webhook.

O webhook público é:

`https://site-psicologa.thiagodrn2.workers.dev/api/payments/webhook`

Quando o pagamento passa para aprovado, o sistema:

1. marca o pagamento como aprovado;
2. marca a consulta como confirmada;
3. bloqueia definitivamente o horário;
4. cria o evento no Google Calendar;
5. registra a ação no audit log.

## Dados clínicos

As anotações clínicas ficam em `clinical_notes` e só existem nas rotas `/api/admin/*`. Não existe endpoint de paciente que retorne essas anotações.

Antes de produção, revisar política de privacidade, termos de uso, base legal e rotinas de retenção/exclusão de dados conforme LGPD e obrigações profissionais aplicáveis.
