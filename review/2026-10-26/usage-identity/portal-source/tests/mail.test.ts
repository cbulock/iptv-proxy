import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loginEmail,invitationEmail} from '../server/core/email-template.ts';
import {Mail} from '../server/core/mail.ts';
import {Store} from '../server/core/db.ts';
import {unseal} from '../server/core/crypto.ts';
test('HTML sign-in links support localhost and preserve the complete verification fragment',()=>{
  for(const base of ['http://localhost:3000','https://media.bulock.house']){
    const url=base+'/login#challenge=abc&proof=def';const email=loginEmail(url,'123456');
    assert.ok(email.html.includes(`href="${base}/login#challenge=abc&amp;proof=def"`));
    assert.match(email.html,/123456/);assert.match(email.html,/letter-spacing/);assert.match(email.html,/10 minutes/);
    assert.ok(email.text.includes(url));assert.ok(email.text.includes('123456'));
  }
});
test('template content is escaped and invitations have a real action link',()=>{
  const email=loginEmail('https://example.com/"<>&','<img src=x>');assert.ok(!email.html.includes('<img'));assert.ok(email.html.includes('&lt;img'));
  const invitation=invitationEmail('https://media.bulock.house/login');assert.ok(invitation.html.includes('href="https://media.bulock.house/login"'));assert.match(invitation.text,/7 days/);
});
test('queued mail retains HTML and plain text inside the encrypted payload',()=>{
  const db=new Store(':memory:'),key='a'.repeat(64),mail=new Mail(db,{key,base:'http://localhost:3000',smtpHost:'smtp.example.com',smtpUser:'sender@example.com',smtpPassword:'test'});
  mail.login({id:'challenge',email:'a@example.com',code:'654321',link:'proof'});
  const job=db.get("SELECT payload FROM jobs WHERE kind='email'");const payload=JSON.parse(unseal(job.payload,key));
  assert.match(payload.html,/href="http:\/\/localhost:3000\/login#challenge=challenge&amp;proof=proof"/);assert.match(payload.text,/654321/);assert.equal(payload.challengeId,'challenge');db.close();
});

test('missing SMTP host or user prevents queueing email',()=>{
  const db=new Store(':memory:');
  try{for(const missing of ['smtpHost','smtpUser']){const cfg={key:'a'.repeat(64),smtpHost:'smtp.example.com',smtpUser:'sender@example.com',smtpPassword:'test',[missing]:''};assert.throws(()=>new Mail(db,cfg).invite('a@example.com'),/not configured/);}assert.equal(db.all("SELECT id FROM jobs WHERE kind='email'").length,0);}finally{db.close();}
});
test('verification mail preserves a selected guide without allowing external return destinations',()=>{
 const db=new Store(':memory:'),key='x'.repeat(64),mail=new Mail(db,{key,base:'https://portal.example',smtpHost:'smtp.example',smtpUser:'sender@example.com',smtpPassword:'test'});
 const next='/guides?service=plex&device=roku';mail.login({id:'c',email:'viewer@example.com',code:'123456',link:'proof'},next);
 const payload=JSON.parse(unseal(db.get('SELECT payload FROM jobs').payload,key));assert.ok(payload.text.includes('returnTo='+encodeURIComponent(next)));db.close();
});
