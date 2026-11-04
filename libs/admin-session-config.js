export const ADMIN_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function adminSessionOptions(secret, store, secure = 'auto') {
  return {
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: ADMIN_SESSION_MAX_AGE_MS,
    },
  };
}
