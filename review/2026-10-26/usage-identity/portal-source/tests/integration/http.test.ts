import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {Store} from '../../server/core/db.ts';
import {Auth} from '../../server/core/auth.ts';
import {liveTvGuides} from '../../shared/live-tv-guides.ts';

test('real HTTP routes enforce auth, origin, proof consumption, SSR sessions and internal authorization',async()=>{
  const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
  const base=`http://127.0.0.1:${port}`,dir=mkdtempSync(join(tmpdir(),'bulock-http-')),path=join(dir,'test.sqlite'),key='local-test-key-not-a-production-secret';
  const db=new Store(path),auth=new Auth(db,key,Date.now,'owner');auth.invite('person@example.com','test');const proof=auth.issueEmail('person@example.com')!;const owner=auth.plexSignIn({id:'owner',name:'Owner',email:'owner@example.com'},true);
  const child=spawn(process.execPath,[resolve('.output/server/index.mjs')],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),APP_URL:base,APP_SECRET:key,DATABASE_PATH:path,SMTP_USER:'test@example.com',SMTP_PASSWORD:'test-only',SMTP_HOST:'127.0.0.1',SMTP_PORT:'9',SMTP_PASSWORD_FILE:'',IPTV_INTERNAL_KEY:'test-internal',ADMIN_PLEX_ID:'',PLEX_OWNER_TOKEN:'',JELLYFIN_API_KEY:'',PLEX_URL:base,JELLYFIN_URL:base,SEERR_URL:base,IPTV_URL:base,IPTV_GATEWAY_INTERNAL_URL:base},stdio:'pipe'});let output='';child.stderr?.on('data',chunk=>output+=chunk);child.stdout?.on('data',chunk=>output+=chunk);
  try{
    let ready=false;for(let i=0;i<80;i++){try{ready=(await fetch(base+'/api/health')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}assert.ok(ready,output);
    assert.equal((await fetch(base+'/api/admin/overview')).status,401);
    const guideRedirect=await fetch(base+'/guides?service=plex&device=roku',{redirect:'manual'});assert.equal(guideRedirect.status,302);assert.match(guideRedirect.headers.get('location')||'',/returnTo=/);
    for(const path of ['plex/enable','plex/check','plex/help'])assert.equal((await fetch(base+'/api/'+path,{method:'POST',headers:{Origin:base,'X-Bulock-Request':'1'},body:'{}'})).status,401);
    const adminPage=await fetch(base+'/admin',{headers:{cookie:'bulock='+owner.token}});assert.equal(adminPage.status,200);assert.match(await adminPage.text(),/Invite someone/);
    const adminHeaders={cookie:'bulock='+owner.token,Origin:base,'Content-Type':'application/json','X-Bulock-Request':'1'};
    const post=(path:string,body:any,headers=adminHeaders)=>fetch(base+'/api/'+path,{method:'POST',headers,body:JSON.stringify(body)});
    const content=[{type:'paragraph',children:[{text:'Portal news test',bold:true},{text:' link',href:'https://example.com'}]}];
    assert.equal((await fetch(base+'/api/news')).status,401);
    assert.equal((await post('admin/news/save',{title:'Blocked',content},{...adminHeaders,Origin:'https://evil.example'})).status,403);
    const draft=await (await post('admin/news/save',{title:'Test news',content})).json();assert.ok(draft.id);
    assert.equal((await fetch(base+'/api/news/'+draft.id,{headers:adminHeaders})).status,404);
    assert.equal((await post('admin/news/publish',{id:draft.id,publish:true})).status,200);
    const news=await (await fetch(base+'/api/news',{headers:adminHeaders})).json();assert.equal(news.items[0].id,draft.id);
    assert.match(await (await fetch(base+'/',{headers:adminHeaders})).text(),/Test news/);
    assert.match(await (await fetch(base+'/news/'+draft.id,{headers:adminHeaders})).text(),/Portal news test/);
    for(const route of ['/admin/news','/admin/alerts']){const response=await fetch(base+route,{headers:adminHeaders});assert.equal(response.status,200);assert.match(await response.text(),/Drafts &amp; history|Posts/);}
    assert.equal((await post('admin/news/save',{title:'Unsafe',content:[{type:'paragraph',children:[{text:'x',href:'javascript:alert(1)'}]}]})).status,400);
    const notice=await (await post('admin/alerts/save',{title:'Test alert',content,audience:'all'})).json();assert.ok(notice.id);
    const review=await (await post('admin/alerts/preview',{id:notice.id})).json();assert.equal(review.recipients.length,0);assert.equal((await post('admin/alerts/send',{id:notice.id,token:review.token})).status,400);
    assert.equal((await post('admin/news/publish',{id:draft.id,publish:false})).status,200);
    assert.equal((await fetch(base+'/api/news/'+draft.id,{headers:adminHeaders})).status,404);
    db.run('UPDATE sessions SET fresh=0 WHERE user_id=?',owner.user.id);
    assert.equal((await post('admin/plex/check',{userId:owner.user.id})).status,200,'access checks accept an existing admin session');
    assert.equal((await post('admin/plex/libraries',{})).status,503,'catalog refresh reaches Plex without reauthentication');
    for(const action of ['defaults','retry'])assert.equal((await post('admin/plex/'+action,{userId:owner.user.id,libraries:['1']})).status,401,'access changes still require recent sign-in');
    const stale=await fetch(base+'/api/admin/user',{method:'POST',headers:{cookie:'bulock='+owner.token,Origin:base,'Content-Type':'application/json','X-Bulock-Request':'1'},body:JSON.stringify({userId:owner.user.id,action:'approve-iptv'})});assert.equal(stale.status,401);
    assert.equal((await fetch(base+'/api/internal/iptv/check',{method:'POST',body:JSON.stringify({token:'x'})})).status,401);
    assert.equal((await fetch(base+'/api/auth/email/verify',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example','X-Bulock-Request':'1'},body:JSON.stringify({id:proof.id,proof:proof.code})})).status,403);
    assert.equal((await fetch(base+'/login')).status,200);assert.equal(db.get('SELECT used FROM challenges WHERE id=?',proof.id).used,0);
    const headers={'Content-Type':'application/json',Origin:base,'X-Bulock-Request':'1'};
    const unavailable=await (await fetch(base+'/api/auth/email/send',{method:'POST',headers,body:JSON.stringify({email:'unknown@example.com'})})).json();assert.equal(unavailable.queued,false);assert.equal(unavailable.id,undefined);assert.match(unavailable.message,/No email was sent/);assert.equal(db.get("SELECT count(*) AS n FROM jobs WHERE kind='email'").n,0);
    const account=await (await fetch(base+'/account?verifyEmail=1',{headers:{cookie:'bulock='+owner.token}})).text();assert.match(account,/owner@example.com/);assert.match(account,/Verify the email from Plex/);assert.match(account,/Skip for now/);
    const signed=await fetch(base+'/api/auth/email/verify',{method:'POST',headers,body:JSON.stringify({id:proof.id,proof:proof.code})});assert.equal(signed.status,200);const cookie=signed.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await fetch(base+'/api/auth/email/verify',{method:'POST',headers,body:JSON.stringify({id:proof.id,proof:proof.link})})).status,400);
    const page=await fetch(base+'/',{headers:{cookie},redirect:'manual'});assert.equal(page.status,200);const home=await page.text();assert.match(home,/Connect Plex account/);assert.doesNotMatch(home,/Open Plex/);const linkedHome=await (await fetch(base+'/',{headers:adminHeaders})).text();assert.match(linkedHome,/Open Plex/);assert.doesNotMatch(linkedHome,/Connect Plex account/);
    assert.equal((await fetch(base+'/api/admin/overview',{headers:{cookie}})).status,403);
    assert.equal((await post('admin/alerts/save',{title:'Forbidden',content},{...headers,cookie})).status,403);
    assert.equal((await fetch(base+'/api/admin/news',{headers:{cookie}})).status,403);
    assert.equal((await fetch(base+'/api/news/'+draft.id,{headers:{cookie}})).status,404);
    db.run('UPDATE sessions SET fresh=? WHERE user_id=?',Date.now(),owner.user.id);
    const readyReview=await (await post('admin/alerts/preview',{id:notice.id})).json();assert.equal(readyReview.recipients.length,1);
    for(let i=0;i<2;i++)assert.equal((await post('admin/alerts/send',{id:notice.id,token:readyReview.token})).status,200);
    assert.equal(db.get("SELECT count(*) n FROM alert_recipients WHERE alert_id=? AND status<>'skipped'",notice.id).n,1);
    assert.equal((await post('admin/alerts/save',{id:notice.id,title:'Changed sent alert',content})).status,409);
    assert.equal((await post('admin/alerts/delete',{id:notice.id})).status,409);
    const tvGuide=await (await fetch(base+'/guides?service=plex&device=roku',{headers:{cookie}})).text();assert.match(tvGuide,/Watch on Roku/);assert.match(tvGuide,/on-device sign-in/);assert.doesNotMatch(tvGuide,/Link your TV/);assert.doesNotMatch(tvGuide,/Copy Plex browser address/);
    const fireGuide=await (await fetch(base+'/guides?service=plex&device=fire-tv',{headers:{cookie}})).text();assert.match(fireGuide,/Link your TV/);
    const browserGuide=await (await fetch(base+'/guides?service=plex&device=browser',{headers:{cookie}})).text();assert.match(browserGuide,/Copy Plex browser address/);
    const unknownGuide=await (await fetch(base+'/guides?service=plex&device=unknown',{headers:{cookie}})).text();assert.match(unknownGuide,/Choose a device to see/);
    const liveUser=db.get('SELECT id FROM users WHERE email=?','person@example.com').id;
    const beforeHandoffs=db.get('SELECT count(*) n FROM handoffs').n;
    for(const guide of liveTvGuides){
      const result=await fetch(base+'/guides?service=iptv&device='+guide.id,{headers:{cookie}});assert.equal(result.status,200);
      const html=await result.text();assert.ok(html.includes('Watch on '+guide.name),guide.id);assert.match(html,/Enable Live TV/);
      assert.doesNotMatch(html,/\/media\/v\//,'Reading a guide must not reveal personal app credentials');
    }
    for(const device of ['', 'tv','phone','unknown']){const html=await(await fetch(base+'/guides?service=iptv&device='+device,{headers:{cookie}})).text();assert.match(html,/Choose a device above for setup instructions/);}
    for(const access of ['pending','approved','revoked']){
      db.run('UPDATE grants SET iptv=? WHERE user_id=?',access,liveUser);
      const html=await(await fetch(base+'/guides?service=iptv&device=browser',{headers:{cookie}})).text();
      assert.ok(html.includes(access==='pending'?'Enable Live TV':access==='approved'?'Live TV is enabled.':'Your Live TV access was revoked.'));
      assert.match(html,/Compatibility mode/);assert.doesNotMatch(html,/\/media\/v\//);
    }
    assert.equal(db.get('SELECT count(*) n FROM handoffs').n,beforeHandoffs,'Reading guides must not create browser launch sessions');
    assert.equal(db.get('SELECT token_cipher FROM grants WHERE user_id=?',liveUser).token_cipher,null,'Reading guides must not create app credentials');
    db.run("UPDATE grants SET iptv='none' WHERE user_id=?",liveUser);
    const liveAccount=await(await fetch(base+'/account',{headers:{cookie}})).text();assert.match(liveAccount,/id="live-tv"/);assert.match(liveAccount,/Live TV setup guide/);
    assert.equal((await fetch(base+'/api/admin/plex/defaults',{method:'POST',headers:{...headers,cookie},body:JSON.stringify({libraries:['1']})})).status,403);
    assert.equal((await fetch(base+'/api/iptv/credentials',{method:'POST',headers:{...headers,cookie},body:'{}'})).status,403);
    const userHeaders={...headers,cookie};
    assert.equal((await post('iptv/request',{}, {...headers})).status,401);
    assert.equal((await post('iptv/request',{}, {...userHeaders,Origin:'https://evil.example'})).status,403);
    assert.equal((await post('iptv/request',{},userHeaders)).status,200);
    const enabled=await(await fetch(base+'/api/me',{headers:{cookie}})).json();assert.equal(enabled.grants.iptv,'approved');
    const links=await(await post('iptv/credentials',{},userHeaders)).json();assert.match(links.playlist,/\/p\/[a-z]+-[a-z]+-[a-z]+$/);assert.equal(links.guide,links.playlist.replace('/p/','/g/'));
    assert.equal((await post('iptv/launch',{},userHeaders)).status,200);
    assert.equal((await post('iptv/request',{},userHeaders)).status,200);
    assert.deepEqual(await(await post('iptv/credentials',{},userHeaders)).json(),links,'Repeated activation preserves app links');
    assert.equal((await post('admin/user',{userId:liveUser,action:'revoke-iptv'})).status,200);
    assert.equal((await post('iptv/request',{},userHeaders)).status,403);
    assert.equal((await post('iptv/launch',{},userHeaders)).status,403);
    assert.equal((await post('iptv/credentials',{},userHeaders)).status,403);
    for(const route of ['/', '/account','/guides?service=iptv']){
      const html=await(await fetch(base+route,{headers:{cookie}})).text();
      assert.match(html,/administrator.*restore/);assert.doesNotMatch(html,/>Enable Live TV/);
    }
    assert.equal((await post('admin/user',{userId:liveUser,action:'approve-iptv'},userHeaders)).status,403);
    assert.equal((await post('admin/user',{userId:liveUser,action:'approve-iptv'})).status,200);
    assert.equal((await post('iptv/launch',{},userHeaders)).status,200);
    const restoredLinks=await(await post('iptv/credentials',{},userHeaders)).json();assert.notEqual(restoredLinks.playlist,links.playlist);
    const check=await fetch(base+'/api/internal/iptv/check',{method:'POST',headers:{Authorization:'Bearer test-internal','Content-Type':'application/json'},body:JSON.stringify({token:'invalid'})});assert.equal(check.status,200);assert.equal((await check.json()).allowed,false);
    await fetch(base+'/api/auth/logout',{method:'POST',headers:{...headers,cookie},body:'{}'});assert.equal((await (await fetch(base+'/api/me',{headers:{cookie}})).json()).user,null);
    const queued=await (await fetch(base+'/api/auth/email/send',{method:'POST',headers,body:JSON.stringify({email:'person@example.com'})})).json();assert.equal(queued.queued,true);assert.ok(queued.id);assert.match(queued.message,/queued/);assert.ok(db.get('SELECT id FROM challenges WHERE id=?',queued.id));assert.equal(db.get("SELECT count(*) AS n FROM jobs WHERE kind='email'").n,1);
  }finally{child.kill();await new Promise<void>(r=>{child.once('exit',()=>r());setTimeout(r,1500).unref();});db.close();rmSync(dir,{recursive:true,force:true});}
});
