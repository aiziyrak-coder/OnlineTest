import { build } from 'esbuild';

build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/server.cjs',
  external: [
    'better-sqlite3',
    'express',
    'multer',
    'pdf-parse',
    'jsonwebtoken',
    'bcryptjs',
    'dotenv',
    '@google/genai',
    'pdfkit',
    'qrcode',
    'socket.io',
    'helmet',
    'compression',
    'morgan',
    'express-rate-limit',
    'vite',
  ],
}).catch(() => process.exit(1));
