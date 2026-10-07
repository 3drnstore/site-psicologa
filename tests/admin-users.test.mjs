import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

registerHooks({resolve(specifier,context,nextResolve){
  if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))specifier+='.ts'
  return nextResolve(specifier,context)
}})
const { handleAdminSecurity }=await import('../src/admin-security.ts')
const { readAdminSession }=await import('../src/admin-session-reader.ts')
const { sha256 }=await import('../src/auth.ts')

async function fixture(){
  const db=new DatabaseSync(':memory:')
  const source=readFileSync(new URL('../src/schema.ts',import.meta.url),'utf8')
  db.exec(source.split('await env.DB.exec(`')[1].split('`)')[0])
  db.exec('ALTER TABLE admin_sessions ADD COLUMN admin_email TEXT; ALTER TABLE admin_sessions ADD COLUMN admin_display_name TEXT; ALTER TABLE admin_sessions ADD COLUMN admin_role TEXT;')
  function prepare(sql){let values=[];return {bind(...v){values=v;return this},async first(){return db.prepare(sql).get(...values)||null},async all(){return {results:db.prepare(sql).all(...values)}},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}}}}}
  const env={DB:{prepare,async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}}}}
  async function user(id,role='assistant',active=1){
    db.prepare('INSERT INTO admin_users(id,email,password_hash,password_salt,display_name,role,active) VALUES(?,?,?,?,?,?,?)').run(id,`${id}@example.invalid`,'x','x',id,role,active)
    db.prepare('INSERT INTO admin_sessions(id,admin_user_id,token_hash,expires_at,admin_email,admin_display_name,admin_role) VALUES(?,?,?,?,?,?,?)').run(`${id}-session`,id,await sha256(id),new Date(Date.now()+86400000).toISOString(),`${id}@example.invalid`,id,role)
    db.prepare('INSERT INTO password_reset_tokens(id,account_type,account_id,token_hash,expires_at) VALUES(?,?,?,?,?)').run(`${id}-reset`,'admin',id,`${id}-hash`,'2099-01-01')
  }
  await user('owner','psychologist')
  const req=(id,actor='owner',confirmation='EXCLUIR USUÁRIO')=>new Request(`https://example.invalid/api/admin/users/${id}`,{method:'DELETE',headers:{cookie:`ps_admin_session=${actor}`,'content-type':'application/json'},body:JSON.stringify({confirmation})})
  return {db,env,user,req,remove:(id,actor,confirmation)=>handleAdminSecurity(req(id,actor,confirmation),env,`/api/admin/users/${id}`)}
}

test('deletes active and inactive users, revokes snapshot sessions and resets, preserves history',async()=>{
  for(const active of [0,1]){
    const f=await fixture();await f.user('target','assistant',active)
    f.db.exec("INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type) VALUES('history','admin','target','old_action','admin_user')")
    const response=await f.remove('target');assert.equal(response.status,200)
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM admin_users WHERE id='target'").get().n,0)
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM admin_sessions WHERE admin_user_id='target'").get().n,0)
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM password_reset_tokens WHERE account_id='target'").get().n,0)
    assert.equal(await readAdminSession(f.req('owner','target'),f.env),null)
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit_log WHERE id='history'").get().n,1)
    assert.equal(f.db.prepare("SELECT actor_id FROM audit_log WHERE action='admin_user_deleted'").get().actor_id,'owner')
    assert.ok(await readAdminSession(f.req('target'),f.env))
  }
})
test('requires an authenticated psychologist and confirmation',async()=>{
  const f=await fixture();await f.user('target');await f.user('assistant')
  assert.equal((await f.remove('target','missing')).status,401)
  assert.equal((await f.remove('target','assistant')).status,403)
  assert.equal((await f.remove('target','owner','')).status,400)
  assert.ok(f.db.prepare("SELECT id FROM admin_users WHERE id='target'").get())
})
test('protects self, reports missing users, and allows deleting another psychologist',async()=>{
  const f=await fixture()
  assert.equal((await f.remove('owner')).status,409)
  assert.equal((await f.remove('missing')).status,404)
  await f.user('other','psychologist')
  assert.equal((await f.remove('other')).status,200)
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM admin_users WHERE role='psychologist' AND active=1").get().n,1)
})
test('atomic guard preserves the last active psychologist with a stale actor snapshot',async()=>{
  const f=await fixture();await f.user('last','psychologist')
  f.db.exec("UPDATE admin_users SET active=0 WHERE id='owner'")
  assert.equal((await f.remove('last')).status,409)
  assert.ok(f.db.prepare("SELECT id FROM admin_users WHERE id='last'").get())
  assert.ok(f.db.prepare("SELECT id FROM admin_sessions WHERE admin_user_id='last'").get())
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit_log WHERE action='admin_user_deleted'").get().n,0)
})
