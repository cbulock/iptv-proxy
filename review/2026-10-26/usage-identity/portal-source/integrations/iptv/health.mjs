// Shared bounded, read-only requests. Never return remote bodies on failure.
export async function getHealthText(url,signal,maxBytes=65536,headers={}){
  try{
    const response=await fetch(url,{signal,headers,redirect:'manual'});
    if(!response.ok){await response.body?.cancel();return {ok:false,code:'http-error',http:response.status};}
    const reader=response.body?.getReader();let text='',size=0;const decoder=new TextDecoder();
    if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();return {ok:false,code:'unexpected-response'};}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
    return {ok:true,code:'ok',text};
  }catch{return {ok:false,code:signal.aborted?'timeout':'unreachable'};}
}
export function validLineup(text){return /^\s*#EXTM3U(?:\s|$)/.test(text)&&/^#EXTINF:[^\r\n]+\r?\nhttps?:\/\/\S+/m.test(text);}
export function validViewer(text){return /<html\b/i.test(text)&&/<title\b[^>]*>\s*Live TV\s*(?:·|&middot;|&#183;|&#x0*b7;)\s*Bulock Media\s*<\/title>/i.test(text)&&/(?:id=["']__nuxt["']|\/_nuxt\/)/i.test(text);}
export async function gatewayHealth(cfg){
  const signal=AbortSignal.timeout(8000);
  const components=await Promise.all([
    {name:'viewer',url:cfg.viewer,validate:validViewer,max:1024*1024},
    {name:'lineup',url:cfg.upstream.replace(/\/$/,'')+'/lineup.m3u',validate:validLineup,max:24*1024*1024}
  ].map(async p=>{
    if(!p.url)return {name:p.name,ok:true,code:'not-applicable'};
    const result=await getHealthText(p.url,signal,p.max),ok=result.ok&&p.validate(result.text||'');
    return {name:p.name,ok,code:result.ok?(ok?'ok':'unexpected-response'):result.code};
  }));return {ok:components.every(c=>c.ok),components};
}
