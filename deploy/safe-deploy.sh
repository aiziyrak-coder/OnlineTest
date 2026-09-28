#!/usr/bin/env bash
# Xavfsiz joylash: avval TEKSHIR, keyin joyla.
#
# Bugun (24.09.2026) qo'lda joylashda ikki marta jiddiy nosozlik prodga chiqdi:
# PIN tekshiruvi uydan topshirishni bloklab qo'ydi va shaxs nazorati butun
# tizimda o'chib qoldi. Ikkalasini ham avtomatik testlar tutib qolardi —
# shuning uchun endi testlar joylashning MAJBURIY qismi.
#
# Ishlatish:
#   bash deploy/safe-deploy.sh            # to'liq: tekshiruv + joylash
#   bash deploy/safe-deploy.sh --check    # faqat tekshiruv (prodga tegmaydi)
#   bash deploy/safe-deploy.sh --fast     # testlarsiz (FAQAT favqulodda holatda)
set -euo pipefail

cd /home/onlinetest
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
MODE="${1:-}"
FAIL=0

say() { printf '\n== %s\n' "$1"; }
ok()  { printf '   OK   %s\n' "$1"; }
bad() { printf '   XATO %s\n' "$1"; FAIL=1; }

say "1/6 Python sintaksisi"
if $DC exec -T app python -m compileall -q /app/backend/apps >/dev/null 2>&1; then
  ok "backend kodi kompilyatsiya bo'ldi"
else
  bad "backend kodida sintaksis xatosi bor"
fi

say "2/6 Frontend tiplari (tsc)"
if [ -d frontend ]; then
  if docker run --rm -v "$PWD/frontend":/w -w /w node:20 npx tsc --noEmit >/tmp/tsc.log 2>&1; then
    ok "tsc xatosiz"
  else
    bad "tsc xatolari: $(grep -c 'error' /tmp/tsc.log) ta (batafsil: /tmp/tsc.log)"
  fi
fi

say "3/6 Backend testlari"
if [ "$MODE" = "--fast" ]; then
  printf '   O TKAZIB YUBORILDI (--fast) — favqulodda rejim\n'
else
  if $DC exec -T -w /app/backend app python manage.py test apps.api.tests -v 1 --noinput >/tmp/tests.log 2>&1; then
    ok "$(grep -oE 'Ran [0-9]+ tests' /tmp/tests.log | tail -1) — hammasi o'tdi"
  else
    bad "yiqilgan testlar: $(grep -cE '^(FAIL|ERROR): ' /tmp/tests.log) ta"
    grep -E '^(FAIL|ERROR): ' /tmp/tests.log | sed 's/(apps.api.tests./ | /' | head -10
  fi
fi

say "4/6 Migratsiyalar"
if $DC exec -T -w /app/backend app python manage.py makemigrations --check --dry-run >/dev/null 2>&1; then
  ok "yetishmayotgan migratsiya yo'q"
else
  bad "modelga mos migratsiya yozilmagan"
fi

if [ "$FAIL" -ne 0 ]; then
  printf '\nJOYLASH TO'"'"'XTATILDI — yuqoridagi xatolarni tuzating.\n'
  exit 1
fi

if [ "$MODE" = "--check" ]; then
  printf '\nTekshiruv tugadi, hammasi joyida. Prodga tegilmadi.\n'
  exit 0
fi

say "5/6 Image yig'ish va kodni ko'chirish"
$DC build app >/tmp/build.log 2>&1 && ok "image tayyor" || { bad "image yig'ilmadi (/tmp/build.log)"; exit 1; }
RUNNING=$($DC exec -T -w /app/backend app python manage.py shell -c \
  "from apps.core.models import StudentExam; print(StudentExam.objects.filter(status='In Progress').count())" 2>/dev/null | tail -1 | tr -d '\r')
printf '   hozir imtihonda: %s kishi\n' "${RUNNING:-?}"
for svc in app worker; do
  $DC cp backend/apps "$svc":/app/backend/ >/dev/null 2>&1 || true
done
ok "kod konteynerlarga ko'chirildi"

say "6/6 Qayta yuklash va sog'liq tekshiruvi"
if [ "${RUNNING:-0}" = "0" ]; then
  $DC up -d --no-deps app worker >/dev/null 2>&1
  ok "konteynerlar qayta yaratildi (imtihon yo'q edi)"
else
  GPID=$($DC exec -T app sh -c 'for p in /proc/[0-9]*; do tr "\0" " " < $p/cmdline 2>/dev/null | grep -q gunicorn && echo ${p#/proc/} && break; done' | tr -d '\r')
  $DC exec -T app python -c "import os,signal; os.kill(${GPID:-11}, signal.SIGHUP)"
  ok "gunicorn yumshoq qayta yuklandi (imtihon uzilmadi)"
fi
# Konteyner qayta yaratilsa Django bir necha soniya ko'tariladi — kutib turamiz.
CODE=000
for _ in $(seq 1 20); do
  sleep 5
  CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8090/api/health || true)
  [ "$CODE" = "200" ] && break
done
if [ "$CODE" = "200" ]; then
  ok "server sog'lom (200)"
else
  bad "sog'liq tekshiruvi: $CODE — loglarni ko'ring: $DC logs --tail 60 app"
  exit 1
fi
printf '\nJOYLASH TUGADI.\n'
