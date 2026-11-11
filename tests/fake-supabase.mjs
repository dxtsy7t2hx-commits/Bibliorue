// Faux Supabase pour les tests locaux UNIQUEMENT.
// Il imite les deux services utilisés par Bibliorue :
//   - /auth/v1/*        (inscription, connexion, jeton JWT) : version minimale de Supabase Auth ;
//   - /rest/v1/rpc/:fn  (appel de fonction SQL) : comme PostgREST, il exécute la fonction dans
//                        PostgreSQL avec le rôle « anon » ou « authenticated » et l'identité
//                        de l'utilisateur dans request.jwt.claims (ce que lit auth.uid()).
// Les fonctions SQL testées sont donc exactement celles du script de migration.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { createHmac, randomBytes, scryptSync, randomUUID } from 'node:crypto';

const SECRET = randomBytes(32);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signJwt(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64(payload);
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
function verifyJwt(token) {
  const [h, p, s] = String(token).split('.');
  if (!s || createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  return payload.exp * 1000 > Date.now() ? payload : null;
}

export function psql(db, sql) {
  return new Promise((resolve, reject) => {
    execFile('psql', ['-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', db, '-c', sql],
      { env: { ...process.env }, maxBuffer: 20e6 }, (err, stdout, stderr) => {
        if (err) {
          const m = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(stderr);
          const hint = /HINT:\s+(.*)/.exec(stderr)?.[1] ?? null;
          return reject(Object.assign(new Error(m?.[2] ?? stderr), { code: m?.[1] ?? 'XX000', hint }));
        }
        resolve(stdout.trim());
      });
  });
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

export async function startFakeSupabase({ db, port = 0, requireConfirmation = false } = {}) {
  const signatures = new Map(); // nom de fonction → [[nom_arg, type], …]
  async function argTypes(fn) {
    if (!signatures.has(fn)) {
      const out = await psql(db, `select coalesce(array_to_string(p.proargnames, ','), '') || '|' || oidvectortypes(p.proargtypes)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = ${lit(fn)}`);
      if (!out) return null;
      const [names, types] = out.split('|');
      const n = names ? names.split(',') : [];
      const t = types ? types.split(', ') : [];
      signatures.set(fn, n.map((x, i) => [x, t[i]]));
    }
    return signatures.get(fn);
  }

  function session(user) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const u = { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, email_confirmed_at: new Date().toISOString(),
      user_metadata: user.meta ?? {}, app_metadata: { provider: 'email' }, identities: [{ id: user.id }], created_at: new Date().toISOString() };
    return {
      access_token: signJwt({ sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email, exp }),
      token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: randomBytes(16).toString('hex'), user: u,
    };
  }
  const refresh = new Map();

  async function findUser(email) {
    const out = await psql(db, `select id || '|' || coalesce(encrypted_password, '') || '|' || raw_user_meta_data::text from auth.users where lower(email) = lower(${lit(email)})`);
    if (!out) return null;
    const [id, pwd, ...meta] = out.split('|');
    return { id, email, pwd, meta: JSON.parse(meta.join('|')) };
  }
  const hash = (pw, salt) => scryptSync(pw, salt, 32).toString('hex');

  const server = createServer(async (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    };
    const send = (status, body) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204);
    const url = new URL(req.url, 'http://x');
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const claims = bearer ? verifyJwt(bearer) : null;
    try {
      // ---------- Auth ----------
      if (url.pathname === '/auth/v1/signup' && req.method === 'POST') {
        if (String(body.password ?? '').length < 6) return send(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
        if (await findUser(body.email)) return send(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
        const salt = randomBytes(8).toString('hex');
        const id = randomUUID();
        await psql(db, `insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
          values (${lit(id)}, ${lit(body.email)}, ${lit(salt + ':' + hash(body.password, salt))}, ${lit(JSON.stringify(body.data ?? {}))}::jsonb)`);
        const user = { id, email: body.email, meta: body.data };
        if (requireConfirmation) return send(200, { id, aud: 'authenticated', role: '', email: body.email, user_metadata: body.data, identities: [{ id }], created_at: new Date().toISOString() });
        const s = session(user); refresh.set(s.refresh_token, user);
        return send(200, s);
      }
      if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const user = refresh.get(body.refresh_token);
          if (!user) return send(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
          const s = session(user); refresh.set(s.refresh_token, user);
          return send(200, s);
        }
        const user = await findUser(body.email ?? '');
        const [salt, h] = (user?.pwd ?? ':').split(':');
        if (!user || hash(String(body.password ?? ''), salt) !== h) {
          return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        }
        const s = session(user); refresh.set(s.refresh_token, user);
        return send(200, s);
      }
      if (url.pathname === '/auth/v1/user') {
        if (!claims) return send(401, { code: 401, msg: 'invalid JWT' });
        return send(200, session({ id: claims.sub, email: claims.email }).user);
      }
      if (url.pathname === '/auth/v1/logout') return send(204);
      if (url.pathname === '/auth/v1/recover') return send(200, {});

      // ---------- RPC (comme PostgREST) ----------
      const m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
      if (m && req.method === 'POST') {
        const sig = await argTypes(m[1]);
        if (!sig) return send(404, { code: 'PGRST202', message: `Could not find the function public.${m[1]}` });
        const role = claims ? 'authenticated' : 'anon';
        const tag = '$a' + randomBytes(4).toString('hex') + '$';
        const args = sig.filter(([n]) => n in body)
          .map(([n, t]) => `${n} => (${tag}${JSON.stringify(body)}${tag}::jsonb ->> ${lit(n)})::${t}`).join(', ');
        const sql = `begin; set local role ${role};
          set local request.jwt.claims = ${lit(JSON.stringify(claims ?? { role: 'anon' }))};
          select coalesce(to_jsonb(public.${m[1]}(${args}))::text, 'null'); commit;`;
        try {
          const out = await psql(db, sql);
          return send(200, JSON.parse(out));
        } catch (e) {
          const status = e.code === '42501' ? (claims ? 403 : 401) : e.code === '23505' ? 409 : 400;
          return send(status, { code: e.code, message: e.message, hint: e.hint, details: null });
        }
      }
      return send(404, { message: 'route inconnue du faux Supabase' });
    } catch (e) {
      return send(500, { message: e.message });
    }
  });
  await new Promise((r) => server.listen(port, r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
