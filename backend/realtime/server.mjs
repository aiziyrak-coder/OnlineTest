/**
 * Socket.IO — imtihon xonasi WebRTC signal (legacy Express bilan mos).
 * Ishga tushirish: npm run dev:realtime (repo ildizidan)
 *
 * Xavfsizlik:
 * - JWT_SECRET (yoki REALTIME_JWT_SECRET) bo'lsa, handshake da JWT majburiy (Django JWT bilan bir xil HS256).
 * - join-exam: client yuborgan userId JWT dagi id bilan mos kelishi shart; student/proctor rollari tekshiriladi.
 * - WebRTC signal (offer/answer/ice): faqat xuddi shu imtihon xonasidagi socketlarga yo'naltiriladi.
 */
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const PORT = Number.parseInt(process.env.REALTIME_PORT || '3001', 10);
const isProd = process.env.NODE_ENV === 'production';
/** Prod: faqat loopback — tashqaridan to‘g‘ridan-to‘g‘ri portga ulanishni oldini oladi (nginx orqali). */
const BIND = process.env.REALTIME_BIND || (isProd ? '127.0.0.1' : '0.0.0.0');

/** Django bilan bir xil kalit: JWT_SECRET (API) yoki DJANGO_SECRET_KEY (JWT_SECRET bo‘lmasa Django shu bilan imzo qo‘yadi). */
const JWT_SECRET = (
  process.env.JWT_SECRET ||
  process.env.REALTIME_JWT_SECRET ||
  process.env.DJANGO_SECRET_KEY ||
  ''
).trim();
const jwtAuthEnabled = JWT_SECRET.length >= 24;

const corsOrigin = process.env.SOCKET_IO_CORS_ORIGIN
  ? process.env.SOCKET_IO_CORS_ORIGIN.split(',').map((s) => s.trim())
  : isProd
    ? false
    : ['http://127.0.0.1:5173', 'http://localhost:5173'];

const httpServer = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const build = (process.env.APP_BUILD_REF || process.env.GIT_COMMIT || '').trim();
    res.end(JSON.stringify({ ok: true, service: 'fjsti-realtime', build: build || null }));
    return;
  }
  res.statusCode = 404;
  res.end();
});

const io = new Server(httpServer, {
  path: '/socket.io',
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
});

/** Xona ichida target socket bor-yo‘qligi (boshqa imtihonlarga signal yuborilmasin). */
function targetInSameExamRoom(examId, targetSocketId) {
  if (!examId || !targetSocketId) return false;
  const room = io.sockets.adapter.rooms.get(`exam-${examId}`);
  return Boolean(room && room.has(targetSocketId));
}

if (jwtAuthEnabled) {
  io.use((socket, next) => {
    const raw =
      socket.handshake.auth?.token ||
      socket.handshake.auth?.jwt ||
      (typeof socket.handshake.query?.token === 'string' ? socket.handshake.query.token : '');
    if (!raw || typeof raw !== 'string') {
      return next(new Error('Unauthorized: missing token'));
    }
    try {
      const payload = jwt.verify(raw.trim(), JWT_SECRET, {
        algorithms: ['HS256'],
        clockTolerance: 60,
      });
      const userId = payload.id ?? payload.sub;
      if (userId == null || userId === '') {
        return next(new Error('Unauthorized: invalid payload'));
      }
      socket.data.userId = String(userId);
      socket.data.role = String(payload.role || '');
      return next();
    } catch {
      return next(new Error('Unauthorized: invalid token'));
    }
  });
} else if (isProd) {
  console.error(
    '[realtime] NODE_ENV=production da JWT_SECRET (yoki REALTIME_JWT_SECRET / DJANGO_SECRET_KEY, min 24 belgi) majburiy. /etc/onlinetest/realtime.env ni api.env bilan moslang.',
  );
  process.exit(1);
}

io.on('connection', (socket) => {
  socket.on('join-exam', (examId, role, userId) => {
    if (jwtAuthEnabled) {
      if (String(userId ?? '') !== socket.data.userId) {
        return;
      }
      if (role === 'student' && socket.data.role !== 'student') {
        return;
      }
      if (role === 'proctor' && socket.data.role !== 'admin') {
        return;
      }
    }
    const eid = Number(examId);
    if (!Number.isFinite(eid) || eid < 1 || eid > 2_147_483_647) {
      return;
    }
    socket.join(`exam-${eid}`);
    socket.data.examId = eid;

    if (role === 'student') {
      socket.to(`exam-${eid}`).emit('student-joined', userId, socket.id);
    }
  });

  socket.on('offer', (to, offer, fromId, userId) => {
    const eid = socket.data.examId;
    if (!eid || !targetInSameExamRoom(eid, to)) {
      return;
    }
    socket.to(to).emit('offer', socket.id, offer, fromId, userId);
  });

  socket.on('answer', (to, answer) => {
    const eid = socket.data.examId;
    if (!eid || !targetInSameExamRoom(eid, to)) {
      return;
    }
    socket.to(to).emit('answer', socket.id, answer);
  });

  socket.on('ice-candidate', (to, candidate) => {
    const eid = socket.data.examId;
    if (!eid || !targetInSameExamRoom(eid, to)) {
      return;
    }
    socket.to(to).emit('ice-candidate', socket.id, candidate);
  });
});

httpServer.listen(PORT, BIND, () => {
  console.log(`[realtime] http://${BIND}:${PORT}  path=/socket.io  healthz=/healthz  jwt=${jwtAuthEnabled}`);
  if (isProd && !process.env.SOCKET_IO_CORS_ORIGIN) {
    console.warn('[realtime] SOCKET_IO_CORS_ORIGIN majburiy tavsiya etiladi (prod).');
  }
});
