import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/core/db.ts';
import {Communications} from '../server/core/communications.ts';
import {contentSchema,renderContent,plainContent} from '../shared/content.ts';
import {Jobs} from '../server/core/jobs.ts';
import {invalidateRestored} from '../server/core/restore.ts';
import {returnPath} from '../shared/return-path.ts';
const content=[{type:'paragraph',children:[{text:'Maintenance <today>',bold:true}]}];
test('news links survive sign-in without allowing external redirects',()=>{assert.equal(returnPath('/news/abc-123'),'/news/abc-123');assert.equal(returnPath('/news?page=2'),'/news?page=2');assert.equal(returnPath('//evil.test/news'),'/');});
function setup(){const db=new Store(':memory:');for(const [id,email,disabled] of [['a','a@example.com',0],['b',null,0],['c','c@example.com',1]])db.run('INSERT INTO users(id,name,email,disabled,created) VALUES(?,?,?,?,?)',id,id,email,disabled,1);const service=new Communications(db,'test-key');return {db,service};}
test('restricted content escapes text and rejects executable links and unknown nodes',()=>{
 assert.match(renderContent(content),/&lt;today&gt;/);assert.equal(plainContent(content),'Maintenance <today>');
 assert.throws(()=>contentSchema.parse([{type:'paragraph',children:[{text:'x',href:'javascript:alert(1)'}]}]));
 assert.throws(()=>contentSchema.parse([{type:'image',src:'x'}]));
});
test('news drafts stay private, publication orders and unpublishing removes access',()=>{
 const {db,service:s}=setup();const post=s.save('news',{title:'Update',content},'a');assert.equal(s.news().items.length,0);assert.throws(()=>s.published(post.id));
 s.publish(post.id,true,'a');assert.equal(s.news().items[0].title,'Update');s.save('news',{id:post.id,title:'Edited',content},'a');assert.equal(s.published(post.id).title,'Edited');
 assert.throws(()=>s.remove('news',post.id,'a'));s.publish(post.id,false,'a');assert.throws(()=>s.published(post.id));s.remove('news',post.id,'a');db.close();
});
test('alert review freezes recipients, send is atomic and repeat sends cannot duplicate',()=>{
 const {db,service:s}=setup();const alert=s.save('alerts',{title:'Notice',content,audience:'all',userIds:[]},'a');const review=s.preview(alert.id);
 assert.deepEqual(review.recipients.map((r:any)=>r.id),['a']);assert.equal(review.skipped.length,1);
 s.send(alert.id,review.token,'a');s.send(alert.id,review.token,'a');assert.equal(db.get("SELECT count(*) n FROM jobs WHERE kind='alert-email'").n,1);
 assert.throws(()=>s.save('alerts',{id:alert.id,title:'Changed',content,audience:'all'},'a'));assert.throws(()=>s.remove('alerts',alert.id,'a'));db.close();
});
test('changing a reviewed audience requires another review',()=>{
 const {db,service:s}=setup();const alert=s.save('alerts',{title:'Notice',content,audience:'all'},'a');const review=s.preview(alert.id);db.run("UPDATE users SET email='b@example.com' WHERE id='b'");assert.throws(()=>s.send(alert.id,review.token,'a'));assert.equal(db.get('SELECT count(*) n FROM jobs').n,0);db.close();
});
test('delivery records success, skips changed addresses and recovers interrupted sends without replay',async()=>{
 const {db,service:s}=setup();const alert=s.save('alerts',{title:'Notice',content},'a');s.send(alert.id,s.preview(alert.id).token,'a');let delivered=0;
 const jobs=new Jobs(db,{} as any,{cfg:{key:'test-key'},deliver:async()=>{delivered++;}} as any);jobs.lastSync=Date.now();await jobs.tick();assert.equal(delivered,1);assert.equal(s.status(alert.id)[0].status,'sent');
 const second=s.save('alerts',{title:'Next',content},'a');s.send(second.id,s.preview(second.id).token,'a');db.run("UPDATE users SET email='changed@example.com' WHERE id='a'");await jobs.tick();assert.equal(delivered,1);assert.equal(s.status(second.id)[0].status,'skipped');
 const third=s.save('alerts',{title:'Interrupted',content},'a');s.send(third.id,s.preview(third.id).token,'a');db.run("UPDATE alert_recipients SET status='sending' WHERE alert_id=? AND status='queued'",third.id);new Jobs(db,{} as any,{cfg:{key:'test-key'}} as any);assert.equal(s.status(third.id)[0].status,'uncertain');assert.throws(()=>s.retry(third.id,s.status(third.id)[0].id,false,'a'));
 const fourth=s.save('alerts',{title:'Restored',content},'a');s.send(fourth.id,s.preview(fourth.id).token,'a');invalidateRestored(db);assert.equal(s.status(fourth.id)[0].status,'skipped');assert.equal(db.get("SELECT count(*) n FROM jobs WHERE kind='alert-email'").n,0);db.close();
});
test('SMTP rejection is retryable but ambiguous errors require review',async()=>{
 const {db,service:s}=setup();const alert=s.save('alerts',{title:'Notice',content},'a');s.send(alert.id,s.preview(alert.id).token,'a');let error:any=Object.assign(new Error('rejected'),{responseCode:550});
 const jobs=new Jobs(db,{} as any,{cfg:{key:'test-key'},deliver:async()=>{throw error;}} as any);jobs.lastSync=Date.now();await jobs.tick();assert.equal(s.status(alert.id)[0].status,'failed');const rid=s.status(alert.id)[0].id;s.retry(alert.id,rid,false,'a');error=Object.assign(new Error('connection ended after DATA'),{code:'ECONNECTION'});await jobs.tick();assert.equal(s.status(alert.id)[0].status,'uncertain');db.close();
});
test('selected recipients exclude disabled accounts and keep successful deliveries out of retries',async()=>{
 const {db,service:s}=setup();db.run("UPDATE users SET email='b@example.com' WHERE id='b'");const alert=s.save('alerts',{title:'Selected',content,audience:'selected',userIds:['a','a','c']},'a');const review=s.preview(alert.id);assert.deepEqual(review.recipients.map((u:any)=>u.id),['a']);s.send(alert.id,review.token,'a');const jobs=new Jobs(db,{} as any,{cfg:{key:'test-key'},deliver:async()=>{}} as any);jobs.lastSync=Date.now();await jobs.tick();assert.throws(()=>s.retry(alert.id,s.status(alert.id)[0].id,false,'a'));db.close();
});
test('news pagination is stable and excludes drafts; authentication jobs run before alerts',async()=>{
 const {db,service:s}=setup();for(let i=0;i<12;i++){const p=s.save('news',{title:'Post '+i,content},'a');s.publish(p.id,true,'a');db.run('UPDATE news SET published=? WHERE id=?',i+1,p.id);}s.save('news',{title:'Hidden',content},'a');assert.equal(s.news().total,12);assert.equal(s.news().items[0].title,'Post 11');assert.equal(s.news(2).items.length,2);assert.equal(s.news(1,3).items.length,3);
 const alert=s.save('alerts',{title:'Notice',content},'a');s.send(alert.id,s.preview(alert.id).token,'a');db.run("INSERT INTO jobs(id,kind,payload,next) VALUES('login','email','login',0)");const calls:string[]=[];const jobs=new Jobs(db,{} as any,{cfg:{key:'test-key'},deliver:async(p:string)=>{calls.push(p);}} as any);jobs.lastSync=Date.now();await jobs.tick();assert.equal(calls[0],'login');assert.equal(calls.length,2);db.close();
});
