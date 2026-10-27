import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {Store} from '../../server/core/db.ts';
import {Auth} from '../../server/core/auth.ts';

test('live status and notices enforce real HTTP boundaries and render escaped authenticated content',async()=>{
  const fixture=createServer((req,res)=>{
    if(req.url==='/identity')res.end(JSON.stringify({MediaContainer:{machineIdentifier:'test-server'}}));
    else if(req.url==='/jelly/health')res.end('Healthy');
    else if(req.url==='/api/v1/status')res.end(JSON.stringify({version:'3.3.0',commitTag:'test'}));
    else if(req.url==='/health')res.end(JSON.stringify({ok:true}));
    else if(req.url==='/internal/health')res.end(JSON.stringify({ok:true,components:[{name:'viewer',ok:true,code:'ok'},{name:'lineup',ok:true,code:'ok'}]}));
    else{res.statusCode=404;res.end();}
  });await new Promise<void>(r=>fixture.listen(0,'127.0.0.1',r));const remote=`http://127.0.0.1:${(fixture.address() as any).port}`;
  const portProbe=createServer();await new Promise<void>(r=>portProbe.listen(0,'127.0.0.1',r));const port=(portProbe.address() as any).port;await new Promise<void>(r=>portProbe.close(()=>r()));
  const base=`http://127.0.0.1:${port}`,dir=mkdtempSync(join(tmpdir(),'bulock-status-')),path=join(dir,'portal.sqlite'),key='test-only-status-key-at-least-32-chars';
  const db=new Store(path),auth=new Auth(db,key,Date.now,'owner');const owner=auth.plexSignIn({id:'owner',name:'Owner'},true);auth.invite('test@example.com','owner');const proof=auth.issueEmail('test@example.com')!,member=auth.consumeEmail(proof.id,proof.code);
  const child=spawn(process.execPath,[resolve('.output/server/index.mjs')],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATABASE_PATH:path,APP_URL:base,APP_SECRET:key,APP_SECRET_FILE:'',ADMIN_PLEX_ID:'owner',PLEX_SERVER_ID:'test-server',PLEX_URL:remote,JELLYFIN_URL:remote+'/jelly',SEERR_URL:remote,IPTV_URL:remote,IPTV_GATEWAY_INTERNAL_URL:remote,IPTV_INTERNAL_KEY:'test-only-internal',SMTP_HOST:'127.0.0.1',SMTP_PORT:'9',SMTP_PASSWORD:'',SMTP_PASSWORD_FILE:'',PLEX_OWNER_TOKEN:'',PLEX_OWNER_TOKEN_FILE:'',JELLYFIN_API_KEY:'',JELLYFIN_API_KEY_FILE:''},stdio:'pipe'});let output='';child.stderr?.on('data',b=>output+=b);child.stdout?.on('data',b=>output+=b);
  const adminHeaders={cookie:'bulock='+owner.token,Origin:base,'X-Bulock-Request':'1','Content-Type':'application/json'},userHeaders={...adminHeaders,cookie:'bulock='+member.token};
  const post=(path:string,body:any={},headers=adminHeaders)=>fetch(base+'/api/'+path,{method:'POST',headers,body:JSON.stringify(body)});
  try{
    let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(base+'/api/health')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}assert.ok(ready,output);
    assert.equal((await fetch(base+'/api/status')).status,401);
    assert.equal((await fetch(base+'/api/admin/status',{headers:userHeaders})).status,403);
    assert.equal((await post('admin/status/check',{},userHeaders)).status,403);
    assert.equal((await post('admin/status/check',{}, {...adminHeaders,Origin:'https://evil.example'})).status,403);
    await post('admin/status/check');
    let data=await(await fetch(base+'/api/status',{headers:userHeaders})).json();assert.equal(data.services.length,4);assert.ok(data.services.every((s:any)=>s.state==='responding'));assert.doesNotMatch(JSON.stringify(data),/diagnostic|fingerprint|machineIdentifier|test-only-internal/);
    const input={services:['plex','iptv'],type:'maintenance',title:'Planned maintenance',message:'Tonight <script>alert(1)</script>'};
    assert.equal((await post('admin/status/notices/save',input,userHeaders)).status,403);
    const saved=await(await post('admin/status/notices/save',input)).json();assert.ok(saved.id);
    data=await(await fetch(base+'/api/status',{headers:userHeaders})).json();assert.equal(data.notices.length,0);
    await post('admin/status/notices/publish',{id:saved.id});
    db.run("UPDATE service_status SET state='unavailable',checked=?,outage_since=? WHERE id IN ('plex','seerr')",Date.now(),Date.now()-60000);
    let home=await(await fetch(base+'/',{headers:userHeaders})).text();assert.match(home,/Planned maintenance/);assert.match(home,/&lt;script&gt;/);assert.doesNotMatch(home,/<script>alert\(1\)<\/script>/);assert.match(home,/Service status/);
    assert.match(home,/Seerr is currently unavailable/);assert.doesNotMatch(home,/Plex is currently unavailable/,'a manual notice covering Plex replaces its separate automatic banner');
    db.run("UPDATE service_status SET checked=? WHERE id='seerr'",Date.now()-181000);
    home=await(await fetch(base+'/',{headers:userHeaders})).text();assert.doesNotMatch(home,/Seerr is currently unavailable/,'stale measurements become unknown instead of claiming an ongoing outage');
    const login=await(await fetch(base+'/login')).text();assert.doesNotMatch(login,/Planned maintenance/);
    assert.match(await(await fetch(base+'/admin/status',{headers:adminHeaders})).text(),/Check now/);
    db.run('UPDATE sessions SET fresh=0 WHERE user_id=?',owner.user.id);
    assert.equal((await post('admin/status/notices/resolve',{id:saved.id})).status,401);
    assert.equal((await post('admin/status/check')).status,200);
    db.run('UPDATE sessions SET fresh=? WHERE user_id=?',Date.now(),owner.user.id);
    await post('admin/status/notices/resolve',{id:saved.id});home=await(await fetch(base+'/',{headers:userHeaders})).text();assert.doesNotMatch(home,/Planned maintenance/);
    assert.equal((await post('admin/status/notices/save',{...input,services:['invalid']})).status,400);
  }finally{child.kill();await new Promise<void>(r=>{child.once('exit',()=>r());setTimeout(r,1500).unref();});db.close();fixture.closeAllConnections();await new Promise<void>(r=>fixture.close(()=>r()));rmSync(dir,{recursive:true,force:true});}
});
