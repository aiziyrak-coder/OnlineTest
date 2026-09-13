# Progress — Kafedra → Yo'nalish → Guruh → Talaba ierarxiyasi

To'liq reja: [`KAFEDRA_HIERARCHY_PLAN.md`](KAFEDRA_HIERARCHY_PLAN.md)

Holat belgilari: `[ ]` boshlanmagan · `[~]` jarayonda · `[x]` tayyor

## Bosqich 0 — Talabalar kontingentini import qilish + yillik kurs ko'tarilishi
(Reja tuzilgandan keyin, amaliy ehtiyojdan kelib chiqib qo'shildi — batafsili: PLAN.md §6)
- [x] `data/talablar kotingenti/*.xlsx` fayllar tahlil qilindi (fieldlar, guruh nomlash qoidasi, rasm holati)
- [x] `Group.intake_year` maydoni qo'shildi (`backend/apps/core/models/user.py`)
- [x] Migration yaratildi (`0028_add_group_intake_year.py`) — production migrate qo‘llangan
- [x] `admin_groups` / `admin_group_detail` API'ga `intake_year` qo'shildi (GET/POST/PATCH)
- [x] `Group.is_active` maydoni qo'shildi (migration `0029_add_group_is_active.py`) — production migrate qo‘llangan
- [x] `promote_groups` management command yozildi (`apps/core/management/commands/promote_groups.py`) — dry-run default, `--apply` bilan yozadi, `AuditLog`ga yozadi
- [ ] `promote_groups` real bazada dry-run / cron (har 1-sentyabr) — ops vazifa
- [x] `import_students` management command yozildi (`apps/core/management/commands/import_students.py`) — `openpyxl` qo'shildi (`requirements/base.txt`)
- [x] 10 ta talaba bilan sinov o'tkazildi (lokal Docker Postgres): `TPI-925` guruh yaratildi, HTTP login (ID=parol) tasdiqlandi, test yozuvlari tozalab tashlandi
- [x] `GROUP_RE` tuzatildi — endi faqat katta harfli kod (TPI, DI, MD...) qabul qilinadi, ordinatura/magistratura nomlari (masalan "Kardiologiya-25") avtomatik chetlab o'tiladi
- [x] `scripts/import_full_kontingent.sh` orkestrator skripti yozildi (barcha 5 faylni ketma-ket ishga tushiradi, `--apply` bilan yoki dry-run)
- [x] To'liq dry-run sinovi o'tkazildi (lokal Postgres): 1-kurs=1609, 2-kurs=1367, 4-kurs=764, 5-kurs=483 talaba — jami ~4223 ta, hech narsa yozilmadi (0 xato holida)
- [x] Frontend UI (`GroupsPage.tsx`, `types.ts`, `i18n.ts`) `intake_year` va `is_active` (bitirgan) ko'rsatish/kiritishni qo'llab-quvvatlaydigan qilindi
- [ ] **3-kurs.xlsx hali import qilinmagan** — "Talabalar" sheet'da "Guruh" ustuni umuman yo'q, qo'lda hal qilish kerak (pastga qarang)
- [x] Butun kontingent (4 fayl) **serverning haqiqiy bazasida** `--apply` bilan import qilindi (`kontingent.py`, konteyner ichida) — natija: **4226 talaba, 303 guruh, 15 yo'nalish** (`TPI, FT, BM, OHI, DI, ЛД, MD, SSBJSS, RTT, TBATM, P, S, F, PI, XT`). Haqiqiy HTTP login (`/api/auth/login`, ID=parol) muvaffaqiyatli tasdiqlandi. (2026-08 audit: DB da ~5299 student.)
- [ ] `promote_groups` uchun yillik avtomatik ishga tushirish (cron/scheduled task, har 1-sentyabr)

**Hal qilinmagan muammolar (import oldidan yoki keyin ko'rib chiqiladi):**
- `3-kurs.xlsx` → "Talabalar" sheet (1073 talaba): "Guruh" ustuni yo'q — manba aniqlanishi kerak.
- `3-kurs.xlsx` → "xalqaro" sheet: 256 qatorning barchasi bo'sh (shablon, real ma'lumot yo'q) — e'tiborsiz qoldiriladi.
- Har faylda 1-2 tadan "Morfologiya-NN (Magistratura/uzbek)" kabi ordinatura/magistratura guruh nomlari — avtomatik o'tkazib yuboriladi, keyin qo'lda ko'rib chiqiladi.

### 0.1 — Talaba rasmlari (`profile_image`)

**Sabab**: `apps/api/views/student.py:409-414` — imtihon boshlashdan oldin `profile_image`
kamida 50 belgi bo'lishi **majburiy** (`403 profile_photo_required`). Import qilingan
4226 talabaning barchasida bu maydon bo'sh edi.

**Topilma**: Excel fayllardagi "Rasm"/"Foto"/"Talaba rasmi" ustunlari `openpyxl`da
`#VALUE!` ko'rsatadi, lekin bu — Excel/365'ning **"Picture in Cell" (Rich Data)**
funksiyasi, rasmning o'zi faylda (`xl/media/*`) **butun saqlangan**. Qator↔rasm
bog'lanishi maxsus XML zanjiri orqali tiklanadi: `xl/worksheets/sheet1.xml`
(katakning `vm=` atributi, 1-based) → `xl/metadata.xml` (`<xlrd:rvb i=N/>`) →
`xl/richData/rdrichvalue.xml` (rv indeks, `s="0"`=lokal / `s="1"`=web-rasm) →
`xl/richData/richValueRel.xml` + `_rels/richValueRel.xml.rels` → haqiqiy
`xl/media/imageN.{png,jpg}` fayli. Rasm ustuni har faylda avtomatik aniqlanadi
(eng ko'p `vm=` bor ustun).

- [x] `apps/core/management/commands/seed_student_photos.py` yozildi — rich-data
  zanjirini o'qiydi, `PIL` bilan JPEG'ga o'giradi (uzun tomon max 600px, sifat 82 —
  1.6MB'lik original ~45KB base64'ga tushadi, 2MB chegaradan xavfsiz past), faqat
  `profile_image` bo'sh bo'lgan talabalarga o'rnatadi (`--overwrite` bilan majburlash
  mumkin).
- [x] 10 talabada sinov (lokal Docker Postgres): barcha 10 tasi to'g'ri rasm bilan
  mos keldi (vizual tekshirildi — asl va bazadagi JPEG bir xil odam), keyin tozalab
  tashlandi.
- [x] `kontingent.py`ga `--photos` flag qo'shildi — har fayl uchun talaba import
  qilingandan keyin xuddi o'sha faylning rasmlarini ham biriktiradi
  (`python kontingent.py --apply --photos`). Dry-run rejimida barcha 4 fayl uchun
  tezlik tekshirildi (~2-3 daqiqa, muammosiz).
- [x] Butun kontingentga (production) rasmlar `seed_student_photos --apply` bilan o'rnatildi —
  2026-08-27: Excel cohort (`allaqachon_bor` 1–5 kurs). Qolgan ~1098 talaba
  Excel'da yo‘q / 3-kursda rich-rasm yo‘q — admin orqali yuklash kerak.
- [ ] 3-kurs.xlsx guruh ustuni + rich-rasm manbasi — alohida

## Bosqich 1 — OnlineTest: Kafedra modeli
- [x] `Kafedra` modeli qo'shildi (`backend/apps/core/models/user.py`) — `name` (unique),
  `code` (unique, **null=True** — ikkita bo'sh kod bir-biriga to'qnashmasligi uchun),
  `sort_order`, `is_active`
- [x] `Direction.kafedra` FK qo'shildi (nullable, `SET_NULL`, `related_name="directions"`)
- [x] `apps/core/models/__init__.py`ga eksport qilindi
- [x] Migration yaratildi (`0030_add_kafedra.py`) — lokal Docker Postgres'da sinovdan
  o'tkazildi (2 ta kafedra, biri bo'sh kod bilan — `unique` xato bermadi; `Direction`ga
  FK biriktirish ishladi), keyin tozalab tashlandi. **Serverda hali ishga tushirilmagan.**
- Django admin panelida ro'yxatdan o'tkazilmadi — `Direction` ham ro'yxatdan o'tmagan
  (ataylab, chunki Bosqich 2/3da maxsus admin API/UI orqali boshqariladi)

## Bosqich 2 — OnlineTest: admin CRUD API
- [x] `admin_kafedralar` (GET/POST) va `admin_kafedra_detail` (GET/PATCH/DELETE)
  view'lari yozildi (`apps/api/views/admin.py`) — `admin_directions`/`admin_direction_detail`
  bilan bir xil naqsh (validatsiya, `audit()`, bog'liq yozuv bo'lsa o'chirishga to'siq)
- [x] URL'lar qo'shildi: `admin/kafedralar`, `admin/kafedralar/<int:pk>` (`apps/api/urls.py`)
- [x] `admin_directions` (GET/POST) va `admin_direction_detail` (GET/PATCH/DELETE)
  `kafedra_id`/`kafedra_name` bilan yangilandi — POST/PATCHda `kafedra_id` validatsiya
  qilinadi (mavjud bo'lmasa 400)
- [x] `Kafedra` `_helpers.py` orqali eksport qilindi (wildcard import zanjiri)
- [x] Xato xabarlari qo'shildi (`admin_api_i18n.py`): `kafedra_name_exists`,
  `kafedra_code_exists`, `kafedra_not_found`, `kafedra_has_directions` (uz/ru/en)
- [x] **To'liq HTTP sinovi** (lokal Docker Postgres, real `runserver` + admin token):
  kafedra yaratish (kod bilan/kodsiz), direction'ni kafedra bilan yaratish,
  `direction_count` hisoblash, bog'liq kafedrani o'chirishga to'siq (400),
  uzish (`kafedra_id: null`) + muvaffaqiyatli o'chirish (200) — barchasi to'g'ri
  ishladi. Test paytida bitta bug topilib tuzatildi: PATCH'da `old_name`
  o'zgartirishdan OLDIN emas, KEYIN o'qilayotgan edi (audit logda ma'nosiz
  bo'lardi) — tuzatildi. Test ma'lumotlari va vaqtinchalik admin parol
  tozalab/tiklab qo'yildi.

## Bosqich 3 — OnlineTest admin frontend
- [x] `KafedralarPage.tsx` yozildi (`frontend/src/pages/admin/`) — `DirectionsPage.tsx`
  bilan bir xil naqsh (CRUD, inline edit/delete, bog'liq yozuv bo'lsa o'chirishga
  to'siq), qo'shimcha `code` maydoni bilan
- [x] `types.ts`ga `Kafedra` turi va `Direction.kafedra_id`/`kafedra_name` qo'shildi
- [x] `DirectionsPage.tsx`ga "Kafedra" dropdown qo'shildi (qo'shish formasi +
  inline tahrirlash), ro'yxatda `kafedra_name` ko'rsatiladi
- [x] `AdminDashboard.tsx`ga yangi sahifa ulandi: `AdminPage` turi, `PAGE_PATHS`
  (`/admin/kafedralar`), sidebar nav item ("Darajalar" bilan "Yo'nalishlar"
  orasida), render bloki
- [x] i18n: uz/ru/en uchta tilda barcha yangi matnlar qo'shildi
  (`kontingentKafedralar`, `kafedraLabel`, `kafedraHasDirections`, ...)
- [x] `tsc --noEmit` va `npm run build` — ikkalasi ham toza (xatosiz)
- [x] **To'liq brauzer E2E sinovi** (real Vite dev server + Django + lokal Postgres,
  haqiqiy admin login orqali): "Kafedralar" menyusi ko'rindi → kafedra yaratildi
  (kod bilan) → "Yo'nalishlar" sahifasida yangi kafedra dropdown'da chiqdi →
  yo'nalish shu kafedra bilan yaratildi → ro'yxatda "TESTDIR — UI Test Kafedra ·
  0 Guruhlar" to'g'ri ko'rindi → Kafedralar sahifasida "1 Yo'nalishlar" to'g'ri
  yangilandi → bog'liq kafedrani o'chirishga urinishda to'g'ri ogohlantirish
  chiqdi (o'chirish bloklandi). Test ma'lumotlari va vaqtinchalik admin parol
  tozalab/tiklab qo'yildi.

### 3.1 — Kafedra ro'yxatini boshlang'ich to'ldirish

- [x] `apps/core/management/commands/seed_kafedralar.py` yozildi — 46 ta kafedra
  nomini bir martada yaratadi (manba: Excel fayllardagi ordinatura/magistratura
  guruh nomlaridan chiqarilgan, imlo xatolari va yil/til variantlari tozalangan,
  masalan "Kardiologiya-25 (Magistratura) rus" → "Kardiologiya"). Idempotent
  (`get_or_create`), dry-run default. Lokal Postgres'da sinovdan o'tkazildi:
  birinchi ishga tushirishda 46 yangi, ikkinchisida 0 yangi/46 mavjud — to'g'ri.
- [x] Serverda `--apply` bilan ishga tushirilgan (production deploy 2026-08-02; audit 2026-08-27: kafedralar jadvali mavjud).

**⚠️ Ochiq kontseptual savol — Kafedra↔Direction bog'lanishi**: mavjud 15 ta
`Direction` (`TPI, DI, MD, PI, S, F, OHI, FT, BM, XT, RTT, SSBJSS, TBATM, P, ЛД`)
— bular **bakalavriat yo'nalishlari**. Yangi 46 ta `Kafedra` esa Excel'dagi
**ordinatura/magistratura** mutaxassislik nomlaridan chiqarilgan — bular boshqa
daraja/miqyos (bitta bakalavriat yo'nalishini odatda o'nlab kafedra birgalikda
o'qitadi, faqat bittasiga tegishli emas). Foydalanuvchi bilan aniqlashtirilgan
qaror: **hozircha bog'lashni qo'lda, admin panel orqali (Yo'nalishlar sahifasi
→ Tahrirlash → Kafedra tanlash) amalga oshiramiz**, keyinroq qayta ko'rib
chiqiladi — avtomatik/skript bilan bog'lash qilinmaydi (chunki to'g'ri xarita
faqat foydalanuvchi/dekanatga ma'lum).

## Bosqich 4 — OnlineTest: iMentor uchun ochiq katalog API
- [x] Autentifikatsiya kaliti mexanizmi tanlandi: `X-Api-Key` header, `ONLINE_TEST_PUBLIC_API_KEYS`
  env var (vergul bilan bir nechta kalit) — iMentor'ning `IMENTOR_EXTERNAL_API_KEYS`/`X-Api-Key`
  naqshiga o'xshab (`imentor/backend/core/external_api_views.py`), lekin teskari yo'nalish uchun
  alohida env var/kalit
- [x] `GET /api/public/academic-catalog/` yozildi (`apps/api/views/public.py`,
  `apps/api/urls.py`) — auth talab qilmaydi (`@permission_classes([AllowAny])`),
  o'zi ichida `X-Api-Key` tekshiradi (`internal_realtime_exam_access` bilan bir xil
  naqsh). Javob: `{kafedralar: [{id,name,code,directions:[{id,name,groups:[{id,name,
  level,student_count}]}]}], unassigned_directions: [...]}`. Faqat `is_active=True`
  kafedra/guruhlar chiqadi.
- [x] To'liq sinov (lokal Docker Postgres, real `runserver`): kalitsiz so'rov → 403,
  noto'g'ri kalit → 403, ikkita turli to'g'ri kalit → ikkalasi ham 200 (bir nechta
  hamkor kaliti ishlashi tasdiqlandi), test ma'lumoti bilan daraxt tuzilishi
  (kafedra→direction→group, `student_count`, kafedrasiz yo'nalish `unassigned_directions`da)
  to'g'ri chiqdi. Test ma'lumotlari tozalab tashlandi.
- [x] Serverda `ONLINE_TEST_PUBLIC_API_KEYS` sozlangan (production deploy yakunlangan).
- Production manzil (iMentor tomonidan chaqiriladigan): `https://online-imtixon.uz/api/public/academic-catalog/`

## Bosqich 5 — iMentor: klient funksiyasi
- [x] `fetch_academic_catalog()` qo'shildi (`imentor/backend/core/online_test_client.py`) —
  `GET /api/public/academic-catalog/` ni `X-Api-Key: ONLINE_TEST_CONSUMER_API_KEY` bilan
  chaqiradi, `OnlineTestAuthError` orqali xatolarni birxillashtiradi (login funksiyasi
  bilan bir xil naqsh)
- [x] Keshlash qo'shildi — `django.core.cache.cache`, kalit
  `online_test:academic_catalog`, TTL 600s (10 daqiqa). `use_cache=False` bilan
  chetlab o'tish mumkin (masalan admin panelda "Yangilash" tugmasi uchun)
- [x] `settings/base.py`ga `ONLINE_TEST_CONSUMER_API_KEY` qo'shildi;
  `.env.example` (ikkalasi), `deploy/.env.production`,
  `docker-compose.dev.yml`/`docker-compose.prod.yml`ga ham qo'shildi
  (`ONLINE_TEST_API_BASE_URL`ga o'xshab)
- [x] `requirements.txt`da `requests` bor edi, lekin lokal `.venv`da o'rnatilmagan
  ekan — o'rnatildi (test uchun; production image build vaqtida avtomatik
  o'rnatiladi, alohida qadam kerak emas)
- [x] **To'liq E2E sinov** (ikkala loyiha bir vaqtda, lokal Postgres + real
  OnlineTest server + iMentor Django muhiti): (1) haqiqiy so'rov — kafedra/
  yo'nalish/guruh to'g'ri keldi; (2) OnlineTest manzili keyin **noto'g'ri portga**
  almashtirilib, qayta chaqirilganda **kesh orqali** (tarmoqqa umuman urilmasdan)
  bir xil natija qaytdi; (3) `use_cache=False` bilan (kesh chetlab o'tilib)
  noto'g'ri portga urinilganda `OnlineTestAuthError` to'g'ri ko'tarildi
  (502, "OnlineTest ga ulanib bo'lmadi."). Test ma'lumotlari tozalab tashlandi.

## Bosqich 6 — iMentor: frontendda ishlatish
- [x] Qaysi ekranlar aniqlandi (Explore agenti orqali): `AdminStaffManagement.tsx`
  (admin xodim CRUD) va `RegisterPage.tsx` (o'z-o'zini ro'yxatdan o'tkazish) —
  ikkalasida ham `faculty/department/direction/study_group` erkin matn edi.
  `ClinicalGroupMember` uchun frontend forma topilmadi (hali qurilmagan yoki
  boshqa nom bilan).
- [x] **Amaliy qamrov qarori**: faqat `AdminStaffManagement.tsx` (admin, nazorat
  ostidagi sirt) o'zgartirildi bu safar; `RegisterPage.tsx` (ochiq/public forma)
  va `ClinicalGroupMember` — keyingi safarga qoldirildi (pastga qarang).
- [x] Backend proxy: `AcademicCatalogView` (`imentor/backend/core/views.py`) —
  `fetch_academic_catalog()`ni frontendga beradi, `JWTAuthentication` +
  `IsAuthenticated, HasAnyPlatformRole` bilan himoyalangan (OnlineTest kaliti
  frontendga hech qachon chiqmaydi — `online_test_login`/`OnlineTestStudentLoginView`
  bilan bir xil naqsh). URL: `v1/academic-catalog/`.
- [x] Frontend: `utils/academicCatalogApi.ts` — backend proxyni chaqiradi,
  5 daqiqalik client-side kesh bilan.
- [x] `AdminStaffManagement.tsx`: `department` (=Kafedra), `direction`,
  `studyGroup` maydonlari endi kaskadli dropdown (Kafedra → Yo'nalish → Guruh),
  agar katalog yuklanmasa yoki mavjud qiymat katalogga mos kelmasa — oddiy matn
  inputga qaytadi (buzilmaydigan fallback). **Muhim dizayn qarori**: model
  maydonlari hamon `CharField` (matn) — schema o'zgarmadi, faqat kiritish endi
  erkin emas, katalogdan tanlanadi (nom matni saqlanadi, ID emas) — bu
  breaking change emas, migratsiya kerak emas.
  `faculty` **o'zgartirilmadi** (yangi ierarxiyada mos keladigan daraja yo'q).
- [x] i18n: `admin.notSelected` uz/ru/en qo'shildi.
- [x] `tsc --noEmit` va `npm run build` (imentor frontend) — toza (3 ta
  oldindan mavjud, mensiz faylga tegishli xato bor edi — tasdiqlandi, mening
  o'zgarishlarimga aloqasi yo'q).
- [x] **To'liq E2E sinov**: ikkala loyiha birga (real OnlineTest server + iMentor
  Django muhiti, `manage.py test` orqali DRF marshrutini haqiqiy chaqirib):
  `AcademicCatalogView` → `200 OK`, test kafedra/yo'nalish/guruh to'g'ri
  qaytdi. Test ma'lumotlari va vaqtinchalik test fayli tozalab tashlandi.

**Qoldirilgan (keyingi safar)**: `RegisterPage.tsx` (ochiq ro'yxatdan o'tish
formasi) va `ClinicalGroupMember` UI — agar topilsa/qurilsa — xuddi shu
`academicCatalogApi.ts` yordamchisidan foydalanib, xuddi shunday kaskadli
dropdown qo'shish kerak bo'ladi.

## Bosqich 7 — Tozalash (keyingi safar, alohida reja kerak)
- [ ] Rejalashtirilmagan — hozircha kutilmoqda

## Bosqich 8 — Test bazasi (imtihon) yaratish oqimini Direction bilan integratsiya qilish
(Bosqich 1-2 va Bosqich 0 to'liq tugagandan keyin boshlanadi — batafsili: PLAN.md §"Bosqich 8")
- [x] `Exam.direction` FK qo'shildi (`apps/core/models/exam.py`, nullable,
  `SET_NULL`) — migration `0031_add_exam_direction.py`
- [x] Direction validatsiya/avtomatik bog'lash (`_admin_exams_create_impl`,
  `_helpers.py`): admin `direction_id`ni to'g'ridan-to'g'ri yuborishi mumkin
  (validatsiya bilan — mavjud bo'lmasa 400); yubormasa va rejim
  `imentor_mixed` bo'lsa, tanlangan `variant_label` `Direction.name`ga
  (katta-kichik harfga sezgir emas) solishtiriladi — mos kelsa avtomatik
  bog'lanadi, mos kelmasa jim o'tkazib yuboriladi (imtihon yaratish
  bloklanmaydi — hozircha kafedra↔yo'nalish to'liq bog'lanmagani uchun
  yumshoq yondashuv tanlandi).
- [x] `admin_exam_detail` PATCH ham `direction_id`ni qo'llab-quvvatlaydi
  (o'rnatish/`null` bilan uzish/noto'g'ri qiymatda 400).
- [x] `_exam_row_dict` javobiga `direction_id`/`direction_name` qo'shildi;
  ikkala `Exam.objects.select_related("teacher")` chaqiruviga `"direction"`
  ham qo'shildi (N+1 oldini olish uchun).
- [x] Frontend (`ImtixonTab.tsx`): guruh tanlashda **"Yo'nalish bo'yicha
  filtr"** dropdown va **"Shu yo'nalishdagi barchasini tanlash"** tugmasi
  qo'shildi — qo'shimcha API so'rovsiz (guruh ro'yxatida `direction_id`/
  `direction_name` allaqachon bor edi). `GroupMultiSelect`ning o'zi
  o'zgartirilmadi (generic saqlandi) — filtr shunchaki `selGroups`ga
  bulk qo'shadi.
- [x] i18n: `selectDirectionFilter`, `selectAllGroupsInDirection` uz/ru/en.
- [x] `tsc --noEmit` (frontend) — toza.
- [x] **To'liq HTTP E2E sinov** (lokal Docker Postgres, real admin login):
  to'g'ri `direction_id` bilan yaratish → detail'da `direction_name` to'g'ri
  chiqdi; noto'g'ri `direction_id` bilan yaratish → `400`; PATCH orqali
  `direction_id: null` (uzish) → muvaffaqiyatli; PATCH noto'g'ri
  `direction_id` → `400`; ro'yxat sahifasi (`select_related`) → `200`.
  Test ma'lumotlari va vaqtinchalik admin parol tozalab/tiklab qo'yildi.
- [ ] (ixtiyoriy, keyingi safar) iMentor `CourseSyllabus.variants`ga barqaror
  `direction_code` qo'shish — ikkala tizim endi "tasodifiy bir xil matn"ga
  emas, balki aniq kodga tayanishi uchun.

### 8.1 — iMentor'ning ikkinchi, mustaqil "Kafedra" jadvalini sinxronlash

**Topilma**: iMentor'da syllabus (fan/test bazasi) katalogi uchun **allaqachon
o'zining alohida `AcademicDepartment` modeli bor edi** (`imentor/backend/core/
models.py:82` — "Kafedra — fan syllabus katalogining yuqori darajasi"),
OnlineTest'dagi yangi `Kafedra`dan **butunlay mustaqil**. Ya'ni ikkita
bog'lanmagan "Kafedra" ro'yxati bor edi.

- [x] `imentor/backend/core/management/commands/sync_kafedra_from_onlinetest.py`
  yozildi — OnlineTest'ning `academic-catalog` API'sidan Kafedra nomlarini
  o'qib, iMentor'ning `AcademicDepartment`iga yozadi/yangilaydi (nom bo'yicha
  moslashtirish, katta-kichik harfga sezgir emas).
- [x] Kod (`code`) muammosi hal qilindi: OnlineTest'da `code` ixtiyoriy
  (ko'p kafedrada bo'sh), lekin iMentor'da `AcademicDepartment.code` **majburiy
  va unikal** — shuning uchun kodsiz kafedralar uchun nomdan avtomatik kod
  generatsiya qilinadi (so'zlarning bosh harflari), to'qnashsa raqam qo'shiladi.
- [x] **To'liq sinov** (`manage.py test` orqali, real OnlineTest serveriga
  ulanib): 46 ta kafedradan 45 tasi yangi yaratildi, oldindan boshqa kod bilan
  mavjud bo'lgan "Kardiologiya" to'g'ri yangilandi (`OLDCODE` → `KRD`), kodsiz
  kafedralar uchun avtomatik kod ishladi, **ikkinchi marta ishga tushirilganda
  0 yangi/0 yangilangan/46 o'zgarishsiz** — to'liq idempotent. Test ma'lumotlari
  tozalab tashlandi.
- [ ] Serverda hali ishga tushirilmagan — keyingi qadam:
  `python manage.py sync_kafedra_from_onlinetest --apply`
- [ ] Muntazam avtomatik ishga tushirish (masalan kunlik cron) — hozircha
  rejalashtirilmagan, qo'lda ishga tushiriladi.

---

## Ishlab chiqarishga chiqarish — YAKUNLANDI (2026-08-02)

Bosqich 0–6, 8 va 8.1 **barchasi production serverda ishga tushirildi va
tasdiqlandi** (foydalanuvchi tomonidan real serverda sinovdan o'tkazildi):

- OnlineTest: kod deploy qilindi (`git pull` + `docker compose build`),
  migratsiyalar qo'llandi, `ONLINE_TEST_PUBLIC_API_KEYS` sozlandi,
  `seed_kafedralar --apply` bajarildi.
- iMentor: `ONLINE_TEST_CONSUMER_API_KEY` sozlandi (OnlineTest bilan bir xil
  kalit), `sync_kafedra_from_onlinetest --apply` bajarildi — natija: **42
  yangi + 4 mavjud = 46/46** to'g'ri sinxronlandi.
- `GET /api/public/academic-catalog/` production'da tasdiqlangan (`curl` orqali
  200 OK, real JSON).

**Yo'lda topilgan va hal qilingan muammolar** (kelajakda shunga o'xshash holat
uchun eslatma):
1. Kod avtomatik commit qilingan, lekin GitHub'ga push qilinmagan edi — server
   `git pull` bilan yangilanmadi, `/api/public/academic-catalog/` 404 qaytardi.
   Yechim: ish stantsiyasidan `git push origin main`, keyin serverda
   `git pull && docker compose up -d --build`.
2. `seed_kafedralar` (OnlineTest) va `sync_kafedra_from_onlinetest` (iMentor) —
   ikki xil loyihaning ikki xil buyrug'i, birinchi urinishda aralashtirilgan.

**Qolgan ochiq ish**: Kafedra↔Direction bog'lash (qo'lda, foydalanuvchi
tomonidan bajariladi), 3-kurs.xlsx (1073 talaba, guruh manbasi noaniq),
`RegisterPage.tsx`/`ClinicalGroupMember` UI (Bosqich 6 qoldirilgan qismi).

## Admin UI sayqal — pagination va icon tuzatish (2026-08-02)

Kafedra loyihasidan tashqari, umumiy admin panel UI so'rovi bo'yicha:

- [x] `AdminDashboard.tsx`: `directions` (Yo'nalishlar) nav item uchun icon
  butunlay yo'q edi (eski xato, Kafedra loyihasiga aloqasi yo'q) — qo'shildi.
- [x] `pages/admin/ui.tsx`ga reusable `usePagedList()` hook va
  `AdminPagination` komponenti qo'shildi (client-side, 20 tadan sahifalash).
- [x] Qo'llanildi: `LevelsPage`, `KafedralarPage`, `DirectionsPage`,
  `GroupsPage`, `StudentsPage`, `BannedPage` (2 ro'yxat: bloklanganlar +
  shikoyatlar), `StaffPage` (2 ro'yxat: xodim + admin), `AdminExamsTab`
  (imtihonlar ro'yxati) — jami 9 ta ro'yxat.
- `AuditPage.tsx` — tegilmadi, u allaqachon server-side pagination bilan
  ishlaydi.
- `AdminExamsTab`dagi natijalar jadvali (bitta imtihon ichidagi talaba
  natijalari) — tegilmadi, allaqachon `max-h-[70vh] overflow-y-auto` bilan
  cheklangan, alohida pagination shart emas deb topildi.
- [x] `tsc --noEmit` va `npm run build` — toza.
- [x] **Brauzerda real sinov** (lokal Docker Postgres, 46 ta kafedra bilan):
  "Kafedralar" sahifasida `1–20 / 46`, `1 / 3` to'g'ri ko'rindi; "keyingi"
  tugmasi bosilganda `21–40 / 46`, `2 / 3`ga to'g'ri o'tdi. Test ma'lumotlari
  tozalab tashlandi.
