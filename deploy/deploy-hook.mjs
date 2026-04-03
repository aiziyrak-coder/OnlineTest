/**
 * SSH siz deploy: nginx → bu xizmat (127.0.0.1).
 * POST /__internal_deploy/v1  Header: X-Deploy-Secret: <DEPLOY_HOOK_SECRET>
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const PORT = Number.parseInt(process.env.DEPLOY_HOOK_PORT || '9085', 10);
const SECRET = process.env.DEPLOY_HOOK_SECRET || '';
const APP = process.env.DEPLOY_APP_ROOT || '/var/www/onlinetest';

if (!SECRET || SECRET.length < 24) {
  console.error('[deploy-hook] DEPLOY_HOOK_SECRET majburiy (min 24 belgi).');
  process.exit(1);
}

const SECRET_HASH = crypto.createHash('sha256').update(SECRET, 'utf8').digest();

function secretOk(headerVal) {
  try {
    const h = crypto.createHash('sha256').update(String(headerVal ?? ''), 'utf8').digest();
    return crypto.timingSafeEqual(h, SECRET_HASH);
  } catch {
    return false;
  }
}

let busy = false;

function runDeploy() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      '/bin/bash',
      [
        '-lc',
        'set -euo pipefail; git fetch origin; git reset --hard origin/HEAD; bash deploy/remote-update.sh --no-git',
      ],
      {
        cwd: APP,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => {
      out += c;
    });
    child.stderr.on('data', (c) => {
      err += c;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`deploy exit ${code}\n${err}\n${out}`));
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/__internal_deploy/v1') {
    res.writeHead(404);
    res.end();
    return;
  }

  if (!secretOk(req.headers['x-deploy-secret'])) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  if (busy) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'busy' }));
    return;
  }

  busy = true;
  try {
    const { out, err } = await runDeploy();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'deployed' }));
    if (err) console.error('[deploy-hook] stderr:', err.slice(0, 8000));
    if (out) console.log('[deploy-hook] stdout:', out.slice(0, 4000));
  } catch (e) {
    console.error('[deploy-hook]', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  } finally {
    busy = false;
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[deploy-hook] http://127.0.0.1:${PORT}/__internal_deploy/v1 (POST)`);
});
