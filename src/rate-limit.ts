type LimitRule={limit:number;windowMs:number;message:string}
type Bucket={count:number;resetAt:number}

const buckets=new Map<string,Bucket>()
let lastSweep=0

const RULES:Record<string,LimitRule>={
  'POST /api/auth/login':{limit:8,windowMs:15*60_000,message:'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.'},
  'POST /api/admin/login':{limit:8,windowMs:15*60_000,message:'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.'},
  'POST /api/auth/register':{limit:4,windowMs:30*60_000,message:'Muitas tentativas de cadastro. Aguarde alguns minutos e tente novamente.'},
  'POST /api/password/forgot':{limit:4,windowMs:30*60_000,message:'Muitas solicitações de recuperação. Aguarde antes de tentar novamente.'},
  'POST /api/password/reset':{limit:8,windowMs:30*60_000,message:'Muitas tentativas de redefinição. Aguarde antes de tentar novamente.'},
  'POST /api/contact':{limit:5,windowMs:10*60_000,message:'Muitas mensagens enviadas em pouco tempo. Aguarde alguns minutos antes de tentar novamente.'},
}

function clientIp(request:Request){
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown'
}

function sweep(now:number){
  if(now-lastSweep<5*60_000)return
  lastSweep=now
  for(const[key,bucket]of buckets){if(bucket.resetAt<=now)buckets.delete(key)}
}

export function checkRateLimit(request:Request,path:string):Response|null{
  const method=request.method.toUpperCase()
  const rule=RULES[`${method} ${path}`]
  if(!rule)return null

  const now=Date.now()
  sweep(now)
  const key=`${clientIp(request)}:${method}:${path}`
  let bucket=buckets.get(key)
  if(!bucket||bucket.resetAt<=now){bucket={count:0,resetAt:now+rule.windowMs};buckets.set(key,bucket)}

  bucket.count+=1
  if(bucket.count<=rule.limit)return null

  const retryAfter=Math.max(1,Math.ceil((bucket.resetAt-now)/1000))
  return new Response(JSON.stringify({ok:false,message:rule.message,retry_after:retryAfter}),{
    status:429,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
      'retry-after':String(retryAfter),
    },
  })
}
