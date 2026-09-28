"""Face embedding unit tests."""
from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from apps.api import face_embedding


def _fake_cv2():
    """cv2 o'rnini bosuvchi mock, lekin rasm o'zgartiruvchi funksiyalari HAQIQIY
    numpy massiv qaytaradi.

    `_face_variants` rasmni o'lchamlab (cv2.resize) va burib (cv2.rotate) bir
    nechta variant yaratadi, `_best_face` esa har birining `.shape`ini o'qiydi.
    Toza MagicMock qaytarsa `.shape[:2]` ochilmaydi (ValueError) — detektor
    mantiqi umuman sinalmay qolardi.
    """
    import numpy as np

    cv2 = mock.MagicMock()
    cv2.ROTATE_90_CLOCKWISE = 0
    cv2.ROTATE_180 = 1
    cv2.ROTATE_90_COUNTERCLOCKWISE = 2
    cv2.INTER_AREA = 3
    cv2.INTER_CUBIC = 2

    def _resize(src, dsize, interpolation=None):
        w, h = dsize
        return np.zeros((h, w) + tuple(src.shape[2:]), dtype=src.dtype)

    def _rotate(src, code):
        return np.ascontiguousarray(np.rot90(src, k={0: -1, 1: 2, 2: 1}[code]))

    cv2.resize.side_effect = _resize
    cv2.rotate.side_effect = _rotate
    return cv2


class FaceEmbeddingTests(unittest.TestCase):
    @mock.patch("apps.api.face_embedding._get_engine", return_value=None)
    def test_engine_unavailable(self, _eng):
        out = face_embedding.compare_face_images("abc", "def")
        self.assertFalse(out.get("success"))
        self.assertEqual(out.get("code"), "FACE_ENGINE_UNAVAILABLE")

    @mock.patch("apps.api.face_embedding._get_engine")
    def test_match_above_threshold(self, eng_mock):
        import numpy as np

        cv2 = _fake_cv2()
        cv2.FaceRecognizerSF_FR_COSINE = 1
        detector = mock.MagicMock()
        recognizer = mock.MagicMock()
        recognizer.match.return_value = 0.82
        eng_mock.return_value = {"detector": detector, "recognizer": recognizer, "cv2": cv2}

        face = np.array([10, 10, 80, 80], dtype=np.float32)
        detector.detect.return_value = (1, np.array([face]))

        with mock.patch("apps.api.face_embedding._decode_b64_image", return_value=b"\xff\xd8\xff"):
            with mock.patch("apps.api.face_embedding._bytes_to_bgr", return_value=np.zeros((120, 120, 3), dtype=np.uint8)):
                out = face_embedding.compare_face_images("p", "l")

        self.assertTrue(out.get("success"))
        self.assertTrue(out.get("match"))
        self.assertEqual(out.get("method"), "embedding")
        self.assertGreaterEqual(out.get("score", 0), 0.8)

    @mock.patch("apps.api.face_embedding._get_engine")
    def test_no_face_detected(self, eng_mock):
        import numpy as np

        cv2 = _fake_cv2()
        detector = mock.MagicMock()
        recognizer = mock.MagicMock()
        eng_mock.return_value = {"detector": detector, "recognizer": recognizer, "cv2": cv2}
        detector.detect.return_value = (0, None)

        with mock.patch("apps.api.face_embedding._decode_b64_image", return_value=b"\xff\xd8\xff"):
            with mock.patch("apps.api.face_embedding._bytes_to_bgr", return_value=np.zeros((120, 120, 3), dtype=np.uint8)):
                out = face_embedding.compare_face_images("p", "l")

        self.assertTrue(out.get("success"))
        self.assertFalse(out.get("match"))
        self.assertEqual(out.get("code"), "FACE_NOT_DETECTED")
        # Barcha variantlar (asl, kattalashtirilgan, 3 burilish) sinab ko'rilgan.
        self.assertGreater(detector.detect.call_count, 1)
        recognizer.feature.assert_not_called()


class ModelIntegrityTests(unittest.TestCase):
    """SHA256 pin tekshiruvi — tampering/mos kelmaslikka qarshi fail-closed."""

    def _write_tmp(self, content: bytes) -> Path:
        d = Path(tempfile.mkdtemp())
        p = d / "model.onnx"
        p.write_bytes(content)
        self.addCleanup(lambda: p.unlink(missing_ok=True))
        return p

    def test_verified_accepts_matching_hash(self):
        content = b"fake-onnx-bytes"
        path = self._write_tmp(content)
        expected = hashlib.sha256(content).hexdigest()
        self.assertTrue(face_embedding._verified(path, expected))

    def test_verified_rejects_mismatched_hash(self):
        path = self._write_tmp(b"fake-onnx-bytes")
        wrong_hash = "0" * 64
        self.assertFalse(face_embedding._verified(path, wrong_hash))

    def test_verified_rejects_missing_file(self):
        missing = Path(tempfile.mkdtemp()) / "does-not-exist.onnx"
        self.assertFalse(face_embedding._verified(missing, "0" * 64))

    def test_ensure_models_false_when_hash_mismatch_and_download_disabled(self):
        with mock.patch.object(face_embedding, "_MODELS_VERIFIED", None):
            with mock.patch.object(face_embedding, "_verified", return_value=False):
                with mock.patch.object(face_embedding, "_download_allowed", return_value=False):
                    self.assertFalse(face_embedding._ensure_models())

    def test_ensure_models_true_when_hash_matches(self):
        with mock.patch.object(face_embedding, "_MODELS_VERIFIED", None):
            with mock.patch.object(face_embedding, "_verified", return_value=True):
                self.assertTrue(face_embedding._ensure_models())

    def test_get_engine_returns_none_on_hash_mismatch(self):
        """Uchidan uchiga: hash mos kelmasa compare_face_images FACE_ENGINE_UNAVAILABLE qaytaradi."""
        with mock.patch.object(face_embedding, "_MODELS_VERIFIED", None), \
             mock.patch.object(face_embedding, "_ENGINE", None), \
             mock.patch.object(face_embedding, "_verified", return_value=False), \
             mock.patch.object(face_embedding, "_download_allowed", return_value=False), \
             mock.patch.object(face_embedding, "_engine_available", return_value=True):
            out = face_embedding.compare_face_images("abc", "def")
        self.assertFalse(out.get("success"))
        self.assertEqual(out.get("code"), "FACE_ENGINE_UNAVAILABLE")
