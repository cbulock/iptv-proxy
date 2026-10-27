const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function layout(title:string,preview:string,content:string){return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background-color:#101317;color:#f1f2ed;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escape(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#101317"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px"><tr><td style="padding:0 0 24px;font-size:20px;font-weight:bold;color:#f1f2ed">Bulock Media</td></tr>
<tr><td style="padding:32px 24px;background-color:#191e24;border:1px solid #30363e;border-radius:16px">
<h1 style="margin:0 0 20px;font-size:26px;line-height:1.3;font-weight:bold;color:#f1f2ed">${escape(title)}</h1>${content}
</td></tr><tr><td style="padding:22px 8px;font-size:12px;line-height:1.6;color:#a5adb8">If you weren’t expecting this email, you can ignore it.</td></tr></table>
</td></tr></table></body></html>`;}
function button(url:string,label:string){return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td bgcolor="#d5ed92" style="background-color:#d5ed92;border-radius:8px;text-align:center;mso-padding-alt:14px 26px"><a href="${escape(url)}" style="display:inline-block;padding:14px 26px;border:1px solid #d5ed92;border-radius:8px;color:#172115;font-size:16px;font-weight:bold;line-height:1.4;text-decoration:none">${escape(label)}</a></td></tr></table>`;}
function fallback(url:string){return `<p style="margin:24px 0 0;font-size:12px;line-height:1.7;color:#a5adb8">Button not working? Open this link:<br><a href="${escape(url)}" style="color:#d5ed92;word-break:break-all;overflow-wrap:anywhere">${escape(url)}</a></p>`;}
export function loginEmail(url:string,code:string){
  const text=`Sign in to Bulock Media\n\n${url}\n\nOr enter this code in the browser where you started:\n\n${code}\n\nThe link and code expire in 10 minutes. Using either invalidates both. If you did not request this, ignore this email.`;
  const html=layout('Your sign-in link & code','Use the button or your six-digit code to continue.',`${button(url,'Continue to Bulock Media')}
<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#c0c6cf">Or enter this code in the browser where you started:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px;border:1px solid #454d57;border-radius:8px;background-color:#101317;font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:bold;line-height:1.4;letter-spacing:6px;color:#d5ed92">${escape(code)}</td></tr></table>
<p style="margin:20px 0 0;font-size:13px;line-height:1.7;color:#a5adb8">Expires in 10 minutes. Use the link or code once.</p>${fallback(url)}`);
  return {text,html};
}
export function invitationEmail(url:string){return {
  text:`You’re invited to Bulock Media.\n\nOpen ${url} and sign in with this email address. No Plex account is needed. Your invitation expires in 7 days.`,
  html:layout('You’re invited','Your invitation to Bulock Media.',`<p style="margin:0;font-size:15px;line-height:1.7;color:#c0c6cf">Sign in with this email address to get started. No Plex account is needed.</p>${button(url,'Open Bulock Media')}<p style="margin:0;font-size:13px;line-height:1.7;color:#a5adb8">Your invitation expires in 7 days.</p>${fallback(url)}`)
};}
