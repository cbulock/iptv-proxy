import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {randomBytes,createHash,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {gatewayHealth} from './health.mjs';
import {publishedQuery,projectPublished,readBounded,readArtwork,safeBackendError} from './live-tv.mjs';

export function allowedMediaPath(path){
  if(path.includes('..')||path.includes('\\')||/%2e|%2f|%5c/i.test(path)||path.startsWith('//'))return false;
  return /^\/(?:lineup\.(?:m3u|json)|xmltv\.xml|channels\.json|guide\.json)$/.test(path)||/^\/profiles\/[a-zA-Z0-9_-]+\/(?:lineup\.(?:m3u|json)|xmltv\.xml)$/.test(path)||/^\/(?:stream|transcode)\/[^/]+\/[^/]+$/.test(path);
}
export function rewriteText(text,upstream,prefix){
  const origin=new URL(upstream).origin;
  return text.split(origin+'/').join(prefix+'/');
}
function encodeResource(path,key,binding,kind='resource'){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(key).digest(),iv);cipher.setAAD(Buffer.from(binding));const data=Buffer.concat([cipher.update(JSON.stringify({kind,path,expires:Date.now()+8*3600000})),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
export function decodeResource(value,key,binding,kind='resource'){if(value.length>8192)throw Error('Invalid resource');const bytes=Buffer.from(value,'base64url'),decipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(key).digest(),bytes.subarray(0,12));decipher.setAAD(Buffer.from(binding));decipher.setAuthTag(bytes.subarray(12,28));const data=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());if((data.kind||'resource')!==kind||!Number.isFinite(data.expires)||data.expires<=Date.now()||typeof data.path!=='string')throw Error('Expired resource');return data.path;}
export function rewriteManifest(text,responseUrl,prefix,key,binding,publicOrigin){
  const origin=new URL(responseUrl).origin;
  const rewrite=uri=>{const target=new URL(uri,responseUrl);if(![origin,publicOrigin].includes(target.origin)||!allowedMediaPath(target.pathname))throw Error('Unprotected media resource');return target.searchParams.has('upstream')?prefix+'/resource/'+encodeResource(target.pathname+target.search,key,binding):prefix+target.pathname+target.search;};
  return text.split(/\r?\n/).map(line=>{if(!line.trim())return line;if(!line.trim().startsWith('#'))return rewrite(line.trim());return rewriteText(line,responseUrl,prefix).replace(/tvg-logo="[^"]*"/g,'tvg-logo=""').replace(/URI="([^"]+)"/g,(_match,uri)=>`URI="${rewrite(uri.startsWith(prefix+'/')?origin+uri.slice(prefix.length):uri)}"`);}).join('\n');
}
function validatePlaylist(text,prefix){
  for(const line of text.split(/\r?\n/)){
    const urls=line.trim().startsWith('#')?[...line.matchAll(/URI="([^"]+)"/g)].map(m=>m[1]):[line.trim()];
    for(const uri of urls){if(!uri||uri.startsWith('#'))continue;if(!uri.startsWith(prefix+'/'))throw Error('Unprotected media URL');const path=new URL(uri).pathname.slice(new URL(prefix).pathname.length);if(!allowedMediaPath(path)&&!/^\/resource\/[a-zA-Z0-9_-]+$/.test(path))throw Error('Unprotected media route');}
  }
}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').slice(0,2)));}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function encodedIdentity(value){if(typeof value!=='string'||!value.trim()||value.length>256)return null;try{const encoded=encodeURIComponent(value.trim());return encoded.length<=1024?encoded:null;}catch{return null;}}
export function createGateway(config){
  const cfg={interval:30000,...config};
  if(cfg.interval>45000)throw Error('Revalidation interval must not exceed 45 seconds');
  const secure=new URL(cfg.publicUrl).protocol==='https:',cookie=secure?'__Host-bulock-tv':'bulock-tv';
  const usageIdentitySecret=typeof cfg.usageIdentitySecret==='string'&&cfg.usageIdentitySecret.length<=256&&/^[\x21-\x7e]+$/.test(cfg.usageIdentitySecret)?cfg.usageIdentitySecret:null;
  const internal=async(path,body)=>{const response=await fetch(cfg.portal.replace(/\/$/,'')+'/api/internal/iptv/'+path,{method:'POST',headers:{Authorization:`Bearer ${cfg.internalKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000),redirect:'error'});if(!response.ok)throw Error('Authorization failed');return response.json();};
  const check=cfg.check||(async(value,kind)=>internal('check',{token:value,kind}));
  const allowed=result=>result===true||result?.allowed===true;
  return createServer(async(req,res)=>{
    let timer,controller,startup,timedOut=false;
    res.on('close',()=>{clearInterval(timer);clearTimeout(startup);controller?.abort();});
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('X-Frame-Options','DENY');
    try{
      const url=new URL(req.url,cfg.publicUrl);
      if(url.pathname==='/internal/health'){
        const actual=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+cfg.internalKey);
        if(!cfg.internalKey||actual.length!==expected.length||!timingSafeEqual(actual,expected)){json(res,401,{error:'Unauthorized'});return;}
        if(req.method!=='GET'){json(res,405,{error:'Method not allowed'});return;}
        json(res,200,await gatewayHealth(cfg));return;
      }
      if(url.pathname==='/health'){json(res,200,{ok:true});return;}
      if(url.pathname==='/portal-launch'&&req.method==='GET'){
        res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Open Live TV · Bulock Media</title><style>body{font:16px system-ui;background:#101317;color:#f1f2ed;max-width:440px;margin:15vh auto;padding:25px;line-height:1.7}p{color:#adb5bf}</style><h1>Live TV</h1><p id="status" role="status">Opening Live TV…</p><noscript>Enable JavaScript, then open Live TV from the portal again.</noscript><script>const code=new URLSearchParams(location.hash.slice(1)).get('code');history.replaceState(null,'','/portal-launch');(async()=>{try{if(!code)throw Error();const r=await fetch('/portal-launch',{method:'POST',headers:{'Content-Type':'application/json','X-Bulock-Request':'1'},body:JSON.stringify({code})});if(!r.ok)throw Error();location.replace('/');}catch{document.getElementById('status').textContent='Unable to open Live TV. The launch link may have expired. Open Live TV from the portal again.';}})();</script></html>`);return;
      }
      if(url.pathname==='/portal-launch'&&req.method==='POST'){
        if(req.headers.origin!==new URL(cfg.publicUrl).origin||req.headers['x-bulock-request']!=='1'){json(res,403,{error:'Forbidden'});return;}
        let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('Too large');}const value=JSON.parse(body);if(typeof value.code!=='string'||value.code.length>128)throw Error('Invalid code');const result=await internal('exchange',{code:value.code});res.setHeader('Set-Cookie',`${cookie}=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${result.expiresIn}${secure?'; Secure':''}`);json(res,200,{ok:true});return;
      }
      if(!['GET','HEAD'].includes(req.method)){json(res,405,{error:'Method not allowed'});return;}
      let native=url.pathname.match(/^\/media\/v\/([a-zA-Z0-9_-]+)(\/.*)$/);
      if(/^\/[pg](?:\/|$)/.test(url.pathname)){
        const alias=url.pathname.match(/^\/([pg])\/([a-z]{3,7}-[a-z]{3,7}-[a-z]{3,7})$/);
        // Every alias attempt consumes the shared portal budget, including malformed paths.
        const resolved=await internal('alias',{phrase:alias&&!url.search?alias[2]:''});
        if(resolved.retryAfter){res.setHeader('Retry-After',String(Math.max(1,Math.ceil(Number(resolved.retryAfter)))));json(res,429,{error:'Too many app link requests. Please try again shortly.'});return;}
        if(!alias||url.search){json(res,400,{error:'Invalid app link'});return;}
        if(resolved.allowed!==true||typeof resolved.token!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(resolved.token)){json(res,403,{error:'Access unavailable. Open Live TV from Bulock Media.'});return;}
        native=[url.pathname,resolved.token,alias[1]==='p'?'/lineup.m3u':'/xmltv.xml'];
      }
      const value=native?native[1]:cookies(req)[cookie],kind=native?'native':'viewer';
      const verified=value?await check(value,kind):false;
      if(!allowed(verified)){if(!url.pathname.startsWith('/media')&&!value){res.writeHead(302,{Location:cfg.portalPublic||'https://media.bulock.house'});res.end();}else json(res,403,{error:'Access unavailable. Open Live TV from Bulock Media.'});return;}
      if(url.pathname==='/'&&!cfg.viewer){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Live TV · Bulock Media</title><style>body{font:16px system-ui;background:#101317;color:#f1f2ed;max-width:620px;margin:12vh auto;padding:24px;line-height:1.8}a{color:#d5ed92}h1{font-weight:550}p{color:#adb5bf}li{padding:8px}</style><h1>Your Live TV is ready.</h1><p>Use your personal playlist and guide in a compatible IPTV app. For permanent app connection links, open your Bulock Media Account page.</p><ul><li><a href="/media/lineup.m3u">Download playlist for this session</a></li><li><a href="/media/xmltv.xml">Download guide for this session</a></li><li><a href="https://media.bulock.house/account">Get personal app connection details</a></li><li><a href="https://media.bulock.house/guides?service=iptv">Setup instructions</a></li></ul></html>');return;}
      const media=Boolean(native)||url.pathname.startsWith('/media/');
      let targetPath=native?native[2]:media?url.pathname.slice('/media'.length):url.pathname;
      let targetSearch=url.search;
      let artwork=false;
      if(media&&!publishedQuery(targetPath,url.searchParams)){json(res,400,{error:'Invalid media query'});return;}
      if(media&&targetPath.startsWith('/artwork/')){
        try{targetPath=decodeResource(targetPath.slice('/artwork/'.length),cfg.internalKey,kind+':'+value,'artwork');if(!/^\/artwork\/[a-zA-Z0-9_-]{1,256}$/.test(targetPath))throw Error('Invalid artwork');artwork=true;}
        catch{json(res,403,{error:'Invalid artwork token'});return;}
      }else if(media&&targetPath.startsWith('/resource/')){
        try{const resolved=new URL(decodeResource(targetPath.slice('/resource/'.length),cfg.internalKey,kind+':'+value),cfg.upstream);if(resolved.origin!==new URL(cfg.upstream).origin||!/^\/(?:stream|transcode)\//.test(resolved.pathname)||!allowedMediaPath(resolved.pathname))throw Error('Invalid resource');targetPath=resolved.pathname;targetSearch=resolved.search;}
        catch{json(res,403,{error:'Invalid media token'});return;}
      }else if(media&&url.searchParams.has('upstream')){json(res,403,{error:'Untrusted nested resource'});return;}
      if(media&&!artwork&&!allowedMediaPath(targetPath)){json(res,403,{error:'Media route not permitted'});return;}
      if(!media&&targetPath.startsWith('/api/')){json(res,403,{error:'Viewer API is not exposed'});return;}
      if(!media&&!(targetPath==='/'||targetPath.startsWith('/_nuxt/')||targetPath==='/favicon.ico')){json(res,404,{error:'Not found'});return;}
      const upstream=media?cfg.upstream:cfg.viewer;
      if(!upstream){json(res,404,{error:'Not found'});return;}
      const target=new URL(targetPath+targetSearch,upstream);
      if(target.origin!==new URL(upstream).origin)throw Error('Invalid target');
      if(res.destroyed)return;
      controller=new AbortController();
      // The artwork deadline includes headers and the entire bounded body. Transcode
      // may need twenty seconds to start; ordinary startup keeps its twelve seconds.
      startup=setTimeout(()=>{timedOut=true;controller.abort();},artwork?8000:targetPath.startsWith('/transcode/')?20000:12000);
      // No incoming credentials, cookies or forwarded hosts cross into the private service.
      const headers={};if(!artwork&&req.headers.range)headers.Range=req.headers.range;
      if(media&&usageIdentitySecret){
        const userId=encodedIdentity(verified?.userId);
        const userName=encodedIdentity(verified?.userName);
        if(userId){
          headers['X-IPTV-Identity-Secret']=usageIdentitySecret;
          headers['X-IPTV-User-Id']=userId;
          if(userName)headers['X-IPTV-User-Name']=userName;
        }
      }
      const response=await fetch(target,{method:req.method,headers,redirect:'manual',signal:controller.signal});
      if(response.status>=300&&response.status<400){await response.body?.cancel();clearTimeout(startup);json(res,502,{error:'Upstream redirect rejected'});return;}
      if(!response.ok){
        const result=await safeBackendError(response,targetPath,req.method==='HEAD');
        if(timedOut)throw Error('Upstream timeout');
        clearTimeout(startup);
        if(response.status===429){const retry=response.headers.get('retry-after');if(retry&&/^\d{1,9}$/.test(retry))res.setHeader('Retry-After',retry);}
        json(res,result.status,result.body);return;
      }
      let checking=false;
      timer=setInterval(async()=>{if(checking)return;checking=true;try{if(!allowed(await check(value,kind))){controller.abort();res.destroy();}}catch{controller.abort();res.destroy();}finally{checking=false;}},cfg.interval);timer.unref();
      const type=response.headers.get('content-type')||'application/octet-stream';
      if(req.method==='HEAD'){
        clearTimeout(startup);await response.body?.cancel();
        if(artwork&&!/^image\/(png|jpeg|webp|gif|avif)(?:;|$)/i.test(type))throw Error('Invalid artwork');
        res.statusCode=response.status;res.setHeader('Content-Type',artwork?type.split(';')[0]:type);res.end();return;
      }
      if(artwork){const image=await readArtwork(response);clearTimeout(startup);res.statusCode=response.status;res.setHeader('Content-Type',image.mime);res.end(image.bytes);return;}
      if(media&&['/channels.json','/guide.json'].includes(targetPath)){
        const data=JSON.parse((await readBounded(response)).toString());
        const prefix='/media'+(native?'/v/'+value:'');
        const result=projectPublished(targetPath,data,prefix,path=>encodeResource(path,cfg.internalKey,kind+':'+value,'artwork'));
        clearTimeout(startup);json(res,response.status,result);return;
      }
      clearTimeout(startup);
      res.statusCode=response.status;res.setHeader('Content-Type',type);
      for(const name of ['content-range','accept-ranges']){const h=response.headers.get(name);if(h)res.setHeader(name,h);}
      const isText=media&&(/mpegurl|xml|json|text/i.test(type)||/\.(m3u|xml|json)$/.test(targetPath));
      if(isText){const raw=(await readBounded(response)).toString();const prefix=cfg.publicUrl.replace(/\/$/,'')+'/media'+(native?'/v/'+value:'');const manifest=/mpegurl/i.test(type)||targetPath.endsWith('.m3u');const output=manifest?rewriteManifest(raw,target.toString(),prefix,cfg.internalKey,kind+':'+value,new URL(cfg.publicUrl).origin):rewriteText(raw,upstream,prefix).replace(/<icon\b[^>]*\/?\s*>/gi,'');if(manifest)validatePlaylist(output,prefix);res.end(output);}
      else if(response.body)Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);else res.end();
    }catch{controller?.abort();clearInterval(timer);clearTimeout(startup);if(!res.headersSent&&!res.destroyed)json(res,timedOut?504:502,{error:timedOut?'Media service timed out':'Access verification or upstream service unavailable'});else res.destroy();}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const key=process.env.IPTV_INTERNAL_KEY_FILE?readFileSync(process.env.IPTV_INTERNAL_KEY_FILE,'utf8').trim():process.env.IPTV_INTERNAL_KEY;
  if(!key||!process.env.PORTAL_INTERNAL_URL||!process.env.IPTV_UPSTREAM_URL||!process.env.IPTV_PUBLIC_URL)throw Error('Configure gateway endpoints and IPTV_INTERNAL_KEY');
  createGateway({upstream:process.env.IPTV_UPSTREAM_URL,viewer:process.env.IPTV_VIEWER_URL,publicUrl:process.env.IPTV_PUBLIC_URL,portal:process.env.PORTAL_INTERNAL_URL,portalPublic:process.env.APP_URL,internalKey:key,usageIdentitySecret:process.env.IPTV_USAGE_IDENTITY_SECRET}).listen(Number(process.env.PORT||3400),'0.0.0.0',()=>console.log('IPTV access gateway listening'));
}
