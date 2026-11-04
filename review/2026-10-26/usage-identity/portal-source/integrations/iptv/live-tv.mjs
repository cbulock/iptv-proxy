const IMAGE_BYTES = 5 * 1024 * 1024;
const JSON_BYTES = 24 * 1024 * 1024;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value);
const text = (value, max = 16384) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const date = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function requireValid(valid) { if (!valid) throw Error('Invalid published response'); }

export function publishedQuery(path, query) {
  if (path === '/channels.json' || path.startsWith('/artwork/')) return [...query].length === 0;
  if (path !== '/guide.json') return true;
  for (const key of query.keys()) if (!['hours', 'cursor'].includes(key) || query.getAll(key).length !== 1) return false;
  const hours = query.get('hours');
  return (hours === null || /^(?:[1-9]|[1-3][0-9]|4[0-8])$/.test(hours)) && (!query.has('cursor') || (query.get('cursor').length > 0 && query.get('cursor').length <= 4096));
}
function mediaUrl(value, type) {
  if (typeof value !== 'string' || !value.startsWith('/' + type + '/') || /[?#\\]|%2e|%2f|%5c/i.test(value)) return false;
  const segments = value.split('/');
  if (segments.length !== 4) return false;
  try { return segments.slice(2).every(part => part.length > 0 && part.length <= 2048 && !decodeURIComponent(part).includes('..')); } catch { return false; }
}
export function projectPublished(path, data, prefix, artworkToken) {
  requireValid(data && typeof data === 'object' && date(data.fetchedAt));
  if (path === '/channels.json') {
    requireValid(Array.isArray(data.channels) && data.channels.length <= 50000);
    const channels = data.channels.map(channel => {
      requireValid(channel && identifier(channel.id) && ['tvgId','name','number','source','group'].every(key => text(channel[key])) && ['hls','ts','unknown'].includes(channel.formatHint));
      requireValid(mediaUrl(channel.streamUrl,'stream') && mediaUrl(channel.transcodeUrl,'transcode'));
      requireValid(channel.logo === null || channel.logo === '/artwork/' + encodeURIComponent(channel.id));
      return {id:channel.id,tvgId:channel.tvgId,name:channel.name,number:channel.number,source:channel.source,group:channel.group,logo:channel.logo === null ? null : prefix+'/artwork/'+artworkToken(channel.logo),streamUrl:prefix+channel.streamUrl,transcodeUrl:prefix+channel.transcodeUrl,formatHint:channel.formatHint};
    });
    requireValid(new Set(channels.map(channel => channel.id)).size === channels.length);
    return {channels, fetchedAt:data.fetchedAt};
  }
  requireValid(Array.isArray(data.programmes) && data.programmes.length <= 1000 && text(data.revision,256) && data.revision.length > 0 && (data.nextCursor === null || (text(data.nextCursor,4096) && data.nextCursor.length > 0)));
  const programmes = data.programmes.map(programme => {
    requireValid(programme && identifier(programme.id) && identifier(programme.channelId) && text(programme.title) && text(programme.description,262144) && date(programme.start) && (programme.stop === null || (date(programme.stop) && programme.stop > programme.start)) && (programme.subtitle === undefined || text(programme.subtitle)));
    return {id:programme.id,channelId:programme.channelId,title:programme.title,description:programme.description,start:programme.start,stop:programme.stop,...(programme.subtitle === undefined ? {} : {subtitle:programme.subtitle})};
  });
  return {programmes,fetchedAt:data.fetchedAt,revision:data.revision,nextCursor:data.nextCursor};
}
export async function readBounded(response, limit = JSON_BYTES) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw Error('Response too large');
  const chunks=[];let size=0;
  for await (const chunk of response.body || []) { size+=chunk.length;if(size>limit)throw Error('Response too large');chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export async function readArtwork(response) {
  const mime=(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  requireValid(/^image\/(png|jpeg|webp|gif|avif)$/.test(mime));
  return {mime,bytes:await readBounded(response,IMAGE_BYTES)};
}
const codes = new Map([
  [400,new Set(['INVALID_WINDOW','INVALID_CURSOR'])],
  [409,new Set(['GUIDE_CHANGED'])],
  [429,new Set(['TRANSCODE_CAPACITY'])],
  [503,new Set(['TRANSCODE_CAPACITY','TRANSCODE_UNAVAILABLE'])],
  [504,new Set(['TRANSCODE_STARTUP_TIMEOUT'])],
  [502,new Set(['TRANSCODE_FAILED','ARTWORK_UNAVAILABLE'])],
]);
export async function safeBackendError(response, path, head) {
  const allowed=[401,403,404,429,503,504,502];
  if (path==='/guide.json') allowed.push(400,409);
  const status=allowed.includes(response.status)?response.status:502;
  let code;
  if(!head){
    try { const data=JSON.parse((await readBounded(response,4096)).toString());if(codes.get(status)?.has(data.code))code=data.code; } catch { /* Never return upstream error text. */ }
  } else await response.body?.cancel();
  return {status,body:{error:status===409?'Guide changed. Refresh the guide.':'Media service could not fulfill this request',...(code?{code}:{})}};
}
