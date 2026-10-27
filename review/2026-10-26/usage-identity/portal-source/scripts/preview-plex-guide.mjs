// Isolated local UI fixture. No production credentials or email delivery.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {Store} from '../server/core/db.ts';
import {Auth} from '../server/core/auth.ts';
const path='data/plex-guide-preview.sqlite',key=randomBytes(32).toString('hex');
const db=new Store(path),auth=new Auth(db,key);auth.invite('preview@example.com','preview');
const proof=auth.issueEmail('preview@example.com');db.close();
const base='http://127.0.0.1:3087';
const child=spawn(process.execPath,['.output/server/index.mjs'],{stdio:'inherit',env:{...process.env,HOST:'127.0.0.1',PORT:'3087',APP_URL:base,APP_SECRET:key,DATABASE_PATH:path,PLEX_OWNER_TOKEN:'',PLEX_OWNER_TOKEN_FILE:'',PLEX_SERVER_ID:'',ADMIN_PLEX_ID:'',SMTP_HOST:'',SMTP_USER:'',SMTP_PASSWORD:'',SMTP_PASSWORD_FILE:'',JELLYFIN_API_KEY:'',JELLYFIN_API_KEY_FILE:'',IPTV_INTERNAL_KEY:''}});
console.log(`${base}/login?returnTo=${encodeURIComponent('/guides?service=plex&device=roku')}#challenge=${proof.id}&proof=${proof.link}`);
process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());child.on('exit',()=>process.exit());
