import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {createGateway,rewriteManifest} from '../integrations/iptv/gateway.mjs';

const date='2026-10-24T12:00:00.000Z';
const channel={id:'canonical-id',tvgId:'station',name:'Station',number:'7',source:'Cable',group:'Local',logo:'/artwork/canonical-id',streamUrl:'/stream/channel/source-id',transcodeUrl:'/transcode/channel/source-id',formatHint:'ts'};
const programme={id:'programme-id',channelId:'canonical-id',title:'News',description:'Details',start:date,stop:'2026-10-24T13:00:00.000Z',subtitle:'Local'};
async function fixture(handler:any,options:any={}){
 const paths:string[]=[];const upstream=createServer((req,res)=>{paths.push(req.url!);handler(req,res);});
 await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));
 const gateway=createGateway({upstream:`http://127.0.0.1:${(upstream.address() as any).port}`,publicUrl:'http://localhost',internalKey:'secret',check:async(v:string)=>v==='good'||v==='other',...options});
 await new Promise<void>(r=>gateway.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(gateway.address() as any).port}`;
 return {base,paths,get:(path:string,options:any={})=>fetch(base+path,{...options,headers:{Cookie:'bulock-tv=good',...options.headers}}),close(){gateway.closeAllConnections();upstream.closeAllConnections();gateway.close();upstream.close();}};
}
function send(res:any,value:any){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}

test('gateway forwards verified account identity only when configured and replaces client-supplied headers',async()=>{
 const seen:any[]=[];
 const handler=(req:any,res:any)=>{seen.push(req.headers);res.end('media');};
 const check=async()=>({allowed:true,userId:'account-1',userName:'Bób Smith'});
 const configured=await fixture(handler,{check,usageIdentitySecret:'shared-secret'});
 try{const response=await configured.get('/media/stream/channel/id',{headers:{'X-IPTV-User-Id':'spoof','X-IPTV-User-Name':'Spoof','X-IPTV-Identity-Secret':'spoof'}});assert.equal(response.status,200);assert.equal(seen[0]['x-iptv-user-id'],'account-1');assert.equal(seen[0]['x-iptv-user-name'],encodeURIComponent('Bób Smith'));assert.equal(seen[0]['x-iptv-identity-secret'],'shared-secret');}finally{configured.close();}
 const unconfigured=await fixture(handler,{check});
 try{assert.equal((await unconfigured.get('/media/stream/channel/id',{headers:{'X-IPTV-User-Id':'spoof'}})).status,200);assert.equal(seen[1]['x-iptv-user-id'],undefined);assert.equal(seen[1]['x-iptv-user-name'],undefined);assert.equal(seen[1]['x-iptv-identity-secret'],undefined);}finally{unconfigured.close();}
});

test('malformed or oversized account names do not interrupt playback',async()=>{
 const seen:any[]=[];let userName='\ud800';
 const gateway=await fixture((req:any,res:any)=>{seen.push(req.headers);res.end('media');},{usageIdentitySecret:'shared-secret',check:async()=>({allowed:true,userId:'account-1',userName})});
 try{for(const name of ['\ud800','a'.repeat(5000)]){userName=name;const response=await gateway.get('/media/stream/channel/id');assert.equal(response.status,200);assert.equal(await response.text(),'media');assert.equal(seen.at(-1)['x-iptv-user-id'],'account-1');assert.equal(seen.at(-1)['x-iptv-user-name'],undefined);}}
 finally{gateway.close();}
});

test('published JSON is projected and URLs are protected for browser and native credentials',async()=>{
 const f=await fixture((_req:any,res:any)=>send(res,{channels:[{...channel,original_url:'https://provider/secret',password:'secret'}],fetchedAt:date,private:'secret'}));
 try{for(const path of ['/media/channels.json','/media/v/good/channels.json']){const response=await f.get(path);assert.equal(response.status,200);const data=await response.json();assert.deepEqual(Object.keys(data).sort(),['channels','fetchedAt']);const item=data.channels[0];assert.equal(item.streamUrl,path.includes('/v/')?'/media/v/good/stream/channel/source-id':'/media/stream/channel/source-id');assert.equal(item.transcodeUrl,path.includes('/v/')?'/media/v/good/transcode/channel/source-id':'/media/transcode/channel/source-id');assert.match(item.logo,path.includes('/v/')?/^\/media\/v\/good\/artwork\/[\w-]+$/:/^\/media\/artwork\/[\w-]+$/);assert.doesNotMatch(JSON.stringify(data),/provider|secret|password|original_url/);assert.equal(Object.keys(item).length,10);}
 }finally{f.close();}
});

test('guide preserves bounded paging query and projects only valid programme metadata',async()=>{
 const f=await fixture((_req:any,res:any)=>send(res,{programmes:[{...programme,provider:'https://provider/private'}],fetchedAt:date,revision:'rev-1',nextCursor:'next+/=.cursor',secret:'secret'}));
 try{const response=await f.get('/media/guide.json?hours=48&cursor=next%2B%2F%3D.cursor');assert.equal(response.status,200);assert.equal(f.paths[0],'/guide.json?hours=48&cursor=next%2B%2F%3D.cursor');assert.deepEqual(await response.json(),{programmes:[programme],fetchedAt:date,revision:'rev-1',nextCursor:'next+/=.cursor'});}finally{f.close();}
});

test('JSON query validation and raw artwork routes cannot broaden published access',async()=>{
 const f=await fixture((_req:any,res:any)=>send(res,{channels:[channel],fetchedAt:date}));
 try{for(const path of ['/media/channels.json?profile=all','/media/channels.json?x=1','/media/guide.json?profile=all','/media/guide.json?source=private','/media/guide.json?include_unmapped=true','/media/guide.json?hours=49','/media/guide.json?hours=0','/media/guide.json?hours=1.5','/media/guide.json?hours=48&hours=1','/media/guide.json?cursor=a&cursor=b','/media/guide.json?cursor='+('a'.repeat(4097))])assert.equal((await f.get(path)).status,400,path);
 for(const path of ['/media/artwork/canonical-id','/media/images/foo','/artwork/canonical-id','/media/profiles/default/channels.json'])assert.ok([403,404].includes((await f.get(path)).status),path);
 assert.equal(f.paths.length,0);
 assert.equal((await fetch(f.base+'/media/channels.json')).status,403);
 }finally{f.close();}
});

test('malformed upstream JSON never exposes untrusted URLs or unexpected fields',async()=>{
 let data:any;const f=await fixture((_req:any,res:any)=>send(res,data));
 try{for(const bad of [{...channel,streamUrl:'https://provider/private'},{...channel,transcodeUrl:'/transcode/channel/id?upstream=secret'},{...channel,logo:'/images/private'},{...channel,logo:'/artwork/other-id'},{...channel,formatHint:'evil'},{...channel,name:{secret:'value'}}]){data={channels:[bad],fetchedAt:date};const response=await f.get('/media/channels.json');assert.equal(response.status,502);assert.doesNotMatch(await response.text(),/provider|private|secret|value/);}
 for(const bad of [{...programme,start:'yesterday'},{...programme,stop:date},{...programme,subtitle:{url:'secret'}},{...programme,channelId:'../secret'}]){data={programmes:[bad],fetchedAt:date,revision:'rev-1',nextCursor:null};assert.equal((await f.get('/media/guide.json?hours=48')).status,502);}
 }finally{f.close();}
});

test('artwork tokens are authenticated, credential-bound, tamper resistant, expiring, and separate from stream resources',async()=>{
 const f=await fixture((req:any,res:any)=>req.url==='/channels.json'?send(res,{channels:[channel],fetchedAt:date}):(res.setHeader('Content-Type','image/png'),res.setHeader('Set-Cookie','secret'),res.end(Buffer.from([137,80,78,71,13,10,26,10]))));
 try{let body=await (await f.get('/media/channels.json')).json();const path=body.channels[0].logo;let response=await f.get(path);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal((await response.arrayBuffer()).byteLength,8);assert.ok(f.paths.includes('/artwork/canonical-id'));
 assert.equal((await fetch(f.base+path)).status,403);assert.equal((await f.get(path,{headers:{Cookie:'bulock-tv=other'}})).status,403);assert.equal((await f.get(path+'x')).status,403);assert.equal((await f.get(path.replace('/artwork/','/resource/'))).status,403);assert.equal((await f.get(path+'?profile=other')).status,400);
 const now=Date.now;Date.now=()=>now()-9*3600000;try{body=await (await f.get('/media/channels.json')).json();}finally{Date.now=now;}assert.equal((await f.get(body.channels[0].logo)).status,403);
 const native=await (await f.get('/media/v/good/channels.json')).json();assert.equal((await f.get(native.channels[0].logo)).status,200);assert.equal((await f.get(native.channels[0].logo.replace('/v/good/','/v/other/'))).status,403);
 }finally{f.close();}
});

test('artwork rejects redirects, unsafe MIME, declared and streamed oversize responses',async()=>{
 let mode='mime';const f=await fixture((req:any,res:any)=>{if(req.url==='/channels.json')return send(res,{channels:[channel],fetchedAt:date});if(mode==='redirect'){res.writeHead(302,{Location:'https://provider/private'});return res.end();}res.setHeader('Content-Type',mode==='mime'?'image/svg+xml':'image/png');if(mode==='length')res.setHeader('Content-Length',6*1024*1024);res.end(mode==='stream'?Buffer.alloc(5*1024*1024+1):'private');});
 try{const path=(await (await f.get('/media/channels.json')).json()).channels[0].logo;for(mode of ['mime','length','stream','redirect']){const response=await f.get(path);assert.equal(response.status,502,mode);assert.doesNotMatch(await response.text(),/provider|private/);}}
 finally{f.close();}
});

test('known backend status and codes are safe while unknown error bodies are concealed',async()=>{
 let status=503,code='TRANSCODE_CAPACITY',retry='12';const f=await fixture((_req:any,res:any)=>{res.statusCode=status;res.setHeader('Retry-After',retry);send(res,{error:'https://provider/password',code,debug:'secret'});});
 try{for(const entry of [[401,'UNKNOWN'],[403,'UNKNOWN'],[404,'UNKNOWN'],[429,'TRANSCODE_CAPACITY'],[503,'TRANSCODE_UNAVAILABLE'],[504,'TRANSCODE_STARTUP_TIMEOUT'],[409,'GUIDE_CHANGED'],[400,'INVALID_CURSOR']] as const){[status,code]=[entry[0],entry[1]];const response=await f.get(status===409||status===400?'/media/guide.json?hours=48':'/media/transcode/channel/id');assert.equal(response.status,status);const data=await response.json();assert.doesNotMatch(JSON.stringify(data),/provider|password|secret|UNKNOWN/);if(code!=='UNKNOWN')assert.equal(data.code,code);if(status===429)assert.equal(response.headers.get('retry-after'),'12');}
 status=429;retry='https://provider/private';assert.equal((await f.get('/media/stream/channel/id')).headers.get('retry-after'),null);status=500;assert.equal((await f.get('/media/stream/channel/id')).status,502);
 }finally{f.close();}
});

test('HEAD requests finish without trying to read response bodies',async()=>{
 const f=await fixture((_req:any,res:any)=>{res.setHeader('Content-Type','application/json');res.end();});
 try{for(const path of ['/media/lineup.m3u','/media/channels.json','/media/guide.json?hours=48']){const response=await f.get(path,{method:'HEAD'});assert.equal(response.status,200);assert.equal(await response.text(),'');}}
 finally{f.close();}
});

test('disconnect before upstream headers cancels the pending request',async()=>{
 let connected!:()=>void,closed!:()=>void;const ready=new Promise<void>(r=>connected=r),cancelled=new Promise<void>(r=>closed=r);
 const f=await fixture((_req:any,res:any)=>{res.on('close',closed);connected();});
 try{const client=request(f.base+'/media/stream/channel/id',{headers:{Cookie:'bulock-tv=good'}});client.on('error',()=>{});client.end();await ready;client.destroy();await Promise.race([cancelled,new Promise((_,reject)=>setTimeout(()=>reject(Error('upstream not cancelled')),1000))]);}finally{f.close();}
});

test('artwork absolute timeout includes a stalled body', {timeout:11000},async()=>{
 const f=await fixture((req:any,res:any)=>{if(req.url==='/channels.json')return send(res,{channels:[channel],fetchedAt:date});res.setHeader('Content-Type','image/png');res.write('partial');});
 try{const path=(await (await f.get('/media/channels.json')).json()).channels[0].logo;const started=Date.now();const response=await f.get(path);assert.equal(response.status,504);assert.ok(Date.now()-started<10000);}finally{f.close();}
});

test('transcode startup gets twenty seconds while ordinary requests time out after twelve', {timeout:24000},async()=>{
 const f=await fixture((_req:any,_res:any)=>{});
 try{const started=Date.now();const [stream,transcode]=await Promise.all([f.get('/media/stream/channel/id').then(response=>({response,elapsed:Date.now()-started})),f.get('/media/transcode/channel/id').then(response=>({response,elapsed:Date.now()-started}))]);assert.equal(stream.response.status,504);assert.equal(transcode.response.status,504);assert.ok(stream.elapsed>=11500&&stream.elapsed<15000,`stream elapsed ${stream.elapsed}`);assert.ok(transcode.elapsed>=19500&&transcode.elapsed<23000,`transcode elapsed ${transcode.elapsed}`);}finally{f.close();}
});


test('stream resource tokens cannot authorize artwork and legacy logos remain stripped',async()=>{
 const f=await fixture((req:any,res:any)=>{if(req.url==='/lineup.m3u'){res.setHeader('Content-Type','application/x-mpegurl');return res.end('#EXTM3U\n#EXTINF:-1 tvg-logo="https://provider/secret",Station\n/stream/channel/source-id\n');}if(req.url==='/xmltv.xml'){res.setHeader('Content-Type','application/xml');return res.end('<tv><channel id="station"><icon src="https://provider/secret"/></channel></tv>');}res.end('media');});
 try{const manifest=rewriteManifest('#EXTM3U\n/stream/channel/source-id?upstream=https%3A%2F%2Fprovider%2Fsecret','http://private/lineup.m3u','http://localhost/media','secret','viewer:good');const resource=manifest.match(/\/resource\/([^\s]+)/)![1];assert.equal((await f.get('/media/artwork/'+resource)).status,403);assert.equal((await f.get('/media/resource/'+resource)).status,200);for(const path of ['/media/lineup.m3u','/media/xmltv.xml']){const response=await f.get(path);assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/provider|secret/);}}
 finally{f.close();}
});
