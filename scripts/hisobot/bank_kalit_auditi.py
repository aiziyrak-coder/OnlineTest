"""Xirurgiya imtihonidagi "to'g'ri javob" kalitini MUSTAQIL tekshirish.

Shikoyat: "javoblar to'g'ri emas". Tekshiruv usuli: modelga kalit KO'RSATILMAYDI —
faqat savol va variantlar beriladi, u o'zi to'g'ri variantni tanlaydi. Keyin
bankdagi kalit bilan solishtiriladi. Talabalar aynan olgan savollar tekshiriladi.
"""
import json
import random
from concurrent.futures import ThreadPoolExecutor

from apps.api.ai_question_gen import _exam_model
from apps.api.openai_client import chat_text
from apps.core.models import Exam, StudentExam

PROMPT = """Sen jarrohlik (umumiy xirurgiya) bo'yicha professorsan. Quyidagi bir tanlovli
test savoliga qaysi variant TO'G'RI javob bo'lishini aniqla. Faqat JSON qaytar:
{{"correct": "<variant matni aynan ko'chirilgan>", "confidence": <0..1>, "why": "<15 so'zgacha izoh>"}}

SAVOL: {q}
VARIANTLAR:
{opts}"""


def ask(q):
    body = PROMPT.format(q=str(q.get("text") or ""),
                         opts="\n".join("- %s" % o for o in (q.get("options") or [])))
    try:
        raw = chat_text(body, temperature=0.0, model=_exam_model())
        i, j = raw.find("{"), raw.rfind("}")
        d = json.loads(raw[i:j + 1]) if i >= 0 else {}
    except Exception as ex:  # noqa: BLE001
        return {"error": str(ex)[:80]}
    return d


def norm(s):
    return " ".join(str(s or "").lower().replace("’", "'").split())


# Talabalar aynan olgan savollar (561 = o'zbekcha, 567 = ruscha)
seen = {}
for se in StudentExam.objects.filter(exam_id__in=[561, 567], status="Completed"):
    for q in json.loads(se.session_questions_json or "[]"):
        seen[norm(q.get("text"))] = q
qs = list(seen.values())
print("Talabalarga tushgan savollar:", len(qs))

# Bankdan qo'shimcha tasodifiy namuna
bank = json.loads(Exam.objects.get(pk=561).questions_json or "[]")
random.seed(7)
extra = []
pool = qs + extra
print("Jami tekshiriladi:", len(pool))

with ThreadPoolExecutor(max_workers=8) as ex:
    res = list(ex.map(ask, pool))

ok = bad = err = lowconf = 0
wrong_rows = []
for q, r in zip(pool, res):
    if not isinstance(r, dict) or r.get("error") or not r.get("correct"):
        err += 1
        continue
    picked = norm(r.get("correct"))
    key = norm(q.get("correctAnswer"))
    opts = [norm(o) for o in (q.get("options") or [])]
    if picked not in opts:                 # model variantni aynan ko'chirmadi
        err += 1
        continue
    conf = float(r.get("confidence") or 0)
    if picked == key:
        ok += 1
    else:
        bad += 1
        if conf < 0.7:
            lowconf += 1
        wrong_rows.append({
            "text": str(q.get("text"))[:130],
            "bank": str(q.get("correctAnswer"))[:70],
            "expert": str(r.get("correct"))[:70],
            "conf": conf,
            "why": str(r.get("why"))[:90],
        })

print("\nNATIJA: kalit mos %d | kalit boshqa %d | tekshirilmadi %d" % (ok, bad, err))
tot = ok + bad
print("Mos kelish darajasi: %s%%" % (round(ok / tot * 100) if tot else 0))
print("Mos kelmaganlaridan ishonchi past (<0.7): %d" % lowconf)
print("\nMOS KELMAGAN NAMUNALAR (eng ishonchli 12 tasi):")
for r in sorted(wrong_rows, key=lambda x: -x["conf"])[:12]:
    print(" -", r["text"])
    print("     bankdagi kalit :", r["bank"])
    print("     ekspert javobi :", r["expert"], "(ishonch %.2f)" % r["conf"], "|", r["why"])

json.dump(wrong_rows, open("/tmp/xirurgiya_audit_kuchli.json", "w"), ensure_ascii=False, indent=1)
print("\nto'liq ro'yxat: /tmp/xirurgiya_audit.json (%d qator)" % len(wrong_rows))
