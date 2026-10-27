import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Store} from '../server/core/db.ts';
import {Auth} from '../server/core/auth.ts';
import {Iptv} from '../server/core/iptv.ts';
import {createGateway} from '../integrations/iptv/gateway.mjs';

async function fixture(){
 const db=new Store(':memory:'),iptv=new Iptv(db,'key'),auth=new Auth(db,'key');
 const user=auth.plexSignIn({id:'alias-http',name:'Viewer'},true).user;iptv.request(user.id);
 const creds=iptv.appCredentials(user.id),requests:string[]=[];
 const upstream=createServer((req,res)=>{
  requests.push(req.url!);
  if(req.url==='/lineup.m3u'){res.setHeader('Content-Type','audio/x-mpegurl');res.end('#EXTM3U\nhttp://'+req.headers.host+'/stream/channel/test\n');}
  else if(req.url==='/xmltv.xml'){res.setHeader('Content-Type','application/xml');res.end('<tv><channel id="test"><display-name>Test</display-name></channel></tv>');}
  else if(req.url==='/stream/channel/test'){res.setHeader('Content-Type','video/mp2t');res.end('media');}
  else{res.writeHead(404);res.end();}
 });
 const portal=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer internal-key'){res.writeHead(401);res.end();return;}
  let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);
  const result=req.url==='/api/internal/iptv/alias'?iptv.resolveAlias(input.phrase):iptv.verify(input.token,input.kind);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 });
 const listen=async(server:any)=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${server.address().port}`;};
 const upstreamUrl=await listen(upstream),portalUrl=await listen(portal);
 const gateway=createGateway({publicUrl:'http://127.0.0.1',upstream:upstreamUrl,portal:portalUrl,internalKey:'internal-key'});
 const base=await listen(gateway);
 return {db,iptv,user,creds,base,requests,close:()=>{for(const server of [gateway,portal,upstream]){server.closeAllConnections();server.close();}db.close();}};
}

test('phrase playlist and guide serve directly with native-token playback, including HEAD',async()=>{
 const f=await fixture();try{
  const response=await fetch(f.base+'/p/'+f.creds.phrase,{redirect:'manual'});assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);
  assert.match(response.headers.get('content-type')!,/mpegurl/);assert.equal(response.headers.get('cache-control'),'no-store');
  const playlist=await response.text();assert.ok(playlist.includes('/media/v/'+f.creds.token+'/stream/channel/test'));assert.ok(!playlist.includes(f.creds.phrase));
  const playback=await fetch(f.base+'/media/v/'+f.creds.token+'/stream/channel/test');assert.equal(await playback.text(),'media');
  const guide=await fetch(f.base+'/g/'+f.creds.phrase);assert.equal(guide.status,200);assert.match(guide.headers.get('content-type')!,/xml/);assert.match(await guide.text(),/<tv>/);
  for(const route of ['p','g']){const head=await fetch(f.base+'/'+route+'/'+f.creds.phrase,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');}
  assert.deepEqual(f.requests,['/lineup.m3u','/stream/channel/test','/xmltv.xml','/lineup.m3u','/xmltv.xml']);
 }finally{f.close();}
});

test('aliases reject unknown phrases, malformed routes and query strings without fetching upstream',async()=>{
 const f=await fixture();try{
  assert.equal((await fetch(f.base+'/p/unknown-phrase-value',{redirect:'manual'})).status,403);
  for(const path of ['/p','/g/','/p/'+f.creds.phrase+'/admin','/p/'+f.creds.phrase+'?upstream=http://outside','/p/MAPLE-OTTER-SUNSET','/g/a%2fb']){
   const result=await fetch(f.base+path,{redirect:'manual'});assert.ok([400,403].includes(result.status),path);assert.equal(result.headers.get('location'),null);
  }
  assert.equal(f.requests.length,0);assert.equal(f.db.get("SELECT count FROM limits WHERE key='iptv:alias'").count,7);
  assert.equal((await fetch(f.base+'/p/'+f.creds.phrase,{method:'POST'})).status,405);
 }finally{f.close();}
});

test('shared alias exhaustion returns Retry-After while native URLs keep working',async()=>{
 const f=await fixture();try{
  for(let i=0;i<60;i++)f.iptv.resolveAlias('unknown');
  const response=await fetch(f.base+'/p/'+f.creds.phrase);assert.equal(response.status,429);
  assert.match(response.headers.get('retry-after')!,/^\d+$/);assert.ok(Number(response.headers.get('retry-after'))<=60);assert.equal(response.headers.get('cache-control'),'no-store');
  const native=await fetch(f.base+'/media/v/'+f.creds.token+'/lineup.m3u');assert.equal(native.status,200);
  assert.equal(f.requests.length,1);
 }finally{f.close();}
});

test('replacing or revoking credentials denies old alias and playback URLs',async()=>{
 const f=await fixture();try{
  f.iptv.rotate(f.user.id);assert.equal((await fetch(f.base+'/p/'+f.creds.phrase,{redirect:'manual'})).status,403);
  assert.equal((await fetch(f.base+'/media/v/'+f.creds.token+'/lineup.m3u')).status,403);
  const current=f.iptv.appCredentials(f.user.id);assert.equal((await fetch(f.base+'/g/'+current.phrase)).status,200);
  f.iptv.revoke(f.user.id,'admin');assert.equal((await fetch(f.base+'/g/'+current.phrase,{redirect:'manual'})).status,403);
 }finally{f.close();}
});
