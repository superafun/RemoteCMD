// Login/auth end-to-end smoke test for RemoteCMD.
// Run AFTER `npm run restart` so server.js serves the new auth routes.
//   node tests/login-auth-check.mjs
// Optional env: RC_BASE (default http://localhost:65433),
//               RC_USER / RC_PASS to exercise a real successful login.
const BASE = process.env.RC_BASE || 'http://localhost:65433';
const USER = process.env.RC_USER || '';
const PASS = process.env.RC_PASS || '';

const HTML_ACCEPT = { headers: { Accept: 'text/html' } };
let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra); }
}
const cookieFrom = (res) => {
  const sc = res.headers.get('set-cookie');
  if (!sc) return '';
  const m = sc.match(/rc_session=[^;]+/);
  return m ? m[0] : '';
};

const run = async () => {
  // 1. Unauthenticated root with browser-like Accept -> redirect to /login
  let r = await fetch(BASE + '/', HTML_ACCEPT);
  ok('GET / no-auth redirects to login', [301, 302, 307].includes(r.status) && /login/.test(r.headers.get('location') || ''), 'status=' + r.status + ' loc=' + r.headers.get('location'));

  // 2. GET /login serves the login page
  r = await fetch(BASE + '/login', HTML_ACCEPT);
  const body = await r.text();
  ok('GET /login returns 200', r.status === 200);
  ok('login page contains RemoteCMD', body.includes('RemoteCMD'));

  // 3. auth-check without cookie -> 401
  r = await fetch(BASE + '/api/auth-check');
  ok('auth-check no cookie -> 401', r.status === 401);

  // 4. login with wrong creds -> 401
  r = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'nobody', password: 'wrong' })
  });
  ok('login wrong creds -> 401', r.status === 401);

  // 5. (optional) full login flow with real creds
  if (USER && PASS) {
    r = await fetch(BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS })
    });
    const cookie = cookieFrom(r);
    ok('login correct creds -> 200', r.status === 200);
    ok('login sets rc_session cookie', cookie.startsWith('rc_session='));
    ok('cookie is HttpOnly', (r.headers.get('set-cookie') || '').toLowerCase().includes('httponly'));

    if (cookie) {
      // auth-check with cookie -> 200
      r = await fetch(BASE + '/api/auth-check', { headers: { Cookie: cookie } });
      ok('auth-check with cookie -> 200', r.status === 200);
      // root with cookie -> 200 (no redirect)
      r = await fetch(BASE + '/', { ...HTML_ACCEPT, headers: { ...HTML_ACCEPT.headers, Cookie: cookie } });
      ok('GET / with cookie -> 200 (no redirect)', r.status === 200);
      // logout -> 200, then auth-check -> 401
      r = await fetch(BASE + '/api/logout', { method: 'POST', headers: { Cookie: cookie } });
      ok('logout -> 200', r.status === 200);
      r = await fetch(BASE + '/api/auth-check', { headers: { Cookie: cookie } });
      ok('auth-check after logout -> 401', r.status === 401);
    }
  } else {
    console.log('(skip: set RC_USER/RC_PASS to exercise a real successful login)');
  }

  console.log('\nRESULT pass=' + pass + ' fail=' + fail);
  process.exit(fail === 0 ? 0 : 1);
};
run().catch(e => { console.error('ERROR', e); process.exit(2); });
