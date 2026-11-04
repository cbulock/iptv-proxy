import {Store} from './db.ts';
import {JellyfinService} from './jellyfin.ts';
import {Mail} from './mail.ts';
import {unseal} from './crypto.ts';
export class Jobs {
  db:Store;jellyfin:JellyfinService;mail:Mail;busy=false;lastSync=0;
  constructor(db:Store,jellyfin:JellyfinService,mail:Mail){this.db=db;this.jellyfin=jellyfin;this.mail=mail;
    db.transaction(()=>{db.run("DELETE FROM jobs WHERE id IN (SELECT 'alert:'||id FROM alert_recipients WHERE status='sending')");db.run("UPDATE alert_recipients SET status='uncertain',error='Sending was interrupted. Delivery may have occurred.',updated=? WHERE status='sending'",Date.now());});
  }
  async alert(job:any){
    const rid=job.id.slice('alert:'.length),row=this.db.get('SELECT * FROM alert_recipients WHERE id=?',rid);
    const finish=(status:string,error:string|null)=>this.db.transaction(()=>{this.db.run("UPDATE alert_recipients SET status=?,error=?,updated=? WHERE id=? AND status IN ('queued','sending')",status,error,Date.now(),rid);this.db.run('DELETE FROM jobs WHERE id=?',job.id);});
    if(!row||row.status!=='queued'){this.db.run('DELETE FROM jobs WHERE id=?',job.id);return;}
    const user=this.db.get('SELECT email,disabled FROM users WHERE id=?',row.user_id);
    if(!user||user.disabled||user.email!==unseal(row.address,this.mail.cfg.key)){finish('skipped','Account disabled or verified email changed.');return;}
    this.db.run("UPDATE alert_recipients SET status='sending',updated=? WHERE id=?",Date.now(),rid);
    try{await this.mail.deliver(job.payload);finish('sent',null);}catch(error:any){
      // ECONNECTION can occur after DATA was accepted; never assume it means non-delivery.
      const definite=error?.responseCode>=400||['EAUTH','EDNS','EENVELOPE'].includes(error?.code);
      finish(definite?'failed':'uncertain',definite?'Mail server rejected the message or could not be reached.':'Delivery could not be confirmed. It may already have occurred.');
    }
  }
  async tick(){if(this.busy)return;this.busy=true;try{
    if(Date.now()-this.lastSync>300000){this.lastSync=Date.now();for(const row of this.db.all("SELECT user_id FROM grants WHERE jellyfin_state IN ('ready','suspended')"))this.db.job('jellyfin-sync',row.user_id);}
    for(const job of this.db.all("SELECT * FROM jobs WHERE kind<>'alert-email' AND next<=? AND attempts<12 ORDER BY CASE WHEN kind='email' THEN 0 ELSE 1 END,next LIMIT 10",Date.now())){
      try{if(job.kind==='email')await this.mail.deliver(job.payload);else if(job.kind==='jellyfin-disable')await this.jellyfin.disable(job.user_id);else if(job.kind==='jellyfin-sync')await this.jellyfin.reconcile(job.user_id);else throw Error('Unknown job');this.db.run('DELETE FROM jobs WHERE id=? AND generation=?',job.id,job.generation);}
      catch{this.db.run('UPDATE jobs SET attempts=attempts+1,next=?,error=? WHERE id=? AND generation=?',Date.now()+Math.min(3600000,10000*2**job.attempts),'Service operation failed. Check integration configuration and retry.',job.id,job.generation);}
    }
    for(const job of this.db.all("SELECT * FROM jobs WHERE kind='alert-email' AND next<=? ORDER BY next LIMIT 2",Date.now()))await this.alert(job);
    this.db.run('DELETE FROM sessions WHERE expires<?',Date.now());this.db.run('DELETE FROM challenges WHERE expires<?',Date.now()-86400000);this.db.run('DELETE FROM handoffs WHERE expires<?',Date.now());this.db.run('DELETE FROM plex_flows WHERE expires<?',Date.now());this.db.run('DELETE FROM viewer_sessions WHERE expires<?',Date.now());
  }finally{this.busy=false;}}
}
