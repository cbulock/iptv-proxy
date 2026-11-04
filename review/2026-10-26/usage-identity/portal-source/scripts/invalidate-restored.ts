import {Store} from '../server/core/db.ts';
import {invalidateRestored} from '../server/core/restore.ts';
const db=new Store(process.env.DATABASE_PATH||'data/portal.sqlite');invalidateRestored(db);
if(process.env.ADMIN_PLEX_ID){db.run("UPDATE users SET disabled=0,role='admin' WHERE plex_id=?",process.env.ADMIN_PLEX_ID);}
db.close();console.log('Restored credentials invalidated; users disabled; remote Jellyfin suspension queued. Only the explicitly configured owner can sign in.');
