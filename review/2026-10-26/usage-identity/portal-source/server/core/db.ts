import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if(path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE,plex_id TEXT UNIQUE,role TEXT NOT NULL DEFAULT 'user',disabled INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invites (email TEXT PRIMARY KEY,expires INTEGER NOT NULL,actor TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY,email TEXT NOT NULL,user_id TEXT,code_hash TEXT NOT NULL,link_hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,fresh INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY,actor TEXT,action TEXT NOT NULL,target TEXT,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS grants (user_id TEXT PRIMARY KEY REFERENCES users(id),iptv TEXT NOT NULL DEFAULT 'none',token_hash TEXT,token_cipher TEXT,jellyfin_id TEXT,jellyfin_name TEXT,jellyfin_state TEXT NOT NULL DEFAULT 'none',policy_source TEXT NOT NULL DEFAULT 'plex',libraries TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS mappings (plex_id TEXT PRIMARY KEY,jellyfin_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,kind TEXT NOT NULL,user_id TEXT,payload TEXT NOT NULL DEFAULT '{}',attempts INTEGER NOT NULL DEFAULT 0,next INTEGER NOT NULL,error TEXT);
      CREATE TABLE IF NOT EXISTS handoffs (hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS viewer_sessions (hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS plex_flows (id TEXT PRIMARY KEY,pin_id TEXT NOT NULL,code TEXT NOT NULL,user_id TEXT,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
      INSERT OR IGNORE INTO migrations VALUES(1);`);
    if(!this.get('SELECT version FROM migrations WHERE version=2'))this.transaction(()=>{this.db.exec('ALTER TABLE jobs ADD COLUMN generation INTEGER NOT NULL DEFAULT 0; INSERT INTO migrations VALUES(2);');});
    if(!this.get('SELECT version FROM migrations WHERE version=3'))this.transaction(()=>{this.db.exec('ALTER TABLE users ADD COLUMN plex_email TEXT; INSERT INTO migrations VALUES(3);');});
    if(!this.get('SELECT version FROM migrations WHERE version=4'))this.transaction(()=>{this.db.exec(`
      CREATE TABLE portal_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE plex_setup (user_id TEXT PRIMARY KEY REFERENCES users(id),eligible INTEGER NOT NULL DEFAULT 0,ever_ready INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'unchecked',libraries TEXT NOT NULL DEFAULT '[]',attempted INTEGER NOT NULL DEFAULT 0,error TEXT,checked INTEGER,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
      INSERT INTO plex_setup(user_id) SELECT id FROM users;
      CREATE TABLE plex_help (user_id TEXT PRIMARY KEY REFERENCES users(id),created INTEGER NOT NULL,resolved INTEGER,notification TEXT NOT NULL);
      INSERT INTO migrations VALUES(4);
    `);});
    if(!this.get('SELECT version FROM migrations WHERE version=5'))this.transaction(()=>{
      if(!this.all('PRAGMA table_info(plex_flows)').some(column=>column.name==='return_to'))this.db.exec("ALTER TABLE plex_flows ADD COLUMN return_to TEXT NOT NULL DEFAULT '/';");
      this.run('INSERT INTO migrations VALUES(5)');
    });
    if(!this.get('SELECT version FROM migrations WHERE version=6'))this.transaction(()=>{
      this.db.exec(`
        CREATE TABLE news (id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,author TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,published INTEGER);
        CREATE TABLE alerts (id TEXT PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,author TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,sent INTEGER,audience TEXT NOT NULL,user_ids TEXT NOT NULL);
        CREATE TABLE alert_recipients (id TEXT PRIMARY KEY,alert_id TEXT NOT NULL REFERENCES alerts(id),user_id TEXT NOT NULL,address TEXT NOT NULL,status TEXT NOT NULL,updated INTEGER NOT NULL,error TEXT,UNIQUE(alert_id,user_id));
        CREATE INDEX news_published ON news(published DESC);
        CREATE INDEX alert_recipient_status ON alert_recipients(alert_id,status);
        INSERT INTO migrations VALUES(6);
      `);
    });
    if(!this.get('SELECT version FROM migrations WHERE version=7'))this.transaction(()=>{
      this.db.exec(`
        CREATE TABLE service_status (id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'unknown',checked INTEGER,last_success INTEGER,failure_since INTEGER,outage_since INTEGER,recovered INTEGER,diagnostic TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE service_notices (id TEXT PRIMARY KEY,services TEXT NOT NULL,type TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'draft',author TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,published INTEGER,resolved INTEGER);
        CREATE INDEX service_notice_state ON service_notices(state,updated DESC);
        INSERT INTO migrations VALUES(7);
      `);
    });
    if(!this.get('SELECT version FROM migrations WHERE version=8'))this.transaction(()=>{
      const pending=this.all("SELECT grants.user_id FROM grants JOIN users ON users.id=grants.user_id WHERE grants.iptv='pending' AND users.disabled=0");
      for(const grant of pending){
        this.run("UPDATE grants SET iptv='approved' WHERE user_id=?",grant.user_id);
        this.audit('system','iptv.enable',grant.user_id);
      }
      this.run('INSERT INTO migrations VALUES(8)');
    });
    if(!this.get('SELECT version FROM migrations WHERE version=9'))this.transaction(()=>{
      this.db.exec(`
        ALTER TABLE grants ADD COLUMN phrase_hash TEXT;
        ALTER TABLE grants ADD COLUMN phrase_cipher TEXT;
        CREATE UNIQUE INDEX grants_phrase_hash ON grants(phrase_hash);
        INSERT INTO migrations VALUES(9);
      `);
    });
  }
  get(sql:string,...args:any[]):any { return this.db.prepare(sql).get(...args); }
  all(sql:string,...args:any[]):any[] { return this.db.prepare(sql).all(...args); }
  run(sql:string,...args:any[]) { return this.db.prepare(sql).run(...args); }
  transaction<T>(fn:()=>T):T { this.db.exec('BEGIN IMMEDIATE'); try {const result=fn();this.db.exec('COMMIT');return result;} catch(e){this.db.exec('ROLLBACK');throw e;} }
  audit(actor:string,action:string,target:string) {this.run('INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)',actor,action,target,Date.now());}
  job(kind:string,userId:string,payload:unknown={}) {this.run('INSERT INTO jobs(id,kind,user_id,payload,next) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET next=excluded.next,payload=excluded.payload,generation=jobs.generation+1,attempts=0',`${kind}:${userId}`,kind,userId,JSON.stringify(payload),Date.now());}
  close(){this.db.close();}
}
