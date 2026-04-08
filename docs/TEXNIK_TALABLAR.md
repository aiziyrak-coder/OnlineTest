# Masofaviy onlayn imtihon platformasi — texnik talablar (texnik topshiriq)

**Hujjat maqsadi:** tanlov (tender) jarayonida takliflarni solishtirish, texnik moslikni baholash va yutuqli yechimni tanlash uchun platformaga qo‘yiladigan **to‘liq funksional va nofunksional talablarni** bitta manbada jamlash.

**Qo‘llanish:** barcha potentsial ijrochilar ushbu talablarga mos keladigan yechimni taqdim etishi kerak. Talablar “minimal” va “tavsiya etilgan” sifatida farqlanishi mumkin; minimal talablar bajarilmasa taklif rad etiladi.

---

## 1. Umumiy maqsad, qamrov va terminlar

### 1.1 Maqsad
Tibbiyot ta’lim muassasasida (masalan, FJSTI kontekstida) **masofaviy imtihonlarni** xavfsiz o‘tkazish, markazlashtirilgan test bazasini boshqarish, talabalarni proktoring (kuzatuv) bilan nazorat qilish, buzilishlar va natijalarni qayd etish, shuningdek rasmiy hisobotlar (sertifikat, ban hujjati) va tekshiruv (QR) imkoniyatini ta’minlovchi **yagona veb-platforma**.

### 1.2 Qamrov
- Brauzer orqali kirish (desktop va zamonaviy mobil brauzerlar).
- Rollar: **administrator**, **talaba** (o‘qituvchi roli alohida talab bo‘lmasa — faqat admin/talaba yetarli).
- Backend API, real vaqtga yaqin xabarnoma (Socket.IO yoki ekvivalent), statik frontend joylashtirish, HTTPS, teskari proksi (Nginx yoki ekvivalent).

### 1.3 Tillar
- Interfeys **kamida o‘zbek, rus va ingliz** tillarida (i18n).
- Test kontenti va import: manba tili **avtomatik aniqlanishi** (jumladan lotin, kirill, ingliz va “boshqa” tillar); **tarjima** EN/UZ/RU uchligiga yoki manba bo‘yicha boshqa tillarga tarjima qilish rejimi talab hujjatida qat’iy belgilanadi.

### 1.4 Terminlar
- **Test banki:** kategoriyalar bo‘yicha tuzilgan savollar bazasi.
- **Imtihon:** vaqt oralig‘i, davomiylik, qatnashchilar guruhi, savollar manbai (statik / bankdan aralash) bilan belgilangan sessiya.
- **Proktoring:** kamera, fokus, to‘liq ekran va boshqa brauzer darajasidagi hodisalar orqali kuzatuv.
- **Qat’iy buzilish (hard block):** darhol imtihonni tugatadigan yoki bloklashni qo‘zg‘atadigan hodisa.

---

## 2. Funksional talablar

### 2.1 Autentifikatsiya va sessiya
- Login: **foydalanuvchi identifikatori + parol** (parollar xavfli hash, masalan bcrypt).
- Sessiya: **JWT** (HS256 yoki ekvivalent); muddati va token yangilanishi siyosati hujjatlashtirilgan bo‘lishi kerak.
- Login **throttling** (ko‘p marta noto‘g‘ri urinishdan himoya).
- **“Meni eslab qol”** (ixtiyoriy): brauzerda xavfsizlik bo‘yicha qisqa izoh bilan (masalan, `localStorage` yoki cookie, parol faqat foydalanuvchi roziligi bilan).

### 2.2 Foydalanuvchilar va rollar
- **Administrator:** barcha admin funksiyalariga kirish.
- **Talaba:** faqat o‘z imtihonlari, natijalari va ruxsat etilgan endpointlarga kirish.
- **Bloklangan** talaba: oddiy API so‘rovlarida **kirish rad etilishi** (403/401); maxsus hujjat yuklash (ban hisoboti) uchun alohida qoida (quyida).
- **O‘qituvchi roli** bo‘lmasa yoki qo‘llab-quvvatlanmasa — aniq xabar berilishi kerak.

### 2.3 Kontingent: darajalar va guruhlar
- **Darajalar (levels)** va **guruhlar (groups)** CRUD.
- Guruh maydonlari: nom, daraja, **yo‘nalish** (masalan: bachelor / residency / master), **akademik yil** (ixtiyoriy).
- Talabalarni guruhga bog‘lash; ro‘yxatda **filtrlash** (guruh, rol, holat).

### 2.4 Talaba boshqaruvi (admin)
- Talaba **yaratish, tahrirlash, o‘chirish**.
- Talaba yaratishda **profil surati majburiy** (base64 yoki URL — format va hajm cheklovi).
- Talaba holati: **Active / Banned** (yoki ekvivalent).
- **Ban ro‘yxati** va filtrlash (`status=Banned`).
- **Bandan chiqarish (unban):** kamida **8 belgi** bo‘lgan sabab matni + **JPG yoki PDF** dalil fayli (masalan, kvitansiya yoki tushuntirish xati), **maksimal hajm** (masalan 5 MB); har bir unban **audit jurnalida** (kim, qachon, qaysi fayl) saqlanishi kerak.

### 2.5 Markaziy test banki
- **Kategoriyalar:** nom, tavsif, tartib, **program_track** (any / bachelor / residency / master va hokazo), **akademik yil**, **manba tili** maydonlari.
- **Savollar:** ko‘p tanlov (MCQ); variantlar soni **2–10** oralig‘ida qo‘llab-quvvatlanishi; bitta savolda **bir yoki bir nechta to‘g‘ri** javob.
- Har bir savol uchun **asosiy matn va variantlar**, shuningdek **o‘zbek va rus** tarjima maydonlari (imtihon tili bo‘yicha tanlash).
- Kategoriya va savollar bo‘yicha **ro‘yxat, qo‘shish, tahrirlash, o‘chirish**.

### 2.6 Import va AI-yordamli tahlil
- **PDF / DOCX** yuklash orqali matn ajratish.
- **PDF:** hajm va **betlar soni cheklovi** (masalan, maksimal **15 bet** — server barqarorligi va vaqt cheklovlari uchun); cheklovdan oshsa, tushunarli xabar.
- **“Smart import”:**  
  - turli formatdagi savollar (javob kaliti hujjat boshida/oxirida, turli prefiks va variant belgilari);  
  - **bir nechta to‘g‘ri** javob;  
  - matn kam bo‘lsa yoki skan/rasmli PDF bo‘lsa — **multimodal OCR / rasm tahlili** (masalan, tashqi AI API) bilan fallback;  
  - **Gemini yoki ekvivalent** mavjud bo‘lmasa — **lokal regex/parser** asosida ishlash (503 xizmat to‘xtashi o‘rniga mantiqiy fallback).  
- Katta matnlar: **bo‘laklarga bo‘lish** (chunking) va jarayonning **timeout** va **progress** bilan boshqarilishi (frontendda progress ko‘rsatkich, sahifadan chiqishda jarayon to‘xtamasligi).
- **Tilni aniqlash** va **tarjima:** manba EN/UZ/RU yoki “boshqa” bo‘lsa ham **qolgan tillarga** tarjima (bitta belgi/slot o‘zgarishini minimallashtirish uchun AI promptlari sifatli bo‘lishi).

### 2.7 Imtihonlar (admin)
- Imtihon yaratish: **sarlavha**, **boshlanish / tugash vaqti** (UTC yoki aniq vaqt zonasi), **davomiylik (daqiqa)**, **til**, **PIN** (ixtiyoriy), **maxsus qoidalar** matni.
- Rejimlar: **statik savollar** (`questions_json`) va/yoki **bankdan aralash** (`bank_mixed`): `bank_category_ids` (JSON massiv yoki string), `bank_question_count` (**1–200** oralig‘ida, talab bo‘yicha); tanlangan kategoriyalarda **jami savollar soni** ko‘rsatilishi va so‘ralgan son **mavjud bazadan oshmasligi** kerak.
- Guruhlarga **imtihonni biriktirish** (kimlar ko‘radi).
- **Istisnolar:** talaba ma’lum imtihonni boshlay olmasligi + sabab.
- **Qayta topshirish oynalari:** imtihon yopilgandan keyin ma’lum talaba uchun vaqt oralig‘i.
- **Natijalar:** admin imtihon bo‘yicha natijalar ro‘yxati; kerak bo‘lsa **qayta topshirish (retake)** imkoniyati.

### 2.8 Talaba tomoni
- **Ruxsat etilgan imtihonlar** ro‘yxati; **soat / qolgan vaqt** (clock).
- **Oldindan tekshiruv:** kamera (haqiqiy USB/web-kamera ustuvor; virtual kamera dasturlari filtrlash tavsiya etiladi), **liveness** (masalan bosqichma-bosqich bosh burish, yaqinlashish, harakat imzosi).
- **Imtihon xonasi:** to‘liq ekran rejimi; savollar va **ichki rasmlar** (URL/markdown) to‘g‘ri ko‘rsatilishi.
- **Javoblarni saqlash** (draft), **vaqt tugaganda yoki topshirishda** yakuniy yuborish.
- **Natijalar** va **natija tafsilotlari**; **PDF sertifikat** yuklab olish.
- **Ochiq tekshirish:** `result_public_id` / maxfiy kalit asosida **ommaviy tekshiruv sahifasi** va sertifikat PDF.

### 2.9 Proktoring va buzilishlar
- Client tomonda hodisalar: **yorug‘lik / kamera**, **yuzni aniqlash** (TensorFlow.js / MediaPipe yoki ekvivalent), **tab/window blur**, **to‘liq ekrandan chiqish**, **devtools**, **clipboard**, **print screen** urinishlari — log qilinadi.
- **Qat’iy buzilish turlari** (masalan: masofadan boshqarish shubhasi, qat’iy tab almashtirish, qat’iy to‘liq ekrandan chiqish): **darhol bloklash** yoki imtihonni tugatish.
- Serverda **ViolationLog:** talaba, imtihon, tur, vaqt, (ixtiyoriy) skrinshot URL.
- Real vaqt: **Socket.IO** (yoki WebSocket) orqali admin/talaba hodisalarini uzatish.

### 2.10 Ban va rasmiy hujjatlar
- **Ban hisoboti PDF:** talaba ma’lumotlari, imtihon nomi, buzilishlar ro‘yxati, muassasa brendi/logotipi, **QR** orqali **ommaviy tekshirish** (`verify-ban-report`).
- Bloklangan talaba **maxsus endpoint** orqali (JWT bilan, global “Banned” tekshiruvini aylanib o‘tish — faqat shu hujjat uchun) hisobotni yuklab olishi mumkin.

### 2.11 Statistika va admin panel
- Dashboard/statistikalar (admin): talabalar, imtihonlar, asosiy ko‘rsatkichlar.
- Django Admin yoki ekvivalent: model **audit** (masalan ViolationLog, UnbanEvidence).

---

## 3. Nofunksional talablar

### 3.1 Xavfsizlik
- **HTTPS** majburiy (Let’s Encrypt yoki ekvivalent).
- **CORS** sozlamalari: frontend va API domenlari aniq ko‘rsatilgan; preflight (`OPTIONS`) qo‘llab-quvvatlanishi.
- **Parollar** muhit o‘zgaruvchilarida (`chmod 600`); repoda sirlar bo‘lmasligi.
- **JWT_SECRET** API va real-time xizmatlar o‘rtasida **muvofiqligi** (deploy skripti yoki hujjatlashtirilgan qo‘lda sinxron).
- **Teskari proksi timeout**lari: uzoq import (masalan **900 s** gacha) va **client_max_body_size** katta fayllar uchun.

### 3.2 Ishlash va barqarorlik
- API: **Gunicorn** (yoki ekvivalent) workerlar bilan; **health** endpoint (`/api/health`).
- Uzoq import va AI chaqiruvlari uchun **worker timeout** va **nginx proxy_read_timeout** mos kelishi kerak.
- Katta PDF: bet cheklovi + chunking + AI fallback — **500/502** xatoliklarni minimallashtirish.

### 3.3 Kengaytirish va texnik qarorlar
- Backend: **Django REST Framework** yoki ekvivalent REST API.
- Frontend: **React** (Vite) yoki ekvivalent SPA.
- Realtime: **Node** + Socket.IO yoki ekvivalent.
- **PostgreSQL/SQLite** — loyiha talabiga qarab; migratsiyalar versiyalangan.

### 3.4 Joylashtirish va CI/CD
- **systemd** unitlar: API, realtime.
- **Nginx:** `location /` → frontend `dist`; `/api/` → Gunicorn; `/socket.io/` → realtime; `/admin/` → Django admin; static fayllar.
- **Yangilash skripti:** `git pull` (stash bilan), migratsiya, `collectstatic`, frontend build, servislarni qayta ishga tushirish, **health** tekshiruvi.
- **Bir martalik tiklash** skripti (nginx/ssl ziddiyatlari uchun) — ixtiyoriy lekin tavsiya etiladi.

### 3.5 Log va monitoring
- **journalctl** orqali servis loglari; `access_log` / `error_log` tahlili.
- Health check muvaffaqiyatsiz bo‘lsa — ogohlantirish (tashqi monitoring ixtiyoriy).

### 3.6 Qabul qilish mezonlari (minimal)
- Login, token, admin CRUD, talaba imtihon oqimi, test banki, smart import (kichik fayl), imtihon yaratish (bank_mixed), HTTPS, health OK, real-time ulanish, ban/unban dalil bilan, PDF sertifikat va ban tekshiruvi.

---

## 4. API va integratsiya (referens)

Quyidagi endpointlar to‘plami yoki funksional ekvivalenti talab qilinadi (prefix: `/api/`):

| Guruh | Misol |
|--------|--------|
| Sog‘liq | `GET /health` |
| Auth | `POST /auth/login` |
| Talaba | `POST /student/identity-compare`, `GET/POST student/exams...`, `POST .../violations`, `GET .../certificate.pdf`, `GET .../ban-report.pdf` |
| Admin | `GET/POST /admin/users`, `PATCH .../users/<id>`, `DELETE ...`, `POST .../unban`, `admin/levels`, `admin/groups`, `admin/test-bank/*`, `admin/exams/*` |
| Ommaviy | `GET /public/verify-result/<id>`, `GET .../certificate.pdf`, `POST /public/verify-ban-report` |

Aniq URL va metodlar ijrochi hujjatida keltirilishi kerak.

---

## 5. Texnik hujjatlar va qo‘llab-quvvatlash

- **O‘rnatish qo‘llanmasi** (server, domen, SSL, muhit o‘zgaruvchilari).
- **Bootstrap** (boshlang‘ich admin) — parolni birinchi kirishdan keyin almashtirish tavsiyasi.
- **Ma’lumotlar bazasi sxemasi** yoki migratsiyalar ro‘yxati.
- **Tillar** va import cheklovlari foydalanuvchi uchun qisqa **FAQ**.

---

## 6. Tanlovda baholash uchun tavsiya etilgan mezonlar (ixtiyoriy ilova)

| Mezon | Tavsif |
|--------|--------|
| Funksional qamrov | Yuqoridagi 2–3-boblar bo‘yicha foizlik moslik |
| Xavfsizlik | Proktoring chuqurligi, JWT, HTTPS, audit |
| Barqarorlik | Uzoq import, timeoutlar, xatoliklarni boshqarish |
| UX | i18n, progress, mobil brauzer |
| Joylashtirish | Skriptlar, systemd, Nginx, tiklash |
| Qo‘llab-quvvatlash | Hujjatlar, kod sifati, testlar |

---

**Hujjat versiyasi:** 1.0  
**Asos:** FJSTI Online Exam loyihasi mavjud funksiyalari va arxitekturasi.
