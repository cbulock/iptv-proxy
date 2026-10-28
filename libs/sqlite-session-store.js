import session from 'express-session';
import { getDatabase } from './database.js';
import { ADMIN_SESSION_MAX_AGE_MS } from './admin-session-config.js';

function expiresAt(value) {
  return value.cookie?.expires
    ? new Date(value.cookie.expires).getTime()
    : Date.now() + (value.cookie?.originalMaxAge ?? ADMIN_SESSION_MAX_AGE_MS);
}

// Keep database errors on express-session's callback/error middleware path.
function complete(callback, operation) {
  let result;
  try {
    result = operation();
  } catch (err) {
    process.nextTick(callback, err);
    return;
  }
  process.nextTick(callback, null, result);
}

/** Persistent admin sessions in the application's DATA_PATH SQLite database. */
export default class SQLiteSessionStore extends session.Store {
  constructor() {
    super();
    getDatabase().prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(Date.now());
  }

  get(sid, callback) {
    complete(callback, () => {
      const db = getDatabase();
      const row = db
        .prepare('SELECT data_json, expires_at FROM admin_sessions WHERE sid = ?')
        .get(sid);
      if (!row) return null;
      if (row.expires_at <= Date.now()) {
        db.prepare('DELETE FROM admin_sessions WHERE sid = ?').run(sid);
        return null;
      }
      const value = JSON.parse(row.data_json);
      value.cookie.expires = new Date(row.expires_at).toISOString();
      return value;
    });
  }

  set(sid, value, callback = () => {}) {
    complete(callback, () => {
      const db = getDatabase();
      db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(Date.now());
      db.prepare(
        `
        INSERT INTO admin_sessions (sid, data_json, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET
          data_json = excluded.data_json, expires_at = excluded.expires_at
      `
      ).run(sid, JSON.stringify(value), expiresAt(value));
    });
  }

  touch(sid, value, callback = () => {}) {
    complete(callback, () => {
      getDatabase()
        .prepare('UPDATE admin_sessions SET expires_at = ? WHERE sid = ? AND expires_at > ?')
        .run(expiresAt(value), sid, Date.now());
    });
  }

  destroy(sid, callback = () => {}) {
    complete(callback, () => {
      getDatabase().prepare('DELETE FROM admin_sessions WHERE sid = ?').run(sid);
    });
  }
}
