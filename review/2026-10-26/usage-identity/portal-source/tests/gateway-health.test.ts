import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createGateway} from '../integrations/iptv/gateway.mjs';
import {validViewer} from '../integrations/iptv/health.mjs';
import {gatewayHealth} from '../integrations/iptv/health.mjs';
test('viewer validation rejects a generic Nuxt sign-in page',()=>{
  assert.equal(validViewer('<html><head><title>Sign in</title></head><body><script src="/_nuxt/login.js"></script></body></html>'),false);
  assert.equal(validViewer('<html><head><title>Live TV · Bulock Media</title></head><body><div id="__nuxt"></div></body></html>'),true);
});
test('gateway diagnostics require the internal key and detect viewer/lineup failures without tuning',async()=>{
  let broken=false;const paths:string[]=[];
  const upstream=createServer((req,res)=>{paths.push(req.url!);if(req.url==='/lineup.m3u')res.end(broken?'<html>login</html>':'#EXTM3U\n#EXTINF:-1,Station\nhttp://private/stream/a/b?upstream=secret\n');else res.end('<!doctype html><html><head><title>Live TV · Bulock Media</title></head><body><div id="__nuxt"></div></body></html>');});
  await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(upstream.address() as any).port}`;
  const gateway=createGateway({upstream:origin,viewer:origin,portal:'http://unused',publicUrl:'http://localhost',internalKey:'internal-secret'});await new Promise<void>(r=>gateway.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(gateway.address() as any).port}`;
  try{assert.equal((await fetch(base+'/internal/health')).status,401);assert.equal((await fetch(base+'/internal/health',{headers:{Authorization:'Bearer wrong'}})).status,401);assert.equal(paths.length,0);
    let response=await fetch(base+'/internal/health',{headers:{Authorization:'Bearer internal-secret'}});assert.equal(response.status,200);let result=await response.json();assert.equal(result.ok,true);assert.equal(paths.some(p=>p.includes('/stream/')),false);assert.doesNotMatch(JSON.stringify(result),/private|secret|http:/);
    broken=true;response=await fetch(base+'/internal/health',{headers:{Authorization:'Bearer internal-secret'}});result=await response.json();assert.equal(result.ok,false);assert.equal(result.components.find((c:any)=>c.name==='lineup').code,'unexpected-response');
    assert.deepEqual(await (await fetch(base+'/health')).json(),{ok:true});
    broken=false;const landing=await gatewayHealth({upstream:origin});assert.equal(landing.ok,true);assert.deepEqual(landing.components.find((c:any)=>c.name==='viewer'),{name:'viewer',ok:true,code:'not-applicable'});
  }finally{gateway.closeAllConnections();upstream.closeAllConnections();gateway.close();upstream.close();}
});
