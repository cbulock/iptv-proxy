import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createStatusProbes} from '../server/core/status-probes.ts';
import {getHealthText} from '../integrations/iptv/health.mjs';

test('probes validate real service responses and never accept generic login pages or wrong Plex servers',async()=>{
  let mode='good';const seen:string[]=[];
  const server=createServer((req,res)=>{seen.push(req.url!);if(mode==='redirect'){res.writeHead(302,{Location:'/login'});res.end();return;}
    if(mode==='html'){res.end('<html><form>Sign in</form></html>');return;}
    const path=req.url!;
    if(path==='/identity')res.end(JSON.stringify({MediaContainer:{machineIdentifier:mode==='wrong'?'other':'expected'}}));
    else if(path==='/health')res.end('Healthy');
    else if(path==='/tv/health')res.end(JSON.stringify({ok:true}));
    else if(path==='/api/v1/status')res.end(JSON.stringify({version:'3.3.0',commitTag:'abcdef',updateAvailable:false,commitsBehind:0,restartRequired:false}));
    else if(path==='/internal/health')res.end(JSON.stringify({ok:true,components:[{name:'viewer',ok:true,code:'ok'},{name:'lineup',ok:true,code:'ok'}]}));
    else {res.statusCode=404;res.end();}
  });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
  try{const probes=createStatusProbes({plexUrl:base,plexServer:'expected',jellyfinUrl:base,seerrUrl:base,iptvUrl:base+'/tv',iptvGatewayInternal:base,internalKey:'private-secret'});
    for(const p of Object.values(probes))assert.equal((await p.run(AbortSignal.timeout(1000))).ok,true);
    mode='wrong';assert.equal((await probes.plex.run(AbortSignal.timeout(1000))).ok,false);
    for(const failure of ['html','redirect']){mode=failure;for(const p of Object.values(probes))assert.equal((await p.run(AbortSignal.timeout(1000))).ok,false);}
    assert.ok(seen.includes('/api/v1/status'));assert.equal(seen.some(path=>path.startsWith('/api/v1/status?')),false,'the deployed Seerr schema rejects unknown query parameters');
    assert.equal(probes.iptv.fingerprint.includes('private-secret'),false);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
test('probe body limits, aborts and HTTP errors return only safe categories',async()=>{
  let mode='large';const server=createServer((_req,res)=>{if(mode==='large')res.end('x'.repeat(4096));else if(mode==='slow'){res.write('start');}else{res.statusCode=500;res.end('private secret');}});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
  try{assert.equal((await getHealthText(base,AbortSignal.timeout(1000),1024)).code,'unexpected-response');
    mode='slow';assert.equal((await getHealthText(base,AbortSignal.timeout(30),1024)).code,'timeout');
    mode='error';const result=await getHealthText(base,AbortSignal.timeout(1000),1024);assert.equal(result.code,'http-error');assert.equal(result.http,500);assert.doesNotMatch(JSON.stringify(result),/private|secret/);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
