"""Yuz orqali kirish: kadrlardan odamni aniqlash (1:N).

Shablonlar cam.fermi.uz -> iMentor bazasidan `FaceLoginTemplate` ga har soatda
ko'chiriladi (deploy/sync-face-templates.sh). Embedding iMentor'ning `face_api`
xizmatida hisoblanadi — shablonlar ham shu model bilan olingan, shuning uchun
bizning OpenCV modelimiz (face_embedding.py) bu yerda ishlatilmaydi.

Qaror qoidasi iMentor bilan bir xil (app/services/face_login.py):
  * har bir kadr eng yaqin ODAMga >= MATCH_THRESHOLD o'xshash bo'lishi;
  * ikkinchi eng yaqin odamdan kamida MATCH_MARGIN farq qilishi;
  * barcha kadrlar AYNAN BITTA odamni ko'rsatishi.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import urllib.error
import urllib.request
import uuid

import numpy as np
from django.db.models import Count, Max

from apps.core.models import FaceLoginTemplate

logger = logging.getLogger("apps.api")

MATCH_THRESHOLD = float(os.environ.get("FACE_LOGIN_THRESHOLD", "0.52"))
MATCH_MARGIN = float(os.environ.get("FACE_LOGIN_MARGIN", "0.07"))
EMBEDDING_DIM = 512


def face_api_url() -> str:
    return os.environ.get("FACE_API_URL", "http://face_api:8200").rstrip("/")


def login_roles() -> set[str]:
    raw = os.environ.get("FACE_LOGIN_ROLES", "faculty")
    return {r.strip().lower() for r in raw.split(",") if r.strip()}


def parse_embedding(raw) -> list[float] | None:
    """JSON ro'yxat yoki vergul/bo'shliq bilan ajratilgan sonlar."""
    vals = None
    if isinstance(raw, list):
        vals = raw
    else:
        s = str(raw or "").strip()
        if not s:
            return None
        try:
            vals = json.loads(s)
        except (ValueError, TypeError):
            vals = s.strip("[]{}").replace(",", " ").split()
    try:
        out = [float(x) for x in vals]
    except (TypeError, ValueError):
        return None
    return out if len(out) == EMBEDDING_DIM else None


_cache_lock = threading.Lock()
_cache: dict = {"stamp": None, "keys": [], "pinfls": [], "matrix": None}


def _load_matrix():
    agg = FaceLoginTemplate.objects.aggregate(n=Count("id"), t=Max("synced_at"))
    stamp = (agg["n"], agg["t"])
    with _cache_lock:
        if _cache["stamp"] == stamp and _cache["matrix"] is not None:
            return _cache["keys"], _cache["pinfls"], _cache["matrix"]
    keys, pinfls, vecs = [], [], []
    for sid, pinfl, raw in FaceLoginTemplate.objects.values_list("source_id", "pinfl", "embedding").iterator():
        vec = parse_embedding(raw)
        if vec is None:
            continue
        arr = np.asarray(vec, dtype=np.float32)
        n = float(np.linalg.norm(arr))
        if n == 0:
            continue
        keys.append(sid)
        pinfls.append(pinfl or "")
        vecs.append(arr / n)
    matrix = np.vstack(vecs) if vecs else None
    with _cache_lock:
        _cache.update(stamp=stamp, keys=keys, pinfls=pinfls, matrix=matrix)
    return keys, pinfls, matrix


@dataclass
class FaceDecision:
    status: str  # ok | unlinked | unknown | no_face | unavailable
    pinfl: str = ""
    similarity: float = 0.0


def decide(embeddings, keys, pinfls, matrix) -> FaceDecision:
    if not embeddings or any(e is None for e in embeddings):
        return FaceDecision("no_face")
    if matrix is None or matrix.shape[0] == 0:
        return FaceDecision("unknown")
    # "Odam" — bog'langan JShShIR (bir odamning bir necha yuzi bo'lishi mumkin)
    # yoki bog'lanmagan shablon.
    identities = [p if p else f"tpl:{k}" for k, p in zip(keys, pinfls)]
    picked: set[str] = set()
    worst = 1.0
    for emb in embeddings:
        vec = np.asarray(emb, dtype=np.float32)
        n = float(np.linalg.norm(vec))
        if n == 0:
            return FaceDecision("no_face")
        sims = matrix @ (vec / n)
        best_by: dict[str, float] = {}
        for idx, ident in enumerate(identities):
            v = float(sims[idx])
            if v > best_by.get(ident, -2.0):
                best_by[ident] = v
        ranked = sorted(best_by.items(), key=lambda kv: kv[1], reverse=True)
        best_ident, best = ranked[0]
        second = ranked[1][1] if len(ranked) > 1 else -1.0
        if best < MATCH_THRESHOLD or best - second < MATCH_MARGIN:
            return FaceDecision("unknown", similarity=best)
        picked.add(best_ident)
        worst = min(worst, best)
    if len(picked) != 1:
        return FaceDecision("unknown", similarity=worst)
    ident = picked.pop()
    if ident.startswith("tpl:"):
        return FaceDecision("unlinked", similarity=worst)
    return FaceDecision("ok", pinfl=ident, similarity=worst)


class FaceApiError(Exception):
    """face_api xizmati javob bermadi."""


def embed_image(data: bytes) -> list[float] | None:
    """face_api /embed (multipart, standart kutubxona). Yuz yo'q / juda kichik — None."""
    boundary = uuid.uuid4().hex
    head = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="image"; filename="frame.jpg"\r\n'
        "Content-Type: image/jpeg\r\n\r\n"
    ).encode()
    body = head + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{face_api_url()}/embed",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as ex:
        if ex.code in (413, 422):
            return None
        raise FaceApiError(str(ex)) from ex
    except (urllib.error.URLError, OSError, ValueError) as ex:
        raise FaceApiError(str(ex)) from ex
    emb = (payload or {}).get("embedding")
    return emb if isinstance(emb, list) and len(emb) == EMBEDDING_DIM else None


def identify(frames: list[bytes]) -> FaceDecision:
    try:
        with ThreadPoolExecutor(max_workers=len(frames)) as pool:
            embeddings = list(pool.map(embed_image, frames))
    except FaceApiError:
        logger.exception("[FACE-LOGIN] face_api bilan bog'lanib bo'lmadi")
        return FaceDecision("unavailable")
    keys, pinfls, matrix = _load_matrix()
    d = decide(embeddings, keys, pinfls, matrix)
    logger.info("[FACE-LOGIN] status=%s pinfl=%s sim=%.3f", d.status, d.pinfl[-4:] if d.pinfl else "-", d.similarity)
    return d
