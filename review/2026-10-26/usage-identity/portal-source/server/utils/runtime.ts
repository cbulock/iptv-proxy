import {Store} from '../core/db.ts';
import {Auth} from '../core/auth.ts';
import {Iptv} from '../core/iptv.ts';
import {JellyfinApi,JellyfinService} from '../core/jellyfin.ts';
import {Plex} from '../core/plex.ts';
import {PlexSetup} from '../core/plex-setup.ts';
import {Mail} from '../core/mail.ts';
import {Jobs} from '../core/jobs.ts';
import {config} from '../core/config.ts';
import {ServiceStatus} from '../core/service-status.ts';
import {createStatusProbes} from '../core/status-probes.ts';
let singleton:ReturnType<typeof create>|undefined;
function create(){const cfg=config(),db=new Store(cfg.db),auth=new Auth(db,cfg.key,Date.now,cfg.owner),iptv=new Iptv(db,cfg.key),plex=new Plex(cfg.plexServer,cfg.plexToken,'bulock-media-'+cfg.plexServer),jellyfinApi=new JellyfinApi(cfg.jellyfinInternal,cfg.jellyfinKey),jellyfin=new JellyfinService(db,jellyfinApi,id=>plex.access(id)),mail=new Mail(db,cfg),plexSetup=new PlexSetup(db,plex,mail),jobs=new Jobs(db,jellyfin,mail),serviceStatus=new ServiceStatus(db,createStatusProbes(cfg));return {cfg,db,auth,iptv,plex,plexSetup,jellyfinApi,jellyfin,mail,jobs,serviceStatus};}
export function runtime(){return singleton??=create();}
