import {randomUUID} from 'node:crypto';
import {Store} from './db.ts';
import {Fault} from './crypto.ts';

export interface PlexSetupApi {
 libraries():Promise<{id:string;key:string;name:string}[]>;
 inspect(plexId:string):Promise<'none'|'pending'|'ready'>;
 invite(plexId:string,libraries:string[]):Promise<unknown>;
}
export class PlexSetup {
 db:Store;api:PlexSetupApi;mail:{queue:(to:string,subject:string,text:string)=>void};
 constructor(db:Store,api:PlexSetupApi,mail:PlexSetup['mail']){this.db=db;this.api=api;this.mail=mail;}
 user(id:string){const u=this.db.get('SELECT * FROM users WHERE id=? AND disabled=0',id);if(!u)throw new Fault('Account unavailable.',403);return u;}
 defaults():string[]{return JSON.parse(this.db.get("SELECT value FROM portal_settings WHERE key='plex-libraries'")?.value||'[]');}
 catalog():{catalog:Awaited<ReturnType<PlexSetupApi['libraries']>>;catalogUpdated:number|null}{
   const cached=this.db.get("SELECT value FROM portal_settings WHERE key='plex-library-catalog'");
   return cached?JSON.parse(cached.value):{catalog:[],catalogUpdated:null};
 }
 async refreshCatalog(){
   const catalog=await this.api.libraries(),snapshot={catalog,catalogUpdated:Date.now()};
   this.db.run("INSERT INTO portal_settings VALUES('plex-library-catalog',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(snapshot));
   return snapshot;
 }
 async saveDefaults(ids:string[],actor:string){
   const unique=[...new Set(ids)],{catalog}=await this.refreshCatalog();
   if(!unique.length||unique.some(id=>!catalog.some(l=>l.id===id)))throw new Fault('Choose at least one available Plex library.');
   this.db.run("INSERT INTO portal_settings VALUES('plex-libraries',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(unique));
   this.db.audit(actor,'plex.defaults',JSON.stringify(unique));return {ok:true};
 }
 row(id:string){this.db.run('INSERT OR IGNORE INTO plex_setup(user_id) VALUES(?)',id);return this.db.get('SELECT * FROM plex_setup WHERE user_id=?',id);}
 status(id:string){
   const u=this.user(id),r=this.row(id),help=this.db.get('SELECT created,notification FROM plex_help WHERE user_id=? AND resolved IS NULL',id)||null;
   const state=!u.plex_id?'connect':r.state;
   return {state,checked:r.checked,error:r.error,libraries:JSON.parse(r.libraries),help,canEnable:!!u.plex_id&&state==='eligible',canCheck:!!u.plex_id,canHelp:state==='help'};
 }
 update(id:string,state:string,error:string|null=null){
   const old=this.row(id);this.db.run('UPDATE plex_setup SET state=?,error=?,checked=?,ever_ready=MAX(ever_ready,?) WHERE user_id=?',state,error,Date.now(),state==='ready'?1:0,id);
   if(old.state!==state)this.db.audit(id,'plex.'+state,id);
 }
 // A database lease also serializes requests across server instances. Expired
 // writes remain attempted and require review, rather than being replayed.
 async locked(id:string,fn:(lease:string)=>Promise<void>){
   this.user(id);this.row(id);const lease=randomUUID();
   if(!this.db.run('UPDATE plex_setup SET lease=?,lease_until=? WHERE user_id=? AND lease_until<?',lease,Date.now()+120000,id,Date.now()).changes)return this.status(id);
   try{await fn(lease);}finally{this.db.run('UPDATE plex_setup SET lease=NULL,lease_until=0 WHERE user_id=? AND lease=?',id,lease);}
   return this.status(id);
 }
 async inspect(id:string){
   const u=this.user(id);if(!u.plex_id)return 'connect';
   const observed=u.role==='admin'?'ready':await this.api.inspect(u.plex_id);this.user(id);
   if(observed==='ready'||observed==='pending'){this.update(id,observed);return observed;}
   const r=this.row(id);
   if(r.ever_ready||r.attempted||!r.eligible){this.update(id,'help','Cameron needs to review this account before access can be enabled.');return 'help';}
   this.update(id,'eligible');return 'eligible';
 }
 async check(id:string){return this.locked(id,async()=>{try{await this.inspect(id);}catch(e){if(e instanceof Fault&&e.status===403)throw e;this.update(id,'help','Plex access could not be checked. Try again or ask Cameron for help.');}});}
 async enable(id:string,actor?:string){return this.locked(id,async(lease)=>{
   const u=this.user(id);if(!u.plex_id)throw new Fault('Connect your Plex account first.');
   try{
     const observed=await this.inspect(id);if(observed==='ready'||observed==='pending')return;
     if(observed!=='eligible'&&!actor)return;
     const r=this.row(id),ids=r.attempted?JSON.parse(r.libraries):this.defaults();
     const catalog=await this.api.libraries();
     if(!ids.length||ids.some((id:string)=>!catalog.some(l=>l.id===id))){this.update(id,'help','Cameron needs to configure available Plex libraries.');return;}
     this.user(id);
     if(!this.db.run("UPDATE plex_setup SET attempted=1,libraries=?,state='sending',error=NULL WHERE user_id=? AND lease=? AND lease_until>?",JSON.stringify(ids),id,lease,Date.now()).changes)return;
     this.db.audit(actor||id,actor?'plex.admin-retry':'plex.invite',id);
     await this.api.invite(u.plex_id,ids);
     this.update(id,'pending');
   }catch(e){if(e instanceof Fault&&e.status===403)throw e;this.update(id,'help','Plex setup could not be completed. Check access before asking Cameron to retry.');}
 });}
 help(id:string){this.user(id);return this.db.transaction(()=>{
   if(this.db.get('SELECT user_id FROM plex_help WHERE user_id=? AND resolved IS NULL',id))return {recorded:true};
   const admin=this.db.get("SELECT email FROM users WHERE role='admin' AND disabled=0 AND email IS NOT NULL ORDER BY created LIMIT 1");
   let notification='missing-email';
   if(admin){try{this.mail.queue(admin.email,'Plex setup needs help',`A viewer needs help with Plex setup. Open Bulock Media Admin and review user ${id}.`);notification='queued';}catch{notification='email-unavailable';}}
   this.db.run('INSERT INTO plex_help(user_id,created,resolved,notification) VALUES(?,?,NULL,?) ON CONFLICT(user_id) DO UPDATE SET created=excluded.created,resolved=NULL,notification=excluded.notification',id,Date.now(),notification);
   this.db.audit(id,'plex.help',id);return {recorded:true};
 });}
 resolve(id:string,actor:string){this.db.run('UPDATE plex_help SET resolved=? WHERE user_id=? AND resolved IS NULL',Date.now(),id);this.db.audit(actor,'plex.help-resolved',id);return {ok:true};}
 async overview(){
   let cached=this.catalog(),catalogError='';
   if(cached.catalogUpdated===null){try{cached=await this.refreshCatalog();}catch{catalogError='Plex libraries could not be loaded. Update from Plex to try again.';}}
   return {...cached,catalogError,libraries:this.defaults(),users:this.db.all('SELECT p.*,u.name,u.plex_id,u.disabled,h.created AS help_created,h.notification FROM plex_setup p JOIN users u ON u.id=p.user_id LEFT JOIN plex_help h ON h.user_id=p.user_id AND h.resolved IS NULL ORDER BY h.created DESC,u.name')};
 }
}
