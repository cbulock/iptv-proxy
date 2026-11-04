export const serviceIds=['plex','jellyfin','iptv','seerr'] as const;
export type ServiceId=typeof serviceIds[number];
export const serviceNames:Record<ServiceId,string>={plex:'Plex',jellyfin:'Jellyfin',iptv:'Live TV',seerr:'Seerr'};
export type Availability='unknown'|'checking'|'responding'|'unavailable';
export const statusLabels:Record<Availability,string>={unknown:'Unknown',checking:'Checking availability',responding:'Responding',unavailable:'Unavailable'};
export const freshnessMs=180_000;
export interface Diagnostic {code:string;http?:number;components?:{name:string;ok:boolean;code:string}[]}
export interface ServiceMeasurement {id:ServiceId;state:Availability;checkedAt:number|null;lastSuccess:number|null;outageSince:number|null;recoveredAt:number|null;diagnostic?:Diagnostic}
export interface ServiceNotice {id:string;services:ServiceId[];type:'outage'|'maintenance';title:string;message:string;state:'draft'|'published'|'resolved';created:number;updated:number;published:number|null;resolved:number|null}
export interface StatusSnapshot {services:ServiceMeasurement[];notices:ServiceNotice[];history?:ServiceNotice[];serverTime:number}
export function measurementTime(serverTime:number,receivedAt:number,clientNow:number){return serverTime+Math.max(0,clientNow-receivedAt);}
export function freshMeasurement(row:ServiceMeasurement,now:number):ServiceMeasurement{return !row.checkedAt||now-row.checkedAt>freshnessMs?{...row,state:'unknown'}:row;}
