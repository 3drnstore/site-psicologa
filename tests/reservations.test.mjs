import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

// Run the real TypeScript handlers with Node 24 and an in-memory SQLite D1 adapter.
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))specifier+='.ts'
  return nextResolve(specifier,context)
}})
const { expireUnpaidReservations, handleSessionManagement, ensureNextRecurringReservation }=await import('../src/session-management.ts')
const { normalizeHourlyDeadlines }=await import('../src/hour-policy.ts')
const { handlePatientReserveV2 }=await import('../src/patient-reserve-v2.ts')
const { handlePublicAvailabilityV3 }=await import('../src/public-availability-v3.ts')
const { handleScheduleV2 }=await import('../src/schedule-v2.ts')
const { removePortalAppointmentFromGoogle, retryPendingGoogleCalendarAppointments, syncPortalAppointmentToGoogle }=await import('../src/google-calendar-sync.ts')
const { sha256 }=await import('../src/auth.ts')
const realFetch=globalThis.fetch
afterEach(()=>{globalThis.fetch=realFetch})
const iso=offset=>new Date(Date.now()+offset).toISOString()
const day=86400000

async function fixture(){
  const db=new DatabaseSync(':memory:')
  const source=readFileSync(new URL('../src/schema.ts',import.meta.url),'utf8')
  db.exec(source.split('await env.DB.exec(`')[1].split('`)')[0])
  function prepare(sql){
    let values=[]
    return {bind(...v){values=v;return this},async first(){return db.prepare(sql).get(...values)||null},async all(){return {results:db.prepare(sql).all(...values)}},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}}}
  }
  const env={DB:{prepare,async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}}}}
  db.exec("INSERT INTO patients(id,full_name,birth_date,cpf,phone,email) VALUES(1,'Test','2000-01-01','test','551100000000','test@example.invalid'); INSERT INTO settings(key,value) VALUES('card_price_cents','10000'),('consultation_price_cents','10000'); INSERT INTO admin_users(id,email,password_hash,password_salt,display_name) VALUES('admin','admin@example.invalid','x','x','Test');")
  db.prepare('INSERT INTO sessions(id,patient_id,token_hash,expires_at) VALUES(?,?,?,?)').run('session',1,await sha256('patient'),iso(day))
  db.prepare('INSERT INTO admin_sessions(id,admin_user_id,token_hash,expires_at) VALUES(?,?,?,?)').run('adminsession','admin',await sha256('admin'),iso(day))
  const req=(path,admin=false,body)=>new Request('https://example.invalid'+path,{method:body?'POST':'GET',headers:{cookie:admin?'ps_admin_session=admin':'ps_session=patient','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
  function slot(id,starts=iso(7*day),status='held'){
    db.prepare('INSERT INTO availability(id,starts_at,ends_at,status) VALUES(?,?,?,?)').run(id,starts,new Date(new Date(starts).getTime()+3000000).toISOString(),status)
  }
  function appointment(id,{kind='standard',deadline=iso(-1000),status='pending_payment',event=null,starts=iso(7*day)}={}){
    slot(id,starts,status==='confirmed'?'confirmed':'held')
    db.prepare('INSERT INTO appointments(id,patient_id,availability_id,status,amount_cents,reservation_kind,payment_deadline_at,reserved_until,google_calendar_event_id) VALUES(?,1,?,?,10000,?,?,?,?)').run(id,id,status,kind,deadline,deadline,event)
    return id
  }
  function google(status=204){
    Object.assign(env,{GOOGLE_CLIENT_ID:'fake',GOOGLE_CLIENT_SECRET:'fake',GOOGLE_REFRESH_TOKEN:'fake'})
    const calls=[]
    globalThis.fetch=async(url,init)=>{
      calls.push({url:String(url),method:init?.method})
      if(String(url).includes('oauth2'))return Response.json({access_token:'fake'})
      return new Response(null,{status})
    }
    return calls
  }
  return {db,env,req,slot,appointment,google,one:sql=>db.prepare(sql).get()}
}

test('standard reservation is 15 minutes; normalization and reuse do not extend it',async()=>{
  const f=await fixture();f.slot(1,iso(2*3600000),'free')
  const path='/api/appointments/reserve',before=Date.now()
  const response=await handlePatientReserveV2(f.req(path,false,{slot_id:1}),f.env,path)
  assert.equal(response.status,201)
  const created=await response.json(),deadline=Date.parse(created.payment_deadline_at)
  assert.ok(deadline>=before+900000&&deadline<=Date.now()+900000)
  assert.equal(f.one('SELECT reservation_kind FROM appointments').reservation_kind,'standard')
  await normalizeHourlyDeadlines(f.env)
  const reused=await (await handlePatientReserveV2(f.req(path,false,{slot_id:1}),f.env,path)).json()
  assert.equal(reused.reused,true);assert.equal(reused.payment_deadline_at,created.payment_deadline_at)
})

test('expiration cancels, releases, fails pending payment, deletes Google event and is idempotent',async()=>{
  const f=await fixture();f.appointment(1,{event:'event1'});const calls=f.google()
  f.db.exec("INSERT INTO payments(appointment_id,provider,method,amount_cents) VALUES(1,'test','pix',10000)")
  await expireUnpaidReservations(f.env);await expireUnpaidReservations(f.env)
  assert.equal(f.one('SELECT status FROM appointments').status,'cancelled')
  assert.equal(f.one('SELECT status FROM availability').status,'free')
  assert.equal(f.one('SELECT status FROM payments').status,'failed')
  assert.equal(f.one('SELECT calendar_sync_state FROM appointments').calendar_sync_state,'removed')
  assert.equal(calls.filter(c=>c.method==='DELETE').length,1)
  assert.equal(f.one('SELECT count(*) AS n FROM audit_log').n,1)
})

test('unexpired and confirmed reservations survive; recurring normalization retains 24-hour rule',async()=>{
  const f=await fixture(),starts=iso(7*day)
  f.appointment(1,{deadline:iso(600000)})
  f.appointment(2,{kind:'recurring',starts,deadline:iso(3*day)})
  f.appointment(3,{status:'confirmed'})
  const standard=f.one('SELECT payment_deadline_at FROM appointments WHERE id=1').payment_deadline_at
  await normalizeHourlyDeadlines(f.env);await expireUnpaidReservations(f.env)
  assert.equal(f.one('SELECT payment_deadline_at FROM appointments WHERE id=1').payment_deadline_at,standard)
  assert.equal(f.one('SELECT payment_deadline_at FROM appointments WHERE id=2').payment_deadline_at,new Date(Date.parse(starts)-day).toISOString())
  assert.deepEqual(f.db.prepare('SELECT status FROM appointments ORDER BY id').all().map(x=>x.status),['pending_payment','pending_payment','confirmed'])
})

test('recurring reservations expire by their own deadline, never by creation +15 minutes',async()=>{
  const f=await fixture();f.appointment(1,{kind:'recurring',deadline:iso(day)})
  f.db.exec("UPDATE appointments SET created_at=datetime('now','-3 days')")
  await expireUnpaidReservations(f.env)
  assert.equal(f.one('SELECT status FROM appointments').status,'pending_payment')
  f.db.prepare('UPDATE appointments SET payment_deadline_at=?,reserved_until=?').run(iso(-1),iso(-1))
  await expireUnpaidReservations(f.env)
  assert.equal(f.one('SELECT status FROM appointments').status,'cancelled')
})

test('recurrence generation remains weekly/fortnightly with its original two-days-before deadline',async()=>{
  for(const cadence of [7,14]){
    const f=await fixture(),starts=iso(-day)
    f.appointment(1,{status:'confirmed',starts})
    f.db.prepare("INSERT INTO patient_recurrence(id,patient_id,cadence_days,weekday,start_time) VALUES('rule',1,?,1,'13:00')").run(cadence)
    const id=await ensureNextRecurringReservation(f.env,1)
    const ap=f.one(`SELECT a.*,av.starts_at FROM appointments a JOIN availability av ON av.id=a.availability_id WHERE a.id=${id}`)
    assert.equal(ap.reservation_kind,'recurring')
    assert.equal(Date.parse(ap.starts_at),Date.parse(starts)+cadence*day)
    const localDay=new Date(Date.parse(ap.starts_at)-3*3600000).toISOString().slice(0,10)
    assert.equal(ap.payment_deadline_at,new Date(Date.parse(localDay+'T23:59:59-03:00')-2*day).toISOString())
    assert.equal(await ensureNextRecurringReservation(f.env,1),id)
    assert.equal(f.one('SELECT count(*) AS n FROM appointments').n,2)
  }
})

test('removal without an event does not request OAuth',async()=>{
  const f=await fixture();f.appointment(1);globalThis.fetch=async()=>{throw Error('No network expected')}
  assert.equal(await removePortalAppointmentFromGoogle(f.env,1),true)
  assert.equal(f.one('SELECT calendar_sync_state FROM appointments').calendar_sync_state,'removed')
})

for(const status of [401,403,500])test(`Google ${status} preserves ID and retry deletes instead of recreating`,async()=>{
  const f=await fixture();f.appointment(1,{event:'event1'});f.google(status)
  await expireUnpaidReservations(f.env)
  assert.equal(f.one('SELECT google_calendar_event_id FROM appointments').google_calendar_event_id,'event1')
  assert.equal(f.one('SELECT calendar_sync_state FROM appointments').calendar_sync_state,'removal_pending')
  assert.equal(f.one('SELECT status FROM availability').status,'free')
  const calls=f.google(204);await retryPendingGoogleCalendarAppointments(f.env)
  assert.equal(f.one('SELECT google_calendar_event_id FROM appointments').google_calendar_event_id,null)
  assert.equal(calls.filter(c=>c.method==='DELETE').length,1)
  assert.equal(calls.filter(c=>c.url.includes('/calendar/')&&c.method==='POST').length,0)
})

for(const status of [404,410])test(`Google ${status} is an idempotent successful removal`,async()=>{
  const f=await fixture();f.appointment(1,{event:'gone'});f.google(status)
  assert.equal(await removePortalAppointmentFromGoogle(f.env,1),true)
  assert.equal(f.one('SELECT google_calendar_event_id FROM appointments').google_calendar_event_id,null)
})

test('OAuth/network failure does not stop expiration or lose Google ID',async()=>{
  const f=await fixture();f.appointment(1,{event:'event1'});f.google()
  globalThis.fetch=async()=>{throw Error('Network unavailable')}
  await expireUnpaidReservations(f.env)
  assert.equal(f.one('SELECT status FROM appointments').status,'cancelled')
  assert.equal(f.one('SELECT google_calendar_event_id FROM appointments').google_calendar_event_id,'event1')
})

test('retry never creates an event for overdue pending or inactive appointments',async()=>{
  const f=await fixture();f.appointment(1);f.appointment(2,{status:'cancelled'})
  const calls=f.google();await retryPendingGoogleCalendarAppointments(f.env)
  assert.equal(calls.length,0)
})

for(const [path,admin] of [['/api/appointments/mine',false],['/api/admin/session-management/appointments',true]])test(`${path} returns expired reservations as inactive history`,async()=>{
  const f=await fixture();f.appointment(1);f.appointment(2,{deadline:iso(day),kind:'recurring'})
  const r=await handleSessionManagement(f.req(path,admin),f.env,path),data=await r.json()
  assert.equal(data.appointments.find(a=>a.id===1).status,'cancelled')
  assert.equal(data.appointments.find(a=>a.id===2).status,'pending_payment')
})

for(const [path,admin,handler] of [['/api/availability',false,handlePublicAvailabilityV3],['/api/admin/availability-v2',true,handleScheduleV2]])test(`${path} shares expiration cleanup`,async()=>{
  const f=await fixture();f.appointment(1)
  const r=await handler(f.req(path,admin),f.env,path)
  assert.equal(r.status,200)
  assert.equal(f.one('SELECT status FROM appointments').status,'cancelled')
  assert.equal(f.one('SELECT status FROM availability').status,'free')
})

test('expired legacy reserved_until is not reused and a new booking gets a new deadline',async()=>{
  const f=await fixture();f.appointment(1)
  f.db.exec('UPDATE appointments SET payment_deadline_at=NULL')
  const path='/api/appointments/reserve',response=await handlePatientReserveV2(f.req(path,false,{slot_id:1}),f.env,path)
  assert.equal(response.status,201)
  assert.equal(f.one('SELECT status FROM appointments WHERE id=1').status,'cancelled')
  assert.equal(f.one('SELECT count(*) AS n FROM appointments').n,2)
})

test('expiration does not release a slot belonging to another active appointment',async()=>{
  const f=await fixture();f.appointment(1)
  f.db.prepare("INSERT INTO appointments(patient_id,availability_id,status,payment_deadline_at,reserved_until) VALUES(1,1,'pending_payment',?,?)").run(iso(day),iso(day))
  await expireUnpaidReservations(f.env)
  assert.equal(f.one('SELECT status FROM availability').status,'held')
})

test('cancellation during Google event creation removes the newly created event',async()=>{
  const f=await fixture();f.appointment(1,{deadline:iso(day)});f.google()
  let deleted=false
  globalThis.fetch=async(url,init)=>{
    if(String(url).includes('oauth2'))return Response.json({access_token:'fake'})
    if(init.method==='POST'){
      f.db.exec("UPDATE appointments SET status='cancelled'")
      return Response.json({id:'late-event'})
    }
    assert.equal(init.method,'DELETE');deleted=true;return new Response(null,{status:204})
  }
  assert.equal(await syncPortalAppointmentToGoogle(f.env,1),null)
  assert.equal(deleted,true)
  assert.equal(f.one('SELECT google_calendar_event_id FROM appointments').google_calendar_event_id,null)
})

test('a deadline extended between selection and cleanup is rechecked before cancellation',async()=>{
  const f=await fixture();f.appointment(1)
  const batch=f.env.DB.batch
  f.env.DB.batch=async statements=>{
    f.db.prepare('UPDATE appointments SET payment_deadline_at=?,reserved_until=? WHERE id=1').run(iso(day),iso(day))
    return batch(statements)
  }
  await expireUnpaidReservations(f.env)
  assert.equal(f.one('SELECT status FROM appointments').status,'pending_payment')
  assert.equal(f.one('SELECT status FROM availability').status,'held')
})

test('payment confirmation winning the cleanup race keeps the slot confirmed',async()=>{
  const f=await fixture();f.appointment(1)
  const batch=f.env.DB.batch
  f.env.DB.batch=async statements=>{
    f.db.exec("UPDATE appointments SET status='confirmed'; UPDATE availability SET status='confirmed'")
    return batch(statements)
  }
  await expireUnpaidReservations(f.env)
  assert.equal(f.one('SELECT status FROM appointments').status,'confirmed')
  assert.equal(f.one('SELECT status FROM availability').status,'confirmed')
})

test('a notification database failure cannot release a successfully created reservation',async()=>{
  const f=await fixture();f.slot(1,iso(day),'free')
  f.db.exec('DROP TABLE patient_notifications')
  const path='/api/appointments/reserve'
  const response=await handlePatientReserveV2(f.req(path,false,{slot_id:1}),f.env,path)
  assert.equal(response.status,201)
  assert.equal(f.one('SELECT status FROM appointments').status,'pending_payment')
  assert.equal(f.one('SELECT status FROM availability').status,'held')
})

test('Google retry failure cannot abort the remaining scheduled session tasks',async()=>{
  const f=await fixture();f.appointment(1,{deadline:iso(day)});f.google()
  globalThis.fetch=async()=>{throw Error('Google unavailable')}
  const result=await retryPendingGoogleCalendarAppointments(f.env)
  assert.equal(result.failed,1)
})

test('recurrence reconciliation does not recreate a cancelled occurrence or reclaim its slot',async()=>{
  const f=await fixture();f.appointment(1,{status:'confirmed',starts:iso(-6*day)})
  f.db.exec("INSERT INTO patient_recurrence(id,patient_id,cadence_days,weekday,start_time) VALUES('rule',1,7,1,'13:00')")
  const id=await ensureNextRecurringReservation(f.env,1)
  await expireUnpaidReservations(f.env)
  assert.equal(f.one(`SELECT status FROM appointments WHERE id=${id}`).status,'cancelled')
  assert.equal(await ensureNextRecurringReservation(f.env,1),id)
  assert.equal(f.one('SELECT count(*) AS n FROM appointments').n,2)
  assert.equal(f.one(`SELECT av.status FROM availability av JOIN appointments a ON a.availability_id=av.id WHERE a.id=${id}`).status,'free')
})
