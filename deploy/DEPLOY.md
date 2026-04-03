# DigitalOcean dropletga joylashtirish

**Push bilan avtomatik deploy:** GitHub’da Secrets qo‘ygach, `main` ga har pushda server yangilanadi — [DEPLOY-GITHUB-ACTIONS.md](./DEPLOY-GITHUB-ACTIONS.md).

**Domen ochilsa boshqa sayt chiqsa:** nginx hali ulangan emas — [TROUBLESHOOT-DOMAINS.md](./TROUBLESHOOT-DOMAINS.md). Bir marta: `sudo bash deploy/bootstrap-ubuntu-once.sh` yoki faqat nginx: `sudo bash deploy/enable-nginx-onlinetest.sh`.

## Xavfsizlik (majburiy)

1. Chatda yuborilgan **root parolini darhol o‘zgartiring** (`passwd`). Keyinchalik faqat **SSH kalit** (`PermitRootLogin prohibit-password`).
2. **Parolni** skript, Git yoki issue’larga yozmang. `api.env` faqat serverda, huquq `chmod 600`.
3. [OnlineTest](https://github.com/aiziyrak-coder/OnlineTest) repozitoriyasi bo‘sh bo‘lsa, avval lokaldan `git push` qiling.

## Domenlar

| Xizmat   | Domen                      | Nginx root / proxy        |
|----------|----------------------------|---------------------------|
| Frontend | `onlinetest.ziyrak.org`    | Statik `frontend/dist`    |
| API+WS   | `onlinetestapi.ziyrak.org` | `127.0.0.1:9081` + `:9082` |

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

`onlinetest` va `onlinetestapi` uchun **A** yozuvlari droplet IP (`167.71.53.238`) ga.

## 3) Serverda katalog va kod

```bash
sudo mkdir -p /var/www/onlinetest /etc/onlinetest
sudo chown -R $USER:$USER /var/www/onlinetest
cd /var/www/onlinetest
git clone https://github.com/aiziyrak-coder/OnlineTest.git .
# yoki mavjud repodan: git pull
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

`bootstrap_exam` standart `admin` / `admin123` — darhol admin panel orqali parolni almashtiring.

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
sudo certbot --nginx -d onlinetest.ziyrak.org -d onlinetestapi.ziyrak.org
```

Certbot konfigni yangilaydi; keyin `listen 443 ssl` bloklari paydo bo‘ladi.

## 8) Yangilash

```bash
cd /var/www/onlinetest && git pull
cd backend && source .venv/bin/activate && pip install -r requirements.txt && python manage.py migrate && deactivate
cd ../frontend && npm ci && npm run build
sudo systemctl restart onlinetest-api onlinetest-realtime
```

## Tekshiruv

- `https://onlinetestapi.ziyrak.org/api/health` — `{"ok":true,"database":true}`
- `https://onlinetest.ziyrak.org` — SPA yuklanishi
- Brauzerda login va imtihon oqimi
