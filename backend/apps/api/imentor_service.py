"""iMentor testlarini imtihon sessiyasiga aylantirish (random tanlash + tarjima)."""
from __future__ import annotations

import random
from typing import Any

from apps.api.imentor_client import (
    DEFAULT_QUESTION_LIMIT_BOUNDS,
    IMentorApiError,
    imentor_catalog_departments,
    imentor_catalog_stats,
    imentor_collect_department_subjects,
    imentor_configured,
    imentor_generate_mcq,
    imentor_get_test,
    imentor_list_tests,
    imentor_published_test_count,
    imentor_sample_questions,
    imentor_stats,
    parse_question_limit_bounds,
    validate_question_limit_value,
)
from apps.api.services import exam_questions_add_translations


def question_limit_bounds() -> dict[str, int]:
    """API catalog/tests stats dan yoki default 10–30."""
    if not imentor_configured():
        return dict(DEFAULT_QUESTION_LIMIT_BOUNDS)
    for loader in (imentor_catalog_stats, imentor_stats):
        try:
            return parse_question_limit_bounds(loader())
        except IMentorApiError:
            continue
    return dict(DEFAULT_QUESTION_LIMIT_BOUNDS)


def normalize_exam_question_count(raw: int | str | None, *, bounds: dict[str, int] | None = None) -> int:
    """
    Imtihon yaratish: 0 = testdagi barcha savollar; aks holda bounds ichida (odatda 10–30).
    """
    b = bounds or DEFAULT_QUESTION_LIMIT_BOUNDS
    lo, hi = int(b["min"]), int(b["max"])
    try:
        n = int(raw) if raw is not None and str(raw).strip() != "" else 0
    except (TypeError, ValueError):
        n = 0
    if n == 0:
        return 0
    if n < lo or n > hi:
        raise IMentorApiError(
            f"Savollar soni {lo} dan {hi} gacha bo'lishi kerak (0 = testdagi barcha savollar).",
            status=400,
        )
    return n


def _derive_department_code(subject_code: str) -> str:
    """Katalog fan kodi: kafedra__fan → kafedra."""
    code = str(subject_code or "").strip()
    if "__" in code:
        return code.split("__", 1)[0]
    return code


def _subject_context(subject_code: str) -> dict[str, Any]:
    """Fan/kafedra konteksti — registry yoki katalog kodidan."""
    token = str(subject_code or "").strip()
    idx = _subject_stats_index()
    row = idx.get(token) or idx.get(token.lower()) or idx.get(token.upper())
    if row:
        dept = str(row.get("department_code") or "").strip() or _derive_department_code(token)
        return {
            "subject_code": str(row.get("subject_code") or token),
            "department_code": dept,
            "syllabus_id": int(row.get("syllabus_id") or 0) or None,
            "test_count": int(row.get("test_count") or 0),
            "has_own_tests": bool(row.get("has_own_tests")),
        }
    dept = _derive_department_code(token)
    return {
        "subject_code": token,
        "department_code": dept,
        "syllabus_id": None,
        "test_count": 0,
        "has_own_tests": False,
    }


def _build_subject_registry() -> dict[str, dict]:
    """Katalog (nomlar) + test stats (test_count) birlashtirilgan reestr."""
    canonical: dict[str, dict] = {}

    def ensure(code: str, **fields: Any) -> None:
        c = str(code or "").strip()
        if not c:
            return
        row = canonical.setdefault(
            c,
            {
                "subject_code": c,
                "subject_name": c,
                "department_code": "",
                "department_name": "",
                "syllabus_id": 0,
                "test_count": 0,
                "questions_total": 0,
            },
        )
        for key, val in fields.items():
            if val is not None and val != "":
                row[key] = val

    if imentor_configured():
        try:
            cat = imentor_catalog_stats()
            for row in cat.get("by_subject") or []:
                if not isinstance(row, dict):
                    continue
                ensure(
                    str(row.get("subject_code") or ""),
                    subject_name=row.get("subject_name"),
                    department_code=row.get("department_code"),
                    department_name=row.get("department_name"),
                    syllabus_id=int(row.get("id") or 0),
                )
        except IMentorApiError:
            pass

        try:
            stats = imentor_stats()
            for row in stats.get("by_subject") or []:
                if not isinstance(row, dict):
                    continue
                code = str(row.get("subject_code") or "").strip()
                if not code:
                    continue
                ensure(
                    code,
                    subject_name=row.get("subject_name"),
                    department_code=row.get("department_code"),
                    department_name=row.get("department_name"),
                    test_count=int(row.get("test_count") or 0),
                    questions_total=int(row.get("questions_total") or 0),
                )
                canonical[code]["test_count"] = int(row.get("test_count") or 0)
                canonical[code]["questions_total"] = int(row.get("questions_total") or 0)
                # Shu KOD ostida haqiqatan test e'lon qilinganmi. Quyida kafedra
                # hisobi fanlarga tarqatiladi va bu farq yo'qoladi — shuning
                # uchun aynan shu yerda belgilab qo'yamiz.
                canonical[code]["has_own_tests"] = int(row.get("test_count") or 0) > 0
        except IMentorApiError:
            pass

        # Legacy: testlar kafedra kodi (akusherlik-va-ginekologiya) ostida, katalog fanlari __ bilan
        legacy_tests: dict[str, int] = {}
        for code, row in canonical.items():
            tc = int(row.get("test_count") or 0)
            if tc < 1:
                continue
            dept_key = str(row.get("department_code") or "").strip() or code
            if "__" not in code:
                legacy_tests[dept_key] = max(legacy_tests.get(dept_key, 0), tc)
        for code, row in canonical.items():
            dept = str(row.get("department_code") or "").strip() or _derive_department_code(code)
            if dept in legacy_tests:
                row["test_count"] = max(int(row.get("test_count") or 0), legacy_tests[dept])
                if not row.get("department_code"):
                    row["department_code"] = dept

    return canonical


#: Fan reestri keshi (soniya). Katalog ma'lumoti kam o'zgaradi, lekin u
#: imtihon yaratishda 4-6 marta qayta quriladi va har safar 2 ta tashqi HTTP
#: so'rov ketadi (~0.55s) — yaratish shu sababdan sekin edi.
_REGISTRY_CACHE_KEY = "imentor:subject_registry:v1"


def _registry_cache_seconds() -> int:
    """Kesh TTL (soniya). 0 = kesh o'chiq.

    Testlarda MAJBURIY 0: har test o'z mock ma'lumotini beradi va oldingi
    testning keshdagi natijasi keyingisiga oqib o'tishi kerak emas.
    """
    import os
    import sys

    if "test" in sys.argv or os.environ.get("PYTEST_CURRENT_TEST"):
        return 0
    try:
        return max(0, int(os.environ.get("IMENTOR_CATALOG_CACHE_SECONDS", "300")))
    except (TypeError, ValueError):
        return 300


def _cached_subject_registry() -> dict[str, dict]:
    """`_build_subject_registry()` natijasi — qisqa muddatli kesh bilan.

    Kesh 0 bo'lsa (yoki cache ishlamasa) — har safar qaytadan quriladi,
    ya'ni xulq o'zgarmaydi, faqat tezlik yo'qoladi.
    """
    ttl = _registry_cache_seconds()
    if ttl <= 0:
        return _build_subject_registry()
    try:
        from django.core.cache import cache

        cached = cache.get(_REGISTRY_CACHE_KEY)
        if isinstance(cached, dict) and cached:
            return cached
    except Exception:
        return _build_subject_registry()

    registry = _build_subject_registry()
    if registry:
        try:
            cache.set(_REGISTRY_CACHE_KEY, registry, ttl)
        except Exception:
            pass
    return registry


def invalidate_subject_registry_cache() -> None:
    """Katalog o'zgarganda (admin fanlar ro'yxatini yangilaganda) chaqiriladi."""
    try:
        from django.core.cache import cache

        cache.delete(_REGISTRY_CACHE_KEY)
    except Exception:
        pass


def _subject_stats_index(rows: list[dict] | None = None) -> dict[str, dict]:
    """subject_code ni case-insensitive qidirish."""
    if rows is not None:
        idx: dict[str, dict] = {}
        for row in rows:
            code = str(row.get("subject_code") or "").strip()
            if not code:
                continue
            idx[code] = row
            idx[code.lower()] = row
            idx[code.upper()] = row
        return idx

    idx = {}
    for code, row in _cached_subject_registry().items():
        idx[code] = row
        idx[code.lower()] = row
        idx[code.upper()] = row
    return idx


def departments_from_catalog() -> list[dict]:
    """Admin UI 1-qadam: kafedralar."""
    if not imentor_configured():
        return []
    try:
        data = imentor_catalog_departments()
    except IMentorApiError:
        return []
    rows = data.get("results") or []
    if not isinstance(rows, list):
        return []
    out: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "").strip()
        if not code:
            continue
        out.append(
            {
                "code": code,
                "name": str(row.get("name") or code).strip(),
                "sort_order": int(row.get("sort_order") or 0),
                "subjects_count": int(row.get("subjects_count") or 0),
                # iMentor API `tests_count` beradi (eski versiyada yo'q — 0).
                "tests_count": int(row.get("tests_count") or 0),
            }
        )
    # Testi bor kafedralar tepada: imtihon aynan ular ustida yaratiladi,
    # qolganlari ro'yxatni to'ldirib turadigan "ochib bo'lmas" variantlar.
    out.sort(key=lambda x: (0 if x["tests_count"] > 0 else 1, x["sort_order"], x["name"].lower()))
    return out


def _normalize_catalog_variants(row: dict) -> list[dict]:
    """Katalog variants[] → UI uchun {label, topics[{code, title}]}."""
    out: list[dict] = []
    raw_variants = row.get("variants")
    if not isinstance(raw_variants, list):
        labels = row.get("variant_labels") or []
        if isinstance(labels, list):
            for lab in labels:
                label = str(lab or "").strip()
                if label:
                    out.append({"label": label, "topics": []})
        return out
    for var in raw_variants:
        if not isinstance(var, dict):
            continue
        label = str(var.get("label") or "").strip()
        if not label:
            continue
        topics: list[dict] = []
        for t in var.get("topics") or []:
            if not isinstance(t, dict):
                continue
            tid = str(t.get("id") or "").strip()
            title = str(t.get("title") or tid).strip()
            if not tid:
                continue
            topics.append({"code": tid.lower(), "id": tid, "title": title})
        out.append(
            {
                "label": label,
                "file_name": str(var.get("file_name") or "").strip(),
                "topics": topics,
            }
        )
    return out


def subjects_for_department(department_code: str) -> tuple[dict | None, list[dict]]:
    """Admin UI 2-qadam: kafedra fanlari + variants/topics + e'lon qilingan test soni."""
    code = str(department_code or "").strip()
    if not code or not imentor_configured():
        return None, []
    try:
        dept_meta, catalog_rows = imentor_collect_department_subjects(code)
    except IMentorApiError:
        return None, []

    test_idx = _subject_stats_index()
    dept_tests = 0
    try:
        dept_tests = imentor_published_test_count(subject_code=code, department_code=code)
    except IMentorApiError:
        dept_tests = 0
    out: list[dict] = []
    for row in catalog_rows:
        if not isinstance(row, dict):
            continue
        subj_code = str(row.get("subject_code") or "").strip()
        if not subj_code:
            continue
        stats_row = test_idx.get(subj_code) or test_idx.get(subj_code.lower()) or {}
        syllabus_id = int(row.get("id") or stats_row.get("syllabus_id") or 0) or None
        dept_code = str(row.get("department_code") or dept_meta.get("code") or code).strip()
        variants = _normalize_catalog_variants(row)
        variant_labels = [v["label"] for v in variants]
        if not variant_labels:
            raw_labels = row.get("variant_labels") or []
            if isinstance(raw_labels, list):
                variant_labels = [str(x).strip() for x in raw_labels if str(x).strip()]
        stats_count = int(stats_row.get("test_count") or 0)
        # Per-subject list API faqat stats bo'sh bo'lsa — tezlik uchun.
        api_count = 0
        if stats_count < 1:
            try:
                api_count = imentor_published_test_count(
                    subject_code=subj_code,
                    syllabus_id=syllabus_id,
                    department_code=dept_code,
                )
            except IMentorApiError:
                api_count = 0
        test_count = max(stats_count, api_count, dept_tests if "__" not in subj_code else 0)
        # Katalog fanlari uchun department legacy testlarini ham hisobga olish
        if "__" in subj_code and dept_tests > 0 and stats_count < 1 and api_count < 1:
            test_count = max(test_count, dept_tests)
        out.append(
            {
                "id": syllabus_id or int(row.get("id") or 0),
                "subject_code": subj_code,
                "subject_name": str(row.get("subject_name") or subj_code).strip(),
                "department_code": dept_code,
                "department_name": str(row.get("department_name") or dept_meta.get("name") or "").strip(),
                "instruction_language": str(row.get("instruction_language") or "").strip(),
                "variants_count": int(row.get("variants_count") or len(variants) or 0),
                "topics_count": int(
                    row.get("topics_count")
                    or sum(len(v.get("topics") or []) for v in variants)
                    or 0
                ),
                "variant_labels": variant_labels,
                "variants": variants,
                "syllabus_id": syllabus_id or int(row.get("id") or 0),
                "test_count": test_count,
                "questions_total": int(stats_row.get("questions_total") or 0),
            }
        )
    out.sort(key=lambda x: (x["subject_name"].lower(), x["subject_code"]))
    department = None
    if dept_meta:
        department = {
            "code": str(dept_meta.get("code") or code).strip(),
            "name": str(dept_meta.get("name") or code).strip(),
            "sort_order": int(dept_meta.get("sort_order") or 0),
        }
    elif catalog_rows:
        department = {"code": code, "name": code, "sort_order": 0}
    return department, out


def parse_imentor_selection(raw: Any) -> dict[str, Any]:
    """
    Imtihon konfiguratsiyasi:
      ["code"] yoki [{"subject_code","variant_label","topic_code"}]
    """
    codes: list[str] = []
    variant_label = ""
    topic_code = ""
    if isinstance(raw, dict) and "subject_codes" in raw:
        for c in raw.get("subject_codes") or []:
            token = str(c or "").strip()
            if token:
                codes.append(token)
        variant_label = str(raw.get("variant_label") or "").strip()
        topic_code = str(raw.get("topic_code") or "").strip().lower()
        return {
            "subject_codes": codes,
            "variant_label": variant_label,
            "topic_code": topic_code,
        }
    if not isinstance(raw, list):
        return {"subject_codes": [], "variant_label": "", "topic_code": ""}
    for item in raw:
        if isinstance(item, str):
            token = item.strip()
            if token:
                codes.append(token)
        elif isinstance(item, dict):
            token = str(item.get("subject_code") or "").strip()
            if token:
                codes.append(token)
            if not variant_label:
                variant_label = str(item.get("variant_label") or "").strip()
            if not topic_code:
                topic_code = str(item.get("topic_code") or "").strip().lower()
    return {
        "subject_codes": codes,
        "variant_label": variant_label,
        "topic_code": topic_code,
    }


def dump_imentor_selection(
    subject_codes: list[str],
    *,
    variant_label: str | None = None,
    topic_code: str | None = None,
) -> list:
    """Saqlash uchun JSON-serializable selection."""
    v = str(variant_label or "").strip()
    t = str(topic_code or "").strip().lower()
    if not v and not t:
        return list(subject_codes)
    return [
        {
            "subject_code": code,
            "variant_label": v,
            "topic_code": t,
        }
        for code in subject_codes
        if str(code).strip()
    ]


def subjects_from_stats() -> list[dict]:
    """Eski endpoint: barcha fanlar (katalog + test_count)."""
    if not imentor_configured():
        return []
    registry = _cached_subject_registry()
    out = list(registry.values())
    out.sort(key=lambda x: (x.get("department_name", "").lower(), x["subject_name"].lower(), x["subject_code"]))
    return out


def resolve_imentor_subject_codes(subject_codes: list[str]) -> list[str]:
    """Frontend/API dan kelgan kodlarni canonical subject_code ga aylantirish."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in subject_codes:
        token = str(raw or "").strip()
        if not token:
            continue
        ctx = _subject_context(token)
        canonical = str(ctx["subject_code"]).strip()
        if canonical and canonical not in seen:
            seen.add(canonical)
            out.append(canonical)
    if not out:
        raise IMentorApiError("Kamida bitta fan tanlanishi kerak", status=400)
    return out


def _transform_imentor_questions(raw_questions: list[dict]) -> list[dict]:
    out: list[dict] = []
    for q in raw_questions:
        if not isinstance(q, dict):
            continue
        opts = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()]
        if not opts:
            continue
        try:
            idx = int(q.get("correctOptionIndex", 0))
        except (TypeError, ValueError):
            idx = 0
        if idx < 0 or idx >= len(opts):
            idx = 0
        text = str(q.get("question") or "").strip()
        if not text:
            continue
        explanation = str(q.get("explanation") or "").strip()
        raw_oe = q.get("optionExplanations")
        option_explanations: list[str] = []
        if isinstance(raw_oe, list):
            option_explanations = [str(x).strip() for x in raw_oe]
            # options bilan bir xil uzunlikka keltirish (yetishmasa bo'sh)
            if len(option_explanations) < len(opts):
                option_explanations.extend([""] * (len(opts) - len(option_explanations)))
            elif len(option_explanations) > len(opts):
                option_explanations = option_explanations[: len(opts)]
        row = {
            "id": len(out) + 1,
            "text": text,
            "options": opts,
            "correctAnswer": opts[idx],
        }
        if explanation:
            row["explanation"] = explanation
        if option_explanations and any(option_explanations):
            row["optionExplanations"] = option_explanations
        # Manbalar (kitob/maqola). Izoh matnida ularga [1][3] ko'rinishida
        # ishora qilinadi — shu sabab ro'yxatning TARTIBI muhim.
        refs = normalize_question_references(q.get("references"))
        if refs:
            row["references"] = refs
        out.append(row)
    return out


#: iMentor `questions/sample/` javobida har savol shu tillarda kelishi mumkin.
SUPPORTED_QUESTION_LANGUAGES = ("uz", "ru", "en")


def _clean_options_with_index(raw: Any, correct_index: int) -> tuple[list[str], int]:
    """Bo'sh variantlarni tashlaydi va to'g'ri javob indeksini shunga moslaydi."""
    opts: list[str] = []
    new_idx = -1
    if isinstance(raw, list):
        for i, o in enumerate(raw):
            text = str(o).strip()
            if not text:
                continue
            if i == correct_index:
                new_idx = len(opts)
            opts.append(text)
    if not opts:
        return [], 0
    if new_idx < 0 or new_idx >= len(opts):
        new_idx = 0
    return opts, new_idx


def _language_question_block(block: Any, correct_index: int) -> dict | None:
    """`languages.<lang>` bloki → {text, options, correctAnswer, explanation, ...}."""
    if not isinstance(block, dict):
        return None
    text = str(block.get("question") or block.get("text") or "").strip()
    if not text:
        return None
    opts, idx = _clean_options_with_index(block.get("options"), correct_index)
    if not opts:
        return None
    raw_oe = block.get("optionExplanations")
    option_explanations: list[str] = []
    if isinstance(raw_oe, list):
        option_explanations = [str(x).strip() for x in raw_oe][: len(opts)]
        if len(option_explanations) < len(opts):
            option_explanations.extend([""] * (len(opts) - len(option_explanations)))
        if not any(option_explanations):
            option_explanations = []
    return {
        "text": text,
        "options": opts,
        "correctAnswer": opts[idx],
        "explanation": str(block.get("explanation") or "").strip(),
        "optionExplanations": option_explanations,
    }


def _pick_source_language(blocks: dict[str, dict], hint: str | None = None) -> str:
    """Asosiy til: so'ralgan til bo'lsa u, aks holda uz → ru → en tartibida."""
    h = str(hint or "").strip().lower()
    order = [h] if h in SUPPORTED_QUESTION_LANGUAGES else []
    order += [lg for lg in SUPPORTED_QUESTION_LANGUAGES if lg not in order]
    for lang in order:
        if blocks.get(lang):
            return lang
    return next(iter(blocks), "uz")


def _transform_imentor_multilang_questions(
    raw_questions: list[dict],
    *,
    source_language: str | None = None,
) -> tuple[list[dict], list[dict]]:
    """
    Yangi sample API shakli (`languages: {uz, ru, en}`) → imtihon savol formati.

    Tillar API dan TAYYOR keladi, shuning uchun bu yerda tarjima qilinmaydi:
    har til to'g'ridan-to'g'ri `text_<lang>` / `options_<lang>` /
    `correct_answer_<lang>` maydonlariga tushadi. `correctOptionIndex` barcha
    tillarda bir xil (API kafolati) — faqat matn tarjima qilinadi.

    Qaytaradi: (savollar, har savol uchun {"src", "languages"} meta ro'yxati).
    """
    out: list[dict] = []
    langs_meta: list[dict] = []
    for q in raw_questions:
        if not isinstance(q, dict):
            continue
        languages = q.get("languages")
        if not isinstance(languages, dict) or not languages:
            continue
        try:
            correct = int(q.get("correctOptionIndex", 0))
        except (TypeError, ValueError):
            correct = 0
        blocks: dict[str, dict] = {}
        for lang in SUPPORTED_QUESTION_LANGUAGES:
            block = _language_question_block(languages.get(lang), correct)
            if block:
                blocks[lang] = block
        if not blocks:
            continue

        src = _pick_source_language(blocks, source_language)
        base = blocks[src]
        row: dict[str, Any] = {
            "id": len(out) + 1,
            "text": base["text"],
            "options": list(base["options"]),
            "correctAnswer": base["correctAnswer"],
        }
        if base["explanation"]:
            row["explanation"] = base["explanation"]
        if base["optionExplanations"]:
            row["optionExplanations"] = list(base["optionExplanations"])
        for lang, block in blocks.items():
            row[f"text_{lang}"] = block["text"]
            row[f"options_{lang}"] = list(block["options"])
            row[f"correct_answer_{lang}"] = block["correctAnswer"]
            if block["explanation"]:
                row[f"explanation_{lang}"] = block["explanation"]
            if block["optionExplanations"]:
                row[f"optionExplanations_{lang}"] = list(block["optionExplanations"])
        refs = normalize_question_references(q.get("references"))
        if refs:
            row["references"] = refs
        out.append(row)
        langs_meta.append({"src": src, "languages": sorted(blocks.keys())})
    return out, langs_meta


def _merge_ai_translation_row(original: dict, ai_row: dict, known_languages: list[str]) -> dict:
    """AI to'ldirgan savolga iMentor dan kelgan haqiqiy tillarni qaytarib qo'yadi."""
    merged = dict(ai_row) if isinstance(ai_row, dict) else dict(original)
    for lang in known_languages:
        for key in (
            f"text_{lang}",
            f"options_{lang}",
            f"correct_answer_{lang}",
            f"explanation_{lang}",
            f"optionExplanations_{lang}",
        ):
            if key in original:
                value = original[key]
                merged[key] = list(value) if isinstance(value, list) else value
    if original.get("references"):
        merged["references"] = [dict(r) for r in original["references"]]
    merged["id"] = original.get("id", merged.get("id"))
    return merged


def _raw_question_text(q: dict) -> str:
    """Dedup uchun savol matni — eski (tekis) va yangi (`languages`) shakl uchun."""
    text = str(q.get("question") or q.get("text") or "").strip()
    if text:
        return text
    languages = q.get("languages")
    if isinstance(languages, dict):
        for lang in SUPPORTED_QUESTION_LANGUAGES:
            block = languages.get(lang)
            if isinstance(block, dict):
                candidate = str(block.get("question") or block.get("text") or "").strip()
                if candidate:
                    return candidate
    return ""


#: Bitta savolga biriktiriladigan manbalar soni chegarasi (JSON hajmi uchun).
MAX_QUESTION_REFERENCES = 8


def normalize_question_references(raw: Any) -> list[dict]:
    """iMentor `references` ro'yxatini toza, cheklangan ko'rinishga keltiradi."""
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()[:300]
        url = str(item.get("url") or "").strip()[:500]
        if not title and not url:
            continue
        # Faqat xavfsiz sxemalar — natija sahifasida havola sifatida beriladi.
        if url and not url.lower().startswith(("http://", "https://")):
            url = ""
        key = (title.lower(), url.lower())
        if key in seen:
            continue
        seen.add(key)
        ref = {"title": title}
        if url:
            ref["url"] = url
        # `pages` — darslik betlari ("643" yoki "114-118, 220"). iMentor RAG
        # manbalarida eng qimmatli maydon: talaba aynan qaysi betga qarashini
        # biladi. Ilgari bu ro'yxatda yo'q edi va indamay tushib qolardi.
        for field in ("pages", "authors", "publisher", "year"):
            val = str(item.get(field) or "").strip()[:200]
            if val:
                ref[field] = val
        out.append(ref)
        if len(out) >= MAX_QUESTION_REFERENCES:
            break
    return out


def _infer_imentor_source_language(
    translations: dict[str, Any],
    *,
    source_language: str | None = None,
    sample_text: str = "",
) -> str:
    """iMentor: translations — asosiy tildan TASHQARI 2 til. Yo'q til = manba."""
    hint = (source_language or "").lower().strip()
    if hint in ("uz", "ru", "en"):
        return hint
    present = {lg for lg in ("uz", "ru", "en") if isinstance(translations.get(lg), dict)}
    missing = {"uz", "ru", "en"} - present
    if len(missing) == 1:
        return next(iter(missing))
    if sample_text:
        try:
            from apps.api.gemini_tools import detect_question_language

            return detect_question_language(sample_text)
        except Exception:
            pass
    return "uz"


def _apply_imentor_builtin_translations(
    base_questions: list[dict],
    payload: dict,
    *,
    source_language: str | None = None,
) -> tuple[list[dict], bool]:
    """
    iMentor payload.translations dan UZ/RU/EN maydonlarini yig'adi.
    Qaytaradi: (savollar, to'liq_3_til_bormi).
    To'liq bo'lsa AI chaqirish shart emas.
    """
    raw_tr = payload.get("translations") if isinstance(payload, dict) else None
    if not isinstance(raw_tr, dict) or not raw_tr:
        return base_questions, False

    by_lang: dict[str, list[dict]] = {}
    for lang, block in raw_tr.items():
        code = str(lang or "").lower().strip()
        if code not in ("uz", "ru", "en") or not isinstance(block, dict):
            continue
        mapped = _transform_imentor_questions(block.get("questions") or [])
        if mapped:
            by_lang[code] = mapped
    if not by_lang:
        return base_questions, False

    sample = " ".join(str(q.get("text") or "") for q in base_questions[:8])
    src = _infer_imentor_source_language(by_lang, source_language=source_language, sample_text=sample)

    out: list[dict] = []
    complete = True
    for i, q in enumerate(base_questions):
        row = {
            "id": q.get("id"),
            "text": q.get("text"),
            "options": list(q.get("options") or []),
            "correctAnswer": q.get("correctAnswer"),
        }
        # Manba til
        row[f"text_{src}"] = row["text"]
        row[f"options_{src}"] = list(row["options"])
        row[f"correct_answer_{src}"] = row["correctAnswer"]

        for lang, qs in by_lang.items():
            if lang == src:
                continue
            if i >= len(qs):
                complete = False
                continue
            tq = qs[i]
            # Index mosligi: variantlar soni farq qilsa ham matnni olamiz
            row[f"text_{lang}"] = tq.get("text") or ""
            row[f"options_{lang}"] = list(tq.get("options") or [])
            row[f"correct_answer_{lang}"] = tq.get("correctAnswer") or ""
            if (tq.get("explanation") or "").strip():
                row[f"explanation_{lang}"] = str(tq.get("explanation") or "").strip()
            if isinstance(tq.get("optionExplanations"), list) and any(
                str(x).strip() for x in (tq.get("optionExplanations") or [])
            ):
                row[f"optionExplanations_{lang}"] = [
                    str(x).strip() for x in (tq.get("optionExplanations") or [])
                ]
            if not (row[f"text_{lang}"] or "").strip() or not row[f"options_{lang}"]:
                complete = False

        # Manbalar tilga bog'liq emas (kitob/maqola bibliografiyasi) — barcha
        # tillar uchun manba tilidagi ro'yxat ishlatiladi.
        if isinstance(q.get("references"), list) and q.get("references"):
            row["references"] = list(q["references"])

        # Manba tilidagi izohlar
        if (q.get("explanation") or "").strip():
            row[f"explanation_{src}"] = str(q.get("explanation") or "").strip()
            row["explanation"] = row[f"explanation_{src}"]
        if isinstance(q.get("optionExplanations"), list) and any(
            str(x).strip() for x in (q.get("optionExplanations") or [])
        ):
            row[f"optionExplanations_{src}"] = [
                str(x).strip() for x in (q.get("optionExplanations") or [])
            ]
            row["optionExplanations"] = list(row[f"optionExplanations_{src}"])

        for lang in ("uz", "ru", "en"):
            if not (row.get(f"text_{lang}") or "").strip():
                complete = False
        out.append(row)

    return out, complete and len(out) == len(base_questions)


def fetch_random_imentor_questions(
    subject_codes: list[str],
    *,
    max_questions: int = 0,
    source_language: str | None = None,
    add_translations: bool = True,
    variant_label: str | None = None,
    topic_code: str | None = None,
) -> tuple[list[dict], dict[str, Any]]:
    """
    Tanlangan fan(lar) doirasidagi e'lon qilingan testlardan unique savollarni
    iMentor sample API orqali oladi (aralashtirilgan pool).

    max_questions=0 bo'lsa — unique poolning hammasi.
    max_questions>0 bo'lsa count=10..30 API ga uzatiladi.
    variant_label / topic_code — ixtiyoriy filtrlash.

    Sample javobida har savol `languages: {uz, ru, en}` bilan keladi — bu tillar
    to'g'ridan-to'g'ri ishlatiladi, AI tarjima QILINMAYDI. AI faqat til yetishmay
    qolgan (eski) savollar uchun zaxira sifatida chaqiriladi.
    """
    bounds = question_limit_bounds()
    question_limit = validate_question_limit_value(int(max_questions or 0), bounds=bounds)
    v_label = str(variant_label or "").strip() or None
    t_code = str(topic_code or "").strip().lower() or None

    try:
        codes = resolve_imentor_subject_codes(subject_codes)
    except IMentorApiError:
        raise

    raw_qs: list[dict] = []
    sample_meta: dict[str, Any] = {}
    last_error: IMentorApiError | None = None

    for code in codes:
        ctx = _subject_context(code)
        syllabus_id = ctx.get("syllabus_id")
        department_code = str(ctx.get("department_code") or "").strip() or None

        # TARTIB MUHIM (tezlik uchun): agar shu fan kodi ostida test e'lon
        # QILINMAGAN bo'lsa (testlar kafedra kodi ostida turadi — katalogda
        # "kafedra__fan" ko'rinishidagi fanlarda odatiy hol), darhol kafedra
        # bilan so'raymiz. Aks holda avval bo'sh javob keladi va faqat keyin
        # zaxira yo'l ishlaydi — bu bekorga bir necha soniya yo'qotardi.
        prefer_department = bool(
            department_code and department_code != code and not ctx.get("has_own_tests")
        )
        try:
            sample = imentor_sample_questions(
                subject_code=None if prefer_department else code,
                department_code=department_code,
                count=question_limit if question_limit else None,
                variant_label=v_label,
                topic_code=t_code,
                syllabus_id=None if prefer_department else syllabus_id,
            )
        except IMentorApiError as ex:
            last_error = ex
            # Fallback: department-only (legacy subject_code = dept)
            if department_code and department_code != code:
                try:
                    sample = imentor_sample_questions(
                        department_code=department_code,
                        count=question_limit if question_limit else None,
                        variant_label=v_label,
                        topic_code=t_code,
                    )
                except IMentorApiError as ex2:
                    last_error = ex2
                    continue
            else:
                continue

        batch = sample.get("questions") if isinstance(sample, dict) else None

        # MUHIM: API xato QAYTARMASDAN bo'sh javob berishi mumkin.
        # Katalogda kafedra ostida bir nechta fan bor, lekin testlar ko'pincha
        # KAFEDRA kodi ostida e'lon qilinadi. "kafedra__fan" kodi bilan so'ralsa
        # API 200 + 0 savol qaytaradi. Ilgari zaxira yo'l faqat `except`
        # ichida edi, ya'ni bo'sh javobda ishlamasdi va imtihon yaratish
        # "test topilmadi" deb yiqilardi (ro'yxatda esa "1 test" ko'rinardi).
        if (not isinstance(batch, list) or not batch) and department_code and department_code != code:
            try:
                sample = imentor_sample_questions(
                    department_code=department_code,
                    count=question_limit if question_limit else None,
                    variant_label=v_label,
                    topic_code=t_code,
                )
                batch = sample.get("questions") if isinstance(sample, dict) else None
            except IMentorApiError as ex3:
                last_error = ex3
                batch = None

        if not isinstance(batch, list) or not batch:
            continue
        raw_qs.extend([q for q in batch if isinstance(q, dict)])
        sample_meta = sample if isinstance(sample, dict) else {}

    if not raw_qs:
        if last_error:
            raise last_error
        raise IMentorApiError(
            "Tanlangan fan/yo'nalish/mavzuda e'lon qilingan test topilmadi"
        )

    # Bir nechta fan bo'lsa — matn bo'yicha yana unique + shuffle + limit
    if len(codes) > 1:
        seen: set[str] = set()
        deduped: list[dict] = []
        for q in raw_qs:
            key = _normalize_question_text(_raw_question_text(q))
            if not key or key in seen:
                continue
            seen.add(key)
            deduped.append(q)
        random.shuffle(deduped)
        if question_limit:
            deduped = deduped[:question_limit]
        raw_qs = deduped

    # Yangi API: har savol `languages` bilan keladi. Eski (tekis) shakl ham
    # qo'llab-quvvatlanadi — o'sha holda tillar yo'q va AI zaxira bo'ladi.
    multilang = any(isinstance(q, dict) and isinstance(q.get("languages"), dict) for q in raw_qs)
    if multilang:
        questions, langs_meta = _transform_imentor_multilang_questions(
            raw_qs, source_language=source_language
        )
    else:
        questions = _transform_imentor_questions(raw_qs)
        langs_meta = [{"src": "", "languages": []} for _ in questions]
    if not questions:
        raise IMentorApiError("Testdan foydali savol ajratib bo'lmadi")

    used_builtin = any(len(m["languages"]) > 0 for m in langs_meta)
    used_ai = False
    if add_translations:
        # AI faqat 3 tilning hammasi kelmagan savollar uchun — API tarjimasi ustun.
        pending: dict[str, list[int]] = {}
        for i, meta_row in enumerate(langs_meta):
            if len(meta_row["languages"]) >= len(SUPPORTED_QUESTION_LANGUAGES):
                continue
            pending.setdefault(meta_row["src"], []).append(i)
        for src, indexes in pending.items():
            subset = [questions[i] for i in indexes]
            translated = exam_questions_add_translations(subset, src or source_language)
            used_ai = True
            for pos, i in enumerate(indexes):
                if pos >= len(translated):
                    continue
                questions[i] = _merge_ai_translation_row(
                    questions[i], translated[pos], langs_meta[i]["languages"]
                )

    meta = {
        "imentor_test_id": 0,
        "imentor_sample": True,
        "imentor_topic": "",
        "subject_code": str(sample_meta.get("subject_code") or (codes[0] if codes else "")),
        "subject_name": "",
        "department_code": str(
            sample_meta.get("department_code")
            or (_subject_context(codes[0]).get("department_code") if codes else "")
            or ""
        ),
        "department_name": "",
        "variant_label": str(sample_meta.get("variant_label") or v_label or ""),
        "topic_code": str(sample_meta.get("topic_code") or t_code or ""),
        "question_count": len(questions),
        "question_limit": int(question_limit or 0),
        "question_count_available": int(sample_meta.get("count_available") or len(questions)),
        "question_count_returned": int(sample_meta.get("count_returned") or len(questions)),
        "question_limit_bounds": parse_question_limit_bounds(sample_meta),
        "verification_code": "",
        "document_id": "",
        "tests_scanned": int(sample_meta.get("tests_scanned") or 0),
        "available_languages": sorted({lg for m in langs_meta for lg in m["languages"]}),
        "translations_source": (
            "imentor" if used_builtin and not used_ai else ("mixed" if used_ai and used_builtin else ("ai" if used_ai else "none"))
        ),
    }
    return questions, meta


def _normalize_question_text(text: str) -> str:
    return " ".join(str(text or "").lower().split())


def build_imentor_reference_index(
    *,
    test_ids: list[int] | None = None,
    subject_code: str | None = None,
    max_tests: int = 50,
) -> dict[str, list[dict]]:
    """
    iMentor e'lon qilingan testlardan: savol matni → references.
    Eski OnlineTest sessiyalariga manba qayta biriktirish uchun.
    """
    if not imentor_configured():
        return {}

    ids: list[int] = []
    if test_ids:
        ids = [int(x) for x in test_ids if int(x) > 0]
    else:
        try:
            kwargs: dict[str, Any] = {"page": 1, "page_size": min(200, max(1, max_tests))}
            if subject_code:
                kwargs["subject_code"] = subject_code
            data = imentor_list_tests(**kwargs)
            for row in data.get("results") or []:
                if isinstance(row, dict) and int(row.get("id") or 0) > 0:
                    ids.append(int(row["id"]))
        except IMentorApiError:
            return {}

    index: dict[str, list[dict]] = {}
    for tid in ids[:max_tests]:
        try:
            detail = imentor_get_test(tid)
        except IMentorApiError:
            continue
        payload = detail.get("payload") if isinstance(detail.get("payload"), dict) else {}
        payload_refs = normalize_question_references(payload.get("references"))
        raw_qs = payload.get("questions") or []
        if not isinstance(raw_qs, list):
            continue
        for q in raw_qs:
            if not isinstance(q, dict):
                continue
            text = str(q.get("question") or q.get("text") or "").strip()
            if not text:
                continue
            refs = normalize_question_references(q.get("references")) or list(payload_refs)
            if not refs:
                continue
            key = _normalize_question_text(text)
            # Birinchi to'liq manbali nusxa ustun — keyinrogi bo'sh bilan yozib qoymasın.
            if key not in index:
                index[key] = refs
    return index


def enrich_questions_with_imentor_references(
    questions: list[dict],
    *,
    test_ids: list[int] | None = None,
    subject_code: str | None = None,
    index: dict[str, list[dict]] | None = None,
) -> tuple[list[dict], int]:
    """
    Savollarga iMentor `references` ni matn bo'yicha biriktiradi.
    Qaytaradi: (yangilangan_savollar, nechta_savol_yangilandi).
    """
    if not questions:
        return questions, 0
    need = [q for q in questions if isinstance(q, dict) and not q.get("references")]
    if not need:
        return questions, 0

    ref_index = index if index is not None else build_imentor_reference_index(
        test_ids=test_ids,
        subject_code=subject_code,
    )
    if not ref_index:
        return questions, 0

    patched = 0
    out: list[dict] = []
    for q in questions:
        if not isinstance(q, dict):
            out.append(q)
            continue
        row = dict(q)
        existing = normalize_question_references(row.get("references"))
        if existing:
            row["references"] = existing
            out.append(row)
            continue
        key = _normalize_question_text(str(row.get("text") or ""))
        refs = ref_index.get(key)
        if refs:
            row["references"] = [dict(r) for r in refs]
            patched += 1
        out.append(row)
    return out, patched


def sync_ai_summary_item_references(ai_summary: dict, questions: list[dict]) -> dict:
    """ai_summary.items[].references ni savol manbalari bilan to'ldiradi."""
    if not isinstance(ai_summary, dict):
        return {"overview": "", "items": [], "source": "fallback"}
    out = dict(ai_summary)
    items = list(out.get("items") or [])
    by_id = {
        q.get("id"): normalize_question_references(q.get("references"))
        for q in questions
        if isinstance(q, dict)
    }
    new_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        qid = row.get("questionId")
        refs = by_id.get(qid) or []
        if refs and not (isinstance(row.get("references"), list) and row.get("references")):
            row["references"] = list(refs)
        new_items.append(row)
    out["items"] = new_items
    return out


def validate_imentor_subjects(
    subject_codes: list[str],
    *,
    variant_label: str | None = None,
    topic_code: str | None = None,
) -> tuple[bool, str, int]:
    """Imtihon yaratishda: fanlar mavjudligi va kamida bitta test borligini tekshirish."""
    if not imentor_configured():
        return False, "iMentor API kaliti sozlanmagan (IMENTOR_API_KEY)", 0
    try:
        resolved = resolve_imentor_subject_codes(subject_codes)
    except IMentorApiError as ex:
        return False, str(ex), 0
    v_label = str(variant_label or "").strip() or None
    t_code = str(topic_code or "").strip().lower() or None
    total_tests = 0
    for code in resolved:
        ctx = _subject_context(code)
        department_code = str(ctx.get("department_code") or "").strip() or None
        syllabus_id = ctx.get("syllabus_id")
        total_tests += max(
            0 if (v_label or t_code) else int(ctx.get("test_count") or 0),
            imentor_published_test_count(
                subject_code=code,
                syllabus_id=syllabus_id,
                department_code=department_code,
                variant_label=v_label,
                topic_code=t_code,
            ),
        )
    if total_tests < 1:
        return False, "Tanlangan fan/yo'nalish/mavzuda e'lon qilingan test yo'q", 0
    return True, "", total_tests


def _transform_faculty_ai_questions(raw_questions: list[dict]) -> list[dict]:
    """generate-mcq javobi: text/options/correctIndex → OnlineTest MCQ."""
    out: list[dict] = []
    for q in raw_questions or []:
        if not isinstance(q, dict):
            continue
        opts = [str(o).strip() for o in (q.get("options") or []) if str(o).strip()]
        if len(opts) < 2:
            continue
        try:
            idx = int(q.get("correctIndex", q.get("correctOptionIndex", 0)) or 0)
        except (TypeError, ValueError):
            idx = 0
        if idx < 0 or idx >= len(opts):
            idx = 0
        text = str(q.get("text") or q.get("question") or "").strip()
        if not text:
            continue
        row: dict[str, Any] = {
            "id": len(out) + 1,
            "text": text,
            "options": opts,
            "correctAnswer": opts[idx],
            "source": str(q.get("source") or "imentor_faculty_ai_books"),
        }
        expl = str(q.get("explanation") or "").strip()
        if expl:
            row["explanation"] = expl
        out.append(row)
    return out


def fetch_faculty_ai_mcq_questions(
    *,
    department_name: str | None = None,
    department_code: str | None = None,
    subject: str | None = None,
    count: int = 20,
    language: str = "uz",
) -> tuple[list[dict], dict]:
    """O'qituvchi imtihoni: kafedra kitoblaridan AI 20 MCQ (fan bo'yicha, USMLE)."""
    from apps.api.imentor_department_match import pick_best_department

    if not imentor_configured():
        raise IMentorApiError("iMentor API kaliti sozlanmagan (IMENTOR_API_KEY)", status=403)
    name = str(department_name or "").strip()
    code = str(department_code or "").strip()
    subj = str(subject or "").strip()
    if not name and not code:
        raise IMentorApiError("Kafedra belgilanmagan", status=400)
    n = max(5, min(30, int(count or 20)))
    lang = str(language or "uz").strip().lower()[:5] or "uz"
    if lang not in ("uz", "ru", "en"):
        lang = "uz"

    # OnlineTest kafedra nomi/kodi ≠ iMentor — katalogdan fuzzy resolve.
    try:
        cats = imentor_catalog_departments()
        rows = cats.get("results") if isinstance(cats, dict) else None
        hit = pick_best_department(
            name=name or None,
            code=code or None,
            catalog_rows=rows if isinstance(rows, list) else [],
        )
        if hit:
            code = str(hit.get("code") or "").strip() or code
            name = str(hit.get("name") or "").strip() or name
    except IMentorApiError:
        pass

    meta: dict[str, Any] = {
        "source": "generate_mcq",
        "fallback": False,
        "subject": subj or None,
        "resolved_department_code": code or None,
        "resolved_department_name": name or None,
    }
    generate_err: str | None = None
    try:
        payload = imentor_generate_mcq(
            department_name=name or None,
            department_code=code or None,
            subject=subj or None,
            count=n,
            language=lang,
        )
        raw_qs = payload.get("questions") if isinstance(payload, dict) else None
        questions = _transform_faculty_ai_questions(raw_qs if isinstance(raw_qs, list) else [])
        if questions:
            meta["department"] = payload.get("department") if isinstance(payload, dict) else None
            meta["chunks_used"] = payload.get("chunks_used") if isinstance(payload, dict) else None
            return questions[:n], meta
    except IMentorApiError as ex:
        # 403/503 — sozlama; qolgan 404/400 da sample fallback uriniladi
        if ex.status in (403, 503):
            raise
        generate_err = str(ex)
        meta["generate_error"] = generate_err

    if not code:
        raise IMentorApiError(
            generate_err
            or "Bu kafedra uchun AI savol yaratib bo'lmadi va iMentor kafedra kodi topilmadi.",
            status=404,
        )
    try:
        sample = imentor_sample_questions(department_code=code, count=n)
    except IMentorApiError as ex:
        raise IMentorApiError(
            generate_err or str(ex) or "Bu kafedra uchun vektor kitob / nashr test topilmadi.",
            status=getattr(ex, "status", None) or 404,
        ) from ex
    raw_qs = sample.get("questions") if isinstance(sample, dict) else None
    questions = _transform_imentor_questions(raw_qs if isinstance(raw_qs, list) else [])
    if not questions:
        raise IMentorApiError(
            generate_err or "Bu kafedra uchun vektor kitob / nashr test topilmadi.",
            status=404,
        )
    meta["source"] = "sample_fallback"
    meta["fallback"] = True
    meta["department_code"] = code
    return questions[:n], meta
