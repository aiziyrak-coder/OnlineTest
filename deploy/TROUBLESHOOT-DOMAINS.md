# Domen ochilsa boshqa dastur chiqyapti

Buning sababi odatda: **nginx sizning `server_name` uchun blokni umuman yuklamagan** yoki **boshqa fayl oldin `default_server`** qilib turibdi.

## 1) Sizning domenlar nginxda bormi?

```bash
sudo nginx -T 2>/dev/null | grep -E 'server_name|fjsti-onlinetest'
```

`onlinetest.ziyrak.org` va `onlinetestapi.ziyrak.org` **faqat** `fjsti-onlinetest.conf` ichida bo‘lishi kerak. Agar boshqa `sites-enabled` faylida ham shu nomlar bo‘lsa — **birini o‘chiring** yoki domenni bir joyga qoldiring.

## 2) Sayt yoqilganmi?

```bash
ls -la /etc/nginx/sites-enabled/ | grep fjsti
```

Bo‘sh bo‘lsa:

```bash
cd /var/www/onlinetest
sudo bash deploy/enable-nginx-onlinetest.sh
```

## 3) Loopbackdan tekshiruv (qaysi virtual host ishlayapti)

```bash
curl -sS -H 'Host: onlinetest.ziyrak.org' http://127.0.0.1/healthz
curl -sS -H 'Host: onlinetestapi.ziyrak.org' http://127.0.0.1/api/health
```

Birinchi `ok`, ikkinchi `{"ok":true` kabi bo‘lishi kerak. Agar boshqa HTML chiqsa — hali noto‘g‘ri `server` bloki ishlayapti.

## 4) `default_server` qayerda?

```bash
grep -r default_server /etc/nginx/sites-enabled/
```

Agar `listen 80 default_server` boshqa loyihada bo‘lsa, bu normal; muhimi — **Host** sizning domeningiz bo‘lganda to‘g‘ri `server_name` tanlanishi. Tanlanmasa, DNS va `server_name` mos emas yoki konfig yo‘q.

## 5) HTTPS (certbot) dan keyin

Certbot ba’zan alohida fayl yaratadi. Tekshiring:

```bash
sudo nginx -T | grep -A2 onlinetestapi
```

443 blokida ham `proxy_pass` va `root` yo‘llari saqlangan bo‘lishi kerak.

## 6) Bir marta to‘liq o‘rnatish (yangi server yoki bo‘sh joy)

```bash
cd /var/www/onlinetest
sudo CERTBOT_EMAIL=siz@pochta.com bash deploy/bootstrap-ubuntu-once.sh
```

Oldin `api.env` ichida **DJANGO_SECRET_KEY** va **JWT_SECRET** ni to‘ldiring.
