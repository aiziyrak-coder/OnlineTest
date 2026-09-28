"""Yuz embedding — OpenCV YuNet + SFace (cosine similarity). OpenAI Vision emas."""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

from apps.api.identity_log import log_identity

_logger = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parent / "face_models"
_YUNET = _MODELS_DIR / "face_detection_yunet_2023mar.onnx"
_SFACE = _MODELS_DIR / "face_recognition_sface_2021dec.onnx"

# opencv_zoo'dagi rasmiy fayllarning SHA256 pin'lari — modellar repo'ga
# committed (backend/apps/api/face_models/), shuning uchun bu tekshiruv
# odatda faqat tasodifiy buzilish/mos kelmaslikni ushlab qoladi, MITM/supply
# chain'ga qarshi himoya sifatida ham xizmat qiladi.
_YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
_SFACE_SHA256 = "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"

_ENGINE_LOCK = threading.Lock()
_ENGINE: dict[str, Any] | None = None
_MODELS_VERIFIED: bool | None = None


def _cosine_threshold() -> float:
    raw = (os.environ.get("FACE_MATCH_COSINE_THRESHOLD") or "0.40").strip()
    try:
        return max(0.2, min(0.95, float(raw)))
    except ValueError:
        return 0.40


def _decode_b64_image(data_b64: str) -> bytes | None:
    s = (data_b64 or "").strip()
    if "," in s:
        s = s.split(",", 1)[1].strip()
    pad = len(s) % 4
    if pad:
        s += "=" * (4 - pad)
    try:
        raw = base64.b64decode(s, validate=False)
    except Exception:
        return None
    return raw if len(raw) >= 80 else None


def _sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _verified(path: Path, expected_sha256: str) -> bool:
    """Fayl mavjud VA hash mos — mos kelmasa (yoki fayl yo'q) False, tampering'ga
    qarshi fail-closed: mos kelmagan fayl hech qachon "mavjud" deb hisoblanmaydi."""
    if not path.is_file():
        return False
    actual = _sha256_of(path)
    if actual != expected_sha256:
        _logger.warning(
            "face model hash mismatch: %s (expected=%s actual=%s) — engine unavailable",
            path.name, expected_sha256, actual,
        )
        return False
    return True


def _download_allowed() -> bool:
    return (os.environ.get("FACE_MODELS_ALLOW_DOWNLOAD") or "").strip().lower() in (
        "1", "true", "yes",
    )


def _try_download(path: Path, url: str, expected_sha256: str) -> bool:
    """Faqat FACE_MODELS_ALLOW_DOWNLOAD=1 bo'lsa chaqiriladi (default: o'chiq —
    modellar allaqachon repo/image ichida, runtime tarmoq chaqiruvi kutilmaydi).
    Yuklangan fayl ham hash tekshiruvidan o'tishi shart; mos kelmasa o'chiriladi."""
    try:
        import urllib.request

        _MODELS_DIR.mkdir(parents=True, exist_ok=True)
        _logger.info("Downloading face model %s", path.name)
        urllib.request.urlretrieve(url, path)  # noqa: S310
    except Exception as exc:
        _logger.warning("face model download failed: %s", exc)
        return False
    if not _verified(path, expected_sha256):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        return False
    return True


def _ensure_models() -> bool:
    global _MODELS_VERIFIED
    if _MODELS_VERIFIED is not None:
        return _MODELS_VERIFIED

    urls = {
        _YUNET: (
            "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
            _YUNET_SHA256,
        ),
        _SFACE: (
            "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
            _SFACE_SHA256,
        ),
    }
    ok = True
    for path, (url, expected_sha256) in urls.items():
        if _verified(path, expected_sha256):
            continue
        if _download_allowed():
            if not _try_download(path, url, expected_sha256):
                ok = False
        else:
            ok = False
    _MODELS_VERIFIED = ok
    return ok


def _engine_available() -> bool:
    try:
        import cv2  # noqa: F401

        return hasattr(cv2, "FaceRecognizerSF") and hasattr(cv2, "FaceDetectorYN")
    except Exception:
        return False


def _get_engine() -> dict[str, Any] | None:
    global _ENGINE
    if _ENGINE is not None:
        return _ENGINE
    if not _engine_available() or not _ensure_models():
        return None
    with _ENGINE_LOCK:
        if _ENGINE is not None:
            return _ENGINE
        try:
            import cv2

            detector = cv2.FaceDetectorYN.create(
                str(_YUNET),
                "",
                (320, 320),
                score_threshold=0.65,
                nms_threshold=0.3,
                top_k=5000,
            )
            # Pasport surati uchun alohida, yumshoqroq detektor. Umumiy
            # detektorning chegarasini o'zgartirib bo'lmaydi — u proctoring
            # kadrlari bilan bir vaqtda ishlaydi.
            detector_lo = cv2.FaceDetectorYN.create(
                str(_YUNET),
                "",
                (320, 320),
                score_threshold=0.2,
                nms_threshold=0.3,
                top_k=5000,
            )
            recognizer = cv2.FaceRecognizerSF.create(str(_SFACE), "")
            _ENGINE = {
                "detector": detector,
                "detector_lo": detector_lo,
                "recognizer": recognizer,
                "cv2": cv2,
            }
            return _ENGINE
        except Exception as exc:
            _logger.warning("face engine init failed: %s", exc)
            return None


def _bytes_to_bgr(image_bytes: bytes):
    import cv2
    import numpy as np

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def _largest_face(faces):
    if faces is None or len(faces) == 0:
        return None
    return max(faces, key=lambda f: float(f[2]) * float(f[3]))


def _face_variants(img, cv2) -> list:
    """Yuzni topish uchun rasm variantlari.

    Odamlar pasportning YOYILGAN suratini yuklaydi: kadr keng, undagi yuz esa
    butun rasmning kichik bir bo'lagi bo'ladi. Bitta o'lchamda qidirilganda
    detektor uni ko'rmasdi va hammaga "Yuz aniqlanmadi" chiqardi. Endi bir
    necha o'lchamda va pasport yoyilgan bo'lsa har bir betida alohida qidiramiz.
    """
    out = []
    h, w = img.shape[:2]
    long_side = max(h, w)

    def _scaled(src, target=1600):
        sh, sw = src.shape[:2]
        longest = max(sh, sw)
        if longest == 0:
            return None
        k = target / float(longest)
        if 0.95 < k < 1.05:
            return src
        interp = cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC
        return cv2.resize(src, (max(1, int(sw * k)), max(1, int(sh * k))), interpolation=interp)

    out.append(img)
    scaled = _scaled(img)
    if scaled is not None and scaled is not img:
        out.append(scaled)
    if long_side < 900:
        big = _scaled(img, 2400)
        if big is not None:
            out.append(big)

    # Yoyilgan pasport: yuz odatda bitta betda bo'ladi.
    if w > h * 1.15:
        half = w // 2
        for part in (img[:, :half], img[:, half:]):
            piece = _scaled(part)
            if piece is not None and piece.shape[0] >= 48 and piece.shape[1] >= 48:
                out.append(piece)

    # Telefonda olingan surat ko'pincha yon tomonga burilgan bo'ladi (EXIF
    # burilishi rasm ichida yozilgan, cv2 esa uni hisobga olmaydi). Bunday
    # kadrda yuz 90 daraja yotgan holatda bo'ladi va detektor uni ko'rmaydi.
    rotations = (cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE)
    base = _scaled(img)
    if base is None:
        base = img
    for code in rotations:
        try:
            out.append(cv2.rotate(base, code))
        except Exception:
            continue
    return out


def _best_face(img, engine):
    """Barcha variantlar ichidan eng ishonchli yuzni tanlaydi.

    Birinchi topilganini olish xato edi: yon burilgan kadrda ham yuz
    "topilardi", lekin undan olingan belgi (embedding) yaroqsiz bo'lib,
    solishtiruv nolga yaqin natija berardi. Tik turgan yuzni detektor ancha
    yuqori ishonch bilan topadi — shuning uchun eng yuqori ballisini olamiz.
    """
    cv2 = engine["cv2"]
    detectors = [engine["detector"]]
    lo = engine.get("detector_lo")
    if lo is not None:
        detectors.append(lo)

    variants = _face_variants(img, cv2)
    best = (None, None, -1.0)
    for detector in detectors:
        for variant in variants:
            vh, vw = variant.shape[:2]
            if vw < 48 or vh < 48:
                continue
            try:
                detector.setInputSize((vw, vh))
                _, faces = detector.detect(variant)
            except Exception:
                continue
            face = _largest_face(faces)
            if face is None:
                continue
            try:
                score = float(face[-1])
            except Exception:
                score = 0.0
            if score > best[2]:
                best = (variant, face, score)
        # Qat'iy detektor ishonchli yuz topgan bo'lsa, yumshog'i kerak emas.
        if best[2] >= 0.9:
            break
    return best[0], best[1]

def _extract_feature(image_bytes: bytes, engine: dict[str, Any]) -> tuple[Any | None, str | None]:
    cv2 = engine["cv2"]
    recognizer = engine["recognizer"]

    img = _bytes_to_bgr(image_bytes)
    if img is None or img.size == 0:
        return None, "INVALID_IMAGE"

    h, w = img.shape[:2]
    if w < 48 or h < 48:
        return None, "IMAGE_TOO_SMALL"

    variant, face = _best_face(img, engine)
    if face is None:
        return None, "FACE_NOT_DETECTED"
    try:
        aligned = recognizer.alignCrop(variant, face)
        return recognizer.feature(aligned), None
    except Exception:
        return None, "FACE_NOT_DETECTED"

def crop_face_b64(image_b64: str, max_side: int = 512, margin: float = 0.55) -> str | None:
    """Rasmdan yuzni kesib, TIK holatda JPEG base64 qaytaradi.

    Profil rasmi sifatida butun pasport sahifasi saqlanardi: yuz kadrning
    kichik, yon burilgan va yaltiragan bo'lagi bo'lib qolardi va imtihon
    oldidagi solishtiruv deyarli nol natija berardi.
    """
    engine = _get_engine()
    if engine is None:
        return None
    raw = _decode_b64_image(image_b64)
    if not raw:
        return None
    cv2 = engine["cv2"]
    img = _bytes_to_bgr(raw)
    if img is None or img.size == 0:
        return None

    variant, face = _best_face(img, engine)
    if face is None:
        return None
    vh, vw = variant.shape[:2]
    x, y, fw, fh = float(face[0]), float(face[1]), float(face[2]), float(face[3])
    mx, my = fw * margin, fh * margin
    x0, y0 = max(0, int(x - mx)), max(0, int(y - my))
    x1, y1 = min(vw, int(x + fw + mx)), min(vh, int(y + fh + my))
    if x1 - x0 < 32 or y1 - y0 < 32:
        return None
    crop = variant[y0:y1, x0:x1]
    ch, cw = crop.shape[:2]
    longest = max(ch, cw)
    if longest and longest != max_side:
        k2 = max_side / float(longest)
        interp = cv2.INTER_AREA if k2 < 1 else cv2.INTER_CUBIC
        crop = cv2.resize(crop, (max(1, int(cw * k2)), max(1, int(ch * k2))), interpolation=interp)
    ok, buf = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    if not ok:
        return None
    import base64 as _b64

    return _b64.b64encode(buf.tobytes()).decode("ascii")

@lru_cache(maxsize=1)
def face_engine_ready() -> bool:
    return _get_engine() is not None


def compare_face_images(profile_b64: str, live_b64: str) -> dict:
    """
    Ikki rasmni SFace embedding orqali solishtiradi.
    Returns:
        success, match, score (cosine), method, code?, detail?
    """
    engine = _get_engine()
    if engine is None:
        log_identity("embedding_skip", reason="FACE_ENGINE_UNAVAILABLE")
        return {"success": False, "code": "FACE_ENGINE_UNAVAILABLE"}

    p_bytes = _decode_b64_image(profile_b64)
    l_bytes = _decode_b64_image(live_b64)
    if not p_bytes or not l_bytes:
        return {"success": False, "code": "INVALID_IMAGE"}

    cv2 = engine["cv2"]
    recognizer = engine["recognizer"]
    threshold = _cosine_threshold()

    log_identity("embedding_start", profile_kb=round(len(p_bytes) / 1024, 1), live_kb=round(len(l_bytes) / 1024, 1))

    p_feat, p_err = _extract_feature(p_bytes, engine)
    if p_feat is None:
        code = p_err or "FACE_NOT_DETECTED"
        log_identity("embedding_fail", side="profile", code=code)
        return {"success": True, "match": False, "score": 0.0, "method": "embedding", "code": code}

    l_feat, l_err = _extract_feature(l_bytes, engine)
    if l_feat is None:
        code = l_err or "FACE_NOT_DETECTED"
        log_identity("embedding_fail", side="live", code=code)
        return {"success": True, "match": False, "score": 0.0, "method": "embedding", "code": code}

    score = float(recognizer.match(p_feat, l_feat, cv2.FaceRecognizerSF_FR_COSINE))
    matched = score >= threshold
    log_identity(
        "embedding_done",
        match=matched,
        score=round(score, 4),
        threshold=threshold,
    )
    return {
        "success": True,
        "match": matched,
        "score": round(score, 4),
        "method": "embedding",
        "threshold": threshold,
    }


def _decode_frame_b64(frame_b64: str) -> bytes | None:
    return _decode_b64_image(frame_b64)


def _detect_faces_raw(image_bytes: bytes, engine: dict[str, Any]):
    """Barcha yuzlar (YuNet) — proktor uchun."""
    cv2 = engine["cv2"]
    detector = engine["detector"]
    img = _bytes_to_bgr(image_bytes)
    if img is None or img.size == 0:
        return None, []
    h, w = img.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    if faces is None or len(faces) == 0:
        return img, []
    return img, list(faces)


def center_identity_ambiguous(frame_b64: str) -> bool:
    """Do not compare identity against a nearby bystander in a shared room."""
    engine = _get_engine()
    raw = _decode_frame_b64(frame_b64)
    if not engine or not raw:
        return False  # Existing identity error handling remains authoritative.
    try:
        img, faces = _detect_faces_raw(raw, engine)
        if img is None or len(faces) < 2:
            return False
        ordered = sorted(faces, key=lambda f: float(f[2]) * float(f[3]), reverse=True)
        first, second = ordered[:2]
        return float(second[2]) * float(second[3]) >= float(first[2]) * float(first[3]) * 0.45
    except Exception:
        return False


def analyze_proctor_frame_local(frame_b64: str) -> dict:
    """
    OpenCV YuNet — yuz soni va kadr markazidan og‘ish (qarab ketish).
    OpenAI kerak emas.
    """
    engine = _get_engine()
    if engine is None:
        return {"ok": False, "code": "FACE_ENGINE_UNAVAILABLE"}

    raw = _decode_frame_b64(frame_b64)
    if not raw:
        return {"ok": False, "code": "INVALID_IMAGE"}

    img, faces = _detect_faces_raw(raw, engine)
    if img is None:
        return {"ok": False, "code": "INVALID_IMAGE"}

    ih, iw = img.shape[:2]
    face_count = len(faces)
    violations: list[str] = []

    if face_count == 0:
        violations.append("FACE_NOT_VISIBLE")
    elif face_count >= 2:
        violations.append("MULTIPLE_FACES")
    else:
        face = faces[0]
        fx, fy, fw, fh = float(face[0]), float(face[1]), float(face[2]), float(face[3])
        cx = fx + fw / 2.0
        cy = fy + fh / 2.0
        rel_x = (cx - iw / 2.0) / max(iw, 1)
        rel_y = (cy - ih / 2.0) / max(ih, 1)
        # Yuz markazdan ancha siljiganda — qarab ketish / uxlash holati
        if rel_x < -0.18:
            violations.append("GAZE_AWAY_LEFT")
        elif rel_x > 0.18:
            violations.append("GAZE_AWAY_RIGHT")
        if rel_y < -0.14:
            violations.append("GAZE_AWAY_UP")
        elif rel_y > 0.18:
            violations.append("GAZE_AWAY_DOWN")

    return {
        "ok": True,
        "face_count": face_count,
        "violations": violations,
        "forbidden_objects": [],
        "looking_away": any(v.startswith("GAZE_AWAY") for v in violations),
        "method": "opencv",
    }
