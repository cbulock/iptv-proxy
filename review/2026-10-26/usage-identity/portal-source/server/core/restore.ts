import {Store} from './db.ts';
export function invalidateRestored(db:Store){db.transaction(()=>{
  db.run('DELETE FROM service_status');
  db.run("UPDATE service_notices SET state='draft',published=NULL,resolved=NULL,updated=? WHERE state='published'",Date.now());
  db.run("UPDATE alert_recipients SET status='skipped',error='Cancelled during backup restoration.',updated=? WHERE status IN ('queued','sending','failed','uncertain')",Date.now());
  for(const table of ['sessions','challenges','handoffs','viewer_sessions','plex_flows','invites','jobs'])db.run(`DELETE FROM ${table}`);
  db.run('UPDATE users SET disabled=1');
  db.run("UPDATE grants SET token_hash=NULL,token_cipher=NULL,phrase_hash=NULL,phrase_cipher=NULL,iptv='revoked',policy_source='blocked'");
  for(const row of db.all('SELECT user_id FROM grants WHERE jellyfin_id IS NOT NULL'))db.job('jellyfin-disable',row.user_id);
  db.audit('restore','credentials.invalidate','all');
});}
