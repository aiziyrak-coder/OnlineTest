# GitHub Actions orqali serverda avtomatik deploy

Bu loyiha **Cursor agent** o‘rniga **GitHub** serveringizga ulanadi: `main` ga push yoki **Actions → Deploy to server → Run workflow**.

## 1) Bir marta serverda (qo‘lda)

- `deploy/DEPLOY.md` bo‘yicha nginx, systemd, `/etc/onlinetest/api.env`, `git clone` — katalog masalan `/var/www/onlinetest`.
- Serverda **deploy** foydalanuvchisi yoki `root` uchun `git pull` ishlashi kerak (SSH kalit yoki HTTPS).
- **sudo** siz systemd restart bo‘lmaydi — deploy user uchun `sudoers` da faqat:
  `systemctl restart onlinetest-api`, `onlinetest-realtime`, `nginx reload` (tavsiya).

## 2) SSH kalit (GitHub → server)

Lokal mashinada:

```bash
ssh-keygen -t ed25519 -f gh_deploy_onlinetest -N ""
ssh-copy-id -i gh_deploy_onlinetest.pub root@SIZNING_IP
# yoki public kalitni server ~/.ssh/authorized_keys ga qo‘shing
cat gh_deploy_onlinetest   # bu PRIVATE kalit — faqat GitHub Secret ga
```

## 3) GitHub repository Secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Nomi | Misol | Majburiy |
|------|--------|----------|
| `SSH_HOST` | `167.71.53.238` | ha |
| `SSH_USERNAME` | `root` yoki `deploy` | ha |
| `SSH_PRIVATE_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----...` | ha |
| `SSH_APP_PATH` | `/var/www/onlinetest` | yo‘q (standart shu) |
| `SSH_PORT` | `22` | yo‘q |

> Agar `SSH_HOST` yoki `SSH_PRIVATE_KEY` bo‘sh bo‘lsa, **Deploy** job o‘tkazib yuboriladi (push qizil bo‘lib qolmasin).

## 4) Sudo siz ishlashi

Agar `SSH_USERNAME` root **emas** bo‘lsa, serverda:

```sudo visudo```

```
deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart onlinetest-api, /bin/systemctl restart onlinetest-realtime, /bin/systemctl reload nginx
```

## 5) Tekshiruv

Push qiling yoki workflow ni qo‘lda ishga tushiring. Logda `remote-update` `OK` ko‘rinishi kerak.
