"""Sertifikat va BAN hisobot PDF (reportlab + QR)."""
import os
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas

# Institut logosi — frontend dist papkasida
_BASE = Path(__file__).resolve().parent.parent.parent.parent
_LOGO_CANDIDATES = [
    _BASE / "frontend" / "dist" / "institute-logo.png",
    _BASE / "frontend" / "public" / "institute-logo.png",
    _BASE / "frontend" / "src" / "assets" / "institute-logo.png",
]

# Violation type larni o'zbek tiliga tarjima
VIOLATION_LABELS: dict[str, str] = {
    "TAB_SWITCH_HARD":              "Boshqa oynaga/varaqqa o'tish (qat'iy)",
    "FULLSCREEN_EXIT_HARD":         "To'liq ekrandan chiqish (qat'iy)",
    "IDENTITY_SUBSTITUTION":        "Boshqa shaxs aniqlandi (yuz almashtirildi)",
    "REMOTE_CONTROL_SUSPECTED":     "Masofadan boshqarish dasturi aniqlandi",
    "FACE_NOT_VISIBLE":             "Yuz kamerada ko'rinmadi",
    "MULTIPLE_FACES":               "Kadrda bir nechta shaxs aniqlandi",
    "SUSPICIOUS_AUDIO":             "Shubhali ovoz/shovqin aniqlandi",
    "FORBIDDEN_OBJECT_CELL_PHONE":  "Telefon aniqlandi",
    "FORBIDDEN_OBJECT_LAPTOP":      "Noutbuk aniqlandi",
    "FORBIDDEN_OBJECT_BOOK":        "Kitob aniqlandi",
    "FORBIDDEN_OBJECT_CELL_PHONE_DETECTED": "Telefon aniqlandi",
    "COPY_PASTE_ATTEMPT":           "Nusxa ko'chirish urinishi",
    "PRINT_SCREEN_ATTEMPT":         "Ekran suratga olish urinishi",
    "DEVTOOLS_OPEN":                "Dasturchi vositalari ochildi",
    "CLIPBOARD_ATTEMPT":            "Nusxa / buferga urinish (clipboard)",
    "CLIPBOARD_ACCESS":             "Bufer xotirasiga kirish",
    "GAZE_AWAY_LEFT":               "Kameradan chapga uzoq qarash",
    "GAZE_AWAY_RIGHT":              "Kameradan o'ngga uzoq qarash",
    "GAZE_AWAY_UP":                 "Tepaga uzoq qarash",
    "GAZE_AWAY_DOWN":               "Pastga uzoq qarash",
    "WHISPER_OR_CONVERSATION_SUSPECTED": "Gapirish / suhbat shubhasi",
    "TAB_SWITCH_SOFT":              "Boshqa varaqqa o'tish",
}

# Ban sabablari — violation type bo'yicha
BAN_REASONS: dict[str, str] = {
    "TAB_SWITCH_HARD":              "Imtihon davomida boshqa brauzer oynasiga yoki varaqqa o'tildi. Bu qoidabuzarlik hisoblanadi va imtihon darhol to'xtatildi.",
    "FULLSCREEN_EXIT_HARD":         "Imtihon davomida to'liq ekran rejimidan chiqildi. Bu qoidabuzarlik hisoblanadi va imtihon darhol to'xtatildi.",
    "IDENTITY_SUBSTITUTION":        "Kamera orqali amalga oshirilgan yuz taqqoslashida profil rasmi bilan mos kelmaydigan shaxs aniqlandi. Imtihon darhol to'xtatildi.",
    "REMOTE_CONTROL_SUSPECTED":     "Kompyuterda masofadan boshqarish dasturi (AnyDesk, TeamViewer va boshqalar) aniqlandi. Bu qoidabuzarlik hisoblanadi.",
    "FACE_NOT_VISIBLE":             "Talaba kamera oldidan uzoq vaqt ketdi yoki yuzini yashirdi.",
    "MULTIPLE_FACES":               "Imtihon davomida kadrda bir nechta shaxs aniqlandi.",
}

DEFAULT_BAN_REASON = (
    "Imtihon qoidalari bir necha marta buzildi. "
    "Tizim tomonidan avtomatik ravishda bloklanish amalga oshirildi."
)


def _get_logo_path() -> str | None:
    for p in _LOGO_CANDIDATES:
        if p.exists():
            return str(p)
    return None


def _violation_label(vtype: str) -> str:
    """Violation type ni o'zbek tiliga tarjima qiladi."""
    return VIOLATION_LABELS.get(vtype, vtype.replace("_", " ").capitalize())


def _group_violation_rows_for_pdf(
    rows: list[dict],
    *,
    window_sec: int = 60,
) -> list[str]:
    """
    serverdagi 60s ogohlantirish birlashishi bilan mos: birinchi hodisadan {window_sec}s
    ichidagi ketma-kelgan yozuvlarni bitta soddalashtirilgan qator sifatida ko'rsatadi.
    """
    if not rows:
        return []
    with_ts = [r for r in rows if r.get("timestamp") is not None]
    if not with_ts:
        return ["- Vaqttama yozuv topilmadi."]
    raw = sorted(with_ts, key=lambda x: x["timestamp"])
    out: list[str] = []
    i = 0
    n = len(raw)
    w = max(10, float(window_sec))
    while i < n:
        start_ts = raw[i]["timestamp"]
        chunk: list[dict] = [raw[i]]
        j = i + 1
        while j < n:
            cur = raw[j]["timestamp"]
            if (cur - start_ts).total_seconds() > w:
                break
            chunk.append(raw[j])
            j += 1
        if len(chunk) == 1:
            ts = str(chunk[0].get("timestamp") or "")[:19].replace("T", " ")
            vt = str(chunk[0].get("violation_type") or "UNKNOWN")
            out.append(f"[{ts}]  {_violation_label(vt)}")
        else:
            t0 = str(chunk[0].get("timestamp") or "")[:19].replace("T", " ")
            t1 = str(chunk[-1].get("timestamp") or "")[:19].replace("T", " ")
            labels = " — ".join(_violation_label(str(c.get("violation_type") or "UNKNOWN")) for c in chunk)
            out.append(
                f"[{t0} – {t1}]  {len(chunk)} ta texnik hodisa, 1 rasmiy ogohlantirish davrida: {labels}"
            )
        i = j
    return out


def _ban_reason_text(violations: list[dict]) -> str:
    """Asosiy ban sababini aniqlaydi."""
    if not violations:
        return DEFAULT_BAN_REASON
    # Eng og'ir violation ni topish
    priority = [
        "IDENTITY_SUBSTITUTION",
        "REMOTE_CONTROL_SUSPECTED",
        "TAB_SWITCH_HARD",
        "FULLSCREEN_EXIT_HARD",
        "MULTIPLE_FACES",
        "FACE_NOT_VISIBLE",
    ]
    vtypes = [str(v.get("violation_type") or "") for v in violations]
    for p in priority:
        if p in vtypes:
            return BAN_REASONS.get(p, DEFAULT_BAN_REASON)
    # Eng ko'p takrorlangan violation
    from collections import Counter
    most_common = Counter(vtypes).most_common(1)
    if most_common:
        return BAN_REASONS.get(most_common[0][0], DEFAULT_BAN_REASON)
    return DEFAULT_BAN_REASON


def _draw_header(c, w: float, h: float, title: str, subtitle: str, hint: str):
    """Institut logosi va sarlavha chizish."""
    logo_path = _get_logo_path()
    logo_x = 40
    logo_y = h - 95
    logo_size = 55

    if logo_path:
        try:
            from reportlab.lib.utils import ImageReader
            c.drawImage(
                ImageReader(logo_path),
                logo_x, logo_y,
                width=logo_size, height=logo_size,
                preserveAspectRatio=True, mask="auto",
            )
        except Exception:
            _draw_logo_placeholder(c, logo_x + logo_size // 2, logo_y + logo_size // 2, logo_size // 2)
    else:
        _draw_logo_placeholder(c, logo_x + logo_size // 2, logo_y + logo_size // 2, logo_size // 2)

    text_x = logo_x + logo_size + 12
    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(colors.HexColor("#1a1a2e"))
    c.drawString(text_x, h - 55, "Farg\u2019ona jamoat salomatligi tibbiyot instituti")
    c.setFont("Helvetica-Bold", 11)
    c.setFillColor(colors.HexColor("#c0392b"))
    c.drawString(text_x, h - 72, title)
    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor("#555555"))
    c.drawString(text_x, h - 86, subtitle)
    if hint:
        c.setFont("Helvetica-Oblique", 8)
        c.setFillColor(colors.HexColor("#888888"))
        c.drawString(text_x, h - 98, hint)

    # Ajratuvchi chiziq
    c.setStrokeColor(colors.HexColor("#c0392b"))
    c.setLineWidth(1.5)
    c.line(40, h - 108, w - 40, h - 108)
    c.setFillColor(colors.black)


def _draw_logo_placeholder(c, cx: float, cy: float, r: float):
    """Logo topilmasa doira ichida FJSTI yozuvi."""
    c.setStrokeColor(colors.HexColor("#1a1a2e"))
    c.setLineWidth(1.5)
    c.circle(cx, cy, r, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(colors.HexColor("#1a1a2e"))
    c.drawCentredString(cx, cy - 4, "FJSTI")


def _draw_qr(c, verify_url: str, w: float, h: float):
    """QR kod chizish."""
    try:
        import qrcode
        from reportlab.lib.utils import ImageReader

        qr = qrcode.QRCode(version=2, box_size=3, border=1,
                           error_correction=qrcode.constants.ERROR_CORRECT_M)
        qr.add_data(verify_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        qbuf = BytesIO()
        img.save(qbuf, format="PNG")
        qbuf.seek(0)
        qr_size = 85
        c.drawImage(ImageReader(qbuf), w - qr_size - 35, h - qr_size - 35,
                    width=qr_size, height=qr_size)
        c.setFont("Helvetica", 6)
        c.setFillColor(colors.HexColor("#888888"))
        c.drawCentredString(w - 35 - qr_size // 2, h - qr_size - 42, "QR tekshiruv")
    except Exception:
        pass


def build_certificate_pdf(
    *,
    result_id: str,
    student_name: str,
    exam_title: str,
    completed_at: str,
    score: int,
    total: int,
    verify_url: str,
    integrity_code: str,
    overview: str,
    rows: list[dict],
) -> bytes:
    buf = BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    w, h = A4

    _draw_qr(c, verify_url, w, h)
    _draw_header(c, w, h,
                 title="Onlayn imtihon sertifikati",
                 subtitle="Hujjat raqamli QR orqali tekshiriladi",
                 hint="")

    y = h - 128
    c.setFont("Helvetica", 10)
    c.setFillColor(colors.HexColor("#1a1a2e"))

    pct = round((score / total) * 100) if total else 0
    fields = [
        ("Natija ID",        result_id),
        ("Talaba",           student_name),
        ("Imtihon",          exam_title),
        ("Yakunlangan sana", completed_at[:19].replace("T", " ")),
        ("Ball",             f"{score} / {total}  ({pct}%)"),
        ("Yaxlitlik kodi",   integrity_code),
        ("Tekshiruv havolasi", verify_url[:80] + ("..." if len(verify_url) > 80 else "")),
    ]
    for label, val in fields:
        c.setFont("Helvetica-Bold", 9)
        c.drawString(50, y, f"{label}:")
        c.setFont("Helvetica", 9)
        c.drawString(160, y, str(val)[:100])
        y -= 14

    y -= 6
    c.setFont("Helvetica-Bold", 10)
    c.drawString(50, y, "Xulosa:")
    y -= 14
    c.setFont("Helvetica", 9)
    for para in (overview or "")[:2000].split("\n")[:8]:
        c.drawString(50, y, para[:110])
        y -= 12
        if y < 100:
            c.showPage()
            y = h - 50

    y -= 6
    c.setFont("Helvetica-Bold", 9)
    c.drawString(50, y, "Savollar:")
    y -= 12
    c.setFont("Helvetica", 8)
    for r in rows[:40]:
        mark = "\u2713" if r.get("isCorrect") else "\u2717"
        txt = f"{r.get('index')}. {str(r.get('text',''))[:70]}  [{mark}]"
        c.drawString(50, y, txt[:110])
        y -= 10
        if y < 60:
            c.showPage()
            y = h - 50

    c.showPage()
    c.save()
    return buf.getvalue()


def build_ban_report_pdf(
    *,
    student_id: str,
    student_name: str,
    exam_title: str,
    issued_at: str,
    violations: list[dict],
    verify_url: str,
) -> bytes:
    buf = BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    w, h = A4

    _draw_qr(c, verify_url, w, h)
    _draw_header(c, w, h,
                 title="Rasmiy intizomiy bayonnoma (BAN hisobot)",
                 subtitle="Hujjat raqamli QR orqali tekshiriladi",
                 hint="Ushbu hujjat instituting ichki nazorat tizimi tomonidan avtomatik shakllantirildi")

    y = h - 128
    c.setFont("Helvetica", 10)
    c.setFillColor(colors.HexColor("#1a1a2e"))

    fields = [
        ("Talaba ID",        student_id),
        ("Talaba F.I.Sh.",   student_name),
        ("Imtihon",          exam_title),
        ("Berilgan sana",    issued_at[:19].replace("T", " ")),
        ("QR tekshiruv",     verify_url[:85] + ("..." if len(verify_url) > 85 else "")),
    ]
    for label, val in fields:
        c.setFont("Helvetica-Bold", 9)
        c.drawString(50, y, f"{label}:")
        c.setFont("Helvetica", 9)
        c.drawString(160, y, str(val)[:100])
        y -= 14

    # Ban sababi — muhim qism
    y -= 8
    c.setStrokeColor(colors.HexColor("#e74c3c"))
    c.setLineWidth(0.5)
    c.rect(40, y - 42, w - 80, 52, stroke=1, fill=0)

    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#c0392b"))
    c.drawString(50, y, "Bloklash sababi:")
    y -= 14

    ban_reason = _ban_reason_text(violations)
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.HexColor("#1a1a2e"))
    # Uzun matnni qatorlarga bo'lish
    words = ban_reason.split()
    line = ""
    for word in words:
        test = (line + " " + word).strip()
        if len(test) > 90:
            c.drawString(50, y, line)
            y -= 12
            line = word
        else:
            line = test
    if line:
        c.drawString(50, y, line)
        y -= 12

    y -= 18
    c.setFillColor(colors.HexColor("#1a1a2e"))

    # Qoidabuzarliklar ro'yxati
    c.setFont("Helvetica-Bold", 10)
    c.drawString(50, y, "Qayd etilgan qoidabuzarliklar:")
    y -= 14

    c.setFont("Helvetica", 9)
    warn_win = max(15, int(os.environ.get("PROCTOR_WARN_SUPPRESS_SECONDS", "30")))
    grouped = _group_violation_rows_for_pdf(violations, window_sec=warn_win) if violations else []
    if not grouped:
        c.drawString(50, y, "- Qoidabuzarlik loglari topilmadi.")
        y -= 12
    else:
        c.setFont("Helvetica", 8)
        c.setFillColor(colors.HexColor("#666666"))
        c.drawString(50, y, f"Eslatma: ketma-kelgan hodisalar {warn_win}s oynasida 1 rasmiy ogohlantirish bilan PDF da bitta qator sifatida ko'rsatiladi.")
        y -= 12
        c.setFont("Helvetica", 9)
        c.setFillColor(colors.HexColor("#1a1a2e"))
        for idx, line in enumerate(grouped[:40], start=1):
            line_txt = f"{idx}) {line}"
            c.drawString(50, y, line_txt[:118])
            y -= 11
            if y < 80:
                c.showPage()
                y = h - 50
                c.setFont("Helvetica", 9)

    # Pastki qism
    y -= 16
    c.setStrokeColor(colors.HexColor("#cccccc"))
    c.setLineWidth(0.5)
    c.line(40, y + 4, w - 40, y + 4)

    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor("#555555"))
    c.drawString(50, y - 8,
                 "Ushbu hujjat Farg\u2019ona jamoat salomatligi tibbiyot instituti")
    c.drawString(50, y - 20,
                 "ichki nazorat siyosati asosida avtomatik shakllantirildi.")

    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(colors.HexColor("#1a1a2e"))
    c.drawString(50, y - 38, "Mas\u2019ul shaxs imzosi: ____________________________")
    c.drawString(320, y - 38, "Sana: _______________")

    c.showPage()
    c.save()
    return buf.getvalue()
