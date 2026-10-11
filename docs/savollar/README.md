# Claude yozgan savollar (11.10.2026)

Bu papkadagi fayllar — banki tor bo'lgan fanlar uchun yozilgan savollar.
Hammasi markaziy test bazaga (`TestBankQuestion`) qo'shilgan; bazada ularni
`created_at` sanasi bo'yicha ajratish mumkin.

| Fayl | Fan (to'plam) | Savol |
|---|---|---|
| `bolalar-immunologiya-40-savol-2026-10-11.json` | Bolalar immunologiya-allergologiyasi — ordinatura 2-kurs | 40 |
| `573_neonatalogiya-2026-10-11.json` | Neonatalogiya — ordinatura 1-kurs | 40 |
| `571_endokrinologiya-2026-10-11.json` | Endokrinologiya — ordinatura 1-kurs | 40 |
| `574_pediatriya-2026-10-11.json` | Pediatriya — ordinatura 1-kurs | 40 |
| `572_laboratoriya-2026-10-11.json` | Laboratoriya ishi — ordinatura 1-kurs | 40 |
| `585_mehnat-2026-10-11.json` | Mehnat gigiyenasi — ordinatura 2-kurs | 43 |

Har bir savol: klinik holat bayoni, 5 ta bir xil turdagi variant, bitta eng
to'g'ri javob. Qo'shishdan oldin uch bosqichdan o'tgan:

1. mexanik tekshiruv (`apps/api/usmle_screen.appeal_risks`) — bo'sh bo'lishi shart;
2. mavjud bank va shu fanning imtihonlari bilan matn yaqinligi 0.80 dan past
   (amalda eng yuqori moslik 39%) — ya'ni ilgari tushgan savol takrorlanmaydi;
3. USMLE balli va shubha belgilari hisobotda ko'rsatilgan.

## KAFEDRA KO'RIGI TALAB QILINADI

Savollarni Claude yozgan. Kalitlar darslik darajasidagi, bir ma'noli
faktlarga asoslangan, lekin fan mutaxassisi tomonidan tasdiqlanmagan.
Imtihondan oldin yoki keyin kafedra ko'rib chiqishi kerak; e'tiroz bo'lgan
savol markaziy bazadan chiqarilishi lozim.

Qo'shish buyrug'i (namuna):

    FAYL=/app/<fayl>.json APPLY=1 python manage.py shell -c "exec(open('/app/imp.py').read())"
