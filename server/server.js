// Servidor de la wiki CEJEL IPS: contenido en SQLite + login con roles.
// Sin dependencias externas. Requiere Node 22.5 o superior (usa node:sqlite).
//   npm start      (o doble clic en "Iniciar wiki.bat")
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

// ---------- Configuración (.env) ----------
// Lector mínimo de .env: CLAVE=valor, # comentarios. No pisa variables ya definidas.
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
} catch { /* sin .env: se usan valores por defecto */ }

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const BACKUPS = path.join(DATA, 'backups');
fs.mkdirSync(BACKUPS, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'data.db'));

db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor');
CREATE TABLE IF NOT EXISTS modules(
  id INTEGER PRIMARY KEY, position INTEGER NOT NULL, title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS sections(
  id INTEGER PRIMARY KEY, module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, code TEXT NOT NULL DEFAULT '', title TEXT NOT NULL,
  bullets TEXT NOT NULL DEFAULT '[]', body TEXT NOT NULL DEFAULT '');
`);
// Migración: bases creadas antes de existir roles (su único usuario era administrador).
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'role'))
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");

// Migración: imagen de banner por módulo.
if (!db.prepare('PRAGMA table_info(modules)').all().some(c => c.name === 'image'))
  db.exec("ALTER TABLE modules ADD COLUMN image TEXT NOT NULL DEFAULT ''");

// ---------- Datos iniciales ----------
if (db.prepare('SELECT COUNT(*) n FROM modules').get().n === 0) {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
  const im = db.prepare('INSERT INTO modules(position,title,description,note) VALUES(?,?,?,?)');
  const is = db.prepare('INSERT INTO sections(module_id,position,code,title,bullets,body) VALUES(?,?,?,?,?,?)');
  seed.forEach((m, i) => {
    const id = im.run(i + 1, m.t, m.d, m.note || '').lastInsertRowid;
    m.s.forEach((s, j) => is.run(id, j + 1, s.code, s.title, JSON.stringify(s.bullets), s.body));
  });
  console.log('Base de datos inicializada con', seed.length, 'módulos.');
}

// ---------- Usuarios ----------
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function checkPw(user, pw) {
  const row = db.prepare('SELECT * FROM users WHERE username=?').get(user);
  const h = Buffer.from(hashPw(pw, row ? row.salt : 'x'.repeat(32)), 'hex'); // mismo costo exista o no el usuario
  if (!row) return null;
  return crypto.timingSafeEqual(h, Buffer.from(row.hash, 'hex')) ? row : null;
}
// Usuarios definidos en .env como  USUARIO_1=nombre:contraseña:rol  (rol: admin | editor).
// Solo se CREAN si no existen: cambiar la contraseña desde la página no se revierte al reiniciar.
const created = [];
for (const [k, v] of Object.entries(process.env)) {
  if (!/^USUARIO_\d+$/.test(k)) continue;
  const a = v.indexOf(':'), z = v.lastIndexOf(':');
  const name = a > 0 ? v.slice(0, a).trim() : '', pass = z > a ? v.slice(a + 1, z) : '', role = z > a ? v.slice(z + 1).trim().toLowerCase() : '';
  if (!/^[\w.\-@]{2,40}$/.test(name) || pass.length < 8 || !['admin', 'editor'].includes(role)) {
    console.warn(`⚠ ${k} ignorado: use  nombre:contraseña(mín. 8):rol  con rol admin o editor.`); continue;
  }
  const row = db.prepare('SELECT id,role FROM users WHERE username=?').get(name);
  if (!row) {
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO users(username,salt,hash,role) VALUES(?,?,?,?)').run(name, salt, hashPw(pass, salt), role);
    created.push({ name, pass, role });
  } else if (row.role !== role) db.prepare('UPDATE users SET role=? WHERE id=?').run(role, row.id);
}
if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) {
  const pass = crypto.randomBytes(9).toString('base64url'), salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users(username,salt,hash,role) VALUES(?,?,?,?)').run('admin', salt, hashPw(pass, salt), 'admin');
  created.push({ name: 'admin', pass: pass + '   (guárdala: no se volverá a mostrar)', role: 'admin' });
}
if (created.length) {
  console.log('\n=== Usuarios creados ===');
  created.forEach(u => console.log(`  ${u.role.padEnd(6)} ${u.name} / ${u.pass}`));
  console.log('========================\n');
}

// ---------- Copias de seguridad ----------
// VACUUM INTO genera una copia consistente de la base aunque la wiki esté en uso.
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
function pruneBackups() {
  const all = fs.readdirSync(BACKUPS).filter(f => /^wiki-[\w-]+\.db$/.test(f)).sort().reverse(); // más nuevas primero
  const auto = all.filter(f => /-(inicio|diaria)\.db$/.test(f)), other = all.filter(f => !auto.includes(f));
  [...auto.slice(14), ...other.slice(10)].forEach(f => { try { fs.unlinkSync(path.join(BACKUPS, f)); } catch { /* ya no existe */ } });
}
function backupNow(tag) {
  let name, file, n = 0;
  do { name = `wiki-${stamp()}-${tag}${n ? '-' + n : ''}.db`; file = path.join(BACKUPS, name); n++; } while (fs.existsSync(file));
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  pruneBackups();
  return name;
}
function listBackups() {
  return fs.readdirSync(BACKUPS).filter(f => /^wiki-[\w-]+\.db$/.test(f)).map(f => {
    const st = fs.statSync(path.join(BACKUPS, f)); return { name: f, size: st.size, t: st.mtimeMs };
  }).sort((a, b) => b.t - a.t).slice(0, 30);
}
try {
  const lastAuto = listBackups().find(b => /-(inicio|diaria)\.db$/.test(b.name));
  if (!lastAuto || Date.now() - lastAuto.t > 12 * 3600e3) console.log('Copia de seguridad automática:', backupNow('inicio'));
} catch (e) { console.warn('No se pudo crear la copia automática:', e.message); }
setInterval(() => { try { backupNow('diaria'); } catch (e) { console.warn('Copia diaria falló:', e.message); } }, 24 * 3600e3).unref();

// ---------- Sesiones y límite de intentos ----------
const sessions = new Map(); // token -> {uid, username, role, exp}
const attempts = new Map(); // ip -> {n, until}
const SESSION_MS = 8 * 3600e3;
const parseCookies = h => Object.fromEntries((h || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, v.join('=')]));
function currentUser(req) {
  const t = parseCookies(req.headers.cookie).sid;
  const s = t && sessions.get(t);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(t); return null; }
  return s;
}

// ---------- Utilidades HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf' };
function send(res, code, data, headers = {}) {
  const isObj = typeof data === 'object' && !Buffer.isBuffer(data);
  res.writeHead(code, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store', ...headers
  });
  res.end(isObj ? JSON.stringify(data) : data);
}
function readJson(req, max = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('json')); } });
  });
}
const str = (v, max, req = false) => {
  if (typeof v !== 'string') v = v == null ? '' : null;
  if (v === null) throw new Error('Dato inválido.');
  v = v.trim();
  if (req && !v) throw new Error('Falta un campo obligatorio.');
  if (v.length > max) throw new Error('Un campo supera la longitud permitida.');
  return v;
};
// Las imágenes se guardan como ENLACE (no se suben archivos). Solo http(s) o las del propio sitio.
const imgOf = v => {
  v = str(v, 600);
  if (v && !/^(https?:\/\/[^\s"'<>\\]+|\/images\/[\w.\-]+)$/.test(v)) throw new Error('El enlace de la imagen no es válido. Debe empezar por https:// y no tener espacios.');
  return v;
};
const bulletsOf = v => {
  if (!Array.isArray(v) || v.length > 60) throw new Error('Lista de puntos inválida.');
  return v.map(x => str(x, 300)).filter(Boolean);
};

const uname = v => {
  v = str(v, 40, true);
  if (!/^[\w.\-@]{2,40}$/.test(v)) throw new Error('Usuario inválido: de 2 a 40 caracteres (letras, números, . _ - @).');
  return v;
};
const roleOf = v => { if (!['admin', 'editor'].includes(v)) throw new Error('Rol inválido.'); return v; };
const pwOf = v => {
  v = str(v, 200, true);
  if (v.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres.');
  return v;
};
function validateContent(data) {
  if (!Array.isArray(data) || !data.length || data.length > 200) throw new Error('El archivo no tiene el formato esperado (lista de módulos).');
  return data.map(m => {
    if (!m || typeof m !== 'object' || !Array.isArray(m.s) || m.s.length > 500) throw new Error('El archivo no tiene el formato esperado.');
    return {
      t: str(m.t, 200, true), d: str(m.d, 500), note: str(m.note, 1000), image: imgOf(m.image),
      s: m.s.map(x => {
        if (!x || typeof x !== 'object') throw new Error('El archivo no tiene el formato esperado.');
        return { code: str(x.code, 20), title: str(x.title, 250, true), bullets: bulletsOf(x.bullets || []), body: str(x.body, 100000) };
      })
    };
  });
}
function insertContent(list) {
  const im = db.prepare('INSERT INTO modules(position,title,description,note,image) VALUES(?,?,?,?,?)');
  const is = db.prepare('INSERT INTO sections(module_id,position,code,title,bullets,body) VALUES(?,?,?,?,?,?)');
  list.forEach((m, i) => {
    const id = im.run(i + 1, m.t, m.d, m.note, m.image).lastInsertRowid;
    m.s.forEach((x, j) => is.run(id, j + 1, x.code, x.title, JSON.stringify(x.bullets), x.body));
  });
}
// Intercambia un elemento con su vecino y renumera 1..n (robusto aunque las posiciones tuvieran huecos).
function reorder(table, scopeSql, scopeArgs, id, dir) {
  const ids = db.prepare(`SELECT id FROM ${table} ${scopeSql} ORDER BY position,id`).all(...scopeArgs).map(r => r.id);
  const i = ids.indexOf(id);
  if (i < 0) return false;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return true; // ya está en el extremo
  [ids[i], ids[j]] = [ids[j], ids[i]];
  db.exec('BEGIN');
  try { const up = db.prepare(`UPDATE ${table} SET position=? WHERE id=?`); ids.forEach((x, k) => up.run(k + 1, x)); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  return true;
}
const adminCount = () => db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n;
const dropSessions = (uid, exceptUid) => { for (const [t, v] of sessions) if (v.uid === uid && uid !== exceptUid) sessions.delete(t); };
const fileStamp = () => new Date().toISOString().slice(0, 10);

// ---------- API ----------
function content() {
  const mods = db.prepare('SELECT * FROM modules ORDER BY position,id').all();
  const secs = db.prepare('SELECT * FROM sections ORDER BY position,id').all();
  return mods.map(m => ({
    id: m.id, t: m.title, d: m.description, note: m.note, image: m.image,
    s: secs.filter(s => s.module_id === m.id).map(s => ({ id: s.id, code: s.code, title: s.title, bullets: JSON.parse(s.bullets), body: s.body }))
  }));
}
const nextPos = (table, where = '', arg) => db.prepare(`SELECT COALESCE(MAX(position),0)+1 n FROM ${table} ${where}`).get(...(arg === undefined ? [] : [arg])).n;

async function api(req, res, url) {
  const m = req.method, p = url.pathname;

  if (m === 'GET' && p === '/api/content') return send(res, 200, content());
  if (m === 'GET' && p === '/api/me') { const u = currentUser(req); return send(res, 200, { user: u ? u.username : null, role: u ? u.role : null }); }

  // Toda escritura exige este encabezado (un formulario de otro sitio no puede enviarlo).
  if (m !== 'GET' && req.headers['x-requested-with'] !== 'wiki') return send(res, 403, { error: 'Solicitud no permitida.' });

  if (m === 'POST' && p === '/api/login') {
    const ip = req.socket.remoteAddress;
    const a = attempts.get(ip) || { n: 0, until: 0 };
    if (a.until > Date.now()) return send(res, 429, { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' });
    let b; try { b = await readJson(req); } catch { return send(res, 400, { error: 'Solicitud inválida.' }); }
    const user = checkPw(String(b.user || '').slice(0, 100), String(b.pass || '').slice(0, 200));
    if (!user) {
      a.n++; if (a.n >= 5) { a.until = Date.now() + 15 * 60e3; a.n = 0; }
      attempts.set(ip, a);
      return send(res, 401, { error: 'Usuario o contraseña incorrectos.' });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, { uid: user.id, username: user.username, role: user.role, exp: Date.now() + SESSION_MS });
    return send(res, 200, { user: user.username, role: user.role }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` });
  }
  if (m === 'POST' && p === '/api/logout') {
    const t = parseCookies(req.headers.cookie).sid; if (t) sessions.delete(t);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  // ---- Requieren sesión ----
  const user = currentUser(req);
  if (!user) return send(res, 401, { error: 'Debes iniciar sesión.' });
  const isAdmin = user.role === 'admin';
  if (p.startsWith('/api/admin/') && !isAdmin) return send(res, 403, { error: 'Solo para administradores.' });
  if (m === 'GET' && p === '/api/admin/info') {
    const n = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    return send(res, 200, { file: 'data/data.db', engine: 'SQLite', size: fs.statSync(path.join(DATA, 'data.db')).size,
      modules: n('modules'), sections: n('sections'), users: n('users'), backups: listBackups() });
  }
  if (m === 'GET' && p === '/api/admin/backup') {
    const name = backupNow('descarga'), file = path.join(BACKUPS, name);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return fs.createReadStream(file).pipe(res);
  }
  if (m === 'GET' && p === '/api/admin/export') {
    const data = content().map(x => ({ t: x.t, d: x.d, note: x.note, image: x.image, s: x.s.map(y => ({ code: y.code, title: y.title, bullets: y.bullets, body: y.body })) }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="wiki-contenido-${fileStamp()}.json"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(JSON.stringify(data, null, 1));
  }
  if (m === 'GET' && p === '/api/admin/users')
    return send(res, 200, db.prepare('SELECT id,username,role FROM users ORDER BY username').all());
  let b = {};
  if (m === 'POST' || m === 'PUT') { try { b = await readJson(req, p === '/api/admin/import' ? 6e6 : 1e6); } catch { return send(res, 400, { error: 'Solicitud inválida.' }); } }

  try {
    if (m === 'POST' && p === '/api/password') {
      if (!checkPw(user.username, String(b.current || ''))) return send(res, 400, { error: 'La contraseña actual no es correcta.' });
      const np = str(b.next, 200, true);
      if (np.length < 10) throw new Error('La nueva contraseña debe tener al menos 10 caracteres.');
      const salt = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt, hashPw(np, salt), user.uid);
      return send(res, 200, { ok: true });
    }
    if (m === 'POST' && p === '/api/admin/import') {
      const clean = validateContent(b.data);
      const backup = backupNow('antes-importar'); // por si hay que volver atrás
      db.exec('BEGIN');
      try { db.exec('DELETE FROM modules'); insertContent(clean); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return send(res, 200, { ok: true, modules: clean.length, backup });
    }
    if (m === 'POST' && p === '/api/admin/users') {
      const name = uname(b.username);
      if (db.prepare('SELECT 1 FROM users WHERE username=?').get(name)) throw new Error('Ese usuario ya existe.');
      const pw = pwOf(b.password), role = roleOf(b.role), salt = crypto.randomBytes(16).toString('hex');
      const id = db.prepare('INSERT INTO users(username,salt,hash,role) VALUES(?,?,?,?)').run(name, salt, hashPw(pw, salt), role).lastInsertRowid;
      return send(res, 201, { id: Number(id) });
    }
    const um = p.match(/^\/api\/admin\/users\/(\d+)$/);
    if (um) {
      const uid = +um[1], target = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
      if (!target) return send(res, 404, { error: 'El usuario no existe.' });
      if (m === 'PUT') {
        if (b.role !== undefined) {
          const role = roleOf(b.role);
          if (target.role === 'admin' && role !== 'admin' && adminCount() <= 1) throw new Error('Debe quedar al menos un administrador.');
          db.prepare('UPDATE users SET role=? WHERE id=?').run(role, uid);
          for (const v of sessions.values()) if (v.uid === uid) v.role = role;
        }
        if (b.password !== undefined) {
          const salt = crypto.randomBytes(16).toString('hex');
          db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt, hashPw(pwOf(b.password), salt), uid);
          dropSessions(uid, user.uid); // quien tenía sesión abierta con la clave vieja debe volver a entrar
        }
        return send(res, 200, { ok: true });
      }
      if (m === 'DELETE') {
        if (uid === user.uid) throw new Error('No puedes eliminar tu propio usuario.');
        if (target.role === 'admin' && adminCount() <= 1) throw new Error('Debe quedar al menos un administrador.');
        db.prepare('DELETE FROM users WHERE id=?').run(uid); dropSessions(uid);
        return send(res, 200, { ok: true });
      }
    }
    const sm = p.match(/^\/api\/sections\/(\d+)\/move$/);
    if (m === 'POST' && sm) {
      const row = db.prepare('SELECT module_id FROM sections WHERE id=?').get(+sm[1]);
      if (!row || !['up', 'down'].includes(b.dir)) throw new Error('Solicitud inválida.');
      reorder('sections', 'WHERE module_id=?', [row.module_id], +sm[1], b.dir);
      return send(res, 200, { ok: true });
    }
    const mo = p.match(/^\/api\/modules\/(\d+)\/move$/);
    if (m === 'POST' && mo) {
      if (!['up', 'down'].includes(b.dir)) throw new Error('Solicitud inválida.');
      if (!reorder('modules', '', [], +mo[1], b.dir)) throw new Error('El módulo no existe.');
      return send(res, 200, { ok: true });
    }
    if (m === 'POST' && p === '/api/modules') {
      const id = db.prepare('INSERT INTO modules(position,title,description,note,image) VALUES(?,?,?,?,?)')
        .run(nextPos('modules'), str(b.title, 200, true), str(b.description, 500), str(b.note, 1000), imgOf(b.image)).lastInsertRowid;
      return send(res, 201, { id: Number(id) });
    }
    let mm = p.match(/^\/api\/modules\/(\d+)$/);
    if (mm && m === 'PUT') {
      db.prepare('UPDATE modules SET title=?,description=?,note=?,image=? WHERE id=?').run(str(b.title, 200, true), str(b.description, 500), str(b.note, 1000), imgOf(b.image), +mm[1]);
      return send(res, 200, { ok: true });
    }
    if (mm && m === 'DELETE') {
      if (!isAdmin) return send(res, 403, { error: 'Solo un administrador puede eliminar módulos.' });
      db.prepare('DELETE FROM modules WHERE id=?').run(+mm[1]); return send(res, 200, { ok: true });
    }
    if (m === 'POST' && p === '/api/sections') {
      const mod = +b.module_id;
      if (!db.prepare('SELECT 1 FROM modules WHERE id=?').get(mod)) throw new Error('El módulo no existe.');
      const id = db.prepare('INSERT INTO sections(module_id,position,code,title,bullets,body) VALUES(?,?,?,?,?,?)')
        .run(mod, nextPos('sections', 'WHERE module_id=?', mod), str(b.code, 20), str(b.title, 250, true), JSON.stringify(bulletsOf(b.bullets || [])), str(b.body, 100000)).lastInsertRowid;
      return send(res, 201, { id: Number(id) });
    }
    mm = p.match(/^\/api\/sections\/(\d+)$/);
    if (mm && m === 'PUT') {
      db.prepare('UPDATE sections SET code=?,title=?,bullets=?,body=? WHERE id=?')
        .run(str(b.code, 20), str(b.title, 250, true), JSON.stringify(bulletsOf(b.bullets || [])), str(b.body, 100000), +mm[1]);
      return send(res, 200, { ok: true });
    }
    if (mm && m === 'DELETE') {
      if (!isAdmin) return send(res, 403, { error: 'Solo un administrador puede eliminar secciones.' });
      db.prepare('DELETE FROM sections WHERE id=?').run(+mm[1]); return send(res, 200, { ok: true });
    }
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
  return send(res, 404, { error: 'No encontrado.' });
}

// ---------- Archivos estáticos (solo public/index.html y public/images/*) ----------
function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Solicitud inválida'); }
  if (rel === '/') rel = '/index.html';
  if (!(rel === '/index.html' || /^\/images\/[\w.\-]+$/.test(rel))) return send(res, 404, 'No encontrado');
  fs.readFile(path.join(PUBLIC, rel), (err, data) => {
    if (err) return send(res, 404, 'No encontrado');
    // img-src permite imágenes enlazadas desde otros sitios; scripts, estilos y el resto siguen restringidos.
    const csp = "default-src 'self'; img-src 'self' data: https: http:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'";
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': csp, 'Cache-Control': rel === '/index.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return api(req, res, url).catch(() => send(res, 500, { error: 'Error del servidor.' }));
    if (req.method !== 'GET') return send(res, 405, 'Método no permitido');
    serveStatic(req, res, url);
  } catch { send(res, 400, 'Solicitud inválida'); }
}).listen(PORT, HOST, () => console.log(`Wiki CEJEL IPS en http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`))
  .on('error', e => { console.error(e.code === 'EADDRINUSE' ? `El puerto ${PORT} ya está en uso. ¿Ya hay una wiki abierta? Cierra la otra ventana o cambia PORT en .env.` : e.message); process.exit(1); });
