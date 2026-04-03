# Bir marta Secret — keyin pull/restart sizsiz

Men lokal mashinadan sizning dropletingizga SSH qila olmayman. **GitHub Actions** serverni yangilaydi — ikki usuldan **bittasini** tanlang.

## Usul 1: Webhook (SSH kalit va parol shart emas)

Serverda `bootstrap-ubuntu-once.sh` yoki `enable-deploy-hook.sh` ishlagandan keyin `/root/onlinetest-github-webhook-once.txt` yoki `/etc/onlinetest/deploy-hook.env` dagi qiymatlar:

1. [Repository → Settings → Secrets → Actions](https://github.com/aiziyrak-coder/OnlineTest/settings/secrets/actions)

| Name | Qiymat |
|------|--------|
| `DEPLOY_HOOK_SECRET` | `deploy-hook.env` dagi `DEPLOY_HOOK_SECRET` (min 24 belgi) |
| `DEPLOY_HOOK_URL` | `https://onlinetestapi.ziyrak.org/__internal_deploy/v1` (o‘z API domeningiz) |

2. `DEPLOY_HOOK_URL` secret **mavjud** bo‘lsa, workflow faqat webhook orqali deploy qiladi (`SSH_*` e’tiborga olinmaydi). SSH usulini ishlatmoqchi bo‘lsangiz, `DEPLOY_HOOK_URL` va `DEPLOY_HOOK_SECRET` ni umuman qo‘shmang.

3. CI `main` da muvaffaqiyat tugagach **Deploy to server** webhook orqali serverda `git fetch`, build, restart qiladi.

**Eslatma:** URL da **https** bo‘lishi kerak (certbot dan keyin). Hook `X-Deploy-Secret` sarlavhasini tekshiradi — tokenni hech kimga bermang.

## Usul 2: SSH (kalit yoki parol)

1. **New repository secret**:

| Name | Value |
|------|--------|
| `SSH_HOST` | masalan `167.71.53.238` |
| `SSH_USERNAME` | `root` |
| `SSH_PASSWORD` | server paroli **yoki** `SSH_PRIVATE_KEY` (kalit) |

2. Webhook ishlatmasangiz `DEPLOY_HOOK_URL` va `DEPLOY_HOOK_SECRET` ni **qo‘shmang**.

## GitHub CLI (webhook)

```bash
gh secret set DEPLOY_HOOK_SECRET
gh secret set DEPLOY_HOOK_URL -b"https://onlinetestapi.ziyrak.org/__internal_deploy/v1"
```

Parol/tokenlarni kodga yoki chatga yozmang — faqat Secret.
