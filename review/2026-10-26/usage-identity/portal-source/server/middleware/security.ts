export default defineEventHandler(event=>{
  setResponseHeaders(event,{'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':event.path.startsWith('/preview')?'SAMEORIGIN':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cache-Control':'no-store'});
});
