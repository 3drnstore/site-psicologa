import type { Env } from './types'

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[c]||c))

function dateLabel(value:string){
  return new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date(value))
}
function timeLabel(value:string){
  return new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(value))
}

export async function sendAppointmentConfirmationEmail(env:Env,appointmentId:number){
  if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return false
  const ap=await env.DB.prepare(`
    SELECT a.id,a.confirmation_email_sent_at,av.starts_at,av.ends_at,p.full_name,p.email
    FROM appointments a
    JOIN availability av ON av.id=a.availability_id
    JOIN patients p ON p.id=a.patient_id
    WHERE a.id=? AND a.status='confirmed'
  `).bind(appointmentId).first<any>()
  if(!ap?.email||ap.confirmation_email_sent_at)return false

  const claim=await env.DB.prepare(`UPDATE appointments SET confirmation_email_sent_at='sending' WHERE id=? AND confirmation_email_sent_at IS NULL`).bind(appointmentId).run()
  if(!Number(claim.meta.changes||0))return false

  const firstName=String(ap.full_name||'').trim().split(/\s+/)[0]||'Paciente'
  const date=dateLabel(String(ap.starts_at))
  const time=timeLabel(String(ap.starts_at))
  const html=`
    <div style="font-family:Arial,sans-serif;color:#29463f;line-height:1.6">
      <h2 style="margin:0 0 16px;color:#244f44">Agendamento confirmado</h2>
      <p>Olá, ${esc(firstName)}.</p>
      <p>Seu pagamento foi confirmado e sua sessão está agendada.</p>
      <p><strong>Data:</strong> ${esc(date)}<br><strong>Horário:</strong> ${esc(time)}<br><strong>Duração:</strong> 50 minutos<br><strong>Modalidade:</strong> online</p>
      <p>Guarde este e-mail como confirmação do agendamento.</p>
    </div>`

  try{
    const r=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json'},
      body:JSON.stringify({from:env.EMAIL_FROM,to:[ap.email],subject:`Agendamento confirmado — ${date}, ${time}`,html})
    })
    if(!r.ok){
      const detail=await r.text().catch(()=>String(r.status))
      console.error('Confirmation email error:',detail)
      await env.DB.prepare(`UPDATE appointments SET confirmation_email_sent_at=NULL WHERE id=? AND confirmation_email_sent_at='sending'`).bind(appointmentId).run()
      return false
    }
    await env.DB.prepare(`UPDATE appointments SET confirmation_email_sent_at=CURRENT_TIMESTAMP WHERE id=?`).bind(appointmentId).run()
    return true
  }catch(error){
    console.error('Confirmation email exception:',error)
    await env.DB.prepare(`UPDATE appointments SET confirmation_email_sent_at=NULL WHERE id=? AND confirmation_email_sent_at='sending'`).bind(appointmentId).run()
    return false
  }
}
