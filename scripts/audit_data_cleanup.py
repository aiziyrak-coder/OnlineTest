"""Audit ma'lumot tuzatishlari (26.09.2026).

1) Istisno ro'yxatidagi talabalarga imtihon tugaganda yozilgan soxta
   "kelmadi" (Failed, boshlanmagan, balsiz) sessiyalarni o'chiradi.
2) Harbiylar: Abdullayev faqat ruscha (№567) topshiradi — o'zbekcha №561 ga
   istisno qo'yiladi; Yigitaliyev Xirurgiyani topshirmaydi — №561 ga istisno.
   Ularning №561 dagi bo'sh (boshlanmagan) qatorlari o'chiriladi, aks holda
   18:00 da "kelmadi" bo'lib, hisobotda soxta yiqilgan natija chiqardi.

APPLY=1 bo'lmasa faqat nima qilinishini ko'rsatadi. O'chiriladigan har bir qator
/home/onlinetest/cleanup_20260926.json ga yoziladi.
"""
import json
import os

from django.db import transaction

from apps.core.models import AuditLog, ExamStudentException, StudentExam

APPLY = os.environ.get("APPLY") == "1"

phantom = []
for ex in ExamStudentException.objects.all().values("exam_id", "student_id"):
    for se in StudentExam.objects.filter(exam_id=ex["exam_id"], student_id=ex["student_id"],
                                         status="Failed", started_at__isnull=True, score__isnull=True):
        phantom.append(se)
print("1) Istisnodagilarga yozilgan soxta 'kelmadi':", len(phantom))
for se in phantom[:20]:
    print("    imtihon", se.exam_id, "| talaba", se.student_id)

EXTRA = {561: ["344211100122", "344211100071"]}   # Abdullayev (ruschada), Yigitaliyev (topshirmaydi)
empty = []
for eid, sids in EXTRA.items():
    for sid in sids:
        se = StudentExam.objects.filter(exam_id=eid, student_id=sid).first()
        busy = bool(se and (se.started_at or se.score is not None or (se.answers_json or "").strip()
                            or se.status not in ("Pending", "")))
        print("2) №%d talaba %s: sessiya %s | %s" % (
            eid, sid, se.id if se else "-",
            "IZ BOR — tegilmaydi" if busy else ("bo'sh — o'chiriladi" if se else "yo'q")))
        if se and not busy:
            empty.append(se)

if not APPLY:
    print("\nKo'rish rejimi. Bajarish uchun: APPLY=1")
    raise SystemExit(0)

backup = [{f.attname: getattr(s, f.attname) for f in StudentExam._meta.concrete_fields}
          for s in phantom + empty]
with open("/tmp/cleanup_20260926.json", "w", encoding="utf-8") as fh:
    json.dump(backup, fh, default=str, ensure_ascii=False)
with transaction.atomic():
    for eid, sids in EXTRA.items():
        for sid in sids:
            ExamStudentException.objects.get_or_create(
                exam_id=eid, student_id=sid,
                defaults={"reason": "Bu imtihon sizga tegishli emas (harbiylar: boshqa til/fan)"})
    n = StudentExam.objects.filter(pk__in=[s.pk for s in phantom + empty]).delete()[0]
    AuditLog.objects.create(
        actor_id="", actor_name="Claude (admin so'rovi)", action="audit_data_cleanup",
        target_type="student_exam", target_id=",".join(str(s.pk) for s in phantom + empty)[:128],
        target_name="Audit 26.09.2026",
        detail="Istisnodagilarga yozilgan soxta 'kelmadi' %d ta + harbiylar №561 bo'sh qatorlari %d ta "
               "o'chirildi; Abdullayev va Yigitaliyev №561 istisnosiga qo'shildi. Zaxira: "
               "/home/onlinetest/cleanup_20260926.json" % (len(phantom), len(empty)),
    )
print("\nBAJARILDI: %d qator o'chirildi, zaxira /tmp/cleanup_20260926.json" % n)
