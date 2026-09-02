const json=(data:unknown,status:number,headers:HeadersInit={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8',...headers}})

const SAFE_METHODS=new Set(['GET','HEAD','OPTIONS'])
const EXTERNAL_WEBHOOKS=new Set([
  '/api/payments/webhook/mercadopago',
  '/api/payments/webhook/infinitepay',
])
const MAX_BODY_BYTES=64*1024

export function protectApiRequest(request:Request,path:string):Response|null{
  if(!path.startsWith('/api/'))return null
  const method=request.method.toUpperCase()
  if(SAFE_METHODS.has(method))return null

  const lengthHeader=request.headers.get('content-length')
  if(lengthHeader){
    const length=Number(lengthHeader)
    if(Number.isFinite(length)&&length>MAX_BODY_BYTES){
      return json({ok:false,message:'A solicitação enviada é maior do que o permitido.'},413)
    }
  }

  if(EXTERNAL_WEBHOOKS.has(path))return null

  const secFetchSite=(request.headers.get('sec-fetch-site')||'').toLowerCase()
  if(secFetchSite==='cross-site'){
    return json({ok:false,message:'Solicitação bloqueada por segurança.'},403)
  }

  const origin=request.headers.get('origin')
  if(origin){
    let expected=''
    try{expected=new URL(request.url).origin}catch{}
    if(!expected||origin!==expected){
      return json({ok:false,message:'Solicitação bloqueada por segurança.'},403)
    }
  }

  return null
}
