import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHmac} from 'node:crypto';
const db=new DatabaseSync(process.env.DATABASE_PATH),id='temporary-browser-playback-check';
if(process.argv[2]==='cleanup'){
  db.prepare('DELETE FROM viewer_sessions WHERE user_id=?').run(id);db.prepare('DELETE FROM handoffs WHERE user_id=?').run(id);db.prepare('DELETE FROM grants WHERE user_id=?').run(id);db.prepare('DELETE FROM users WHERE id=?').run(id);console.log('Temporary browser test access removed.');
}else{
  db.prepare('INSERT INTO users(id,name,role,created) VALUES(?,?,?,?)').run(id,'Temporary browser playback check','user',Date.now());
  db.prepare('INSERT INTO grants(user_id,iptv) VALUES(?,?)').run(id,'approved');
  const code=randomBytes(32).toString('base64url'),hash=createHmac('sha256',process.env.APP_SECRET).update(code).digest('hex');
  db.prepare('INSERT INTO handoffs(hash,user_id,expires) VALUES(?,?,?)').run(hash,id,Date.now()+60000);
  console.log('https://iptv.bulock.house/portal-launch#code='+code);
}
db.close();
