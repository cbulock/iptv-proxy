import {z} from 'zod';
import {Store} from './db.ts';
import {Fault,token} from './crypto.ts';
import {freshMeasurement,freshnessMs,serviceIds} from '../../shared/service-status.ts';
import type {Diagnostic,ServiceId,ServiceNotice,StatusSnapshot} from '../../shared/service-status.ts';

export interface ProbeResult {ok:boolean;code?:string;http?:number;components?:{name:string;ok:boolean;code:string}[]}
export interface StatusProbe {fingerprint:string;configured:boolean;run:(signal:AbortSignal)=>Promise<ProbeResult>}
const codes=new Set(['ok','timeout','unreachable','http-error','unexpected-response','configuration','component-failure','not-applicable']);
function diagnostic(result:ProbeResult):Diagnostic {
  return {code:codes.has(result.code||'')?result.code!:(result.ok?'ok':'unreachable'),
    ...(Number.isInteger(result.http)&&result.http!>=100&&result.http!<=599?{http:result.http}:{}),
    ...(result.components?{components:result.components.filter(c=>['gateway','viewer','lineup'].includes(c.name)).slice(0,3).map(c=>({name:c.name,ok:c.ok===true,code:codes.has(c.code)?c.code:'unexpected-response'}))}:{})};
}
const noticeInput=z.object({id:z.string().min(1).max(128).optional(),services:z.array(z.enum(serviceIds)).min(1).max(4).transform(ids=>[...new Set(ids)]),type:z.enum(['outage','maintenance']),title:z.string().trim().min(1).max(120),message:z.string().trim().min(1).max(2000)});
function notice(row:any):ServiceNotice{return {...row,services:JSON.parse(row.services)};}

export class ServiceStatus {
  db:Store;probes:Partial<Record<ServiceId,StatusProbe>>;now:()=>number;busy=false;lastRun:number|null=null;lastManual:number|null=null;
  constructor(db:Store,probes:Partial<Record<ServiceId,StatusProbe>>,now=Date.now){
    this.db=db;this.probes=probes;this.now=now;
    db.transaction(()=>{
      db.run("UPDATE service_status SET state='unknown',checked=NULL,failure_since=NULL");
      for(const [id,p] of Object.entries(probes))db.run("INSERT INTO service_status(id,fingerprint) VALUES(?,?) ON CONFLICT(id) DO NOTHING",id,p.fingerprint);
    });
  }
  async check(force=false){
    const started=this.now();
    if(this.busy||(force&&this.lastManual!==null&&started-this.lastManual<15000)||(!force&&this.lastRun!==null&&started-this.lastRun<60000))return;
    this.busy=true;this.lastRun=started;if(force)this.lastManual=started;
    try{await Promise.all(Object.entries(this.probes).map(async([id,p])=>{
      this.db.run('INSERT OR IGNORE INTO service_status(id,fingerprint) VALUES(?,?)',id,p.fingerprint);
      let row=this.db.get('SELECT * FROM service_status WHERE id=?',id);
      if(row.fingerprint!==p.fingerprint){this.db.run("UPDATE service_status SET fingerprint=?,state='unknown',checked=NULL,last_success=NULL,failure_since=NULL,outage_since=NULL,recovered=NULL WHERE id=?",p.fingerprint,id);row=this.db.get('SELECT * FROM service_status WHERE id=?',id);}
      if(!p.configured){this.db.run("UPDATE service_status SET state='unknown',checked=NULL,failure_since=NULL,outage_since=NULL,diagnostic=? WHERE id=?",JSON.stringify({code:'configuration'}),id);return;}
      const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
      let result:ProbeResult;
      try{result=await Promise.race([p.run(controller.signal),new Promise<ProbeResult>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({ok:false,code:'timeout'});},10000);})]);}
      catch{result={ok:false,code:controller.signal.aborted?'timeout':'unreachable'};}finally{clearTimeout(timer);controller.abort();}
      const checked=this.now(),fresh=row.checked!==null&&started-row.checked<=freshnessMs;
      const firstFailure=fresh?row.failure_since:null;
      const state=result.ok?'responding':firstFailure!==null&&started-firstFailure>=60000?'unavailable':'checking';
      const outage=result.ok?null:state==='unavailable'?(row.outage_since??firstFailure):null;
      this.db.run('UPDATE service_status SET state=?,checked=?,last_success=?,failure_since=?,outage_since=?,recovered=?,diagnostic=? WHERE id=?',state,checked,result.ok?checked:row.last_success,result.ok?null:(firstFailure??started),outage,result.ok&&row.outage_since!==null?checked:row.recovered,JSON.stringify(diagnostic(result)),id);
    }));}finally{this.busy=false;}
  }
  snapshot(admin=false):StatusSnapshot {
    const now=this.now();
    const services=serviceIds.filter(id=>this.probes[id]).map(id=>{
      const row=this.db.get('SELECT * FROM service_status WHERE id=?',id)??{id,fingerprint:'',state:'unknown',checked:null,last_success:null,outage_since:null,recovered:null,diagnostic:'{}'};
      const changed=this.probes[row.id as ServiceId]?.fingerprint!==row.fingerprint;
      return freshMeasurement({id:row.id,state:changed?'unknown':row.state,checkedAt:changed?null:row.checked,lastSuccess:changed?null:row.last_success,outageSince:changed?null:row.outage_since,recoveredAt:changed?null:row.recovered,...(admin?{diagnostic:changed?{code:'configuration'}:JSON.parse(row.diagnostic)}:{})},now);
    });
    const published=this.db.all("SELECT * FROM service_notices WHERE state='published' ORDER BY updated DESC,id");
    return {services,notices:published.map(row=>{const {author,...safe}=notice(row) as ServiceNotice&{author:string};return safe;}),serverTime:now,...(admin?{history:this.db.all('SELECT * FROM service_notices ORDER BY updated DESC,id LIMIT 100').map(notice)}:{})};
  }
  private getNotice(id:string){const row=this.db.get('SELECT * FROM service_notices WHERE id=?',id);if(!row)throw new Fault('Notice not found.',404);return row;}
  saveNotice(input:unknown,actor:string){const value=noticeInput.parse(input),now=this.now(),id=value.id||token();
    this.db.transaction(()=>{
      if(value.id){const row=this.getNotice(id);if(row.state==='resolved')throw new Fault('Resolved notices cannot be edited.',409);this.db.run('UPDATE service_notices SET services=?,type=?,title=?,message=?,updated=? WHERE id=?',JSON.stringify(value.services),value.type,value.title,value.message,now,id);}
      else this.db.run('INSERT INTO service_notices(id,services,type,title,message,author,created,updated) VALUES(?,?,?,?,?,?,?,?)',id,JSON.stringify(value.services),value.type,value.title,value.message,actor,now,now);
      this.db.audit(actor,'status.notice.save',id);
    });return notice(this.getNotice(id));
  }
  publishNotice(id:string,actor:string){return this.transition(id,'draft','published',actor);}
  resolveNotice(id:string,actor:string){return this.transition(id,'published','resolved',actor);}
  private transition(id:string,from:string,to:string,actor:string){
    this.db.transaction(()=>{const row=this.getNotice(id);if(row.state!==from)throw new Fault('This notice has changed. Refresh and try again.',409);this.db.run(`UPDATE service_notices SET state=?,updated=?,${to==='published'?'published':'resolved'}=? WHERE id=?`,to,this.now(),this.now(),id);this.db.audit(actor,'status.notice.'+to,id);});return {ok:true};
  }
  deleteNotice(id:string,actor:string){this.db.transaction(()=>{if(this.getNotice(id).state!=='draft')throw new Fault('Only drafts can be deleted.',409);this.db.run('DELETE FROM service_notices WHERE id=?',id);this.db.audit(actor,'status.notice.delete',id);});return {ok:true};}
}
