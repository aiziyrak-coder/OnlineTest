# Davom ettirish uchun boshlang'ich prompt

Quyidagi matnni yangi suhbatga (Claude Code yoki boshqa AI yordamchiga) birinchi
xabar sifatida to'liq nusxalab qo'ying. Odam dasturchi uchun ham xuddi shu matn
kirish hujjati bo'lib xizmat qiladi.

---

```
Men FJSTI (Farg'ona jamoat salomatligi tibbiyot instituti) onlayn imtihon
platformasini davom ettiraman. Loyihani boshqa dasturchidan qabul qilyapman.

## Loyiha haqida

Real ishlab turgan tizim — institutda kundalik imtihonlar shu yerda
o'tkaziladi: bakalavr talabalar, ordinatorlar (1-kurs attestatsiya, 2-kurs DAK),
o'qituvchilarni baholash, ishga kiruvchi nomzodlar va harbiy xizmatga
chaqiriluvchilar. Imtihon paytida VAC deb ataladigan nazorat ishlaydi: kamera,
ekran suratlari, yuz tekshiruvi, taqiqlangan buyumlarni aniqlash, qurilmaga
bog'lash, HMAC imzolangan so'rovlar.

Django REST + React/Vite, Docker Compose, PostgreSQL, Redis, Celery.

## Kod va server

Repo: https://github.com/aiziyrak-coder/OnlineTest
Shoxobcha: handoff-2026-09-28 (oxirgi commit f68eda7)

MUHIM: kanonik kod SERVERDA — /home/onlinetest. Repo undan orqada qolishi
mumkin, chunki tuzatishlar ko'pincha to'g'ridan-to'g'ri serverda qilinadi.
Ish boshlashdan oldin serverdagi holatni repo bilan solishtiring.

Serverga kirish:
  ssh -i ~/.ssh/imentor_deploy admin_root@192.168.0.101
  cd /home/onlinetest
  DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

Konteynerlar: app (Django+nginx), worker (Celery), beat (sweep tsikli),
db (PostgreSQL), redis.

Birinchi bo'lib repodagi HANDOFF-2026-09-28.md faylini o'qing — unda tizim
tuzilishi, joylash tartibi, tugallanmagan ishlar va ehtiyot choralari bor.

## Birinchi navbatdagi vazifalar

1) AUDIT TUZATISHLARINI PRODGA JOYLASH (eng muhim, hali bajarilmagan)

26.09.2026 da butun kod auditdan o'tkazilgan: 47 ta kamchilik topilgan, 36 tasi
tuzatilgan va handoff-2026-09-28 shoxobchasida turibdi. 276 ta test o'tadi,
lekin PRODDA HALI ISHLAMAYAPTI.

Joylash:
  bash deploy/safe-deploy.sh

Bu skript 6 bosqichni bajaradi: Python sintaksisi, tsc, 276 backend test,
migratsiya tekshiruvi, image yig'ish va kodni ko'chirish, qayta yuklash va
sog'liq tekshiruvi. Migratsiya 0052 avtomatik qo'llanadi (yangi
student_exam_attempts jadvali va users ga ikkita ustun).

Joylashdan oldin tekshiring: hozir imtihonda odam bormi?
  $DC exec -T -w /app/backend app python manage.py shell -c \
    "from apps.core.models import StudentExam; print(StudentExam.objects.filter(status='In Progress').count())"

Agar imtihonda odam bo'lsa, konteynerni qayta yaratmang — gunicorn'ga SIGHUP
yuboring (safe-deploy buni o'zi hal qiladi). beat konteynerini har doim
--force-recreate bilan yangilang: u eski image bilan qolib ketib, tuzatilgan
xato qaytib kelgan holatlar bo'lgan.

2) MA'LUMOTNI TOZALASH (skript tayyor, bajarilmagan)

  scripts/audit_data_cleanup.py

Ko'rish rejimida ishlaydi, APPLY=1 bilan bajaradi. Ikki ishni qiladi:
- istisno ro'yxatidagi talabalarga xato yozilgan "kelmadi" sessiyalarini
  o'chiradi (562-imtihonda 14 ta);
- harbiylar 561-imtihonida Abdullayev (ruschada topshiradi) va Yigitaliyevni
  istisnoga qo'shib, bo'sh qatorlarini o'chiradi.

3) TUZATILMAGAN KAMCHILIKLAR (HANDOFF faylining 4.3-bo'limida 11 tasi)

Eng muhimlari: konteyner loglari qayta yaratilganda o'chib ketadi (21.09 dagi
loglar shu sabab yo'qolgan); test markazidagi kompyuterlar tizimga bitta IP va
bitta qurilma izi bilan ko'rinadi, ya'ni kim qaysi kompyuterda o'tirgani
aniqlanmaydi.

## Nimalarga ehtiyot bo'lish kerak

- Prod bazaga tegishdan oldin har doim zaxira oling.
- Imtihon paytida kod joylamang.
- Hech qachon holatni tekshirmasdan ommaviy tozalash qilmang. 21.09 da shunday
  qilingan va o'sha kuni allaqachon imtihonni tugatganlarning natijalari ham
  o'chib ketgan; bittasi faqat besh kundan keyin bazaning zaxirasidan topildi.
  Shu sababli endi har bir tozalashdan oldin urinish arxivlanadi
  (StudentExamAttempt jadvali).
- Yangi savol banki qo'yishdan oldin kalitlarni albatta tekshiring:
    python manage.py verify_bank_keys --exam <id> --sample 60
  Moslik 70% dan past bo'lsa bankni imtihonga qo'ymang. 25.09 da tashqi fayldan
  o'girilgan bankda kalitlarning ~75% i noto'g'ri chiqqan va talabalar to'g'ri
  javob berib ham yiqilgan.
- Imtihon kuniga tayyorlikni bitta buyruq bilan tekshiring:
    python manage.py exam_readiness --date 28.09.2026

## Testlar

  $DC exec -T -w /app/backend app python manage.py test apps.api.tests --noinput

Hozir 276 ta test bor, hammasi o'tadi. SQLite ishlamaydi — faqat PostgreSQL.
Prod bazaga tegmasdan sinash uchun kodni /tmp ga nusxalab, konteynerni
--entrypoint python bilan ishga tushiring (aks holda entrypoint migrate qiladi).

## Mendan kutilayotgani

Avval kodni va HANDOFF hujjatini o'rganing, serverdagi holatni repo bilan
solishtiring, keyin 1-vazifadan boshlang. Har bir o'zgarishdan oldin nima
qilmoqchi ekaningizni ayting va prod bazaga ta'sir qiladigan har qanday
amaldan oldin mendan tasdiq so'rang.
```

---

## Qo'shimcha: nimalar allaqachon bajarilgan

Yangi dasturchi savol bermasligi uchun — oxirgi ikki haftada qilingan ishlar:

- Test markazi rejimi, umumiy PIN, kitoblarni e'tiborga olmaslik, avtomatik
  ogohlantirishlarni o'chirish (nazoratchilar o'zlari tekshiradi).
- Yuz orqali kirish (cam.fermi.uz bazasi bilan), guruh kodisiz ro'yxatdan o'tish.
- Ro'yxat orqali ommaviy ruxsat berish sahifasi (admin o'zi qiladi).
- Uydan topshiriladigan imtihonlar (harbiylar): PINsiz, to'liq VAC, avtomatik
  qayta urinish — adminlarga ish qolmaydi.
- Savollarni 3-4 barobar qiyinlashtirish va AI xarajatini kamaytirish
  (qabul darajasi 15% dan 78% ga ko'tarildi).
- Hisobotlar: ordinatorlar, nomzodlar, maxsus kiruvchilar; PDF/Excel/Word.
- Natijalarni yuzma-yuz tasdiqlash tartibi (80%+ natijalar uchun).
