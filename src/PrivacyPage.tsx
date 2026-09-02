export default function PrivacyPage(){
  return <main className="privacy-page">
    <a className="privacy-back" href="/">← Voltar ao site</a>
    <header className="privacy-hero">
      <span className="section-kicker">Privacidade e proteção de dados</span>
      <h1>Como seus dados são tratados</h1>
      <p>Esta página explica, de forma simples, quais informações podem ser utilizadas no site e para quais finalidades. Ela não substitui documentos profissionais ou jurídicos específicos que possam ser adotados pela psicóloga.</p>
    </header>

    <section className="privacy-grid">
      <article><h2>Dados de cadastro</h2><p>Nome, data de nascimento, CPF, telefone e e-mail podem ser utilizados para identificação, criação da conta, contato, agendamento e organização do atendimento.</p></article>
      <article><h2>Agendamentos</h2><p>Informações sobre horários, reservas, confirmações, cancelamentos e histórico de consultas são utilizadas para organizar a agenda e prestar o serviço solicitado pelo paciente.</p></article>
      <article><h2>Pagamentos</h2><p>O site pode encaminhar informações necessárias aos provedores de pagamento utilizados. Dados financeiros sensíveis, como número completo de cartão, não devem ser armazenados diretamente pelo sistema quando o processamento é feito pelo provedor.</p></article>
      <article><h2>Prontuário e anotações clínicas</h2><p>Anotações clínicas e registros profissionais são mantidos em área restrita. O portal do paciente não possui acesso ao conteúdo privado do prontuário.</p></article>
      <article><h2>Sigilo e acesso</h2><p>O acesso administrativo é restrito a usuários autorizados. O sistema utiliza autenticação, sessões protegidas e medidas técnicas de segurança para reduzir acessos indevidos.</p></article>
      <article><h2>Compartilhamento</h2><p>Dados podem ser enviados somente aos serviços necessários para funcionamento do atendimento, como pagamento, e-mail, autenticação e videoconferência, conforme a configuração adotada pela profissional.</p></article>
      <article><h2>Contato pelo site</h2><p>Mensagens enviadas pelo formulário de contato podem conter nome, e-mail, telefone e o conteúdo informado pelo próprio usuário. Evite inserir informações clínicas sensíveis desnecessárias nesse formulário.</p></article>
      <article><h2>Direitos do titular</h2><p>Solicitações relacionadas a dados pessoais, como correção de informações cadastrais ou esclarecimentos sobre o tratamento dos dados, poderão ser feitas pelos canais de contato disponibilizados pela profissional.</p></article>
    </section>

    <section className="privacy-note-card">
      <h2>Importante</h2>
      <p>Informações sobre retenção de prontuário, bases legais específicas, responsável pelo tratamento e canal formal de privacidade devem ser definidas pela profissional conforme sua atuação e orientação jurídica ou contábil aplicável. Esses pontos não foram inventados neste texto.</p>
      <p><strong>Jacqueline Siqueira • Psicóloga • CRP 06/212470</strong></p>
    </section>
  </main>
}
