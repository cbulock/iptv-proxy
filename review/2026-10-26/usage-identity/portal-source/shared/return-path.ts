/** Only known internal destinations may survive authentication. */
export function returnPath(value:unknown):string {
 if(typeof value!=='string'||value.length>1500||/[\\\r\n]/.test(value))return '/';
 try{const url=new URL(value,'https://portal.invalid');const known=['/guides','/account','/','/news'].includes(url.pathname)||/^\/news\/[a-zA-Z0-9-]{1,128}$/.test(url.pathname);if(url.origin!=='https://portal.invalid'||!known||!value.startsWith('/')||value.startsWith('//'))return '/';return url.pathname+url.search+url.hash;}catch{return '/';}
}
