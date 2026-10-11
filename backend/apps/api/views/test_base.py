"""Test baza — markaziy savol bazasining sifat ko'rinishi.

Admin panelidagi "Test baza" sahifasi shu yerdan ma'lumot oladi: har bir
to'plamda nechta savol bor, ularning USMLE darajasi qanday, nechtasida
apellyatsiyaga sabab bo'luvchi nuqson bor va nechtasini odam ko'rib
chiqishi kerak.

Nuqson va daraja hisobi `apps/api/usmle_screen.py` da; u savolni qayta
yozmaydi, faqat baholaydi.
"""
from __future__ import annotations

import json

from apps.api.usmle_screen import appeal_risks, review_flags, usmle_score
from apps.api.views._helpers import *  # noqa: F401,F403
from apps.core.models import TestBankCategory, TestBankQuestion


def _as_exam_dict(q: TestBankQuestion) -> dict:
    """Bank qatorini saralovchi tushunadigan ko'rinishga keltiradi."""
    def _opts(raw: str) -> list:
        try:
            val = json.loads(raw or "[]")
        except (TypeError, ValueError):
            return []
        return [str(x) for x in val] if isinstance(val, list) else []

    opts = _opts(q.options_uz_json) or _opts(q.options_json) or _opts(q.options_en_json)
    return {
        "id": q.id,
        "text": q.text_uz or q.text or q.text_en or "",
        "options": opts,
        "correctAnswer": q.correct_answer_uz or q.correct_answer or q.correct_answer_en or "",
    }


def _stats(rows: list[dict]) -> dict:
    n = len(rows)
    if not n:
        return {"total": 0, "avg_score": 0, "avg_len": 0, "defects": 0, "review": 0,
                "strong": 0, "weak": 0}
    scores = [usmle_score(q) for q in rows]
    lens = [len(str(q.get("text") or "")) for q in rows]
    defects = sum(1 for q in rows if appeal_risks(q))
    review = sum(1 for q in rows if review_flags(q))
    return {
        "total": n,
        "avg_score": round(sum(scores) / n, 1),
        "avg_len": int(sum(lens) / n),
        "defects": defects,
        "review": review,
        # Imtihonga tayyor: USMLE balli 8 dan baland va nuqsonsiz.
        "strong": sum(1 for q, s in zip(rows, scores) if s >= 8 and not appeal_risks(q)),
        "weak": sum(1 for s in scores if s <= 4),
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_test_base_quality(request):
    """To'plamlar kesimida sifat ko'rsatkichlari.

    `?category_id=` berilsa — o'sha to'plamdagi nuqsonli va shubhali
    savollar ro'yxati (odam ko'rib tuzatishi uchun).
    """
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)

    cid = request.query_params.get("category_id")
    if cid:
        try:
            cid_int = int(cid)
        except (TypeError, ValueError):
            return Response({"error": "category_id butun son bo'lsin"}, status=400)
        out = []
        for q in TestBankQuestion.objects.filter(category_id=cid_int).order_by("id"):
            d = _as_exam_dict(q)
            risks, flags = appeal_risks(d), review_flags(d)
            if not risks and not flags:
                continue
            out.append({
                "id": q.id,
                "text": str(d["text"])[:400],
                "options": d["options"],
                "correct_answer": d["correctAnswer"],
                "usmle_score": usmle_score(d),
                "defects": risks,
                "review": flags,
            })
        return Response({"category_id": cid_int, "count": len(out), "results": out})

    cats = []
    for c in TestBankCategory.objects.order_by("sort_order", "name"):
        rows = [_as_exam_dict(q) for q in TestBankQuestion.objects.filter(category_id=c.id)]
        st = _stats(rows)
        st.update({"id": c.id, "name": c.name,
                   "source_language": getattr(c, "source_language", "en")})
        cats.append(st)
    jami = {
        "collections": len(cats),
        "total": sum(c["total"] for c in cats),
        "strong": sum(c["strong"] for c in cats),
        "defects": sum(c["defects"] for c in cats),
        "review": sum(c["review"] for c in cats),
    }
    return Response({"totals": jami, "categories": cats})
