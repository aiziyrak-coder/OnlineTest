/**
 * Socket.IO — imtihon xonasi WebRTC signal (legacy Express bilan mos).
 * Ishga tushirish: npm run dev:realtime (repo ildizidan)
 *
 * Xavfsizlik: prod da REALTIME_BIND=127.0.0.1 (standart). join-exam JWT siz —
 * keyingi yaxshilanish: handshake da token tekshirish.
 */
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const PORT = Number.parseInt(process.env.REALTIME_PORT || '3001', 10);
const isProd = process.env.NODE_ENV === 'production';
/** Prod: faqat loopback — tashqaridan to‘g‘ridan-to‘g‘ri 9082 ga ulanishni oldini oladi (nginx orqali). */
const BIND = process.env.REALTIME_BIND || (isProd ? '127.0.0.1' : '0.0.0.0');

const corsOrigin = process.env.SOCKET_IO_CORS_ORIGIN
  ? process.env.SOCKET_IO_CORS_ORIGIN.split(',').map((s) => s.trim())
  : isProd
    ? false
    : ['http://127.0.0.1:5173', 'http://localhost:5173'];

const httpServer = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'fjsti-realtime' }));
    return;
  }
  res.statusCode = 404;
  res.end();
});

const io = new Server(httpServer, {
  path: '/socket.io',
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  socket.on('join-exam', (examId, role, userId) => {
    socket.join(`exam-${examId}`);
    if (role === 'student') {
      socket.to(`exam-${examId}`).emit('student-joined', userId, socket.id);
    }
  });

  socket.on('offer', (to, offer, fromId, userId) => {
    socket.to(to).emit('offer', socket.id, offer, fromId, userId);
  });

  socket.on('answer', (to, answer) => {
    socket.to(to).emit('answer', socket.id, answer);
  });

  socket.on('ice-candidate', (to, candidate) => {
    socket.to(to).emit('ice-candidate', socket.id, candidate);
  });
});

httpServer.listen(PORT, BIND, () => {
  console.log(`[realtime] http://${BIND}:${PORT}  path=/socket.io  healthz=/healthz`);
  if (isProd && !process.env.SOCKET_IO_CORS_ORIGIN) {
    console.warn('[realtime] SOCKET_IO_CORS_ORIGIN majburiy tavsiya etiladi (prod).');
  }
});
