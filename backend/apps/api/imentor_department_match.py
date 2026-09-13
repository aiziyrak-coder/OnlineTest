"""Robust department resolve for faculty AI generate-mcq."""
from __future__ import annotations

import re
import unicodedata
from typing import Any


def _norm_dept(s: str) -> str:
    t = unicodedata.normalize("NFKC", str(s or "")).casefold().strip()
    t = t.replace("ʻ", "'").replace("ʼ", "'").replace("'", "'").replace("`", "'")
    t = t.replace("‘", "'").replace("’", "'")
    for suf in (" kafedrasi", " kafedra", " department", " dep."):
        if t.endswith(suf):
            t = t[: -len(suf)].strip()
    t = re.sub(r"[^\w\s]+", " ", t, flags=re.UNICODE)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _tokens(s: str) -> set[str]:
    return {w for w in _norm_dept(s).split() if len(w) > 2}


def score_department_match(query: str, candidate: str) -> int:
    """Higher is better. 0 = no useful match."""
    qn = _norm_dept(query)
    cn = _norm_dept(candidate)
    if not qn or not cn:
        return 0
    if qn == cn:
        return 1000
    if qn in cn or cn in qn:
        return 800 + min(len(qn), len(cn))
    qt, ct = _tokens(query), _tokens(candidate)
    if not qt or not ct:
        return 0
    inter = qt & ct
    if not inter:
        return 0
    # Jaccard-ish with bonus for coverage of query tokens
    j = len(inter) / max(1, len(qt | ct))
    cov = len(inter) / max(1, len(qt))
    if cov < 0.45 and j < 0.35:
        return 0
    return int(400 * cov + 200 * j + 10 * len(inter))


def pick_best_department(
    *,
    name: str | None,
    code: str | None,
    catalog_rows: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Pick best iMentor department from catalog rows ({code,name,...})."""
    rows = [r for r in (catalog_rows or []) if isinstance(r, dict)]
    code_q = str(code or "").strip()
    name_q = str(name or "").strip()
    if code_q:
        for r in rows:
            if str(r.get("code") or "").strip() == code_q:
                return r
    best: dict[str, Any] | None = None
    best_score = 0
    if name_q:
        for r in rows:
            sc = score_department_match(name_q, str(r.get("name") or ""))
            if sc > best_score:
                best_score = sc
                best = r
    if best_score >= 200:
        return best
    return None
