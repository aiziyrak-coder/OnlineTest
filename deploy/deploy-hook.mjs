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
const MAX_BODY = 4096;

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
};

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

function drainCapped(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let n = 0;
    req.on('data', (chunk) => {
      n += chunk.length;
      if (n > maxBytes) {
        req.destroy();
        reject(new Error('payload too large'));
      }
    });
    req.on('end', () => resolve());
    req.on('error', () => resolve());
    req.resume();
  });
}

let busy = false;

function runDeploy() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      '/bin/bash',
      [
        '-lc',
        'set -euo pipefail; git fetch origin main; git reset --hard origin/main; bash deploy/remote-update.sh --no-git',
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
    res.writeHead(404, jsonHeaders);
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }

  const cl = req.headers['content-length'];
  if (cl !== undefined && Number(cl) > MAX_BODY) {
    res.writeHead(413, jsonHeaders);
    res.end(JSON.stringify({ ok: false, error: 'payload too large' }));
    return;
  }

  if (!secretOk(req.headers['x-deploy-secret'])) {
    try {
      await drainCapped(req, MAX_BODY);
    } catch {
      res.writeHead(413, jsonHeaders);
      res.end(JSON.stringify({ ok: false, error: 'payload too large' }));
      return;
    }
    res.writeHead(401, jsonHeaders);
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  if (busy) {
    try {
      await drainCapped(req, MAX_BODY);
    } catch {
      res.writeHead(413, jsonHeaders);
      res.end(JSON.stringify({ ok: false, error: 'payload too large' }));
      return;
    }
    res.writeHead(429, jsonHeaders);
    res.end(JSON.stringify({ ok: false, error: 'busy' }));
    return;
  }

  try {
    await drainCapped(req, MAX_BODY);
  } catch {
    res.writeHead(413, jsonHeaders);
    res.end(JSON.stringify({ ok: false, error: 'payload too large' }));
    return;
  }

  busy = true;
  try {
    const { out, err } = await runDeploy();
    res.writeHead(200, jsonHeaders);
    res.end(JSON.stringify({ ok: true, message: 'deployed' }));
    if (err) console.error('[deploy-hook] stderr:', err.slice(0, 8000));
    if (out) console.log('[deploy-hook] stdout:', out.slice(0, 4000));
  } catch (e) {
    console.error('[deploy-hook]', e);
    res.writeHead(500, jsonHeaders);
    res.end(JSON.stringify({ ok: false, error: 'deploy failed' }));
  } finally {
    busy = false;
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[deploy-hook] http://127.0.0.1:${PORT}/__internal_deploy/v1 (POST)`);
});
