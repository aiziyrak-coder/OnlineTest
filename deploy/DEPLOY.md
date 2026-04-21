# DigitalOcean dropletga joylashtirish

**Push bilan avtomatik deploy:** GitHub’da Secrets qo‘ygach, `main` ga har pushda server yangilanadi — [DEPLOY-GITHUB-ACTIONS.md](./DEPLOY-GITHUB-ACTIONS.md).

**Domen ochilsa boshqa sayt chiqsa:** nginx hali ulangan emas — [TROUBLESHOOT-DOMAINS.md](./TROUBLESHOOT-DOMAINS.md). Bir marta: `sudo bash deploy/bootstrap-ubuntu-once.sh` yoki faqat nginx: `sudo bash deploy/enable-nginx-onlinetest.sh`.

**Lokaldan SSH parol/kalit ishlatib bo‘lmasa (tavsiya: DO web console / «Console»):** to‘liq o‘rnatish bitta qatorda (root sifatida):

```bash
curl -fsSL https://raw.githubusercontent.com/aiziyrak-coder/OnlineTest/main/deploy/droplet-bootstrap-from-console.sh | bash
```

Yoki o‘z domenlaringizni bering: `CERTBOT_EMAIL=you@mail.uz FRONT_DOMAIN=online-imtixon.uz API_DOMAIN=api.online-imtixon.uz` (export) so‘ng yuqoridagi `curl | bash`.

**Brauzer ochilmayaptimi / timeout?** SSH dan keyin serverda portlar va nginx:

```bash
curl -fsSL https://raw.githubusercontent.com/aiziyrak-coder/OnlineTest/main/deploy/droplet-open-ports-and-verify.sh | bash
```

Bu skript **faqat server ichida** UFW + nginx + xizmatlarni tekshiradi; **DNS va DO Cloud Firewall** sizning panelingizda qo‘lda (skript oxirida eslatma chiqadi).

**`api.online-imtixon.uz` DNS yo‘q / sertifikat chiqmayaptimi:** `sudo bash deploy/enable-nginx-onlinetest.sh` endi **sertifikat bo‘lmasa** avtomatik **HTTP-only** nginx qo‘yadi (`nginx -t` yiqilmasin). DNS da `api` uchun **A** yozuvi paydo bo‘lib, certbot muvaffaq bo‘lgach, yana shu skriptni ishga tushiring — HTTPS konfig yuklanadi.

## Xavfsizlik (majburiy)

1. Chatda yuborilgan **root parolini darhol o‘zgartiring** (`passwd`). Keyinchalik faqat **SSH kalit** (`PermitRootLogin prohibit-password`).
2. **Parolni** skript, Git yoki issue’larga yozmang. `api.env` faqat serverda, huquq `chmod 600`.
3. [OnlineTest](https://github.com/aiziyrak-coder/OnlineTest) repozitoriyasi bo‘sh bo‘lsa, avval lokaldan `git push` qiling.

## Domenlar

| Xizmat   | Domen                      | Nginx root / proxy        |
|----------|----------------------------|---------------------------|
| Frontend | `online-imtixon.uz`    | Statik `frontend/dist`    |
| API+WS   | `api.online-imtixon.uz` | `127.0.0.1:9081` + `:9082` |

Boshqa loyihalarga tegmaslik: faqat **loopback** (`127.0.0.1`) portlari; tashqi dunyoga faqat **80/443** orqali nginx.

## 1) Bo‘sh portlarni tekshirish

Serverda:

```bash
bash deploy/find-free-ports.sh
```

Agar `9081` yoki `9082` band bo‘lsa, boshqa bo‘sh port tanlang va quyidagilarni bir xil yangilang:

- `deploy/systemd/onlinetest-api.service` — `--bind 127.0.0.1:YANGI`
- `deploy/nginx/onlinetest.conf` — `proxy_pass` portlari
- `/etc/onlinetest/realtime.env` — `REALTIME_PORT=`

## 2) DNS

`online-imtixon.uz` va `api.online-imtixon.uz` uchun **A** yozuvlari droplet IP (`209.38.239.183`) ga.

## 3) Serverda katalog va kod

```bash
sudo mkdir -p /var/www/onlinetest /etc/onlinetest
sudo chown -R $USER:$USER /var/www/onlinetest
cd /var/www/onlinetest
git clone https://github.com/aiziyrak-coder/OnlineTest.git .
# yoki mavjud repodan: git pull
```

### To'liq 0-dan qayta o'rnatish (tavsiya)

```bash
sudo rm -rf /var/www/onlinetest
sudo mkdir -p /var/www/onlinetest
sudo git clone https://github.com/aiziyrak-coder/OnlineTest.git /var/www/onlinetest
cd /var/www/onlinetest
sudo CERTBOT_EMAIL=admin@online-imtixon.uz FRONT_DOMAIN=online-imtixon.uz API_DOMAIN=api.online-imtixon.uz bash deploy/full-install-root.sh
```

## 4) Backend

```bash
cd /var/www/onlinetest/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
sudo cp deploy/env.api.example /etc/onlinetest/api.env
sudo nano /etc/onlinetest/api.env   # kalitlarni to‘ldiring
sudo chmod 600 /etc/onlinetest/api.env
python manage.py migrate
python manage.py bootstrap_exam   # bir marta; keyin parolni o‘zgartiring
deactivate
```

`bootstrap_exam` admin yaratadi: ID odatda `fjstiadmin` (`ADMIN_BOOTSTRAP_ID`). **Production (`DJANGO_DEBUG=0`):** `ADMIN_BOOTSTRAP_PASSWORD` muhitda majburiy va kamida **12** belgi; standart parol ishlatilmaydi. Mahalliy ishlab chiqish (`DEBUG=1`) da parol ixtiyoriy — berilmasa `fjsti123`. `deploy/bootstrap-ubuntu-once.sh` birinchi marta `api.env` da kuchli parol generatsiya qiladi (`/root/onlinetest-admin-once.txt`).

**Demo kirishlar (ixtiyoriy):** `python manage.py seed_demo_users` — `demo_admin`, `demo_student`, `demo_teacher` uchun **bir xil** parol. Prod: `api.env` da `DEMO_SEED_PASSWORD` (kamida 12 belgi) majburiy. Dev (`DEBUG=1`): o‘rnatilmasa parol `DemoFJSTI2026!`. **Eslatma:** `teacher` roli SPA login da qo‘llab-quvvatlanmaydi (403); faqat admin va student tizimga kiradi.

**Toza boshlash:** `python manage.py reset_single_admin --yes` — barcha `AppUser` va imtihon/natija yozuvlarini o‘chiradi, faqat **ID `admin`**, parol **`fjsti123`** qoldiradi (`--id` / `--password` bilan boshqacha ham bo‘ladi).

## 5) Frontend build (production)

Lokal yoki serverda:

```bash
cd /var/www/onlinetest/frontend
cp .env.production.example .env.production
# VITE_API_BASE_URL va VITE_SOCKET_URL ni tekshiring
npm ci
npm run build
```

Natija: `frontend/dist` — nginx `root` shu yerga ishora qiladi.

## 6) Realtime (Node)

Ildizda `socket.io` kerak:

```bash
cd /var/www/onlinetest
npm ci --omit=dev
sudo cp deploy/env.realtime.example /etc/onlinetest/realtime.env
sudo nano /etc/onlinetest/realtime.env
sudo chmod 600 /etc/onlinetest/realtime.env
```

Systemd fayllarini nusxalang (`User=www-data` uchun kodga o‘qish huquqi):

```bash
sudo chown -R www-data:www-data /var/www/onlinetest
# yoki faqat kerakli papkalarga
sudo cp deploy/systemd/onlinetest-api.service /etc/systemd/system/
sudo cp deploy/systemd/onlinetest-realtime.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now onlinetest-api onlinetest-realtime
```

## 7) Nginx + TLS

```bash
sudo cp deploy/nginx/onlinetest.conf /etc/nginx/sites-available/onlinetest
sudo ln -sf /etc/nginx/sites-available/onlinetest /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Ikki domen uchun SSL (yoki qo‘lda). **Avval** loyiha katalogiga kiring (`cd /var/www/onlinetest`).

Agar `nginx -t` da `options-ssl-nginx.conf` topilmadi desa:

```bash
sudo bash deploy/ensure-letsencrypt-nginx-options.sh
sudo nginx -t
```

Keyin:

```bash
sudo certbot --nginx -d online-imtixon.uz -d api.online-imtixon.uz
# yoki: sudo bash deploy/https-certbot.sh online-imtixon.uz api.online-imtixon.uz
```

Certbot konfigni yangilaydi; keyin `listen 443 ssl` bloklari paydo bo‘ladi.

**HTTPS dan keyin** `/etc/onlinetest/api.env` va `frontend/.env.production` da faqat **`https://`** URL lar bo‘lishi kerak (`deploy/https-certbot.sh` oxirida eslatma chiqadi). `DJANGO_SECURE_SSL=1` **qo‘ymang** — TLS nginx da; Django qayta yo‘naltirish cheksiz loop berishi mumkin.

## 8) Yangilash

```bash
cd /var/www/onlinetest
bash deploy/remote-update.sh
```

Qo'shimcha flaglar:

```bash
# git pull qilmasin
bash deploy/remote-update.sh --no-git

# lokal o'zgarishlarni auto-stash qilmasin
bash deploy/remote-update.sh --no-autostash
```

## Tekshiruv

- `https://api.online-imtixon.uz/api/health` — `{"ok":true,"database":true}`
- `https://online-imtixon.uz` — SPA yuklanishi
- Brauzerda login va imtihon oqimi

## Xavfsizlik (audit qoidalari)

- **Maxfiy kalitlar** faqat `/etc/onlinetest/*.env` (chmod `600`), repoda emas: `DJANGO_SECRET_KEY`, `JWT_SECRET`, `GEMINI_API_KEY`, `DEPLOY_HOOK_SECRET`.
- **Gunicorn** faqat `127.0.0.1:9081`, **realtime** prod da `REALTIME_BIND=127.0.0.1` — tashqi dunyoga faqat nginx `80/443`.
- **Gunicorn** `--forwarded-allow-ips=127.0.0.1` — `X-Forwarded-Proto` faqat mahalliy proksi ishonchli.
- **CORS** prod da aniq ro‘yxat (`CORS_ALLOWED_ORIGINS`); `DJANGO_DEBUG=0`.
- **JWT** server bazasidagi `AppUser` rolini ishlatadi; muddati `JWT_EXPIRE_HOURS` bilan cheklangan.
- **SQLite** yagona serverda yaxshi; yuqori yuk uchun keyinroq PostgreSQL ko‘rib chiqiladi.
- **Deploy hook** `timingSafeEqual` bilan solishtiradi; nginx orqali maxfiy sarlavha.
- **Socket.IO** hozircha `join-exam` uchun alohida JWT tekshiruvi yo‘q — xona `exam-{id}` bo‘yicha; bilgan ID bo‘lsa signal kanaliga qo‘shilishi mumkin (keyingi qatlam: handshake da token). Hozir kirish nginx + `REALTIME_BIND` bilan cheklangan.

## Ma’lumotlarning doimiyligi (muhim)

Barcha **foydalanuvchilar**, **test bazasi savollari/kategoriyalari**, **imtihonlar**, **talaba natijalari**, **qoidabuzarliklar** — bittada **`/var/www/onlinetest/backend/db.sqlite3`** faylida saqlanadi.

- **`git pull` va `migrate`** bu faylni **o‘chirib yubormaydi**; migratsiyalar faqat jadval tuzilmasini yangilaydi (ma’lumotlar saqlanadi).
- Repoda `db.sqlite3` **yo‘q** (`.gitignore`) — bu **to‘g‘ri**: bazani Git orqali boshqarmang.
- Serverda **disk zaxirasi** majburiy: `sudo mkdir -p /var/backups/onlinetest` va cron:

```bash
sudo bash /var/www/onlinetest/deploy/backup-database.sh
sudo cp deploy/backup-cron.example /etc/cron.d/onlinetest-backup
sudo chmod 644 /etc/cron.d/onlinetest-backup
```

Zaxira nusxalari: `BACKUP_DIR` (standart `/var/backups/onlinetest`), `45` kundan oshiq eski fayllar avtomatik o‘chiriladi (`BACKUP_KEEP_DAYS`).

- Droplet/snapshot yoki hosting **disk backup** ni alohida yoqing.
- Keyinroq juda yuqori yuk bo‘lsa **PostgreSQL** ga o‘tish mumkin; hozirgi loyiha SQLite bilan to‘liq ishlaydi.
