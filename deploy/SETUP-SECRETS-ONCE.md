# Bir marta Secret — keyin pull/restart sizsiz

Men lokal mashinadan sizning dropletingizga SSH qila olmayman. **GitHub Actions** serverga ulanadi — buning uchun repoda **3 ta Secret** (bir marta).

## Brauzer (2 daqiqa)

1. [Repository → Settings → Secrets → Actions](https://github.com/aiziyrak-coder/OnlineTest/settings/secrets/actions)
2. **New repository secret**:

| Name | Value |
|------|--------|
| `SSH_HOST` | `167.71.53.238` |
| `SSH_USERNAME` | `root` |
| `SSH_PASSWORD` | server root parolingiz |

3. Tugadi. **CI** muvaffaqiyatidan keyin **Deploy to server** avtomatik: `git pull`, build, `systemctl restart`.

## GitHub CLI

```bash
gh auth login
gh secret set SSH_HOST -b"167.71.53.238"
gh secret set SSH_USERNAME -b"root"
gh secret set SSH_PASSWORD
```

Parolni kodga yoki repoga yozmang — faqat Secret.
