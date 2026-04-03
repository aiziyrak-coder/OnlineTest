# GitHub Actions orqali serverda avtomatik deploy

**CI tugagach deploy avtomatik** (`workflow_run`). Push qilgach sizdan qo‘lda pull/restart talab qilinmaydi — faqat bir marta [SETUP-SECRETS-ONCE.md](./SETUP-SECRETS-ONCE.md).

Qo‘lda ishga tushirish: **Actions → Deploy to server → Run workflow**.

## 1) Bir marta serverda (qo‘lda)

- `deploy/DEPLOY.md` bo‘yicha nginx, systemd, `/etc/onlinetest/api.env`, `git clone` — katalog masalan `/var/www/onlinetest`.
- Serverda **deploy** foydalanuvchisi yoki `root` uchun `git pull` ishlashi kerak (SSH kalit yoki HTTPS).
- **sudo** siz systemd restart bo‘lmaydi — deploy user uchun `sudoers` da faqat:
  `systemctl restart onlinetest-api`, `onlinetest-realtime`, `nginx reload` (tavsiya).

## 2) Autentifikatsiya: kalit yoki parol

**Parol server paroli** (masalan root paroli) — bu SSH **kalit emas**. Kalit fayl `-----BEGIN OPENSSH PRIVATE KEY-----` bilan boshlanadi.

Tavsiya: parolni chat yoki kodga yozmang; server parolini **almashtiring** va keyin faqat **SSH kalit** ishlating.

### Variant A — parol (tez, kamroq xavfsiz)

GitHub’da faqat quyidagi secretlar:

- `SSH_PASSWORD` — serverdagi **root** (yoki tanlangan user) paroli.

`SSH_PRIVATE_KEY` ni **qo‘ymang** yoki bo‘sh qoldiring (faqat parol ishlatiladi).

### Variant B — SSH kalit (tavsiya etiladi)

Lokal mashinada:

```bash
ssh-keygen -t ed25519 -f gh_deploy_onlinetest -N ""
ssh-copy-id -i gh_deploy_onlinetest.pub root@SIZNING_IP
cat gh_deploy_onlinetest   # PRIVATE kalit — faqat Secret SSH_PRIVATE_KEY
```

`SSH_PASSWORD` ni bo‘sh qoldiring.

## 3) GitHub repository Secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Nomi | Tavsif | Majburiy |
|------|--------|----------|
| `SSH_HOST` | Masalan `167.71.53.238` | ha |
| `SSH_USERNAME` | Masalan `root` | ha |
| `SSH_PRIVATE_KEY` | To‘liq private key matni | kalit bilan — ha |
| `SSH_PASSWORD` | Server paroli | parol bilan — ha |
| `SSH_APP_PATH` | Masalan `/var/www/onlinetest` | yo‘q |

**Kalit yoki paroldan bittasi** bo‘lishi kerak. Ikkalasi ham to‘ldirilsa, odatda kalit ustunlik qiladi.

> `SSH_HOST`, `SSH_USERNAME` va (`SSH_PRIVATE_KEY` yoki `SSH_PASSWORD`) bo‘lmasa, **Deploy** job ishlamaydi (push yashil, deploy o‘tkaziladi).

## 4) Sudo siz ishlashi

Agar `SSH_USERNAME` root **emas** bo‘lsa, serverda:

```sudo visudo```

```
deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart onlinetest-api, /bin/systemctl restart onlinetest-realtime, /bin/systemctl reload nginx
```

## 5) Tekshiruv

Push qiling yoki workflow ni qo‘lda ishga tushiring. Logda `remote-update` `OK` ko‘rinishi kerak.
