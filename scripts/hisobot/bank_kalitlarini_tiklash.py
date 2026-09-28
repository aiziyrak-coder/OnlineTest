"""Harbiylar banklarining TO'G'RI kalitini tiklaydi.

MTF fayllaridan o'girishda "birinchi variant to'g'ri" deb qabul qilingan edi —
bu xato bo'lib chiqdi. Endi har bir savol IKKI MARTA mustaqil tekshiriladi:
variantlar har safar boshqa tartibda beriladi, kalit ko'rsatilmaydi. Ikki
javob bir xil va ishonch yuqori bo'lsa — savol qabul qilinadi va kalit shu
javobga qo'yiladi. Aks holda savol bankdan chiqariladi.

Ishlatish: python manage.py shell < rebuild_keys.py
Natija: /tmp/banklar/<exam_id>_tekshirilgan.json (imtihonga hali yozilmaydi).
"""
import json
import os
import random
from concurrent.futures import ThreadPoolExecutor

from apps.api.ai_question_gen import _exam_model
from apps.api.openai_client import chat_text
from apps.core.models import Exam

OUT = "/tmp/banklar"
os.makedirs(OUT, exist_ok=True)

TARGET = {561: ("umumiy xirurgiya va xirurgik kasalliklar", 260),
          563: ("oftalmologiya", 200),
          564: ("ftiziatriya (sil kasalligi)", 200)}
MIN_CONF = 0.8

PROMPT = """Sen {subject} bo'yicha professorsan. Quyidagi bir tanlovli test savoliga
QAYSI variant to'g'ri javob ekanini aniqla. Faqat JSON qaytar:
{{"correct": "<variant matnini AYNAN ko'chir>", "confidence": <0..1>}}
Agar savol noaniq bo'lsa yoki bitta to'g'ri javob aniqlanmasa: {{"correct": "", "confidence": 0}}

SAVOL: {q}
VARIANTLAR:
{opts}"""


def norm(s):
    return " ".join(str(s or "").lower().replace("’", "'").replace("‘", "'").split())


def ask(args):
    q, subject, seed = args
    opts = list(q.get("options") or [])
    random.Random(seed).shuffle(opts)          # tartib javobni oshkor qilmasin
    body = PROMPT.format(subject=subject, q=str(q.get("text") or ""),
                         opts="\n".join("- %s" % o for o in opts))
    try:
        raw = chat_text(body, temperature=0.0, model=_exam_model())
        i, j = raw.find("{"), raw.rfind("}")
        d = json.loads(raw[i:j + 1]) if i >= 0 else {}
    except Exception:  # noqa: BLE001
        return None
    pick = norm(d.get("correct"))
    conf = float(d.get("confidence") or 0)
    if not pick or pick not in [norm(o) for o in opts] or conf < MIN_CONF:
        return None
    # aynan variant matnini qaytaramiz (registr saqlanadi)
    for o in opts:
        if norm(o) == pick:
            return (o, conf)
    return None


for eid, (subject, want) in TARGET.items():
    e = Exam.objects.get(pk=eid)
    bank = json.loads(e.questions_json or "[]")
    random.Random(eid).shuffle(bank)
    pool = bank[:want]
    print("\n=== [%s] %s | bankda %d, tekshiriladi %d" % (eid, e.title[:45], len(bank), len(pool)))

    with ThreadPoolExecutor(max_workers=10) as ex:
        r1 = list(ex.map(ask, [(q, subject, 1) for q in pool]))
    with ThreadPoolExecutor(max_workers=10) as ex:
        r2 = list(ex.map(ask, [(q, subject, 99) for q in pool]))

    good, changed, kept, dropped = [], 0, 0, 0
    for q, a, b in zip(pool, r1, r2):
        if not a or not b or norm(a[0]) != norm(b[0]):
            dropped += 1
            continue
        nq = dict(q)
        if norm(q.get("correctAnswer")) != norm(a[0]):
            changed += 1
        else:
            kept += 1
        nq["correctAnswer"] = a[0]
        nq["key_source"] = "ikki bosqichli mustaqil tekshiruv"
        nq["key_confidence"] = round(min(a[1], b[1]), 2)
        good.append(nq)
    for i, q in enumerate(good, 1):
        q["id"] = i
    print("   QABUL: %d savol | kalit tuzatildi: %d | avvalgi kalit to'g'ri edi: %d | chiqarildi: %d"
          % (len(good), changed, kept, dropped))
    if good:
        print("   namuna:", good[0]["text"][:80], "->", good[0]["correctAnswer"][:50])
    json.dump(good, open("%s/%d_tekshirilgan.json" % (OUT, eid), "w"), ensure_ascii=False)
    json.dump(bank, open("%s/%d_asl_zaxira.json" % (OUT, eid), "w"), ensure_ascii=False)
print("\nTayyor:", os.listdir(OUT))
