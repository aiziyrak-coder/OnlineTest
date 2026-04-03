import 'dotenv/config';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import multer from 'multer';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import morgan from 'morgan';
import http from 'http';
import crypto from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { buildResultCertificatePdf, type CertificateInput } from './reportPdf';

// CJS bundle da import.meta bo‘sh — loyiha ildizidan require (prod `node dist/server.cjs`)
const requireFromRoot = createRequire(pathToFileURL(path.join(process.cwd(), 'package.json')).href);
const pdfParse = requireFromRoot('pdf-parse');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const DEFAULT_JWT_SECRET = 'super-secret-key-for-ai-proctoring';
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  const s = process.env.JWT_SECRET;
  if (!s || s === DEFAULT_JWT_SECRET || String(s).length < 24) {
    console.error('[FATAL] Production: set JWT_SECRET (min 24 chars, not the default placeholder).');
    process.exit(1);
  }
}
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

if (!isProduction && JWT_SECRET === DEFAULT_JWT_SECRET) {
  console.warn(
    '[security] JWT_SECRET standart qiymatda. Port tashqariga ochiq bo‘lsa, .env da kuchli maxfiy kalit qo‘ying.',
  );
}

if (process.env.TRUST_PROXY === '1' || /^true$/i.test(process.env.TRUST_PROXY || '')) {
  app.set('trust proxy', 1);
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for Vite dev server compatibility
  crossOriginEmbedderPolicy: false,
}));

// Performance middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

app.use(express.json({ limit: '50mb' })); // Increased limit for base64 images

// Rate limiting for login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login requests per `window` (here, per 15 minutes)
  message: { error: 'Too many login attempts from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

const faceVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many face verification requests. Wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const publicVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: 'Too many verification requests from this IP.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Setup SQLite Database (TEST_SQLITE_PATH=:memory: — Vitest integratsion testlari uchun)
const db = new Database(process.env.TEST_SQLITE_PATH || 'proctoring.db');
db.pragma('journal_mode = WAL'); // Better concurrency
db.pragma('synchronous = NORMAL'); // Better performance with WAL

// Initialize DB Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    level_id INTEGER NOT NULL,
    FOREIGN KEY(level_id) REFERENCES levels(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'Active',
    group_id INTEGER,
    profile_image TEXT,
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id TEXT NOT NULL,
    title TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    questions_json TEXT NOT NULL,
    language TEXT DEFAULT 'uz',
    pin TEXT DEFAULT '',
    custom_rules TEXT DEFAULT '',
    FOREIGN KEY(teacher_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS exam_groups (
    exam_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    PRIMARY KEY (exam_id, group_id),
    FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE,
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS student_exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    exam_id INTEGER NOT NULL,
    status TEXT DEFAULT 'Pending',
    score INTEGER,
    answers_json TEXT,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS violations_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    exam_id INTEGER NOT NULL,
    violation_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    screenshot_url TEXT,
    FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS test_bank_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS test_bank_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    language TEXT DEFAULT 'uz',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(category_id) REFERENCES test_bank_categories(id) ON DELETE CASCADE
  );
`);

// Seed initial data
try {
  try { db.exec("ALTER TABLE exams ADD COLUMN pin TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE exams ADD COLUMN custom_rules TEXT DEFAULT ''"); } catch (e) {}
  try { db.exec("ALTER TABLE student_exams ADD COLUMN flagged_questions_json TEXT DEFAULT '[]'"); } catch (e) {}
  try { db.exec("ALTER TABLE student_exams ADD COLUMN session_questions_json TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE student_exams ADD COLUMN result_public_id TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE student_exams ADD COLUMN result_verify_secret TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE student_exams ADD COLUMN ai_summary_json TEXT"); } catch (e) {}
  try { db.exec("ALTER TABLE exams ADD COLUMN exam_mode TEXT DEFAULT 'static'"); } catch (e) {}
  try { db.exec("ALTER TABLE exams ADD COLUMN bank_category_ids TEXT DEFAULT '[]'"); } catch (e) {}
  try { db.exec("ALTER TABLE exams ADD COLUMN bank_question_count INTEGER DEFAULT 0"); } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS result_id_sequence (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        next_num INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO result_id_sequence (id, next_num) VALUES (1, 37923423);
    `);
  } catch (e) {}
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_student_exams_result_public_id ON student_exams(result_public_id) WHERE result_public_id IS NOT NULL`);
  } catch (e) {}
  
  // Create indexes for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_student_exams_student_id ON student_exams(student_id);
    CREATE INDEX IF NOT EXISTS idx_student_exams_exam_id ON student_exams(exam_id);
    CREATE INDEX IF NOT EXISTS idx_exams_teacher_id ON exams(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_violations_exam_id ON violations_log(exam_id);
    CREATE INDEX IF NOT EXISTS idx_users_group_id ON users(group_id);
  `);

  const levelsCount = (db.prepare('SELECT COUNT(*) as cnt FROM levels').get() as any).cnt;
  if (levelsCount === 0) {
    const levels = ['1-kurs', '2-kurs', '3-kurs', '4-kurs', '5-kurs', '6-kurs', 'Magistratura', 'Aspirantura', 'Ordinatura'];
    const insertLevel = db.prepare('INSERT INTO levels (name) VALUES (?)');
    const insertLevelsTx = db.transaction((lvls) => {
      for (const l of lvls) insertLevel.run(l);
    });
    insertLevelsTx(levels);
  }

  const adminExists = db.prepare('SELECT * FROM users WHERE id = ?').get('admin');
  if (!adminExists) {
    if (isProduction) {
      const boot = process.env.ADMIN_BOOTSTRAP_PASSWORD;
      if (!boot || String(boot).length < 12) {
        console.error(
          '[FATAL] Production: bazada admin yo‘q. Birinchi marta ishga tushirish uchun .env da ADMIN_BOOTSTRAP_PASSWORD (min 12 belgi) o‘rnating, keyin parolni o‘chirib tashlang.',
        );
        process.exit(1);
      }
      db.prepare('INSERT INTO users (id, password, role, name) VALUES (?, ?, ?, ?)').run(
        'admin',
        bcrypt.hashSync(String(boot), 10),
        'admin',
        'System Admin',
      );
      console.log('[init] Production: boshlang‘ich admin yaratildi (id=admin). Birinchi kirishdan keyin parolni almashtiring.');
    } else {
      db.prepare('INSERT INTO users (id, password, role, name) VALUES (?, ?, ?, ?)').run(
        'admin',
        bcrypt.hashSync('admin123', 10),
        'admin',
        'System Admin',
      );
    }
  }
  db.prepare("UPDATE users SET role = 'student' WHERE role = 'teacher'").run();

  const allowDemoStudent = !isProduction || process.env.ENABLE_MOCK_SEED === '1';
  if (allowDemoStudent) {
    const studentExists = db.prepare('SELECT * FROM users WHERE id = ?').get('student');
    if (!studentExists) {
      db.prepare('INSERT INTO users (id, password, role, name) VALUES (?, ?, ?, ?)').run(
        'student',
        bcrypt.hashSync('student123', 10),
        'student',
        'Demo Student',
      );
    }
  }

  const bankCatCount = (db.prepare('SELECT COUNT(*) as c FROM test_bank_categories').get() as any).c;
  if (bankCatCount === 0) {
    const ins = db.prepare('INSERT INTO test_bank_categories (name, description, sort_order) VALUES (?, ?, ?)');
    const seedCats: [string, string, number][] = [
      ['Ichki kasalliklari', 'Terapiya va diagnostika', 1],
      ['Bolalar kasalliklari', 'Pediatriya', 2],
      ['Ayollar kasalliklari', 'Akusherlik va ginekologiya', 3],
      ['Kasalliklar profilaktikasi', 'Jamoat salomatligi', 4],
      ['Mikrobiologiya', 'Infeksion kasalliklar', 5],
      ['Anatomiya va fiziologiya', 'Asosiy fanlar', 6],
    ];
    for (const [name, desc, ord] of seedCats) ins.run(name, desc, ord);
  }

  // Mock / demo: devda odatda yoqilgan (DISABLE_MOCK_SEED=1 bilan o‘chirish); prod faqat ENABLE_MOCK_SEED=1 bo‘lsa
  const runMockSeed =
    !isProduction ? process.env.DISABLE_MOCK_SEED !== '1' : process.env.ENABLE_MOCK_SEED === '1';
  if (runMockSeed) {
    const levelId = ((db.prepare('SELECT id FROM levels ORDER BY id LIMIT 1').get() as any)?.id as number) || 1;
    let demoGroupId: number;
    const existingG = db.prepare('SELECT id FROM groups WHERE name = ?').get('DEMO 301-guruh (mock)') as { id: number } | undefined;
    if (existingG) {
      demoGroupId = existingG.id;
    } else {
      const gr = db.prepare('INSERT INTO groups (name, level_id) VALUES (?, ?)').run('DEMO 301-guruh (mock)', levelId);
      demoGroupId = Number(gr.lastInsertRowid);
    }

    const tinyProfileJpeg =
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABALCwwLCQ8QDBAPFhYUGBweHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx8fHx//2wBDAQcHFw8PDxQPEBEXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXF//wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGQAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z';
    db.prepare('UPDATE users SET group_id = ?, profile_image = ? WHERE id = ?').run(demoGroupId, tinyProfileJpeg, 'student');

    const bankTotal = (db.prepare('SELECT COUNT(*) as c FROM test_bank_questions').get() as any).c as number;
    if (bankTotal < 28) {
      const cats = db.prepare('SELECT id FROM test_bank_categories ORDER BY id').all() as { id: number }[];
      const insQ = db.prepare(
        'INSERT INTO test_bank_questions (category_id, text, options_json, correct_answer, language) VALUES (?, ?, ?, ?, ?)',
      );
      for (const c of cats) {
        for (let i = 0; i < 5; i++) {
          const correct = `To'g'ri variant (${c.id}-${i + 1})`;
          const opts = [correct, `Noto'g'ri A (${c.id})`, `Noto'g'ri B (${c.id})`, `Noto'g'ri C (${c.id})`];
          insQ.run(
            c.id,
            `DEMO savol ${c.id}-${i + 1}: Tibbiyot testi uchun namuna. Qaysi javob to'g'ri?`,
            JSON.stringify(opts),
            correct,
            'uz',
          );
        }
      }
    }

    const now = Date.now();
    const startIso = new Date(now - 24 * 3600000).toISOString();
    const endIso = new Date(now + 30 * 24 * 3600000).toISOString();

    const mockStaticQuestions = [
      {
        id: 1,
        text: "Qonning o‘rtacha pH qiymati qaysi oraliqda bo‘ladi?",
        options: ['7.35–7.45', '6.8–7.0', '7.6–8.0', '5.5–6.0'],
        correctAnswer: '7.35–7.45',
      },
      {
        id: 2,
        text: 'Insulin asosan qaysi organ tomonidan ishlab chiqariladi?',
        options: ['Buyrak', 'Jigar', 'Uch pankoas bezining Langerhans orolchalari', 'Oshqozon'],
        correctAnswer: 'Uch pankoas bezining Langerhans orolchalari',
      },
      {
        id: 3,
        text: 'Yurak urishining asosiy elektrofiziologik boshlovchisi qayerda joylashgan?',
        options: ['AV tugun', 'Sinus-tugunchasi', 'His-tozama tizimi', 'Purkinje tolalari'],
        correctAnswer: 'Sinus-tugunchasi',
      },
      {
        id: 4,
        text: 'Vitamin D ning faol shakli qaysi biri hisoblanadi?',
        options: ['Ergokalsiferol', 'Kolekalsiferol (D3)', '1,25-digidroksivitamin D', 'Foliy kislotasi'],
        correctAnswer: '1,25-digidroksivitamin D',
      },
      {
        id: 5,
        text: 'Tuberkulyozning asosiy keltirib chiqaruvchisi qaysi mikroorganizm?',
        options: ['Staphylococcus aureus', 'Streptococcus pneumoniae', 'Mycobacterium tuberculosis', 'Escherichia coli'],
        correctAnswer: 'Mycobacterium tuberculosis',
      },
    ];

    const mockStaticTitle = '__MOCK: Statik imtihon (5 savol)';
    if (!db.prepare('SELECT 1 FROM exams WHERE title = ?').get(mockStaticTitle)) {
      const r = db
        .prepare(
          `INSERT INTO exams (teacher_id, title, start_time, end_time, duration_minutes, questions_json, language, pin, custom_rules, exam_mode, bank_category_ids, bank_question_count)
           VALUES ('admin', ?, ?, ?, 45, ?, 'uz', '', '', 'static', '[]', 0)`,
        )
        .run(mockStaticTitle, startIso, endIso, JSON.stringify(mockStaticQuestions));
      const examId = Number(r.lastInsertRowid);
      db.prepare('INSERT OR IGNORE INTO exam_groups (exam_id, group_id) VALUES (?, ?)').run(examId, demoGroupId);
    }

    const mockBankTitle = '__MOCK: Test bazasi + AI (12 savol)';
    const catIds = db.prepare('SELECT id FROM test_bank_categories ORDER BY id LIMIT 3').all() as { id: number }[];
    const catIdList = catIds.map((x) => x.id);
    if (catIdList.length >= 1 && !db.prepare('SELECT 1 FROM exams WHERE title = ?').get(mockBankTitle)) {
      const r2 = db
        .prepare(
          `INSERT INTO exams (teacher_id, title, start_time, end_time, duration_minutes, questions_json, language, pin, custom_rules, exam_mode, bank_category_ids, bank_question_count)
           VALUES ('admin', ?, ?, ?, 60, '[]', 'uz', '', '', 'bank_mixed', ?, ?)`,
        )
        .run(mockBankTitle, startIso, endIso, JSON.stringify(catIdList), 12);
      const examId2 = Number(r2.lastInsertRowid);
      db.prepare('INSERT OR IGNORE INTO exam_groups (exam_id, group_id) VALUES (?, ?)').run(examId2, demoGroupId);
    }

    const staticRow = db.prepare('SELECT id FROM exams WHERE title = ?').get(mockStaticTitle) as { id: number } | undefined;
    if (staticRow) {
      const already = db.prepare('SELECT 1 FROM student_exams WHERE student_id = ? AND exam_id = ?').get('student', staticRow.id);
      if (!already) {
        const answers = {
          '1': '7.35–7.45',
          '2': 'Buyrak',
          '3': 'Sinus-tugunchasi',
          '4': 'Foliy kislotasi',
          '5': 'Mycobacterium tuberculosis',
        };
        const score = 3;
        const completedAt = new Date(now - 3600000).toISOString();
        const mockResultId = `FJSTI_${String(37923400).padStart(8, '0')}_${new Date().getFullYear()}`;
        // Doimiy kalit — faqat mock DEMO qatori uchun (tekshirish havolasi o‘zgarmaydi)
        const mockSecret = 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234ab';
        const mockAi = {
          overview:
            'DEMO natija: 5 savoldan 3 tasi to‘g‘ri. Bu avtomatik yaratilgan mock xulosa — tizimni tekshirish uchun.',
          items: mockStaticQuestions.map((q) => {
            const st = answers[String(q.id) as keyof typeof answers];
            const ok = st === q.correctAnswer;
            return {
              questionId: q.id,
              isCorrect: ok,
              commentCorrect: ok ? 'To‘g‘ri javob tanlangan (mock).' : '',
              whyStudentWrong: ok ? '' : `Tanlangan javob "${st}" to‘g‘ri variant bilan mos emas (mock).`,
              whyCorrectIsRight: ok ? '' : `To‘g‘ri javob "${q.correctAnswer}" sababli (mock tushuntirish).`,
            };
          }),
        };
        db.prepare(
          `INSERT INTO student_exams (student_id, exam_id, status, score, answers_json, flagged_questions_json, completed_at, result_public_id, result_verify_secret, ai_summary_json)
           VALUES ('student', ?, 'Completed', ?, ?, '[]', ?, ?, ?, ?)`,
        ).run(staticRow.id, score, JSON.stringify(answers), completedAt, mockResultId, mockSecret, JSON.stringify(mockAi));
        console.log(`[seed] DEMO sertifikat: /verify/result/${encodeURIComponent(mockResultId)}?k=${mockSecret}`);
      }
    }

    console.log(
      "[seed] Mock: talaba `student` / student123 — DEMO guruh, rasm, test bazasi, 2 imtihon, 1 ta yakunlangan natija (Natijalar bo'limi).",
    );
  }
} catch (err) {
  console.error("Error seeding database:", err);
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

function assertSafeResultPublicId(id: string): boolean {
  if (!id || id.length > 80) return false;
  return /^FJSTI_[0-9]{8}_20[0-9]{2}$/.test(id);
}

async function compareFacePairWithGemini(
  profileB64: string,
  liveB64: string,
): Promise<{ success: true; match: boolean } | { success: false; code: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { success: false, code: 'GEMINI_UNAVAILABLE' };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: {
        parts: [
          {
            text: "Compare these two images. The first is a reference profile photo, the second is a live webcam capture (mirrored like a selfie). Determine if they show the same person. Respond ONLY with 'MATCH' or 'NO_MATCH'.",
          },
          { inlineData: { data: profileB64, mimeType: 'image/jpeg' } },
          { inlineData: { data: liveB64, mimeType: 'image/jpeg' } },
        ],
      },
    });
    const raw = (response.text || '').trim().toUpperCase();
    const isMatch = raw === 'MATCH' || (raw.includes('MATCH') && !raw.includes('NO_MATCH'));
    return { success: true, match: isMatch };
  } catch (e) {
    console.error('compareFacePairWithGemini', e);
    return { success: false, code: 'GEMINI_ERROR' };
  }
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parseGeminiJsonArray(text: string): any[] {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const parsed = JSON.parse(t);
  if (!Array.isArray(parsed)) throw new Error('AI response is not a JSON array');
  return parsed;
}

async function generateBankExtensionQuestions(
  samples: { text: string; options: string[]; correctAnswer: string }[],
  count: number,
  language: string,
  categoryNames: string[],
): Promise<{ text: string; options: string[]; correctAnswer: string }[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  const ai = new GoogleGenAI({ apiKey: key });
  const sampleBlock = JSON.stringify(samples.slice(0, 14));
  const langName = language === 'uz' ? "O'zbek" : language === 'ru' ? 'Russian' : 'English';
  const prompt = `You are a medical education expert for Farg'ona jamoat salomatligi tibbiyot instituti (FJSTI), Uzbekistan.

Generate exactly ${count} NEW multiple-choice questions (not copies of the samples) in the SAME medical topics, difficulty, and style as these sample questions from the university test bank categories: ${categoryNames.join(', ')}.

Rules:
- Language for question text and all four options: ${langName}.
- Each item: "text" (string), "options" (array of exactly 4 strings), "correctAnswer" (must equal one option string exactly).
- Original questions only; same subject matter as samples; suitable for medical institute students.
- Output ONLY a JSON array, no markdown fences, no commentary.

Samples (reference topics and style only):
${sampleBlock}`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  const text = response.text;
  if (!text) throw new Error('Empty AI response');
  const arr = parseGeminiJsonArray(text);
  const normalized: { text: string; options: string[]; correctAnswer: string }[] = [];
  for (let i = 0; i < count; i++) {
    const q = arr[i];
    if (!q || typeof q !== 'object') throw new Error(`AI returned fewer than ${count} valid questions`);
    const opts = Array.isArray(q.options) ? q.options.map((x: any) => String(x)).slice(0, 4) : [];
    while (opts.length < 4) opts.push(`Variant ${opts.length + 1}`);
    let correct = String(q.correctAnswer ?? opts[0]);
    if (!opts.includes(correct)) correct = opts[0];
    normalized.push({ text: String(q.text || `Savol ${i + 1}`), options: opts, correctAnswer: correct });
  }
  return normalized;
}

function buildStudentQuestionList(full: { id: number; text: string; options: string[]; correctAnswer: string }[]) {
  return full.map((q) => {
    const shuffledOptions = shuffleInPlace([...q.options]);
    return { id: q.id, text: q.text, options: shuffledOptions };
  });
}

function parseGeminiJsonObject(text: string): any {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  return JSON.parse(t);
}

function allocateResultPublicId(): string {
  const year = new Date().getFullYear();
  const tx = db.transaction(() => {
    const cur = db.prepare('SELECT next_num FROM result_id_sequence WHERE id = 1').get() as { next_num: number };
    const n = cur.next_num + 1;
    db.prepare('UPDATE result_id_sequence SET next_num = ? WHERE id = 1').run(n);
    return n;
  });
  const num = tx();
  return `FJSTI_${String(num).padStart(8, '0')}_${year}`;
}

function makeIntegrityCode(resultId: string, completedAt: string, score: number, total: number, secret: string): string {
  return crypto.createHmac('sha256', JWT_SECRET).update(`${resultId}|${completedAt}|${score}|${total}|${secret}`).digest('hex').slice(0, 24).toUpperCase();
}

function getPublicBaseUrl(req: any): string {
  const env = process.env.PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, '');
  const host = req.get('host') || `localhost:${PORT}`;
  const xf = req.headers['x-forwarded-proto'];
  const proto = typeof xf === 'string' ? xf.split(',')[0].trim() : req.protocol || 'http';
  return `${proto}://${host}`;
}

type AiSummaryShape = {
  overview: string;
  items: {
    questionId: number;
    isCorrect: boolean;
    commentCorrect: string;
    whyStudentWrong: string;
    whyCorrectIsRight: string;
  }[];
};

function buildFallbackAiSummary(
  questions: { id: number; text: string; correctAnswer: string }[],
  answers: Record<string, string>,
): AiSummaryShape {
  return {
    overview:
      "Quyida har bir savol bo‘yicha avtomatik tekshiruv natijalari ko‘rsatilgan. Batafsil tahlil uchun administratorga murojaat qiling.",
    items: questions.map((q) => {
      const st = answers[String(q.id)] ?? '';
      const ok = st === q.correctAnswer;
      return {
        questionId: q.id,
        isCorrect: ok,
        commentCorrect: ok ? "Javob to‘g‘ri tanlangan." : '',
        whyStudentWrong: ok ? '' : `Tanlangan javob (“${st || 'bo‘sh'}”) savolning to‘g‘ri yechimi bilan mos kelmaydi.`,
        whyCorrectIsRight: ok ? '' : `To‘g‘ri javob “${q.correctAnswer}” — savol mazmuniga mos yagona aniq variant.`,
      };
    }),
  };
}

async function generateExamAiSummary(
  questions: { id: number; text: string; options: string[]; correctAnswer: string }[],
  answers: Record<string, string>,
  language: string,
): Promise<AiSummaryShape> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return buildFallbackAiSummary(questions, answers);

  const payload = questions.map((q) => {
    const st = answers[String(q.id)] ?? '';
    return {
      questionId: q.id,
      text: q.text,
      options: q.options,
      correctAnswer: q.correctAnswer,
      studentAnswer: st || null,
      isCorrect: st === q.correctAnswer,
    };
  });

  const langName = language === 'uz' ? "O'zbek (lotin)" : language === 'ru' ? 'Rus' : 'Ingliz';
  const prompt = `Siz FJSTI (Farg'ona jamoat salomatligi tibbiyot instituti) uchun tibbiyot testlari bo'yicha ekspertsiz.

Savollar va talaba javoblari (mashina tekshiruvi bilan):
${JSON.stringify(payload)}

Til: ${langName}.

Faqat bitta JSON obyekt qaytaring (markdown yoki izoh yo'q), shakl:
{
  "overview": "2-4 jumlada umumiy xulosa",
  "items": [
    {
      "questionId": <raqam>,
      "isCorrect": true yoki false,
      "commentCorrect": "to'g'ri bo'lsa qisqa izoh; noto'g'ri bo'lsa bo'sh string",
      "whyStudentWrong": "noto'g'ri bo'lsa nima uchun talaba xato; to'g'ri bo'lsa bo'sh string",
      "whyCorrectIsRight": "noto'g'ri bo'lsa to'g'ri javob nima uchun to'g'ri; to'g'ri bo'lsa bo'sh string"
    }
  ]
}

Har bir savol uchun "items"da aynan bitta element bo'lsin (questionId mos kelishi shart).`;

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });
    const text = response.text;
    if (!text) return buildFallbackAiSummary(questions, answers);
    const parsed = parseGeminiJsonObject(text) as AiSummaryShape;
    if (!parsed || typeof parsed.overview !== 'string' || !Array.isArray(parsed.items)) {
      return buildFallbackAiSummary(questions, answers);
    }
    const byId = new Map(parsed.items.map((i) => [Number(i.questionId), i]));
    return {
      overview: parsed.overview,
      items: questions.map((q) => {
        const st = answers[String(q.id)] ?? '';
        const ok = st === q.correctAnswer;
        const aiPart = byId.get(q.id);
        return {
          questionId: q.id,
          isCorrect: ok,
          commentCorrect: ok ? (aiPart?.commentCorrect || "Javob to‘g‘ri.") : '',
          whyStudentWrong: ok ? '' : (aiPart?.whyStudentWrong || `Noto‘g‘ri javob tanlangan.`),
          whyCorrectIsRight: ok ? '' : (aiPart?.whyCorrectIsRight || `To‘g‘ri javob: ${q.correctAnswer}.`),
        };
      }),
    };
  } catch (e) {
    console.error('AI summary failed:', e);
    return buildFallbackAiSummary(questions, answers);
  }
}

function buildCertificateInputFromDb(args: {
  result_public_id: string;
  student_name: string;
  exam_title: string;
  completed_at: string;
  score: number;
  total: number;
  verifyUrl: string;
  integrityCode: string;
  ai: AiSummaryShape;
  questions: { id: number; text: string; correctAnswer: string }[];
  answers: Record<string, string>;
}): CertificateInput {
  const itemByQ = new Map(args.ai.items.map((i) => [i.questionId, i]));
  const rows = args.questions.map((q, idx) => {
    const st = args.answers[String(q.id)] ?? '';
    const ok = st === q.correctAnswer;
    const aiRow = itemByQ.get(q.id);
    return {
      index: idx + 1,
      text: q.text,
      isCorrect: ok,
      studentAnswer: st || '—',
      correctAnswer: q.correctAnswer,
      commentCorrect: aiRow?.commentCorrect || '',
      whyStudentWrong: aiRow?.whyStudentWrong || '',
      whyCorrectIsRight: aiRow?.whyCorrectIsRight || '',
    };
  });
  const logoPath = path.join(process.cwd(), 'public', 'institute-logo.png');
  return {
    resultId: args.result_public_id,
    studentName: args.student_name,
    examTitle: args.exam_title,
    completedAtIso: args.completed_at,
    score: args.score,
    total: args.total,
    verifyUrl: args.verifyUrl,
    integrityCode: args.integrityCode,
    overview: args.ai.overview,
    rows,
    logoPath: fs.existsSync(logoPath) ? logoPath : null,
  };
}

// Auth Middleware
const authenticate = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    // Verify user still exists and is active
    const user = db.prepare('SELECT status FROM users WHERE id = ?').get(decoded.id) as any;
    if (!user) return res.status(401).json({ error: 'Unauthorized: User not found' });
    if (user.status === 'Banned') return res.status(403).json({ error: 'Forbidden: Account is banned' });
    
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Async Handler Wrapper
const asyncHandler = (fn: any) => (req: any, res: any, next: any) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- API Routes ---

app.get('/api/health', (_req: any, res: any) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Login
app.post('/api/auth/login', loginLimiter, asyncHandler(async (req: any, res: any) => {
  const { id, password } = req.body;
  if (!id || !password) return res.status(400).json({ error: 'ID and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.status === 'Banned') {
    return res.status(403).json({ error: 'Your account is banned. Contact administrator.' });
  }
  if (user.role === 'teacher') {
    return res.status(403).json({ error: 'Teacher role is no longer supported. Use an admin or student account.' });
  }
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name, group_id: user.group_id }, JWT_SECRET, { expiresIn: '24h' });
  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      status: user.status,
      group_id: user.group_id,
      profile_image: user.profile_image || null,
    },
  });
}));

// Student: yuzni serverda Gemini bilan tekshirish (API kaliti klientga chiqmaydi)
app.post(
  '/api/student/identity-compare',
  faceVerifyLimiter,
  authenticate,
  asyncHandler(async (req: any, res: any) => {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Forbidden' });
    const { profile_image_base64, live_capture_base64 } = req.body || {};
    if (typeof profile_image_base64 !== 'string' || typeof live_capture_base64 !== 'string') {
      return res.status(400).json({ error: 'Invalid body' });
    }
    const strip = (s: string) => {
      const t = s.trim();
      return t.includes(',') ? t.split(',')[1].trim() : t;
    };
    const p = strip(profile_image_base64);
    const l = strip(live_capture_base64);
    const maxB64 = 14 * 1024 * 1024;
    if (p.length < 80 || l.length < 80 || p.length > maxB64 || l.length > maxB64) {
      return res.status(400).json({ error: 'Invalid image payload' });
    }
    const result = await compareFacePairWithGemini(p, l);
    if (result.success === false) {
      if (result.code === 'GEMINI_UNAVAILABLE') {
        return res.status(503).json({ error: 'Face verification is not configured on the server', code: result.code });
      }
      return res.status(503).json({ error: 'Verification service error', code: result.code });
    }
    res.json({ match: result.match });
  }),
);

// Admin: Get all users
app.get('/api/admin/users', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const users = db.prepare(`
    SELECT u.id, u.role, u.name, u.status, u.group_id, u.profile_image, g.name as group_name 
    FROM users u LEFT JOIN groups g ON u.group_id = g.id
  `).all();
  res.json(users);
}));

// Admin: Add user
app.post('/api/admin/users', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { id, password, role, name, group_id, profile_image } = req.body;
  if (!id || !password || !role || !name) return res.status(400).json({ error: 'Missing required fields' });
  if (role !== 'admin' && role !== 'student') {
    return res.status(400).json({ error: 'Role must be admin or student' });
  }
  if (role === 'student' && (!profile_image || String(profile_image).length < 50)) {
    return res.status(400).json({ error: 'Talaba uchun profil rasmi majburiy' });
  }

  try {
    const hashed = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (id, password, role, name, group_id, profile_image) VALUES (?, ?, ?, ?, ?, ?)').run(id, hashed, role, name, group_id || null, profile_image || null);
    res.json({ success: true });
  } catch (err: any) {
    if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      res.status(400).json({ error: 'User ID already exists' });
    } else {
      throw err;
    }
  }
}));

// Admin: Update user
app.patch('/api/admin/users/:id', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  if (!row) return res.status(404).json({ error: 'User not found' });

  const { name, role, group_id, status, password, profile_image } = req.body || {};
  const nextRole = role !== undefined ? role : row.role;
  const nextProfile = profile_image !== undefined ? profile_image : row.profile_image;

  if (role !== undefined && role !== 'admin' && role !== 'student') {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (row.role === 'admin' && nextRole === 'student') {
    const admins = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as any).c as number;
    if (admins <= 1) return res.status(400).json({ error: 'Cannot demote the last admin' });
  }
  if (nextRole === 'student' && (!nextProfile || String(nextProfile).length < 50)) {
    return res.status(400).json({ error: 'Student requires a profile photo' });
  }
  if (status !== undefined && status !== 'Active' && status !== 'Banned') {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const fields: string[] = [];
  const vals: any[] = [];
  if (name !== undefined) {
    fields.push('name = ?');
    vals.push(String(name));
  }
  if (role !== undefined) {
    fields.push('role = ?');
    vals.push(nextRole);
  }
  if (group_id !== undefined) {
    fields.push('group_id = ?');
    vals.push(group_id === '' || group_id == null ? null : group_id);
  }
  if (status !== undefined) {
    fields.push('status = ?');
    vals.push(status);
  }
  if (profile_image !== undefined) {
    fields.push('profile_image = ?');
    vals.push(profile_image || null);
  }
  if (password !== undefined && String(password).length > 0) {
    if (String(password).length < 6) return res.status(400).json({ error: 'Password min 6 characters' });
    fields.push('password = ?');
    vals.push(bcrypt.hashSync(String(password), 10));
  }
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  vals.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ success: true });
}));

// Admin: Delete user
app.delete('/api/admin/users/:id', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const id = req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  const row = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as any;
  if (!row) return res.status(404).json({ error: 'User not found' });
  if (row.role === 'admin') {
    const admins = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as any).c as number;
    if (admins <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true });
}));

// Admin: Unban user
app.post('/api/admin/users/:id/unban', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  
  const unbanTx = db.transaction(() => {
    db.prepare("UPDATE users SET status = 'Active' WHERE id = ?").run(req.params.id);
    db.prepare("UPDATE student_exams SET status = 'Pending' WHERE student_id = ? AND status = 'Banned'").run(req.params.id);
  });
  unbanTx();
  
  res.json({ success: true });
}));

// Admin: Allow Retake
app.post('/api/admin/student_exams/:id/retake', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  db.prepare("UPDATE student_exams SET status = 'Pending', answers_json = NULL, score = NULL WHERE id = ?").run(req.params.id);
  res.json({ success: true });
}));

// Admin: Get stats
app.get('/api/admin/stats', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
  const totalExams = db.prepare('SELECT COUNT(*) as count FROM exams').get() as any;
  const totalViolations = db.prepare('SELECT COUNT(*) as count FROM violations_log').get() as any;
  const bannedUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'Banned'").get() as any;
  res.json({ totalUsers: totalUsers.count, totalExams: totalExams.count, totalViolations: totalViolations.count, bannedUsers: bannedUsers.count });
}));

// Admin: Levels & Groups (faqat admin — aks holda talaba JWT bilan IDOR)
app.get('/api/admin/levels', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  res.json(db.prepare('SELECT * FROM levels').all());
}));

app.get('/api/admin/groups', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  res.json(db.prepare('SELECT g.*, l.name as level_name FROM groups g JOIN levels l ON g.level_id = l.id').all());
}));

app.post('/api/admin/groups', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { name, level_id } = req.body;
  if (!name || !level_id) return res.status(400).json({ error: 'Name and level_id are required' });
  db.prepare('INSERT INTO groups (name, level_id) VALUES (?, ?)').run(name, level_id);
  res.json({ success: true });
}));

app.patch('/api/admin/groups/:id', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { name, level_id } = req.body || {};
  const g = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Group not found' });
  if (level_id != null) {
    const lv = db.prepare('SELECT id FROM levels WHERE id = ?').get(level_id);
    if (!lv) return res.status(400).json({ error: 'Invalid level' });
  }
  if (name !== undefined && level_id !== undefined) {
    db.prepare('UPDATE groups SET name = ?, level_id = ? WHERE id = ?').run(name, level_id, req.params.id);
  } else if (name !== undefined) {
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, req.params.id);
  } else if (level_id !== undefined) {
    db.prepare('UPDATE groups SET level_id = ? WHERE id = ?').run(level_id, req.params.id);
  } else {
    return res.status(400).json({ error: 'No fields to update' });
  }
  res.json({ success: true });
}));

app.delete('/api/admin/groups/:id', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const r = db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Group not found' });
  res.json({ success: true });
}));

// --- Test bank (categories & questions) ---
app.get('/api/admin/test-bank/categories', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const rows = db.prepare('SELECT c.*, (SELECT COUNT(*) FROM test_bank_questions q WHERE q.category_id = c.id) as question_count FROM test_bank_categories c ORDER BY c.sort_order, c.name').all();
  res.json(rows);
}));

app.post('/api/admin/test-bank/categories', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { name, description, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const r = db.prepare('INSERT INTO test_bank_categories (name, description, sort_order) VALUES (?, ?, ?)').run(name, description || '', sort_order ?? 0);
  res.json({ id: r.lastInsertRowid });
}));

app.delete('/api/admin/test-bank/categories/:id', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM test_bank_categories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
}));

app.get('/api/admin/test-bank/questions', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const cid = req.query.category_id;
  if (cid) {
    res.json(db.prepare('SELECT * FROM test_bank_questions WHERE category_id = ? ORDER BY id DESC').all(Number(cid)));
  } else {
    res.json(db.prepare(`
      SELECT q.*, c.name as category_name FROM test_bank_questions q
      JOIN test_bank_categories c ON c.id = q.category_id ORDER BY q.id DESC LIMIT 500
    `).all());
  }
}));

app.post('/api/admin/test-bank/questions', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { category_id, questions, language } = req.body;
  if (!category_id || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'category_id and questions[] required' });
  }
  const cat = db.prepare('SELECT id FROM test_bank_categories WHERE id = ?').get(category_id);
  if (!cat) return res.status(400).json({ error: 'Invalid category' });
  const lang = language || 'uz';
  const ins = db.prepare('INSERT INTO test_bank_questions (category_id, text, options_json, correct_answer, language) VALUES (?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (const q of questions) {
      const opts = Array.isArray(q.options) ? q.options.map(String) : [];
      if (opts.length < 4) continue;
      const ca = String(q.correctAnswer || opts[0]);
      ins.run(category_id, String(q.text || ''), JSON.stringify(opts.slice(0, 4)), ca, lang);
    }
  });
  tx();
  res.json({ success: true, inserted: questions.length });
}));

// Admin: Get all exams (to monitor)
app.get('/api/admin/exams', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const exams = db.prepare(`
    SELECT e.*, u.name as teacher_name 
    FROM exams e JOIN users u ON e.teacher_id = u.id
  `).all();
  res.json(exams);
}));

app.get('/api/admin/exams/:id', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const exam = db
    .prepare(
      `SELECT e.*, u.name as teacher_name FROM exams e JOIN users u ON e.teacher_id = u.id WHERE e.id = ?`,
    )
    .get(req.params.id) as any;
  if (!exam) return res.status(404).json({ error: 'Exam not found' });
  const group_ids = (db.prepare('SELECT group_id FROM exam_groups WHERE exam_id = ?').all(req.params.id) as { group_id: number }[]).map(
    (r) => r.group_id,
  );
  let questions: any[] = [];
  try {
    questions = JSON.parse(exam.questions_json || '[]');
  } catch {
    questions = [];
  }
  let bank_category_ids: number[] = [];
  try {
    bank_category_ids = JSON.parse(exam.bank_category_ids || '[]');
  } catch {
    bank_category_ids = [];
  }
  res.json({ ...exam, group_ids, questions, bank_category_ids });
}));

app.patch('/api/admin/exams/:id', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(req.params.id) as any;
  if (!exam) return res.status(404).json({ error: 'Exam not found' });

  const {
    title,
    start_time,
    end_time,
    duration_minutes,
    language,
    pin,
    custom_rules,
    group_ids,
    questions,
    bank_category_ids,
    bank_question_count,
  } = req.body || {};

  let questions_json = exam.questions_json;
  let bankCatsJson = exam.bank_category_ids || '[]';
  let bankCount = Number(exam.bank_question_count) || 0;
  const lang = language !== undefined ? language : exam.language || 'uz';

  if (exam.exam_mode === 'static' && questions != null) {
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'questions must be a non-empty array' });
    }
    const normalized = questions.map((q: any, i: number) => {
      const opts = Array.isArray(q.options) ? q.options.map((x: any) => String(x)).slice(0, 4) : [];
      while (opts.length < 4) opts.push(`Variant ${opts.length + 1}`);
      let correct = String(q.correctAnswer ?? opts[0]);
      if (!opts.includes(correct)) correct = opts[0];
      return { id: i + 1, text: String(q.text || `Savol ${i + 1}`), options: opts, correctAnswer: correct };
    });
    questions_json = JSON.stringify(normalized);
  }

  if (exam.exam_mode === 'bank_mixed' && (bank_category_ids != null || bank_question_count != null)) {
    let catIds: number[] = [];
    try {
      catIds =
        bank_category_ids != null ? bank_category_ids : (JSON.parse(exam.bank_category_ids || '[]') as number[]);
    } catch {
      return res.status(400).json({ error: 'Invalid bank_category_ids' });
    }
    if (!Array.isArray(catIds) || catIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one test bank category' });
    }
    const n = Math.max(
      8,
      Math.min(200, parseInt(String(bank_question_count ?? exam.bank_question_count ?? 20), 10) || 20),
    );
    const needBank = Math.floor(n * 0.75);
    const placeholders = catIds.map(() => '?').join(',');
    const poolLen = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM test_bank_questions WHERE category_id IN (${placeholders}) AND language = ?`,
        )
        .get(...catIds, lang) as any
    ).c as number;
    if (poolLen < needBank) {
      return res.status(400).json({
        error: `Test bazasida yetarli savol yo'q (${poolLen}/${needBank}, til: ${lang})`,
      });
    }
    bankCatsJson = JSON.stringify(catIds);
    bankCount = n;
  }

  const titleF = title !== undefined ? title : exam.title;
  const startF = start_time !== undefined ? start_time : exam.start_time;
  const endF = end_time !== undefined ? end_time : exam.end_time;
  const durF = duration_minutes !== undefined ? Number(duration_minutes) : exam.duration_minutes;
  const pinF = pin !== undefined ? pin : exam.pin;
  const rulesF = custom_rules !== undefined ? custom_rules : exam.custom_rules || '';

  if (!titleF || !startF || !endF || !durF) return res.status(400).json({ error: 'Missing required exam fields' });

  try {
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE exams SET title = ?, start_time = ?, end_time = ?, duration_minutes = ?, questions_json = ?, language = ?, pin = ?, custom_rules = ?, bank_category_ids = ?, bank_question_count = ? WHERE id = ?`,
      ).run(titleF, startF, endF, durF, questions_json, lang, pinF ?? '', rulesF, bankCatsJson, bankCount, req.params.id);
      if (group_ids != null) {
        if (!Array.isArray(group_ids) || group_ids.length === 0) {
          throw new Error('GROUP_IDS');
        }
        db.prepare('DELETE FROM exam_groups WHERE exam_id = ?').run(req.params.id);
        const ins = db.prepare('INSERT INTO exam_groups (exam_id, group_id) VALUES (?, ?)');
        for (const gid of group_ids) ins.run(req.params.id, gid);
      }
    });
    tx();
  } catch (e: any) {
    if (e?.message === 'GROUP_IDS') {
      return res.status(400).json({ error: 'Select at least one group' });
    }
    throw e;
  }
  res.json({ success: true });
}));

app.delete('/api/admin/exams/:id', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const r = db.prepare('DELETE FROM exams WHERE id = ?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Exam not found' });
  res.json({ success: true });
}));

try {
  fs.mkdirSync(path.join(process.cwd(), 'uploads'), { recursive: true });
} catch {
  /* ignore */
}

const upload = multer({
  dest: path.join(process.cwd(), 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const name = file.originalname || '';
    const ok =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/x-pdf' ||
      /\.pdf$/i.test(name);
    if (!ok) return cb(new Error('Only PDF files are allowed'));
    cb(null, true);
  },
});

// Admin: Exam results (full detail)
app.get('/api/admin/exams/:id/results', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const exam = db.prepare('SELECT questions_json, exam_mode FROM exams WHERE id = ?').get(req.params.id) as any;
  if (!exam) return res.status(404).json({ error: 'Exam not found' });

  const results = db.prepare(`
    SELECT se.id, se.student_id, u.name, se.status, se.score, se.started_at, se.completed_at, se.answers_json, se.flagged_questions_json, se.session_questions_json
    FROM student_exams se
    JOIN users u ON se.student_id = u.id
    WHERE se.exam_id = ?
  `).all(req.params.id);

  const violations = db.prepare(`
    SELECT student_id, violation_type, timestamp 
    FROM violations_log 
    WHERE exam_id = ?
  `).all(req.params.id);

  const enriched = (results as any[]).map((r) => ({
    ...r,
    questions_json: r.session_questions_json || exam.questions_json,
  }));

  res.json({ results: enriched, violations, questions_json: exam.questions_json, exam_mode: exam.exam_mode });
}));

// Admin: Create exam (PDF, manual, or test-bank mixed 75/25)
app.post('/api/admin/exams', authenticate, upload.single('pdf'), asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'admin') {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Forbidden' });
  }

  const {
    title,
    start_time,
    end_time,
    duration_minutes,
    language,
    group_ids,
    manual_questions,
    pin,
    custom_rules,
    exam_mode,
    bank_category_ids,
    bank_question_count,
  } = req.body;

  if (!title || !start_time || !end_time || !duration_minutes) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Missing required exam fields' });
  }

  const lang = language || 'uz';
  let questions: any[] = [];
  let mode = exam_mode === 'bank_mixed' ? 'bank_mixed' : 'static';
  let bankCatsJson = '[]';
  let bankCount = 0;

  if (mode === 'bank_mixed') {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    let catIds: number[] = [];
    try {
      catIds = JSON.parse(bank_category_ids || '[]');
    } catch {
      return res.status(400).json({ error: 'Invalid bank_category_ids' });
    }
    if (!Array.isArray(catIds) || catIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one test bank category' });
    }
    const n = Math.max(8, Math.min(200, parseInt(String(bank_question_count || 20), 10) || 20));
    const needBank = Math.floor(n * 0.75);
    const placeholders = catIds.map(() => '?').join(',');
    const pool = db.prepare(
      `SELECT * FROM test_bank_questions WHERE category_id IN (${placeholders}) AND language = ?`,
    ).all(...catIds, lang) as any[];
    if (pool.length < needBank) {
      return res.status(400).json({
        error: `Test bazasida yetarli savol yo'q (${pool.length}/${needBank} kerak, til: ${lang}). Kategoriyalarga savol qo'shing yoki sonni kamaytiring.`,
      });
    }
    bankCatsJson = JSON.stringify(catIds);
    bankCount = n;
    questions = [];
  } else if (req.file) {
    try {
      const dataBuffer = fs.readFileSync(req.file.path);
      const data = await pdfParse(dataBuffer);
      const text = data.text;
      const qBlocks = text.split(/(?=\d+\.)/g).filter((b: string) => b.trim().length > 0);

      questions = qBlocks.map((block: string, index: number) => {
        const lines = block.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
        const qText = lines[0].replace(/^\d+\.\s*/, '');
        const options = lines.slice(1).filter((l: string) => /^[A-D]\)/.test(l)).map((l: string) => l.replace(/^[A-D]\)\s*/, ''));
        const finalOptions = options.length === 4 ? options : ['Correct Option A', 'Option B', 'Option C', 'Option D'];
        return { id: index + 1, text: qText || `Question ${index + 1}`, options: finalOptions, correctAnswer: finalOptions[0] };
      });
    } catch (err) {
      return res.status(400).json({ error: 'Failed to parse PDF' });
    } finally {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
  } else if (manual_questions) {
    try {
      questions = JSON.parse(manual_questions);
      if (!Array.isArray(questions) || questions.length === 0) throw new Error();
    } catch (err) {
      return res.status(400).json({ error: 'Invalid manual questions format' });
    }
  } else {
    return res.status(400).json({ error: 'No questions provided' });
  }

  const insertExamTx = db.transaction(() => {
    const result = db.prepare(
      `INSERT INTO exams (teacher_id, title, start_time, end_time, duration_minutes, questions_json, language, pin, custom_rules, exam_mode, bank_category_ids, bank_question_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      req.user.id,
      title,
      start_time,
      end_time,
      duration_minutes,
      JSON.stringify(questions),
      lang,
      pin || '',
      custom_rules || '',
      mode,
      bankCatsJson,
      bankCount,
    );

    const examId = result.lastInsertRowid;
    if (group_ids) {
      const gids = JSON.parse(group_ids);
      if (Array.isArray(gids)) {
        const insertGroup = db.prepare('INSERT INTO exam_groups (exam_id, group_id) VALUES (?, ?)');
        gids.forEach((gid: number) => insertGroup.run(examId, gid));
      }
    }
    return examId;
  });

  const examId = insertExamTx();
  res.json({ id: examId });
}));

// Student: Get available exams
app.get('/api/student/exams', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Forbidden' });
  if (!req.user.group_id) return res.json([]); // No group assigned
  
  const exams = db.prepare(`
    SELECT e.id, e.title, e.start_time, e.end_time, e.duration_minutes, e.language, e.pin, e.custom_rules, e.exam_mode, e.bank_question_count
    FROM exams e
    JOIN exam_groups eg ON e.id = eg.exam_id
    LEFT JOIN student_exams se ON e.id = se.exam_id AND se.student_id = ?
    WHERE eg.group_id = ? AND (se.id IS NULL OR se.status = 'In Progress')
  `).all(req.user.id, req.user.group_id).map((e: any) => ({
    ...e,
    has_pin: !!e.pin,
    pin: undefined // Hide actual pin
  }));
  res.json(exams);
}));

// Student: Start exam
app.post('/api/student/exams/:id/start', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Forbidden' });
  const examId = req.params.id;
  const { pin } = req.body;
  
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as any;
  if (!exam) return res.status(404).json({ error: 'Exam not found' });

  if (exam.pin && exam.pin !== pin) {
    return res.status(403).json({ error: 'Invalid PIN' });
  }

  // Verify exam is assigned to student's group
  const isAssigned = db.prepare('SELECT 1 FROM exam_groups WHERE exam_id = ? AND group_id = ?').get(examId, req.user.group_id);
  if (!isAssigned) return res.status(403).json({ error: 'Exam not assigned to your group' });

  const now = new Date();
  const startTime = new Date(exam.start_time);
  const endTime = new Date(exam.end_time);

  if (now < startTime) {
    return res.status(403).json({ error: 'Exam has not started yet' });
  }
  if (now > endTime) {
    return res.status(403).json({ error: 'Exam has already ended' });
  }

  const profileUser = db.prepare('SELECT profile_image FROM users WHERE id = ?').get(req.user.id) as any;
  if (!profileUser?.profile_image || String(profileUser.profile_image).length < 50) {
    return res.status(403).json({ error: 'Profil rasmsiz imtihon boshlash mumkin emas. Administratorga murojaat qiling.' });
  }

  let studentExam = db.prepare('SELECT * FROM student_exams WHERE student_id = ? AND exam_id = ?').get(req.user.id, examId) as any;

  if (!studentExam) {
    const startedAt = new Date().toISOString();
    const result = db.prepare("INSERT INTO student_exams (student_id, exam_id, status, started_at) VALUES (?, ?, 'In Progress', ?)").run(req.user.id, examId, startedAt);
    studentExam = { id: result.lastInsertRowid, status: 'In Progress', started_at: startedAt };
  } else if (studentExam.status === 'Banned' || studentExam.status === 'Completed') {
    return res.status(403).json({ error: `Exam already ${studentExam.status}` });
  }

  let fullQuestions: { id: number; text: string; options: string[]; correctAnswer: string }[];

  if (exam.exam_mode === 'bank_mixed') {
    if (studentExam.session_questions_json) {
      fullQuestions = JSON.parse(studentExam.session_questions_json);
    } else {
      const n = Math.max(8, exam.bank_question_count || 20);
      const nBank = Math.floor(n * 0.75);
      const nAi = n - nBank;
      let catIds: number[] = [];
      try {
        catIds = JSON.parse(exam.bank_category_ids || '[]');
      } catch {
        return res.status(500).json({ error: 'Invalid exam bank configuration' });
      }
      const placeholders = catIds.map(() => '?').join(',');
      const pool = db.prepare(
        `SELECT * FROM test_bank_questions WHERE category_id IN (${placeholders}) AND language = ?`,
      ).all(...catIds, exam.language || 'uz') as any[];
      if (pool.length < nBank) {
        return res.status(400).json({ error: 'Test bazasida hozircha yetarli savol yo‘q. Administratorga murojaat qiling.' });
      }
      shuffleInPlace(pool);
      const picked = pool.slice(0, nBank).map((row: any, i: number) => {
        const opts = JSON.parse(row.options_json) as string[];
        return {
          id: i + 1,
          text: row.text,
          options: opts.slice(0, 4),
          correctAnswer: row.correct_answer,
        };
      });
      const catNames = db.prepare(`SELECT name FROM test_bank_categories WHERE id IN (${placeholders})`).all(...catIds) as { name: string }[];
      const samples = picked.map((q) => ({ text: q.text, options: q.options, correctAnswer: q.correctAnswer }));
      let aiPart: { text: string; options: string[]; correctAnswer: string }[] = [];
      try {
        aiPart = await generateBankExtensionQuestions(samples, nAi, exam.language || 'uz', catNames.map((c) => c.name));
      } catch (e: any) {
        console.error('AI generation failed:', e);
        return res.status(503).json({
          error: e?.message?.includes('GEMINI') ? 'AI xizmati sozlanmagan (GEMINI_API_KEY). Administratorga murojaat qiling.' : 'Yangi savollarni yaratishda xatolik. Keyinroq urinib ko‘ring.',
        });
      }
      const nextIdStart = picked.length + 1;
      const aiWithIds = aiPart.map((q, j) => ({ id: nextIdStart + j, ...q }));
      fullQuestions = shuffleInPlace([...picked, ...aiWithIds]).map((q, idx) => ({ ...q, id: idx + 1 }));
      db.prepare('UPDATE student_exams SET session_questions_json = ? WHERE id = ?').run(JSON.stringify(fullQuestions), studentExam.id);
    }
  } else {
    fullQuestions = JSON.parse(exam.questions_json);
  }

  const shuffledQuestions = buildStudentQuestionList(fullQuestions);

  const examOut = { ...exam, questions: shuffledQuestions };
  delete (examOut as any).questions_json;
  delete (examOut as any).bank_category_ids;

  res.json({
    exam: examOut,
    studentExamId: studentExam.id,
    startedAt: studentExam.started_at,
  });
}));

// Student: Submit exam
app.post('/api/student/exams/:id/submit', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Forbidden' });
  const { answers, flaggedQuestions } = req.body;
  const examId = req.params.id;

  if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'Invalid answers format' });

  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as any;
  if (!exam) return res.status(404).json({ error: 'Exam not found' });

  const studentExam = db.prepare('SELECT * FROM student_exams WHERE student_id = ? AND exam_id = ?').get(req.user.id, examId) as any;
  if (!studentExam || studentExam.status === 'Completed' || studentExam.status === 'Banned') {
    return res.status(403).json({ error: 'Cannot submit exam' });
  }

  let questions: any[];
  if (studentExam.session_questions_json) {
    questions = JSON.parse(studentExam.session_questions_json);
  } else {
    questions = JSON.parse(exam.questions_json);
  }

  const normAnswers: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers as Record<string, unknown>)) {
    normAnswers[String(k)] = String(v ?? '');
  }

  let score = 0;
  questions.forEach((q: any) => {
    if (normAnswers[String(q.id)] === q.correctAnswer) {
      score += 1;
    }
  });

  const flaggedJson = flaggedQuestions ? JSON.stringify(flaggedQuestions) : '[]';
  const completedAt = new Date().toISOString();
  const resultPublicId = allocateResultPublicId();
  const verifySecret = crypto.randomBytes(32).toString('hex');
  const total = questions.length;
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

  const aiSummary = await generateExamAiSummary(questions, normAnswers, exam.language || 'uz');
  const aiSummaryJson = JSON.stringify(aiSummary);

  db.prepare(
    `UPDATE student_exams SET status = 'Completed', score = ?, answers_json = ?, flagged_questions_json = ?, completed_at = ?,
     result_public_id = ?, result_verify_secret = ?, ai_summary_json = ?
     WHERE student_id = ? AND exam_id = ?`,
  ).run(
    score,
    JSON.stringify(normAnswers),
    flaggedJson,
    completedAt,
    resultPublicId,
    verifySecret,
    aiSummaryJson,
    req.user.id,
    examId,
  );

  const integrityCode = makeIntegrityCode(resultPublicId, completedAt, score, total, verifySecret);
  const base = getPublicBaseUrl(req);
  const verifyUrl = `${base}/verify/result/${encodeURIComponent(resultPublicId)}?k=${encodeURIComponent(verifySecret)}`;

  const perQuestion = questions.map((q: any) => {
    const st = normAnswers[String(q.id)] ?? '';
    const ok = st === q.correctAnswer;
    const aiRow = aiSummary.items.find((i) => i.questionId === q.id);
    return {
      id: q.id,
      text: q.text,
      options: q.options,
      studentAnswer: st || null,
      correctAnswer: q.correctAnswer,
      isCorrect: ok,
      commentCorrect: ok ? (aiRow?.commentCorrect || '') : '',
      whyStudentWrong: ok ? '' : (aiRow?.whyStudentWrong || ''),
      whyCorrectIsRight: ok ? '' : (aiRow?.whyCorrectIsRight || ''),
    };
  });

  res.json({
    success: true,
    score,
    total,
    percentage,
    exam_id: Number(examId),
    result_public_id: resultPublicId,
    verify_secret: verifySecret,
    verify_url: verifyUrl,
    integrity_code: integrityCode,
    completed_at: completedAt,
    overview: aiSummary.overview,
    questions: perQuestion,
  });
}));

// Student: past results list
app.get('/api/student/results', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Forbidden' });
  const rows = db
    .prepare(
      `SELECT se.id, se.exam_id, se.status, se.score, se.completed_at, se.result_public_id, se.session_questions_json, e.title, e.questions_json
       FROM student_exams se
       JOIN exams e ON e.id = se.exam_id
       WHERE se.student_id = ? AND (se.status = 'Completed' OR se.status = 'Banned')
       ORDER BY datetime(se.completed_at) DESC`,
    )
    .all(req.user.id) as any[];

  const out = rows.map((r) => {
    let total = 0;
    try {
      if (r.session_questions_json) total = JSON.parse(r.session_questions_json).length;
      else total = JSON.parse(r.questions_json || '[]').length;
    } catch {
      total = 0;
    }
    const pct = total > 0 && r.score != null ? Math.round((r.score / total) * 100) : null;
    return {
      id: r.id,
      exam_id: r.exam_id,
      title: r.title,
      status: r.status,
      score: r.score,
      total_questions: total,
      percentage: pct,
      completed_at: r.completed_at,
      result_public_id: r.result_public_id,
    };
  });
  res.json(out);
}));

// Student: re-open certificate data (owner only)
app.get('/api/student/exams/:examId/result-details', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Forbidden' });
  const examId = req.params.examId;
  const row = db
    .prepare(
      `SELECT se.*, e.title as exam_title, e.language, e.questions_json, u.name as student_name
       FROM student_exams se
       JOIN exams e ON e.id = se.exam_id
       JOIN users u ON u.id = se.student_id
       WHERE se.student_id = ? AND se.exam_id = ?`,
    )
    .get(req.user.id, examId) as any;
  if (!row || row.status !== 'Completed') return res.status(404).json({ error: 'Result not found' });
  if (!row.result_public_id || !row.result_verify_secret) {
    return res.status(404).json({ error: 'Certificate not available for this attempt' });
  }

  let questions: any[];
  if (row.session_questions_json) questions = JSON.parse(row.session_questions_json);
  else questions = JSON.parse(row.questions_json);

  const answers = JSON.parse(row.answers_json || '{}') as Record<string, string>;
  const ai = JSON.parse(row.ai_summary_json || '{}') as AiSummaryShape;
  if (!ai.items) {
    return res.status(500).json({ error: 'Corrupt summary' });
  }
  const total = questions.length;
  const integrityCode = makeIntegrityCode(row.result_public_id, row.completed_at, row.score, total, row.result_verify_secret);
  const base = getPublicBaseUrl(req);
  const verifyUrl = `${base}/verify/result/${encodeURIComponent(row.result_public_id)}?k=${encodeURIComponent(row.result_verify_secret)}`;

  const perQuestion = questions.map((q: any) => {
    const st = answers[String(q.id)] ?? '';
    const ok = st === q.correctAnswer;
    const aiRow = ai.items.find((i) => i.questionId === q.id);
    return {
      id: q.id,
      text: q.text,
      options: q.options,
      studentAnswer: st || null,
      correctAnswer: q.correctAnswer,
      isCorrect: ok,
      commentCorrect: ok ? (aiRow?.commentCorrect || '') : '',
      whyStudentWrong: ok ? '' : (aiRow?.whyStudentWrong || ''),
      whyCorrectIsRight: ok ? '' : (aiRow?.whyCorrectIsRight || ''),
    };
  });

  res.json({
    result_public_id: row.result_public_id,
    verify_secret: row.result_verify_secret,
    verify_url: verifyUrl,
    integrity_code: integrityCode,
    overview: ai.overview,
    score: row.score,
    total,
    percentage: total > 0 ? Math.round((row.score / total) * 100) : 0,
    completed_at: row.completed_at,
    exam_title: row.exam_title,
    student_name: row.student_name,
    questions: perQuestion,
  });
}));

// Student: download PDF certificate
app.get('/api/student/exams/:examId/certificate.pdf', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Forbidden' });
  const examId = req.params.examId;
  const row = db
    .prepare(
      `SELECT se.*, e.title as exam_title, e.questions_json, u.name as student_name
       FROM student_exams se
       JOIN exams e ON e.id = se.exam_id
       JOIN users u ON u.id = se.student_id
       WHERE se.student_id = ? AND se.exam_id = ?`,
    )
    .get(req.user.id, examId) as any;
  if (!row || row.status !== 'Completed' || !row.result_public_id || !row.result_verify_secret) {
    return res.status(404).send('Not found');
  }
  let questions: any[];
  if (row.session_questions_json) questions = JSON.parse(row.session_questions_json);
  else questions = JSON.parse(row.questions_json);
  const answers = JSON.parse(row.answers_json || '{}') as Record<string, string>;
  const ai = JSON.parse(row.ai_summary_json || '{}') as AiSummaryShape;
  const total = questions.length;
  const integrityCode = makeIntegrityCode(row.result_public_id, row.completed_at, row.score, total, row.result_verify_secret);
  const base = getPublicBaseUrl(req);
  const verifyUrl = `${base}/verify/result/${encodeURIComponent(row.result_public_id)}?k=${encodeURIComponent(row.result_verify_secret)}`;
  const certIn = buildCertificateInputFromDb({
    result_public_id: row.result_public_id,
    student_name: row.student_name,
    exam_title: row.exam_title,
    completed_at: row.completed_at,
    score: row.score,
    total,
    verifyUrl,
    integrityCode,
    ai: ai.items ? ai : buildFallbackAiSummary(questions, answers),
    questions,
    answers,
  });
  const pdfBuf = await buildResultCertificatePdf(certIn);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${row.result_public_id}.pdf"`);
  res.send(pdfBuf);
}));

// Public: verify result (QR / link)
app.get('/api/public/verify-result/:resultId', publicVerifyLimiter, asyncHandler(async (req: any, res: any) => {
  const resultId = decodeURIComponent(req.params.resultId);
  if (!assertSafeResultPublicId(resultId)) {
    return res.status(400).json({ error: 'Invalid result id' });
  }
  const k = typeof req.query.k === 'string' ? req.query.k : '';
  if (!k || k.length < 32 || k.length > 256) return res.status(400).json({ error: 'Missing or invalid verification key' });

  const row = db
    .prepare(
      `SELECT se.*, e.title as exam_title, e.questions_json, u.name as student_name
       FROM student_exams se
       JOIN exams e ON e.id = se.exam_id
       JOIN users u ON u.id = se.student_id
       WHERE se.result_public_id = ? AND se.result_verify_secret = ? AND se.status = 'Completed'`,
    )
    .get(resultId, k) as any;
  if (!row) return res.status(404).json({ error: 'Not found or invalid link' });

  let questions: any[];
  if (row.session_questions_json) questions = JSON.parse(row.session_questions_json);
  else questions = JSON.parse(row.questions_json);
  const answers = JSON.parse(row.answers_json || '{}') as Record<string, string>;
  const ai = JSON.parse(row.ai_summary_json || '{}') as AiSummaryShape;
  const total = questions.length;
  const integrityCode = makeIntegrityCode(row.result_public_id, row.completed_at, row.score, total, row.result_verify_secret);

  const perQuestion = questions.map((q: any) => {
    const st = answers[String(q.id)] ?? '';
    const ok = st === q.correctAnswer;
    const aiRow = ai.items?.find((i) => i.questionId === q.id);
    return {
      id: q.id,
      text: q.text,
      options: q.options,
      studentAnswer: st || null,
      correctAnswer: q.correctAnswer,
      isCorrect: ok,
      commentCorrect: ok ? (aiRow?.commentCorrect || '') : '',
      whyStudentWrong: ok ? '' : (aiRow?.whyStudentWrong || ''),
      whyCorrectIsRight: ok ? '' : (aiRow?.whyCorrectIsRight || ''),
    };
  });

  res.json({
    result_public_id: row.result_public_id,
    integrity_code: integrityCode,
    overview: ai.overview || '',
    score: row.score,
    total,
    percentage: total > 0 ? Math.round((row.score / total) * 100) : 0,
    completed_at: row.completed_at,
    exam_title: row.exam_title,
    student_name: row.student_name,
    questions: perQuestion,
    pdf_url: `/api/public/verify-result/${encodeURIComponent(resultId)}/certificate.pdf?k=${encodeURIComponent(k)}`,
  });
}));

app.get('/api/public/verify-result/:resultId/certificate.pdf', publicVerifyLimiter, asyncHandler(async (req: any, res: any) => {
  const resultId = decodeURIComponent(req.params.resultId);
  if (!assertSafeResultPublicId(resultId)) {
    return res.status(400).send('Invalid id');
  }
  const k = typeof req.query.k === 'string' ? req.query.k : '';
  if (!k || k.length < 32 || k.length > 256) return res.status(400).send('Missing key');

  const row = db
    .prepare(
      `SELECT se.*, e.title as exam_title, e.questions_json, u.name as student_name
       FROM student_exams se
       JOIN exams e ON e.id = se.exam_id
       JOIN users u ON u.id = se.student_id
       WHERE se.result_public_id = ? AND se.result_verify_secret = ? AND se.status = 'Completed'`,
    )
    .get(resultId, k) as any;
  if (!row) return res.status(404).send('Not found');

  let questions: any[];
  if (row.session_questions_json) questions = JSON.parse(row.session_questions_json);
  else questions = JSON.parse(row.questions_json);
  const answers = JSON.parse(row.answers_json || '{}') as Record<string, string>;
  const ai = JSON.parse(row.ai_summary_json || '{}') as AiSummaryShape;
  const total = questions.length;
  const base = getPublicBaseUrl(req);
  const verifyUrl = `${base}/verify/result/${encodeURIComponent(row.result_public_id)}?k=${encodeURIComponent(k)}`;
  const integrityCode = makeIntegrityCode(row.result_public_id, row.completed_at, row.score, total, row.result_verify_secret);
  const certIn = buildCertificateInputFromDb({
    result_public_id: row.result_public_id,
    student_name: row.student_name,
    exam_title: row.exam_title,
    completed_at: row.completed_at,
    score: row.score,
    total,
    verifyUrl,
    integrityCode,
    ai: ai.items ? ai : buildFallbackAiSummary(questions, answers),
    questions,
    answers,
  });
  const pdfBuf = await buildResultCertificatePdf(certIn);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${row.result_public_id}.pdf"`);
  res.send(pdfBuf);
}));

// Student: Log violation
app.post('/api/student/violations', authenticate, asyncHandler(async (req: any, res: any) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Forbidden' });
  const { exam_id, violation_type, screenshot_url } = req.body;
  
  if (!exam_id || !violation_type) return res.status(400).json({ error: 'Missing required fields' });

  const exam = db.prepare('SELECT id FROM exams WHERE id = ?').get(exam_id);
  if (!exam) return res.status(404).json({ error: 'Exam not found' });

  db.prepare('INSERT INTO violations_log (student_id, exam_id, violation_type, timestamp, screenshot_url) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, exam_id, violation_type, new Date().toISOString(), screenshot_url || ''
  );

  const count = db.prepare('SELECT COUNT(*) as cnt FROM violations_log WHERE student_id = ? AND exam_id = ?').get(req.user.id, exam_id) as any;

  const immediateBan = violation_type === 'IDENTITY_SUBSTITUTION';

  if (immediateBan) {
    const banTx = db.transaction(() => {
      db.prepare("UPDATE users SET status = 'Banned' WHERE id = ?").run(req.user.id);
      db.prepare("UPDATE student_exams SET status = 'Banned' WHERE student_id = ? AND exam_id = ?").run(req.user.id, exam_id);
    });
    banTx();
    return res.json({ banned: true, violationsCount: count.cnt });
  }

  if (count.cnt >= 3) {
    const banTx = db.transaction(() => {
      db.prepare("UPDATE users SET status = 'Banned' WHERE id = ?").run(req.user.id);
      db.prepare("UPDATE student_exams SET status = 'Banned' WHERE student_id = ? AND exam_id = ?").run(req.user.id, exam_id);
    });
    banTx();
    return res.json({ banned: true, violationsCount: count.cnt });
  }

  res.json({ banned: false, violationsCount: count.cnt });
}));

// Global Error Handler
app.use((err: any, req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err && err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled Error:', err);
  res.status(500).json({ error: 'Internal Server Error', details: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

async function startServer() {
  const server = http.createServer(app);

  // Vite HMR WebSocket avval ro‘yxatdan o‘tadi — aks holda Socket.IO bilan ziddiyat bo‘lishi mumkin
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      configFile: path.join(process.cwd(), 'vite.config.ts'),
      server: {
        middlewareMode: true,
        hmr: {
          server,
          path: '/__vite_hmr',
          clientPort: PORT,
        },
      },
      appType: 'spa',
    });
    // Vite SPA fallback ba'zan /api ga ham index.html berardi — /api uchun Vite chaqirilmasin
    app.use((req, res, next) => {
      const p = req.path || '';
      if (p === '/api' || p.startsWith('/api/')) return next();
      return vite.middlewares(req, res, next);
    });
    app.use((req, res, next) => {
      const p = req.path || '';
      if ((p === '/api' || p.startsWith('/api/')) && !res.headersSent) {
        return res.status(404).json({ error: 'API route not found' });
      }
      next();
    });
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  const io = new SocketIOServer(server, {
    path: '/socket.io',
    cors: {
      origin: process.env.SOCKET_IO_CORS_ORIGIN
        ? process.env.SOCKET_IO_CORS_ORIGIN.split(',').map((s) => s.trim())
        : '*',
      methods: ['GET', 'POST'],
    },
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

    socket.on('disconnect', () => {
      // Handle disconnect if needed
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} (${isProduction ? 'production' : 'development'})`);
    if (isProduction && !process.env.SOCKET_IO_CORS_ORIGIN) {
      console.warn(
        '[security] SOCKET_IO_CORS_ORIGIN o‘rnatilmagan — Socket.IO CORS * (faqat ichki tarmoq yoki reverse-proxy bilan cheklang).',
      );
    }
  });
}

export { app, db, startServer };

if (process.env.SKIP_SERVER_LISTEN !== '1') {
  startServer();
}
