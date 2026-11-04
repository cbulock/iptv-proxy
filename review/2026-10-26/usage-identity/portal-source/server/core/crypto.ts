import { randomBytes, createHmac, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
export const token = () => randomBytes(32).toString('base64url');
export function hash(value:string,key:string){ return createHmac('sha256',key).update(value).digest('hex'); }
export function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function seal(value:string,key:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(key).digest(),iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
export function unseal(value:string,key:string){const data=Buffer.from(value,'base64url');const decipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(key).digest(),data.subarray(0,12));decipher.setAuthTag(data.subarray(12,28));return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString();}
export class Fault extends Error { status:number; constructor(message:string,status=400){super(message);this.status=status;} }
