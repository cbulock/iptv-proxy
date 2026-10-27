import {readFileSync} from 'node:fs';
import {Fault} from './crypto.ts';
function setting(name:string,fallback=''){return process.env[name+'_FILE']?readFileSync(process.env[name+'_FILE']!,'utf8').trim():process.env[name]||fallback;}
export function config(){
  const key=setting('APP_SECRET');
  const iptvGatewayInternal=setting('IPTV_GATEWAY_INTERNAL_URL');
  if(key.length<32)throw new Fault('Configure APP_SECRET with at least 32 random characters.',503);
  return {key,iptvGatewayInternal,db:setting('DATABASE_PATH','data/portal.sqlite'),base:setting('APP_URL','http://localhost:3000').replace(/\/$/,''),owner:setting('ADMIN_PLEX_ID'),plexServer:setting('PLEX_SERVER_ID'),plexToken:setting('PLEX_OWNER_TOKEN'),plexUrl:setting('PLEX_URL','https://plex.bulock.house'),jellyfinUrl:setting('JELLYFIN_URL','https://jellyfin.bulock.house'),jellyfinInternal:setting('JELLYFIN_INTERNAL_URL',setting('JELLYFIN_URL','https://jellyfin.bulock.house')),jellyfinKey:setting('JELLYFIN_API_KEY'),iptvUrl:setting('IPTV_URL','https://iptv.bulock.house'),iptvMedia:setting('IPTV_MEDIA_URL','https://iptv.bulock.house/media'),internalKey:setting('IPTV_INTERNAL_KEY'),seerrUrl:setting('SEERR_URL','https://plexhelp.bulock.house'),smtpHost:setting('SMTP_HOST'),smtpPort:Number(setting('SMTP_PORT','587')),smtpUser:setting('SMTP_USER'),smtpPassword:setting('SMTP_PASSWORD'),sender:setting('SMTP_FROM','Bulock Media <media@bulock.com>')};
}
