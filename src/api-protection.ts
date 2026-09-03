const json=(data:unknown,status:number,headers:HeadersInit={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8',...headers}})

const SAFE_METHODS=new Set(['GET','HEAD','OPTIONS'])
const EXTERNAL_WEBHOOKS=new Set([
  '/api/payments/webhook/mercadopago',
  '/api/payments/webhook/infinitepay',
])
const DESKTOP_ORIGINS=new Set(['tauri://localhost','http://tauri.localhost','https://tauri.localhost'])
const MAX_BODY_BYTES=64*1024

function isOfficialDesktop(request:Request,origin:string){
  const ua=request.headers.get('user-agent')||''
  return DESKTOP_ORIGINS.has(origin)&&ua.startsWith('PsicoGestaoDesktop/')
}

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

  const origin=request.headers.get('origin')||''
  const desktop=isOfficialDesktop(request,origin)
  const secFetchSite=(request.headers.get('sec-fetch-site')||'').toLowerCase()
  if(secFetchSite==='cross-site'&&!desktop){
    return json({ok:false,message:'Solicitação bloqueada por segurança.'},403)
  }

  if(origin){
    let expected=''
    try{expected=new URL(request.url).origin}catch{}
    if((!expected||origin!==expected)&&!desktop){
      return json({ok:false,message:'Solicitação bloqueada por segurança.'},403)
    }
  }

  return null
}
