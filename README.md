# FJSTI Online Exam

Masofaviy imtihon platformasi: **Django REST API**, **React (Vite) SPA**, **Socket.IO** real-time (proctoring signal). Batafsil funksional talablar: [`docs/TEXNIK_TALABLAR.md`](docs/TEXNIK_TALABLAR.md).

## Talablar

- **Node.js** ≥ 20 (frontend + realtime)
- **Python** ≥ 3.12 (backend)
- **npm** (ildiz va `frontend/`)

## Mahalliy ishga tushirish

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate   # Linux/macOS
pip install -r requirements.txt
cp .env.example .env        # qiymatlarni to‘ldiring (JWT_SECRET, DJANGO_SECRET_KEY)
python manage.py migrate
python manage.py bootstrap_exam   # DEBUG=1 da admin: fjstiadmin / fjsti123 (yoki .env)
python manage.py seed_demo_users  # ixtiyoriy demo hisoblar (bitta parol)
python manage.py reset_single_admin --yes  # hammasini o‘chirib faqat admin / fjsti123 (ID: admin)
python manage.py runserver
```

API: `http://127.0.0.1:8000/api/health`

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Brauzer: `http://127.0.0.1:5173` (Vite odatda `vite.config.ts` orqali `/api` ni backend ga proxylaydi).

### 3. Realtime (ixtiyoriy, imtihon xonasi WebRTC)

Repo ildizidan:

```bash
npm install
npm run dev:realtime
```

`JWT_SECRET` backend `.env` bilan bir xil bo‘lishi kerak (min 24 belgi).

## Muhit o‘zgaruvchilari (qisqacha)

| O‘zgaruvchi | Tavsif |
|-------------|--------|
| `DJANGO_SECRET_KEY` | Prod: kamida ~40 belgi |
| `DJANGO_DEBUG` | `0` production |
| `JWT_SECRET` | HS256, realtime bilan bir xil |
| `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` | Frontend HTTPS URL lar |
| `ADMIN_BOOTSTRAP_PASSWORD` | **Prod (`DEBUG=0`):** majburiy, ≥12 belgi. Dev: ixtiyoriy |
| `GEMINI_API_KEY` | Yuz solishtirish, smart import, AI savollar |
| `DATABASE_URL` | Production: PostgreSQL ulanish qatori (`postgres://...`). Bo‘sh bo‘lsa SQLite (faqat dev) |
| `DB_CONN_MAX_AGE`, `DATABASE_SSL_REQUIRE` | PostgreSQL pool va SSL |
| `APP_BUILD_REF` / `GIT_COMMIT` | `/api/health` va realtime health da build/reviziya |
| `VITE_API_BASE_URL` | Production build da API to‘liq URL |
| `VITE_SOCKET_URL` | Production: Socket.IO URL |

To‘liq namunalar: `backend/.env.example`, `frontend/.env.example`, `deploy/env.api.example`.

## Monorepo skriptlar (ildiz `package.json`)

- `npm run dev:front` — Vite dev server
- `npm run dev:realtime` — Socket.IO server
- `npm run build:front` — production `frontend/dist`
- `npm run ci:backend` — `manage.py check` + testlar

## Joylashtirish

[`deploy/DEPLOY.md`](deploy/DEPLOY.md), GitHub Actions: [`deploy/DEPLOY-GITHUB-ACTIONS.md`](deploy/DEPLOY-GITHUB-ACTIONS.md).

**Serverda bitta yangilash** (git pull, migrate, frontend build, nginx HTTP/HTTPS tanlash, realtime CORS, restart):

```bash
cd /var/www/onlinetest && bash deploy/remote-update.sh
```

Barcha foydalanuvchi + imtihonlarni o‘chirib faqat `admin` / `fjsti123` qoldirish (xavfli): `bash deploy/remote-update.sh --reset-admin`

## Xavfsizlik eslatmalari

- Repoda `.env` va `db.sqlite3` qolmaganini tekshiring (`.gitignore`).
- Brauzerda **parolni localStorage da saqlamaymiz**; «Eslab qolish» faqat foydalanuvchi ID.
- Production da `bootstrap_exam` kuchsiz standart parol ishlatmaydi — `ADMIN_BOOTSTRAP_PASSWORD` o‘rnating yoki `deploy/bootstrap-ubuntu-once.sh` avtogeneratsiyasidan foydalaning.

## CI

GitHub Actions: `.github/workflows/ci.yml` (frontend typecheck/test/build, backend check/test, realtime health).
