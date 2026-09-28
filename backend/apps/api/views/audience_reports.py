"""Auditoriyaga XOS hisobotlar: ordinatorlar, ishga kiruvchi nomzodlar, maxsus kiruvchilar.

O'qituvchilar hisoboti (`admin_reports.py`) kafedra kesimida quriladi va u
yerda maxraj — "kafedradagi jami o'qituvchi". Boshqa toifalarda bu mezon
noto'g'ri natija beradi, shuning uchun har biriga o'z mantig'i:

  * ORDINATOR — guruhlash yo'nalish (imtihon) bo'yicha, maxraj esa
    kafedradagi barcha ordinator emas, RUXSAT BERILGANLAR (grant ro'yxati).
    Qarzdorlar (ruxsat ushlab turilgan) va hali topshirmaganlar alohida.
  * NOMZOD (vakansiya) — bu TANLOV: har bir kafedra + fan (lavozim) bo'yicha
    reyting, tavsiya etiladigan nomzod (eng yuqori natija va o'tish
    chegarasidan yuqori; teng natijada komissiya qaror qiladi), telefon.
  * MAXSUS KIRUVCHI — bir necha kishi: har biriga individual natija varaqasi —
    fanlar kesimida natija, vaqt, shaxs tasdig'i, rozilik, nazorat qaydlari.
"""
from __future__ import annotations

import re
from collections import Counter
from functools import lru_cache

from django.http import HttpResponse
from django.utils import timezone as dj_tz
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.api.certificate_pdf import exam_pass_threshold
from apps.api.views._helpers import IsAuthenticated, _request_user_role_norm, safe_json_loads
from apps.api.views.admin_reports import _season_exam_ids
from apps.core.models import AppUser, Exam, StudentExam, ViolationLog

__all__ = [
    "TAILORED_AUDIENCES",
    "build_audience_report",
    "admin_reports_audience",
    "admin_reports_audience_pdf",
    "admin_student_exam_evidence",
]

TAILORED_AUDIENCES = ("ordinator", "vacancy", "entrant")

# Texnik uzilishlar — qoidabuzarlik emas (jazolanmaydi), alohida sanaladi.
TECHNICAL_VIOLATIONS = frozenset({"PROCTOR_FEED_LOST", "CAMERA_MIC_ACCESS_FAILED"})

STATE_LABELS = {
    "completed": "Topshirdi",
    "banned": "Chetlatildi",
    "in_progress": "Hozir topshirmoqda",
    "absent": "Kelmadi",
    "unfinished": "Yakunlanmagan",
    "not_started": "Hali topshirmagan",
    "no_session": "Hali kirmagan",
    "debt": "Qarzdor — ruxsat yo'q",
}

BAN_REASON_LABELS = {
    "VIOLATION_LIMIT": "Ogohlantirishlar chegarasi (3 ta ogohlantirishdan keyin yana qoidabuzarlik)",
    "IDENTITY": "Shaxs almashtirildi (yuz mos emas)",
    "HARDENED": "Qisqa vaqtda ko'p jiddiy qoidabuzarlik",
    "RETAKE_EXHAUSTED": "Qayta topshirish imkoniyatlari tugagan",
    "ADMIN": "Admin qarori",
}

_PHONE_RE = re.compile(r"^\+?\d[\d\s\-()]{7,}$")


# ------------------------------------------------------------ yordamchilar --
@lru_cache(maxsize=256)
def _label(vtype: str) -> str:
    """Qoidabuzarlik turining o'zbekcha nomi (proctor_violation_labels dan)."""
    if vtype == "BROWSER_EXTENSION_SUSPECTED":
        return "Brauzer kengaytmasi / begona kod aniqlandi"
    try:
        from apps.api import proctor_violation_labels as labels

        for obj in vars(labels).values():
            if isinstance(obj, dict):
                v = obj.get(vtype)
                if isinstance(v, dict) and v.get("uz"):
                    return str(v["uz"])
    except Exception:
        pass
    return str(vtype or "").replace("_", " ").capitalize()


def _fmt(dt) -> str:
    return dj_tz.localtime(dt).strftime("%d.%m.%Y %H:%M") if dt else ""


def _iso(dt):
    return dt.isoformat() if dt else None


def _state(se: StudentExam) -> str:
    st = str(se.status or "").strip()
    if st == "Completed":
        return "completed"
    if st == "Banned":
        return "banned"
    if st == "In Progress":
        return "in_progress"
    if st == "Failed":
        # Avto-yakunlashda umuman kirmagan — started_at bo'sh (kelmagan).
        return "unfinished" if se.started_at else "absent"
    return "not_started"


def _total(se: StudentExam, exam: Exam | None) -> int:
    n = len(safe_json_loads(se.session_questions_json or "", []) or [])
    return n or int(getattr(exam, "bank_question_count", 0) or 0)


def _minutes(se: StudentExam):
    if se.started_at and se.completed_at:
        return round(max(0.0, (se.completed_at - se.started_at).total_seconds()) / 60.0, 1)
    return None


def _violations(exam_ids) -> dict:
    out: dict[tuple[str, int], Counter] = {}
    for sid, eid, vt in ViolationLog.objects.filter(exam_id__in=list(exam_ids)).values_list(
        "student_id", "exam_id", "violation_type"
    ):
        out.setdefault((str(sid), int(eid)), Counter())[str(vt)] += 1
    return out


def _viol_summary(cnt: Counter | None) -> dict:
    cnt = cnt or Counter()
    real = Counter({k: v for k, v in cnt.items() if k not in TECHNICAL_VIOLATIONS})
    return {
        "total": sum(real.values()),
        "technical": sum(v for k, v in cnt.items() if k in TECHNICAL_VIOLATIONS),
        "top": [{"type": k, "label": _label(k), "count": v} for k, v in real.most_common(5)],
    }


def _person(se: StudentExam, exam: Exam | None, viol: dict, threshold: int) -> dict:
    total = _total(se, exam)
    state = _state(se)
    done = state == "completed"
    score = int(se.score or 0) if (done and se.score is not None) else None
    pct = round(score / total * 100) if (score is not None and total) else None
    return {
        "student_exam_id": se.id,
        "exam_id": se.exam_id,
        "student_id": str(se.student_id),
        "name": " ".join(str(getattr(se.student, "name", "") or "").split()),
        "state": state,
        "state_label": STATE_LABELS[state],
        "score": score,
        "total": total,
        "percent": pct,
        "passed": bool(pct is not None and pct >= threshold),
        "started_at": _iso(se.started_at),
        "completed_at": _iso(se.completed_at),
        "started_label": _fmt(se.started_at),
        "completed_label": _fmt(se.completed_at),
        "minutes": _minutes(se),
        "warnings": int(se.proctor_official_warnings or 0),
        "violations": _viol_summary(viol.get((str(se.student_id), int(se.exam_id)))),
        "ban_reason": str(se.ban_reason or ""),
        "result_id": str(se.result_public_id or ""),
        "access_granted": bool(se.access_granted),
        "hold": str(getattr(se, "access_hold_reason", "") or ""),
    }


def _stats(people: list[dict]) -> dict:
    done = [p for p in people if p["state"] == "completed"]
    passed = sum(1 for p in done if p["passed"])
    pcts = [p["percent"] for p in done if p["percent"] is not None]
    mins = [p["minutes"] for p in done if p["minutes"] is not None]
    return {
        "completed": len(done),
        "passed": passed,
        "failed": len(done) - passed,
        "pass_percent": round(passed / len(done) * 100) if done else 0,
        "avg_percent": round(sum(pcts) / len(pcts)) if pcts else 0,
        "best_percent": max(pcts) if pcts else 0,
        "worst_percent": min(pcts) if pcts else 0,
        "avg_minutes": round(sum(mins) / len(mins), 1) if mins else None,
        "banned": sum(1 for p in people if p["state"] == "banned"),
        "in_progress": sum(1 for p in people if p["state"] == "in_progress"),
        "not_started": sum(1 for p in people if p["state"] in ("not_started", "no_session")),
        "absent": sum(1 for p in people if p["state"] in ("absent", "unfinished")),
    }


def _single_threshold(values: set) -> int | None:
    return values.pop() if len(values) == 1 else None


def _direction(title: str) -> str:
    t = str(title or "")
    for sep in (" — ", " - "):
        if sep in t:
            return t.split(sep, 1)[1].strip()
    return t


def _plan(exam: Exam) -> list:
    raw = getattr(exam, "question_plan", None)
    items = raw if isinstance(raw, list) else safe_json_loads(raw or "", []) or []
    return [
        {"subject": str(x.get("subject") or ""), "count": int(x.get("count") or 0)}
        for x in items
        if isinstance(x, dict)
    ]


def _integrity_flags(se: StudentExam, p: dict) -> dict:
    """Ko'chirish belgilari — avtomatik jazo EMAS, admin ko'rib chiqishi uchun.

    BANK_GAP: bank savollarini a'lo, yangi (AI) savollarni keskin past yechgan —
      bank savollari va javoblari oldindan qo'lga tushgan bo'lishi mumkin.
    FAST: savolga o'rtacha 25 soniyadan kam va natija yuqori — klinik holatli
      savollarni o'qib chiqishga ham yetmaydigan tezlik.
    """
    empty = {"bank_pct": None, "ai_pct": None, "flags": [], "_bank_answers": {}}
    if p.get("state") != "completed":
        return empty
    # Baholashdagi tilda (auto imtihonda EN/RU javoblar ham to'g'ri sanalsin).
    from apps.api.services import graded_session_questions

    qs, ans = graded_session_questions(se)
    bt = bo = at = ao = 0
    bank_answers: dict = {}
    for q in qs:
        a = ans.get(str(q.get("id")))
        keys = {str(q.get("correctAnswer") or "").strip(), str(q.get("correct_answer_ru") or "").strip()} - {""}
        good = a is not None and str(a).strip() in keys
        if q.get("source") == "ai_generated":
            at += 1
            ao += int(good)
        else:
            bt += 1
            bo += int(good)
            # Til biriktirish tahlili uchun: bank savoli (source_id) -> tanlangan va
            # to'g'ri variant RAQAMI (qayta yozilganda ham variant tartibi saqlanadi).
            opts = [str(o).strip() for o in (q.get("options") or [])]
            src = q.get("source_id") or q.get("id")
            if a is not None and str(a).strip() in opts:
                ci = str(q.get("correctAnswer") or "").strip()
                bank_answers[str(src)] = (opts.index(str(a).strip()), opts.index(ci) if ci in opts else -1)
    bank_pct = round(bo / bt * 100) if bt else None
    ai_pct = round(ao / at * 100) if at else None
    flags = []
    if bt >= 8 and at >= 8 and bank_pct - ai_pct >= 40:
        flags.append({"code": "BANK_GAP", "label": "bank savollari %d%%, yangi savollar %d%% — bank oldindan "
                      "ma'lum bo'lgan bo'lishi mumkin" % (bank_pct, ai_pct)})
    if p.get("minutes") is not None and p.get("total"):
        per_q = p["minutes"] * 60.0 / p["total"]
        if per_q < 25 and (p.get("percent") or 0) >= 60:
            flags.append({"code": "FAST", "label": "savolga o'rtacha %d soniya — juda tez" % round(per_q)})
    from apps.api.proctor_profile import audio_review_types

    _audio = audio_review_types()
    n_audio = sum(int(x.get("count") or 0) for x in (p.get("violations") or {}).get("top", [])
                  if str(x.get("type") or "").upper() in _audio)
    n_ext = sum(int(x.get("count") or 0) for x in (p.get("violations") or {}).get("top", [])
                if str(x.get("type") or "") == "BROWSER_EXTENSION_SUSPECTED")
    if n_ext:
        flags.append({"code": "EXTENSION", "label": "brauzer kengaytmasi / begona kod aniqlangan "
                      "(%d marta) — Dalillarni ko'ring" % n_ext})
    try:
        from apps.api.answer_timing import quick_correct

        _tm = safe_json_loads(se.answer_timings_json or "", {}) or {}
        if _tm:
            _qc, _nl = quick_correct(qs, ans, _tm)
            if _nl >= 5 and _qc >= 5:
                flags.append({"code": "QUICK", "label": "%d ta uzun klinik savolga 8 soniyadan tez "
                              "TO'G'RI javob (jami %d ta uzun savol)" % (_qc, _nl)})
    except Exception:
        pass
    try:
        from apps.api.question_lock import load_lock as _load_lock

        _times = (_load_lock(se) or {}).get("times") or {}
        fast_n = fast_ok = 0
        for q in qs:
            t = _times.get(str(q.get("id")))
            if t is None or len(str(q.get("text") or "")) < 120:
                continue
            if float(t) <= 10:
                fast_n += 1
                a = ans.get(str(q.get("id")))
                keys = {str(q.get("correctAnswer") or "").strip(), str(q.get("correct_answer_ru") or "").strip()} - {""}
                fast_ok += int(a is not None and str(a).strip() in keys)
        if fast_ok >= 4 and fast_ok >= 0.8 * fast_n:
            flags.append({"code": "QUICK_SERVER", "label": "server o'lchovi: %d ta uzun savolga 10 soniyadan "
                          "tez TO'G'RI javob (%d tadan) — javob tashqaridan kelgan bo'lishi mumkin" % (fast_ok, fast_n)})
    except Exception:
        pass
    try:
        from apps.api.answer_timing import gaze_answer_assessment

        _ga = gaze_answer_assessment(safe_json_loads(se.answer_timings_json or "", {}) or {})
        if _ga["suspicious"]:
            _det = "" if _ga["legacy"] else " (odatiy %d%%, %s tomonga %d%%)" % (
                round(_ga["expected"] * 100), _ga["side"], round(_ga["same_side"] * 100))
            flags.append({"code": "GAZE_ANSWER", "label": "javobdan oldin chetga qarash %d/%d savolda%s"
                          " — kadrdan tashqaridagi yordam gumoni" % (_ga["glance"], _ga["answered"], _det)})
    except Exception:
        pass
    if getattr(se, "verify_state", ""):
        flags.append({"code": "VERIFY_" + se.verify_state.upper(), "label": {
            "pending": "yuzma-yuz tasdiqlash kutilmoqda", "confirmed": "yuzma-yuz tasdiqlangan",
            "rejected": "yuzma-yuz tasdiqlanmadi — ball bekor"}.get(se.verify_state, se.verify_state)})
    if n_audio >= 2:
        flags.append({"code": "AUDIO", "label": "ovoz gumoni %d marta (gaplashish/pichirlash) — "
                      "ko'rib chiqing" % n_audio})
    return {"bank_pct": bank_pct, "ai_pct": ai_pct, "flags": flags, "_bank_answers": bank_answers}


def _collusion_flags(people: list[dict]) -> None:
    """Bir yo'nalishda bir xil bank savollarida BIR XIL NOTO'G'RI javob tanlaganlar.

    Tasodifan bir-ikki noto'g'ri javob mos kelishi mumkin; 3 va undan ko'p
    bir xil noto'g'ri javob (umumiy kamida 5 bank savolida) — javoblar
    tarqatilganining kuchli belgisi. Avtomatik jazo emas — admin ko'rib chiqadi.
    """
    done = [p for p in people if p.get("_bank_answers")]
    for i in range(len(done)):
        for j in range(i + 1, len(done)):
            a, b = done[i]["_bank_answers"], done[j]["_bank_answers"]
            shared = set(a) & set(b)
            if len(shared) < 5:
                continue
            same_wrong = sum(1 for s in shared if a[s][0] == b[s][0] and a[s][0] != a[s][1])
            if same_wrong >= 3:
                for x, y in ((done[i], done[j]), (done[j], done[i])):
                    x.setdefault("flags", []).append({
                        "code": "COLLUSION",
                        "label": "%s bilan %d ta bank savolida bir xil NOTO'G'RI javob — javoblar "
                                 "tarqatilgan bo'lishi mumkin" % (y["name"], same_wrong),
                    })


# --------------------------------------------------------------- ordinator --
def build_ordinator_report(ids: list[int], season: dict) -> dict:
    from apps.api.views.ordinator import is_one_attempt_exam

    course = int(season.get("course") or 0)
    exams = {e.id: e for e in Exam.objects.filter(id__in=ids).select_related("kafedra")}
    viol = _violations(ids)
    by_exam: dict[int, list] = {}
    for se in StudentExam.objects.filter(exam_id__in=ids).select_related("student"):
        by_exam.setdefault(se.exam_id, []).append(se)

    groups, debtors, todo, done_all = [], [], [], []
    thresholds: set[int] = set()
    for eid, e in exams.items():
        thr = exam_pass_threshold(e)
        people, debt_here = [], 0
        for se in by_exam.get(eid, []):
            hold = str(getattr(se, "access_hold_reason", "") or "")
            if not se.access_granted and not hold and str(se.status or "") == "Pending":
                continue  # ruxsat yo'q va hech narsa qilmagan — hisobotga aloqasi yo'q
            p = _person(se, e, viol, thr)
            p["direction"] = _direction(e.title)
            p.update(_integrity_flags(se, p))
            if hold and not se.access_granted:
                p["state"], p["state_label"] = "debt", STATE_LABELS["debt"]
                debtors.append(p)
                debt_here += 1
                continue
            people.append(p)
        if not people and not debt_here:
            continue
        thresholds.add(thr)
        people.sort(key=lambda p: (p["state"] != "completed", -(p["percent"] or 0), p["name"]))
        _collusion_flags(people)
        for p in people:
            p.pop("_bank_answers", None)
        for p in people:
            if p["state"] in ("not_started", "in_progress"):
                todo.append(p)
            elif p["state"] == "completed":
                done_all.append(p)
        groups.append(
            {
                "exam_id": eid,
                "direction": _direction(e.title),
                "kafedra_name": str(getattr(e.kafedra, "name", "") or "") if e.kafedra_id else "",
                "allowed": sum(1 for p in people if p["access_granted"]),
                "debt": debt_here,
                "threshold": thr,
                "question_count": int(e.bank_question_count or 0),
                "duration": int(e.duration_minutes or 0),
                **_stats(people),
                "people": people,
            }
        )

    groups.sort(key=lambda g: g["direction"].lower())
    for p in debtors:
        p.pop("_bank_answers", None)
    everyone = [p for g in groups for p in g["people"]]
    st = _stats(everyone)
    allowed = sum(g["allowed"] for g in groups)
    todo.sort(key=lambda p: (p["direction"].lower(), p["name"]))
    debtors.sort(key=lambda p: (p["direction"].lower(), p["name"]))
    top = sorted(
        done_all,
        key=lambda p: (-(p["percent"] or 0), p["minutes"] if p["minutes"] is not None else 1e9, p["name"]),
    )[:10]
    if course == 2:
        title = "Ordinatorlar 2-kurs — DAK (davlat attestatsiyasi)"
    elif course:
        title = "Ordinatorlar %d-kurs — yillik attestatsiya" % course
    else:
        title = "Ordinatorlar"
    return {
        "kind": "ordinator",
        "course": course,
        "title": title,
        "one_attempt": any(is_one_attempt_exam(e) for e in exams.values()),
        "pass_threshold": _single_threshold(thresholds),
        "totals": {
            "allowed": allowed,
            "debt": len(debtors),
            "directions": len(groups),
            "exams_total": len(exams),
            "remaining": st["not_started"] + st["in_progress"],
            "coverage_percent": round(st["completed"] / allowed * 100) if allowed else 0,
            "suspicious": sum(1 for p in everyone if p.get("flags")),
            **st,
        },
        "groups": groups,
        "todo": todo,
        "debtors": debtors,
        "top": top,
        # Amaliy ko'nikma kuni og'zaki tekshirish uchun — avtomatik jazo emas.
        "suspects": sorted(
            (p for p in everyone if p.get("flags")),
            key=lambda p: (p.get("direction", "").lower(), p["name"]),
        ),
    }


# ------------------------------------------------------------------ nomzod --
_VERDICT_LABELS = {
    "recommended": "Tavsiya etiladi",
    "tie": "Teng natija — komissiya qarori",
    "passed": "O'tdi",
    "failed": "O'tmadi",
    "banned": "Chetlatildi",
    "absent": "Topshirmagan",
}


def build_vacancy_report(ids: list[int], season: dict) -> dict:
    exams = {e.id: e for e in Exam.objects.filter(id__in=ids).select_related("kafedra")}
    exam_by_kaf: dict[int, Exam] = {}
    for e in exams.values():
        if e.kafedra_id:
            exam_by_kaf.setdefault(int(e.kafedra_id), e)
    viol = _violations(ids)

    last_se: dict[str, StudentExam] = {}
    for se in StudentExam.objects.filter(exam_id__in=ids).select_related("student").order_by("id"):
        last_se[str(se.student_id)] = se
    users = {
        str(u.id): u
        for u in AppUser.objects.filter(role="vacancy").select_related("kafedra")
        if int(u.kafedra_id or 0) in exam_by_kaf or str(u.id) in last_se
    }

    comps: dict[tuple, dict] = {}
    thresholds: set[int] = set()
    for uid, u in users.items():
        se = last_se.get(uid)
        exam = exams.get(se.exam_id) if se else exam_by_kaf.get(int(u.kafedra_id or 0))
        thr = exam_pass_threshold(exam) if exam else 60
        thresholds.add(thr)
        if se:
            p = _person(se, exam, viol, thr)
        else:
            p = {
                "student_exam_id": None, "exam_id": getattr(exam, "id", None), "student_id": uid,
                "name": "", "state": "no_session", "state_label": STATE_LABELS["no_session"],
                "score": None, "total": int(getattr(exam, "bank_question_count", 0) or 0),
                "percent": None, "passed": False, "started_at": None, "completed_at": None,
                "started_label": "", "completed_label": "", "minutes": None, "warnings": 0,
                "violations": _viol_summary(None), "ban_reason": "", "result_id": "",
                "access_granted": False, "hold": "",
            }
        p["name"] = " ".join(str(u.name or p["name"]).split())
        phone = str(u.position or "").strip()
        p["phone"] = phone if _PHONE_RE.match(phone) else ""
        kaf_name = str(getattr(u.kafedra, "name", "") or "") if u.kafedra_id else ""
        if not kaf_name and exam is not None and exam.kafedra_id:
            kaf_name = str(exam.kafedra.name or "")
        subject = str(u.vacancy_subject or "").strip() or str(getattr(exam, "faculty_subject", "") or "") or "—"
        p["kafedra_name"], p["subject"] = kaf_name or "—", subject
        key = (p["kafedra_name"], subject)
        comps.setdefault(
            key, {"kafedra_name": p["kafedra_name"], "subject": subject, "threshold": thr, "people": []}
        )["people"].append(p)

    competitions = []
    for c in comps.values():
        ppl = c["people"]
        done = sorted(
            (p for p in ppl if p["state"] == "completed"),
            key=lambda p: (-(p["percent"] or 0), p["minutes"] if p["minutes"] is not None else 1e9,
                           p["completed_at"] or ""),
        )
        for i, p in enumerate(done, 1):
            p["rank"] = i
        winners: list[str] = []
        tie = False
        if done and done[0]["passed"]:
            top = [p for p in done if p["percent"] == done[0]["percent"]]
            tie = len(top) > 1
            for p in top:
                p["verdict"] = "tie" if tie else "recommended"
            winners = [p["name"] for p in top]
        for p in done:
            p.setdefault("verdict", "passed" if p["passed"] else "failed")
        rest = sorted((p for p in ppl if p["state"] != "completed"), key=lambda p: p["name"])
        for p in rest:
            p["rank"] = None
            p["verdict"] = "banned" if p["state"] == "banned" else "absent"
        for p in done + rest:
            p["verdict_label"] = _VERDICT_LABELS[p["verdict"]]
        c.update(_stats(ppl))
        c.update({
            "people": done + rest,
            "candidates": len(ppl),
            "contested": len(ppl) > 1,
            "winner": winners,
            "tie": tie,
        })
        competitions.append(c)
    competitions.sort(key=lambda c: (c["kafedra_name"].lower(), c["subject"].lower()))

    kaf_rows: dict[str, dict] = {}
    for c in competitions:
        k = kaf_rows.setdefault(c["kafedra_name"], {
            "kafedra_name": c["kafedra_name"], "positions": 0, "candidates": 0,
            "completed": 0, "passed": 0, "not_started": 0, "banned": 0, "recommended": 0,
        })
        k["positions"] += 1
        k["candidates"] += c["candidates"]
        k["completed"] += c["completed"]
        k["passed"] += c["passed"]
        k["not_started"] += c["not_started"]
        k["banned"] += c["banned"]
        k["recommended"] += 1 if (c["winner"] and not c["tie"]) else 0

    everyone = [p for c in competitions for p in c["people"]]
    not_taken = sorted(
        (p for p in everyone if p["state"] not in ("completed", "banned")),
        key=lambda p: (p["kafedra_name"].lower(), p["name"]),
    )
    st = _stats(everyone)
    return {
        "kind": "vacancy",
        "title": "Ishga qabul — nomzodlar tanlovi",
        "pass_threshold": _single_threshold(thresholds),
        "totals": {
            "registered": len(everyone),
            "competitions": len(competitions),
            "contested": sum(1 for c in competitions if c["contested"]),
            "recommended": sum(1 for c in competitions if c["winner"] and not c["tie"]),
            "ties": sum(1 for c in competitions if c["tie"]),
            "no_winner": sum(1 for c in competitions if not c["winner"]),
            "kafedras": len(kaf_rows),
            **st,
        },
        "competitions": competitions,
        "kafedras": sorted(kaf_rows.values(), key=lambda k: k["kafedra_name"].lower()),
        "not_taken": not_taken,
    }


# --------------------------------------------------------- maxsus kiruvchi --
def _subject_breakdown(se: StudentExam) -> tuple[list[dict], bool]:
    """Fanlar kesimida to'g'ri javoblar. exact=False — rasmiy ball bilan farq bor."""
    from apps.api.services import graded_session_questions

    qs, ans = graded_session_questions(se)
    rows: dict[str, dict] = {}
    correct_total = 0
    for q in qs:
        subj = str(q.get("subject") or "Umumiy").strip()
        r = rows.setdefault(subj, {"subject": subj, "correct": 0, "total": 0, "answered": 0})
        r["total"] += 1
        a = ans.get(str(q.get("id")))
        if a not in (None, ""):
            r["answered"] += 1
            if str(a).strip() == str(q.get("correctAnswer") or "").strip():
                r["correct"] += 1
                correct_total += 1
    out = [
        dict(r, percent=round(r["correct"] / r["total"] * 100) if r["total"] else 0)
        for r in rows.values()
    ]
    exact = se.score is None or correct_total == int(se.score or 0)
    return out, exact


def build_entrant_report(ids: list[int], season: dict) -> dict:
    viol = _violations(ids)
    people = []
    thresholds: set[int] = set()
    for se in StudentExam.objects.filter(exam_id__in=ids).select_related("student", "exam"):
        e = se.exam
        thr = exam_pass_threshold(e)
        thresholds.add(thr)
        p = _person(se, e, viol, thr)
        subjects, exact = _subject_breakdown(se) if se.session_questions_json else ([], True)
        timeline = list(
            ViolationLog.objects.filter(student_id=se.student_id, exam_id=e.id)
            .order_by("timestamp")
            .values_list("violation_type", "timestamp")[:60]
        )
        p.update(
            {
                "exam_title": str(e.title or ""),
                "threshold": thr,
                "duration_limit": int(e.duration_minutes or 0),
                "answered": len(safe_json_loads(se.answers_json or "", {}) or {}),
                "subjects": subjects,
                "subjects_exact": exact,
                "plan": _plan(e),
                "identity": {
                    "verified_at": _fmt(se.identity_verified_at),
                    "matched": se.identity_last_matched,
                    "score": se.identity_last_score,
                },
                "consent": {
                    "at": _fmt(se.vac_consent_at),
                    "version": str(se.vac_consent_version or ""),
                    "ip": str(se.vac_consent_ip or ""),
                    "mic": se.mic_level_at_start,
                },
                "timeline": [
                    {"type": t, "label": _label(t), "at": _fmt(ts), "technical": t in TECHNICAL_VIOLATIONS}
                    for t, ts in timeline
                ],
                "retakes": {
                    "technical": int(se.technical_retakes_used or 0),
                    "identity": int(se.identity_retakes_used or 0),
                },
                "certificate": p["state"] == "completed",
            }
        )
        people.append(p)
    people.sort(key=lambda p: (p["state"] != "completed", -(p["percent"] or 0), p["name"]))
    return {
        "kind": "entrant",
        "title": "Maxsus kiruvchilar — kirish imtihoni natijalari",
        "pass_threshold": _single_threshold(thresholds),
        "totals": {"people": len(people), **_stats(people)},
        "people": people,
    }


# ------------------------------------------------------------ dispatcher --
_BUILDERS = {
    "ordinator": build_ordinator_report,
    "vacancy": build_vacancy_report,
    "entrant": build_entrant_report,
}


def build_audience_report(season_key: str | None) -> dict:
    ids, season = _season_exam_ids(season_key)
    if not season:
        return {"kind": "empty"}
    builder = _BUILDERS.get(str(season.get("audience") or ""))
    if builder is None:
        return {"kind": "generic", "season": season}
    data = builder(list(ids or []), season)
    now = dj_tz.now()
    data.update({"season": season, "generated_at": now.isoformat(), "generated_label": _fmt(now)})
    return data


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_reports_audience(request):
    """Ordinator / nomzod / maxsus kiruvchi — toifaga xos hisobot (JSON)."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    return Response(build_audience_report(request.query_params.get("season")))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_reports_audience_pdf(request):
    """Xuddi shu hisobot — bosib chiqarishga tayyor PDF."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    data = build_audience_report(request.query_params.get("season"))
    kind = data.get("kind")
    if kind not in TAILORED_AUDIENCES:
        return Response({"error": "Bu mavsum uchun maxsus hisobot yo'q"}, status=400)
    from apps.api.audience_report_pdf import build_audience_pdf

    pdf = build_audience_pdf(data)
    name = {"ordinator": "ordinatorlar", "vacancy": "nomzodlar", "entrant": "maxsus-kiruvchilar"}[kind]
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = (
        'attachment; filename="%s-hisobot-%s.pdf"' % (name, dj_tz.localtime(dj_tz.now()).strftime("%Y-%m-%d"))
    )
    return resp


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_student_exam_evidence(request, pk: int):
    """Bitta sessiyaning nazorat qaydlari — vaqt, tur va DALIL RASMI bilan (admin)."""
    if _request_user_role_norm(request.user) != "admin":
        return Response({"error": "Forbidden"}, status=403)
    se = StudentExam.objects.select_related("student", "exam").filter(pk=pk).first()
    if se is None:
        return Response({"error": "Not found"}, status=404)
    started = se.started_at
    items = []
    for ts, vt, img, detail, outcome in (
        # Imtihon kutubxonada o'tkaziladi: javondagi kitoblar qoidabuzarlik emas,
        # shuning uchun ular dalillar ro'yxatida umuman ko'rsatilmaydi.
        ViolationLog.objects.filter(student_id=se.student_id, exam_id=se.exam_id)
        .exclude(violation_type="FORBIDDEN_OBJECT_BOOK")
        .order_by("timestamp")
        .values_list("timestamp", "violation_type", "screenshot_url", "detail", "outcome")[:300]
    ):
        img = str(img or "")
        fact = str(detail or "").strip() or (img[5:1000] if img.startswith("note:") else "")
        elapsed = ""
        if started and ts and ts >= started:
            sec = int((ts - started).total_seconds())
            elapsed = "%d:%02d" % (sec // 60, sec % 60)
        items.append({
            "at": dj_tz.localtime(ts).strftime("%d.%m.%Y %H:%M:%S") if ts else "",
            "type": str(vt),
            "label": _label(str(vt)),
            "technical": str(vt) in TECHNICAL_VIOLATIONS,
            "image": img if img.startswith("data:image") else "",
            "note": fact,
            "detail": fact,
            "outcome": str(outcome or ""),
            "elapsed": elapsed,
        })
    from apps.api.proctor_config import max_warnings_before_ban

    ban_code = str(getattr(se, "ban_reason", "") or "")
    summary = {
        "state": _state(se),
        "state_label": STATE_LABELS.get(_state(se), str(se.status or "")),
        "ban_reason": ban_code,
        "ban_reason_label": BAN_REASON_LABELS.get(ban_code, ban_code),
        "official_warnings": int(getattr(se, "proctor_official_warnings", 0) or 0),
        "warning_limit": max(1, max_warnings_before_ban() - 1),
        "records": len(items),
        "counted": sum(1 for x in items if x["outcome"].startswith("warning:")),
        "started": _fmt(se.started_at),
    }
    return Response({
        "student_exam_id": se.id,
        "student_id": str(se.student_id),
        "name": " ".join(str(getattr(se.student, "name", "") or "").split()),
        "exam_title": str(se.exam.title or ""),
        "status": str(se.status or ""),
        "summary": summary,
        "items": items,
        # Butun ekran rasmlari (ekranni ulashish yoqilgan imtihonda).
        "screens": _screen_snapshots(se.id),
    })


def _screen_snapshots(student_exam_id: int, limit: int = 150) -> list[dict]:
    try:
        from apps.core.models import ScreenSnapshot

        out = []
        # Javob hajmi cheklangan (bir nechta admin bir vaqtda ochsa server xotirasi to'lmasin):
        # har turdan ENG SO'NGGI kadrlar, vaqt tartibida.
        for kind, cap in (("room", 12), ("webcam", 60), ("screen", min(limit, 40))):
            rows = list(
                ScreenSnapshot.objects.filter(student_exam_id=student_exam_id, kind=kind)
                .order_by("-taken_at")
                .values_list("taken_at", "image")[:cap]
            )[::-1]
            out.extend({"at": _fmt(ts), "image": str(img), "kind": kind} for ts, img in rows)
        return out
    except Exception:  # noqa: BLE001
        return []
