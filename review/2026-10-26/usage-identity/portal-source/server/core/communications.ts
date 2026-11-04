import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Store} from './db.ts';
import {Fault,hash,seal,unseal} from './crypto.ts';
import {contentSchema,plainContent,renderContent,escapeHtml} from '../../shared/content.ts';
type Kind='news'|'alerts';
const draftSchema=z.object({id:z.string().max(128).optional(),title:z.string().trim().min(1).max(200).refine(v=>!/[\r\n]/.test(v)),content:contentSchema,audience:z.enum(['all','selected']).default('all'),userIds:z.array(z.string().min(1).max(128)).max(1000).default([])});
export class Communications {
 db:Store;key:string;
 constructor(db:Store,key:string){this.db=db;this.key=key;}
 row(kind:Kind,id:string){const row=this.db.get(`SELECT * FROM ${kind} WHERE id=?`,id);if(!row)throw new Fault('Not found.',404);return {...row,content:JSON.parse(row.content),...(kind==='alerts'?{userIds:JSON.parse(row.user_ids)}:{})};}
 list(kind:Kind){return this.db.all(`SELECT * FROM ${kind} ORDER BY created DESC`).map(r=>({...r,content:JSON.parse(r.content),...(kind==='alerts'?{userIds:JSON.parse(r.user_ids)}:{})}));}
 save(kind:Kind,input:unknown,actor:string){const data=draftSchema.parse(input),now=Date.now(),id=data.id||randomUUID();return this.db.transaction(()=>{
  if(data.id){const current=this.row(kind,id);if(kind==='alerts'&&current.sent)throw new Fault('Sent alerts cannot be edited.',409);
   this.db.run(`UPDATE ${kind} SET title=?,content=?,updated=? WHERE id=?`,data.title,JSON.stringify(data.content),now,id);
  }else if(kind==='news')this.db.run('INSERT INTO news(id,title,content,author,created,updated) VALUES(?,?,?,?,?,?)',id,data.title,JSON.stringify(data.content),actor,now,now);
  else this.db.run('INSERT INTO alerts(id,title,content,author,created,updated,audience,user_ids) VALUES(?,?,?,?,?,?,?,?)',id,data.title,JSON.stringify(data.content),actor,now,now,data.audience,JSON.stringify([...new Set(data.userIds)]));
  if(kind==='alerts')this.db.run('UPDATE alerts SET audience=?,user_ids=? WHERE id=?',data.audience,JSON.stringify([...new Set(data.userIds)]),id);
  this.db.audit(actor,kind+'.save',id);return this.row(kind,id);
 });}
 remove(kind:Kind,id:string,actor:string){const row=this.row(kind,id);if(row.sent||row.published)throw new Fault('Only drafts can be deleted.',409);this.db.run(`DELETE FROM ${kind} WHERE id=?`,id);this.db.audit(actor,kind+'.delete',id);return {ok:true};}
 publish(id:string,publish:boolean,actor:string){this.row('news',id);this.db.run('UPDATE news SET published=CASE WHEN ? THEN COALESCE(published,?) ELSE NULL END,updated=? WHERE id=?',publish?1:0,Date.now(),Date.now(),id);this.db.audit(actor,publish?'news.publish':'news.unpublish',id);return this.row('news',id);}
 news(page=1,limit=10){const rows=this.db.all('SELECT * FROM news WHERE published IS NOT NULL ORDER BY published DESC,id DESC LIMIT ? OFFSET ?',limit,(page-1)*limit);return {items:rows.map(r=>({id:r.id,title:r.title,published:r.published,excerpt:plainContent(JSON.parse(r.content)).slice(0,220)})),total:this.db.get('SELECT count(*) n FROM news WHERE published IS NOT NULL').n,page};}
 published(id:string){const row=this.row('news',id);if(!row.published)throw new Fault('Not found.',404);return {id:row.id,title:row.title,content:row.content,published:row.published,updated:row.updated};}
 users(){return this.db.all('SELECT id,name,email FROM users WHERE disabled=0 ORDER BY name,id');}
 preview(id:string){const alert=this.row('alerts',id);const users=this.users().filter(u=>alert.audience==='all'||alert.userIds.includes(u.id));const recipients=users.filter(u=>u.email),skipped=users.filter(u=>!u.email);return {recipients,skipped,token:hash(JSON.stringify({id,title:alert.title,content:alert.content,audience:alert.audience,userIds:alert.userIds,recipients}),this.key)};}
 send(id:string,token:string,actor:string){return this.db.transaction(()=>{
  const alert=this.row('alerts',id);if(alert.sent)return this.status(id);
  const preview=this.preview(id);if(preview.token!==token)throw new Fault('Content or recipients changed. Review the alert again.',409);if(!preview.recipients.length)throw new Fault('No eligible recipients.');
  const now=Date.now();this.db.run('UPDATE alerts SET sent=?,updated=? WHERE id=?',now,now,id);
  for(const user of [...preview.recipients,...preview.skipped]){const rid=randomUUID();this.db.run('INSERT INTO alert_recipients(id,alert_id,user_id,address,status,updated,error) VALUES(?,?,?,?,?,?,?)',rid,id,user.id,seal(user.email||'',this.key),user.email?'queued':'skipped',now,user.email?null:'No verified email address.');if(user.email)this.enqueue(rid,user.email,alert);}
  this.db.audit(actor,'alerts.send',id);return this.status(id);
 });}
 enqueue(rid:string,email:string,alert:any){const html=`<html><body style="font-family:Arial,sans-serif;line-height:1.7;max-width:600px;margin:auto;padding:24px"><p>Bulock Media · Important notice</p><h1>${escapeHtml(alert.title)}</h1>${renderContent(alert.content)}</body></html>`;this.db.run('INSERT INTO jobs(id,kind,payload,next) VALUES(?,?,?,?)',`alert:${rid}`,'alert-email',seal(JSON.stringify({to:email,subject:alert.title,text:alert.title+'\n\n'+plainContent(alert.content),html,recipientId:rid}),this.key),Date.now());}
 status(id:string){this.row('alerts',id);return this.db.all('SELECT r.id,r.user_id,r.status,r.updated,r.error,r.address,u.name FROM alert_recipients r LEFT JOIN users u ON u.id=r.user_id WHERE alert_id=? ORDER BY u.name,r.id',id).map(r=>({...r,address:unseal(r.address,this.key)}));}
 retry(id:string,recipientId:string,acknowledge:boolean,actor:string){return this.db.transaction(()=>{const row=this.db.get('SELECT * FROM alert_recipients WHERE id=? AND alert_id=?',recipientId,id);if(!row||!['failed','uncertain'].includes(row.status))throw new Fault('This delivery cannot be retried.',409);if(row.status==='uncertain'&&!acknowledge)throw new Fault('Delivery may already have occurred. Confirm the risk of a duplicate before retrying.',409);
  const email=unseal(row.address,this.key),user=this.db.get('SELECT email,disabled FROM users WHERE id=?',row.user_id);if(!user||user.disabled||user.email!==email)throw new Fault('This recipient is no longer eligible.',409);
  this.db.run('UPDATE alert_recipients SET status=?,error=NULL,updated=? WHERE id=?','queued',Date.now(),recipientId);this.enqueue(recipientId,email,this.row('alerts',id));this.db.audit(actor,'alerts.retry',recipientId);return {ok:true};
 });}
}
