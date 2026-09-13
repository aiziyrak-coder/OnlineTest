"""Sertifikat va BAN hisobot PDF (reportlab + QR)."""
import os
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas

# Institut logosi — Docker image ichida frontend build "frontend_dist" ga joylashadi
# (Dockerfile: COPY --from=frontend-build /build/frontend/dist /app/frontend_dist).
# Lokal (docker'siz) ishga tushirish uchun "frontend/dist" va "frontend/public" ham
# zaxira sifatida tekshiriladi.
_BASE = Path(__file__).resolve().parent.parent.parent.parent
_LOGO_CANDIDATES = [
    _BASE / "frontend_dist" / "institute-logo.png",
    _BASE / "frontend" / "dist" / "institute-logo.png",
    _BASE / "frontend" / "public" / "institute-logo.png",
    _BASE / "frontend" / "src" / "assets" / "institute-logo.png",
    _BASE / "backend" / "static" / "institute-logo.png",
]

# O'tish mezoni: to'g'ri javoblar foizi (ball / jami savollar * 100).
PASS_PERCENT_THRESHOLD = max(1, min(100, int(os.environ.get("EXAM_PASS_PERCENT", "50"))))


def exam_pass_threshold(exam) -> int:
    """Imtihonning o'tish chegarasi (%).

    Imtihonda o'z qiymati bo'lsa (`pass_percent` > 0) — o'sha, aks holda
    umumiy sozlama. Maxsus kirish imtihonlarida chegara boshqacha bo'ladi.
    """
    try:
        v = int(getattr(exam, "pass_percent", 0) or 0)
    except (TypeError, ValueError):
        v = 0
    return v if 1 <= v <= 100 else PASS_PERCENT_THRESHOLD

# Dizayn ranglari
C_NAVY = colors.HexColor("#1e3a5f")
C_NAVY_LIGHT = colors.HexColor("#eef3f9")
C_RED = colors.HexColor("#c0392b")
C_RED_LIGHT = colors.HexColor("#fdf0ef")
C_GREEN = colors.HexColor("#1e9e5a")
C_GREEN_LIGHT = colors.HexColor("#ecfdf3")
C_SLATE = colors.HexColor("#334155")
C_MUTED = colors.HexColor("#64748b")
C_BORDER = colors.HexColor("#e2e8f0")
LOGO_PDF_SIZE = 92
QR_PDF_SIZE = 100
HEADER_CARD_H = 118
HEADER_BOTTOM_Y = 40 + HEADER_CARD_H + 18  # kontent boshlanishi: h - HEADER_BOTTOM_Y


def result_questions_to_pdf_rows(questions: list[dict]) -> list[dict]:
    """Natija API dagi savollarni PDF uchun to'liq qatorlarga aylantiradi."""
    return [
        {
            "index": i + 1,
            "text": q.get("text"),
            "isCorrect": bool(q.get("isCorrect")),
            "studentAnswer": q.get("studentAnswer") or "",
            "correctAnswer": q.get("correctAnswer") or "",
            "commentCorrect": q.get("commentCorrect") or "",
            "whyStudentWrong": q.get("whyStudentWrong") or "",
            "whyCorrectIsRight": q.get("whyCorrectIsRight") or "",
            "options": q.get("options") or [],
            "references": [
                r
                for r in (q.get("references") or [])
                if isinstance(r, dict) and (r.get("title") or r.get("url"))
            ],
        }
        for i, q in enumerate(questions)
    ]


def format_pdf_reference_lines(refs: list[dict], *, pages_suffix: str = "bet") -> list[str]:
    """UI dagi Manbalar ro'yxati bilan bir xil: [1] Title — pages-bet."""
    lines: list[str] = []
    for i, r in enumerate(refs or [], start=1):
        if not isinstance(r, dict):
            continue
        title = str(r.get("title") or r.get("url") or "").strip()
        if not title:
            continue
        pages = str(r.get("pages") or "").strip()
        meta_parts = []
        if pages:
            meta_parts.append(f"{pages}-{pages_suffix}")
        for field in ("authors", "publisher", "year"):
            val = str(r.get(field) or "").strip()
            if val:
                meta_parts.append(val)
        meta = " · ".join(meta_parts)
        lines.append(f"[{i}] {title}" + (f" — {meta}" if meta else ""))
    return lines

# Kirill (rus) va lotin harflarini to'g'ri chizish uchun Unicode shrift.
# Standart PDF bazaviy shriftlari (Helvetica) faqat Latin-1 ni qo'llaydi — rus tilidagi
# savol/xulosa matnlari qora to'rtburchaklar sifatida chiqib qolardi.
_FONT_CANDIDATES = [
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
]
FONT_REGULAR = "Helvetica"
FONT_BOLD = "Helvetica-Bold"
FONT_OBLIQUE = "Helvetica-Oblique"
for _reg_path, _bold_path in _FONT_CANDIDATES:
    if os.path.exists(_reg_path) and os.path.exists(_bold_path):
        try:
            pdfmetrics.registerFont(TTFont("DejaVuSans", _reg_path))
            pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", _bold_path))
            FONT_REGULAR = "DejaVuSans"
            FONT_BOLD = "DejaVuSans-Bold"
            FONT_OBLIQUE = "DejaVuSans"  # DejaVu Sans Oblique odatda alohida o'rnatilmagan
            break
        except Exception:
            pass

from apps.api.pdf_i18n import PdfTexts

def _get_logo_path() -> str | None:
    for p in _LOGO_CANDIDATES:
        if p.exists():
            return str(p)
    return None


def _violation_label(vtype: str, texts: PdfTexts) -> str:
    return texts.violation_label(vtype)


def _violation_chunks_for_pdf(
    rows: list[dict],
    texts: PdfTexts,
    *,
    window_sec: int = 60,
) -> list[dict]:
    """Vaqt oynasida guruhlangan hodisalar — har guruhdan 1 rasmiy ogohlantirish."""
    if not rows:
        return []
    with_ts = [r for r in rows if r.get("timestamp") is not None]
    if not with_ts:
        return []
    raw = sorted(with_ts, key=lambda x: x["timestamp"])
    out: list[dict] = []
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
        t0 = str(chunk[0].get("timestamp") or "")[:19].replace("T", " ")
        t1 = str(chunk[-1].get("timestamp") or "")[:19].replace("T", " ")
        types = [str(c.get("violation_type") or "UNKNOWN") for c in chunk]
        labels = " — ".join(_violation_label(t, texts) for t in types)
        summary = texts.format_chunk_summary(
            timestamp_start=t0,
            timestamp_end=t1,
            count=len(chunk),
            labels=labels,
        )
        out.append({
            "timestamp_start": t0,
            "timestamp_end": t1,
            "count": len(chunk),
            "types": types,
            "labels": labels,
            "summary": summary,
        })
        i = j
    return out


def _group_violation_rows_for_pdf(
    rows: list[dict],
    texts: PdfTexts,
    *,
    window_sec: int = 60,
) -> list[str]:
    """PDF uchun soddalashtirilgan qatorlar (orqaga moslik)."""
    return [c["summary"] for c in _violation_chunks_for_pdf(rows, texts, window_sec=window_sec)]


def _sorted_violation_logs(rows: list[dict]) -> list[dict]:
    """Vaqt bo'yicha eski → yangi."""
    with_ts = [r for r in rows if r.get("timestamp") is not None]
    return sorted(with_ts, key=lambda x: x["timestamp"])


def _violation_log_line(v: dict, texts: PdfTexts) -> str:
    ts = str(v.get("timestamp") or "")[:19].replace("T", " ")
    vt = str(v.get("violation_type") or "UNKNOWN")
    return texts.t("chunk_single", ts=ts, label=_violation_label(vt, texts))


def _ban_timeline_items(
    violations: list[dict],
    texts: PdfTexts,
    *,
    window_sec: int,
    official_warnings: int,
    last_violation_type: str,
) -> list[dict]:
    """
    Raqamli ro'yxat: har bir rasmiy ogohlantirish = bitta log yozuvi, oxirida BAN.
    Vaqt oynasida birlashtirish faqat izoh uchun; ogohlantirishlar loglar bilan 1:1.
    """
    del window_sec  # timeline uchun loglar ishlatiladi
    logs = _sorted_violation_logs(violations)
    last_type = (last_violation_type or "").strip()
    if not last_type and logs:
        last_type = str(logs[-1].get("violation_type") or "")

    instant = last_type == "IDENTITY_SUBSTITUTION"
    if instant:
        label = _violation_label(last_type, texts)
        detail = texts.ban_reason(last_type)
        line = _violation_log_line(logs[-1], texts) if logs else f"{label}."
        return [{
            "n": 1,
            "title": texts.t("ban_instant_title"),
            "lines": [line, detail],
            "is_ban": True,
        }]

    warn_n = max(0, int(official_warnings or 0))
    items: list[dict] = []

    for i in range(warn_n):
        num = i + 1
        if i < len(logs):
            lines = [_violation_log_line(logs[i], texts)]
        else:
            lines = [texts.t("violation_recorded")]
        items.append({
            "n": num,
            "title": texts.t("warning_title", n=num),
            "lines": lines,
            "is_ban": False,
        })

    ban_num = len(items) + 1
    trigger = _violation_label(last_type, texts) if last_type else texts.t("unknown_violation")
    ban_lines = [
        texts.t("ban_after_warnings", n=warn_n),
        texts.t("last_violation", label=trigger),
    ]
    if last_type:
        extra = texts.ban_reason(last_type)
        if extra:
            ban_lines.append(extra)
    items.append({
        "n": ban_num,
        "title": texts.t("ban_step"),
        "lines": ban_lines,
        "is_ban": True,
    })
    return items


def _ban_reason_text(
    violations: list[dict],
    texts: PdfTexts,
    *,
    official_warnings: int = 0,
    last_violation_type: str = "",
) -> tuple[str, str]:
    """
    (asosiy_sabab, qo'shimcha_tushuntirish) qaytaradi.
    """
    last_type = (last_violation_type or "").strip()
    if not last_type and violations:
        sorted_logs = _sorted_violation_logs(violations)
        if sorted_logs:
            last_type = str(sorted_logs[-1].get("violation_type") or "")

    instant_types = {"IDENTITY_SUBSTITUTION"}
    if last_type in instant_types:
        detail = texts.ban_reason(last_type)
        headline = texts.t("instant_headline", label=_violation_label(last_type, texts))
        return headline, detail

    priority = [
        "IDENTITY_SUBSTITUTION",
        "REMOTE_CONTROL_SUSPECTED",
        "TAB_SWITCH_HARD",
        "FULLSCREEN_EXIT_HARD",
        "MULTIPLE_FACES",
        "WHISPER_OR_CONVERSATION_SUSPECTED",
        "MOUTH_MOVEMENT_TALKING",
        "FACE_NOT_VISIBLE",
    ]
    vtypes = [str(v.get("violation_type") or "") for v in violations]
    trigger_type = last_type
    if not trigger_type:
        for p in priority:
            if p in vtypes:
                trigger_type = p
                break
        if not trigger_type and vtypes:
            from collections import Counter
            trigger_type = Counter(vtypes).most_common(1)[0][0]

    trigger_label = _violation_label(trigger_type, texts) if trigger_type else texts.t("unknown_violation")
    detail = texts.ban_reason(trigger_type)

    warn_n = max(0, int(official_warnings or 0))
    if warn_n >= 3:
        headline = texts.t("blocked_after_3", label=trigger_label)
        extra = texts.t("discipline_extra", n=warn_n)
        return headline, f"{detail} {extra}"

    headline = texts.t("generic_headline", label=trigger_label)
    extra = texts.t("generic_extra", count=len(violations))
    return headline, f"{detail} {extra}"


def _draw_header(c, w: float, h: float, title: str, subtitle: str, hint: str, texts: PdfTexts, *, accent: str = "cert"):
    """Professional sarlavha: logo | matn | QR."""
    accent_color = C_RED if accent == "ban" else C_NAVY
    accent_light = C_RED_LIGHT if accent == "ban" else C_NAVY_LIGHT
    top = h - 40
    header_h = HEADER_CARD_H

    c.setFillColor(accent_light)
    c.setStrokeColor(C_BORDER)
    c.roundRect(40, top - header_h, w - 80, header_h, 10, stroke=1, fill=1)
    c.setFillColor(accent_color)
    c.roundRect(40, top - 6, w - 80, 6, 8, stroke=0, fill=1)

    logo_path = _get_logo_path()
    logo_x, logo_y = 52, top - 14 - LOGO_PDF_SIZE
    if logo_path:
        try:
            from reportlab.lib.utils import ImageReader
            c.drawImage(
                ImageReader(logo_path), logo_x, logo_y,
                width=LOGO_PDF_SIZE, height=LOGO_PDF_SIZE,
                preserveAspectRatio=True, mask="auto",
            )
        except Exception:
            _draw_logo_placeholder(c, logo_x + LOGO_PDF_SIZE // 2, logo_y + LOGO_PDF_SIZE // 2, LOGO_PDF_SIZE // 2.2)
    else:
        _draw_logo_placeholder(c, logo_x + LOGO_PDF_SIZE // 2, logo_y + LOGO_PDF_SIZE // 2, LOGO_PDF_SIZE // 2.2)

    qr_size = QR_PDF_SIZE
    qr_x, qr_y = w - qr_size - 52, top - 14 - qr_size

    text_x = logo_x + LOGO_PDF_SIZE + 14
    text_max_w = qr_x - text_x - 12
    ty = top - 22
    c.setFont(FONT_BOLD, 8.5)
    c.setFillColor(C_MUTED)
    c.drawString(text_x, ty, texts.t("institute_name"))
    ty -= 16
    c.setFont(FONT_BOLD, 13)
    c.setFillColor(accent_color)
    for tl in _wrap_text(c, title, FONT_BOLD, 13, text_max_w)[:2]:
        c.drawString(text_x, ty, tl)
        ty -= 15
    c.setFont(FONT_REGULAR, 8)
    c.setFillColor(C_SLATE)
    c.drawString(text_x, ty, subtitle)
    ty -= 11
    if hint:
        c.setFont(FONT_REGULAR, 7.5)
        c.setFillColor(C_MUTED)
        for hl in _wrap_text(c, hint, FONT_REGULAR, 7.5, text_max_w)[:2]:
            c.drawString(text_x, ty, hl)
            ty -= 10

    c.setFillColor(colors.black)


def _draw_qr(c, verify_url: str, w: float, h: float, texts: PdfTexts, *, size: int | None = None):
    """QR kod — sarlavha o'ng tomonida."""
    qr_size = size or QR_PDF_SIZE
    try:
        import qrcode
        from reportlab.lib.utils import ImageReader

        qr = qrcode.QRCode(version=2, box_size=4, border=1,
                           error_correction=qrcode.constants.ERROR_CORRECT_M)
        qr.add_data(verify_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        qbuf = BytesIO()
        img.save(qbuf, format="PNG")
        qbuf.seek(0)
        top = h - 40
        qr_x = w - qr_size - 52
        qr_y = top - 14 - qr_size
        c.setFillColor(colors.white)
        c.setStrokeColor(C_BORDER)
        c.roundRect(qr_x - 5, qr_y - 5, qr_size + 10, qr_size + 16, 8, stroke=1, fill=1)
        c.drawImage(ImageReader(qbuf), qr_x, qr_y, width=qr_size, height=qr_size)
        c.setFont(FONT_REGULAR, 7)
        c.setFillColor(C_MUTED)
        c.drawCentredString(qr_x + qr_size / 2, qr_y - 10, texts.t("qr_verify"))
    except Exception:
        pass


def _draw_section_title(c, x: float, y: float, title: str, *, color=None) -> float:
    c.setFont(FONT_BOLD, 10.5)
    c.setFillColor(color or C_NAVY)
    c.drawString(x, y, title)
    return y - 18


def _draw_kv_panel(c, x: float, y: float, width: float, fields: list[tuple[str, str]], *, fill=None) -> float:
    """Label: value ro'yxati — yumaloq panel."""
    row_h = 16
    pad = 12
    panel_h = pad * 2 + len(fields) * row_h
    c.setFillColor(fill or C_NAVY_LIGHT)
    c.setStrokeColor(C_BORDER)
    c.roundRect(x, y - panel_h, width, panel_h, 10, stroke=1, fill=1)
    fy = y - pad - 2
    for label, val in fields:
        c.setFont(FONT_BOLD, 8.5)
        c.setFillColor(C_MUTED)
        c.drawString(x + 14, fy, label)
        c.setFont(FONT_REGULAR, 9)
        c.setFillColor(C_SLATE)
        val_lines = _wrap_text(c, str(val), FONT_REGULAR, 9, width - 140)[:1]
        c.drawString(x + 120, fy, val_lines[0] if val_lines else "")
        fy -= row_h
    return panel_h + 10


def _draw_numbered_timeline(c, x: float, y: float, width: float, items: list[dict]) -> float:
    """1, 2, 3, 4 … raqamli ogohlantirish va BAN ro'yxati."""
    if not items:
        return 0
    pad_x = 12
    num_w = 22
    text_w = width - pad_x * 2 - num_w - 6
    gap = 5
    total = 0

    for item in items:
        is_ban = bool(item.get("is_ban"))
        title = str(item.get("title") or "")
        body_lines: list[str] = []
        for line in item.get("lines") or []:
            body_lines.extend(_wrap_text(c, str(line), FONT_REGULAR, 8.5, text_w))
        row_h = 16 + 12 + len(body_lines) * 11 + 8

        bg = C_RED_LIGHT if is_ban else colors.white
        border = C_RED if is_ban else C_BORDER
        c.setFillColor(bg)
        c.setStrokeColor(border)
        c.setLineWidth(0.8 if is_ban else 0.5)
        c.roundRect(x, y - row_h, width, row_h, 8, stroke=1, fill=1)

        num = int(item.get("n") or 0)
        cy = y - 18
        c.setFillColor(C_RED if is_ban else C_NAVY)
        c.circle(x + pad_x + 9, cy, 9, stroke=0, fill=1)
        c.setFont(FONT_BOLD, 9)
        c.setFillColor(colors.white)
        c.drawCentredString(x + pad_x + 9, cy - 3.5, str(num))

        tx = x + pad_x + num_w
        c.setFont(FONT_BOLD, 9)
        c.setFillColor(C_RED if is_ban else C_NAVY)
        c.drawString(tx, y - 14, title)
        ly = y - 28
        c.setFont(FONT_REGULAR, 8.5)
        c.setFillColor(C_SLATE)
        for bl in body_lines:
            c.drawString(tx, ly, bl)
            ly -= 11

        y -= row_h + gap
        total += row_h + gap

    return total


def _draw_logo_placeholder(c, cx: float, cy: float, r: float):
    """Logo topilmasa doira ichida FJSTI yozuvi."""
    c.setStrokeColor(C_NAVY)
    c.setLineWidth(1.5)
    c.circle(cx, cy, r, stroke=1, fill=0)
    c.setFont(FONT_BOLD, 9)
    c.setFillColor(C_NAVY)
    c.drawCentredString(cx, cy - 4, "FJSTI")


def _wrap_text(c, text: str, font: str, size: float, max_width: float) -> list[str]:
    """So'zlarni max_width ga sig'adigan qatorlarga bo'ladi (harf kesish o'rniga)."""
    words = str(text or "").split()
    if not words:
        return []
    lines: list[str] = []
    line = words[0]
    for word in words[1:]:
        test = f"{line} {word}"
        if c.stringWidth(test, font, size) <= max_width:
            line = test
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def _draw_page_frame(c, w: float, h: float):
    """Har sahifa atrofida ingichka ramka \u2014 sertifikat ko'rinishini beradi."""
    c.setStrokeColor(colors.HexColor("#dcdfe6"))
    c.setLineWidth(1)
    c.rect(18, 18, w - 36, h - 36, stroke=1, fill=0)
    c.setFillColor(colors.black)


def _draw_footer(c, w: float, texts: PdfTexts, page_label: str = ""):
    c.setFont(FONT_REGULAR, 7)
    c.setFillColor(colors.HexColor("#9aa0aa"))
    c.drawString(30, 26, texts.t("footer_doc"))
    if page_label:
        c.drawRightString(w - 30, 26, page_label)
    c.setFillColor(colors.black)


def build_certificate_pdf(
    *,
    result_id: str,
    student_name: str,
    student_group: str = "",
    exam_title: str,
    completed_at: str,
    score: int,
    total: int,
    verify_url: str,
    integrity_code: str,
    overview: str,
    rows: list[dict],
    pass_threshold: int | None = None,
    lang: str = "uz",
) -> bytes:
    texts = PdfTexts(lang)
    buf = BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    page_no = 1

    def new_page():
        nonlocal page_no
        _draw_footer(c, w, texts, texts.page_label(page_no))
        c.showPage()
        page_no += 1
        _draw_page_frame(c, w, h)
        return h - 50

    _draw_page_frame(c, w, h)
    # MUHIM: header AVVAL chiziladi. Ilgari QR header'dan oldin chizilardi va
    # header'ning to'ldirilgan foni QR ustidan bosib, uni ko'rinmas qilardi
    # (faqat "QR tekshiruv" yozuvi qolardi). Endi QR header ustiga chiziladi.
    _draw_header(c, w, h,
                 title=texts.t("cert_title"),
                 subtitle=texts.t("cert_subtitle"),
                 hint="",
                 texts=texts,
                 accent="cert")
    _draw_qr(c, verify_url, w, h, texts)

    pct = round((score / total) * 100) if total else 0
    threshold = pass_threshold if pass_threshold is not None else PASS_PERCENT_THRESHOLD
    passed = pct >= threshold
    badge_color = C_GREEN if passed else C_RED
    badge_bg = C_GREEN_LIGHT if passed else C_RED_LIGHT
    badge_label = texts.t("passed_badge") if passed else texts.t("failed_badge")

    y = h - HEADER_BOTTOM_Y

    # --- Ma'lumotlar bloki (chegaralangan karta) ---
    box_top = y
    fields = [
        (texts.t("result_id"),        result_id),
        (texts.t("student"),           student_name),
    ]
    if student_group:
        fields.append((texts.t("group"), student_group))
    fields += [
        (texts.t("exam"),              exam_title),
        (texts.t("completed_at"), completed_at[:19].replace("T", " ")),
        (texts.t("integrity_code"),   integrity_code),
        (texts.t("verify_url"), verify_url),
    ]
    box_height = 18 + len(fields) * 15 + 6
    c.setFillColor(C_NAVY_LIGHT)
    c.setStrokeColor(C_BORDER)
    c.roundRect(40, box_top - box_height + 10, w - 80, box_height, 8, stroke=1, fill=1)
    c.setFillColor(colors.black)

    fy = box_top
    for label, val in fields:
        c.setFont(FONT_BOLD, 9)
        c.setFillColor(colors.HexColor("#555555"))
        c.drawString(52, fy, f"{label}:")
        c.setFont(FONT_REGULAR, 9)
        c.setFillColor(colors.HexColor("#1a1a2e"))
        max_w = w - 52 - 170
        val_lines = _wrap_text(c, str(val), FONT_REGULAR, 9, max_w)[:1] or [""]
        val_text = val_lines[0]
        # Juda uzun (havola kabi) qiymatlarni kesib, oxiriga "..." qo'shamiz.
        while c.stringWidth(val_text, FONT_REGULAR, 9) > max_w and len(val_text) > 4:
            val_text = val_text[:-4] + "..."
        c.drawString(170, fy, val_text)
        fy -= 15
    y = box_top - box_height + 2

    # --- Ball / natija (rangli badge bilan) ---
    y -= 18
    c.setFont(FONT_BOLD, 22)
    c.setFillColor(colors.HexColor("#1a1a2e"))
    c.drawString(50, y, f"{score} / {total}")
    c.setFont(FONT_BOLD, 13)
    c.setFillColor(badge_color)
    c.drawString(150, y + 3, f"({pct}%)")

    badge_w = c.stringWidth(badge_label, FONT_BOLD, 9) + 20
    c.setFillColor(badge_bg)
    c.roundRect(w - 50 - badge_w, y - 3, badge_w, 20, 4, stroke=0, fill=1)
    c.setFont(FONT_BOLD, 9)
    c.setFillColor(badge_color)
    c.drawCentredString(w - 50 - badge_w / 2, y + 3, badge_label)
    c.setFillColor(colors.black)
    y -= 16

    # O'tish mezoni va hisoblash qoidasi
    c.setFont(FONT_REGULAR, 8)
    c.setFillColor(colors.HexColor("#666666"))
    rule_line = texts.t("scoring_rule", score=score, total=total, threshold=threshold)
    for line in _wrap_text(c, rule_line, FONT_REGULAR, 8, w - 100):
        c.drawString(50, y, line)
        y -= 11
    y -= 8
    c.setFillColor(colors.black)

    # --- Xulosa ---
    if (overview or "").strip():
        c.setFont(FONT_BOLD, 11)
        c.setFillColor(colors.HexColor("#1a1a2e"))
        c.drawString(50, y, texts.t("overview"))
        y -= 16
        c.setFont(FONT_REGULAR, 9)
        c.setFillColor(colors.HexColor("#333333"))
        for para in (overview or "")[:3000].split("\n"):
            if not para.strip():
                y -= 6
                continue
            for line in _wrap_text(c, para, FONT_REGULAR, 9, w - 100)[:20]:
                c.drawString(50, y, line)
                y -= 13
                if y < 90:
                    y = new_page()
                    c.setFont(FONT_REGULAR, 9)
        y -= 10
        c.setFillColor(colors.black)

    # --- Savollar (batafsil) ---
    c.setFont(FONT_BOLD, 12)
    c.setFillColor(C_NAVY)
    c.drawString(50, y, texts.t("questions_detail"))
    y -= 18

    for r in rows:
        is_correct = bool(r.get("isCorrect"))
        mark_color = C_GREEN if is_correct else C_RED
        card_bg = C_GREEN_LIGHT if is_correct else C_RED_LIGHT
        idx = r.get("index")
        text = str(r.get("text") or "")
        student_ans = str(r.get("studentAnswer") or "").strip()
        correct_ans = str(r.get("correctAnswer") or "").strip()
        comment_ok = str(r.get("commentCorrect") or "").strip()
        why_wrong = str(r.get("whyStudentWrong") or "").strip()
        why_right = str(r.get("whyCorrectIsRight") or "").strip()
        options = r.get("options") or []

        # MUHIM: savolning 1-qatori BOLD 10pt da chiziladi (pastdagi q_lines[0]),
        # qolganlari REGULAR 9pt da. Ilgari o'rash REGULAR 9pt ga hisoblanardi —
        # bold kattaroq bo'lgani uchun 1-qator kartadan CHIQIB ketardi. Endi eng
        # keng holat (BOLD 10) bilan o'raymiz; qolgan qatorlar undan tor, bemalol
        # sig'adi. O'ng chetdagi ✓/✗ belgisi bilan urilmasin uchun kengroq zahira.
        MAX_Q_LINES = 6
        q_lines = _wrap_text(c, f"{idx}. {text}", FONT_BOLD, 10, w - 150) or [f"{idx}."]
        if len(q_lines) > MAX_Q_LINES:
            q_lines = q_lines[:MAX_Q_LINES]
            q_lines[-1] = q_lines[-1].rstrip()[:80] + "…"
        detail_blocks: list[tuple[str, str]] = []
        if student_ans:
            detail_blocks.append((texts.t("your_answer"), student_ans))
        if correct_ans:
            detail_blocks.append((texts.t("correct_answer"), correct_ans))
        if is_correct and comment_ok:
            detail_blocks.append((texts.t("comment"), comment_ok))
        if not is_correct and why_wrong:
            detail_blocks.append((texts.t("why_wrong"), why_wrong))
        if not is_correct and why_right:
            detail_blocks.append((texts.t("why_correct_right"), why_right))

        ref_lines = format_pdf_reference_lines(
            r.get("references") or [],
            pages_suffix=texts.t("pages_suffix"),
        )

        block_lines = 0
        for label, body in detail_blocks:
            block_lines += 1 + len(_wrap_text(c, body, FONT_REGULAR, 8, w - 120)[:6])
        if options:
            block_lines += 1 + min(len(options), 8)
        if ref_lines:
            # sarlavha + har bir manba (wrap bilan)
            block_lines += 1
            for rl in ref_lines[:6]:
                block_lines += len(_wrap_text(c, rl, FONT_REGULAR, 7.5, w - 120)[:3])
        card_h = 16 + len(q_lines) * 12 + block_lines * 11 + 12

        if y - card_h < 70:
            y = new_page()
            c.setFont(FONT_BOLD, 12)
            c.setFillColor(C_NAVY)
            c.drawString(50, y, texts.t("questions_continued"))
            y -= 18

        card_top = y
        c.setFillColor(card_bg)
        c.setStrokeColor(mark_color)
        c.roundRect(42, card_top - card_h, w - 84, card_h, 8, stroke=1, fill=1)

        cy = card_top - 14
        for li, line in enumerate(q_lines):
            c.setFont(FONT_REGULAR if li else FONT_BOLD, 9 if li else 10)
            c.setFillColor(C_SLATE)
            c.drawString(52, cy, line)
            if li == 0:
                c.setFont(FONT_BOLD, 11)
                c.setFillColor(mark_color)
                mark = "\u2713" if is_correct else "\u2717"
                c.drawRightString(w - 52, cy, mark)
            cy -= 12

        if options:
            c.setFont(FONT_BOLD, 7.5)
            c.setFillColor(C_MUTED)
            c.drawString(52, cy, texts.t("options"))
            cy -= 10
            c.setFont(FONT_REGULAR, 7.5)
            for opt_i, opt in enumerate(options[:8], start=1):
                opt_mark = ""
                if student_ans and str(opt) == student_ans:
                    opt_mark = f" \u2190 {texts.t('opt_you')}"
                elif correct_ans and str(opt) == correct_ans:
                    opt_mark = f" \u2190 {texts.t('opt_correct')}"
                for ol in _wrap_text(c, f"{opt_i}) {opt}{opt_mark}", FONT_REGULAR, 7.5, w - 120)[:2]:
                    c.drawString(58, cy, ol)
                    cy -= 9

        for label, body in detail_blocks:
            c.setFont(FONT_BOLD, 8)
            c.setFillColor(C_SLATE)
            c.drawString(52, cy, f"{label}:")
            cy -= 10
            c.setFont(FONT_REGULAR, 8)
            c.setFillColor(C_MUTED if label != texts.t("correct_answer") else C_GREEN)
            for bl in _wrap_text(c, body, FONT_REGULAR, 8, w - 120)[:8]:
                c.drawString(58, cy, bl)
                cy -= 10

        if ref_lines:
            c.setFont(FONT_BOLD, 7.5)
            c.setFillColor(C_MUTED)
            c.drawString(52, cy, texts.t("references"))
            cy -= 10
            c.setFont(FONT_REGULAR, 7.5)
            c.setFillColor(C_SLATE)
            for rl in ref_lines[:6]:
                for bl in _wrap_text(c, rl, FONT_REGULAR, 7.5, w - 120)[:3]:
                    c.drawString(58, cy, bl)
                    cy -= 9

        y = card_top - card_h - 10

    _draw_footer(c, w, texts, texts.page_label(page_no))
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
    official_warnings: int = 0,
    last_violation_type: str = "",
    lang: str = "uz",
) -> bytes:
    texts = PdfTexts(lang)
    buf = BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    page_no = 1
    margin_x = 44
    content_w = w - margin_x * 2

    def new_page():
        nonlocal page_no
        _draw_footer(c, w, texts, texts.page_label(page_no))
        c.showPage()
        page_no += 1
        _draw_page_frame(c, w, h)
        return h - 50

    _draw_page_frame(c, w, h)
    _draw_header(c, w, h,
                 title=texts.t("ban_title"),
                 subtitle=texts.t("ban_subtitle"),
                 hint=texts.t("ban_hint"),
                 texts=texts,
                 accent="ban")
    _draw_qr(c, verify_url, w, h, texts)

    y = h - HEADER_BOTTOM_Y

    y = _draw_section_title(c, margin_x + 4, y, texts.t("student_info"))
    y -= _draw_kv_panel(c, margin_x, y, content_w, [
        (texts.t("student_id"), student_id),
        (texts.t("full_name"), student_name),
        (texts.t("exam"), exam_title),
        (texts.t("issued_at"), issued_at[:19].replace("T", " ")),
    ])

    ban_headline, ban_detail = _ban_reason_text(
        violations,
        texts,
        official_warnings=official_warnings,
        last_violation_type=last_violation_type,
    )
    headline_lines = _wrap_text(c, ban_headline, FONT_BOLD, 10, content_w - 28)[:4]
    detail_lines: list[str] = []
    for dl in _wrap_text(c, ban_detail, FONT_REGULAR, 8.5, content_w - 28):
        detail_lines.append(dl)
        if len(detail_lines) >= 6:
            break

    y = _draw_section_title(c, margin_x + 4, y, texts.t("why_blocked"), color=C_RED)
    y -= 4
    reason_pad = 14
    inner_h = 18 + len(headline_lines) * 13 + len(detail_lines) * 11
    reason_h = reason_pad * 2 + inner_h
    box_top = y
    c.setFillColor(C_RED_LIGHT)
    c.setStrokeColor(C_RED)
    c.setLineWidth(0.6)
    c.roundRect(margin_x, box_top - reason_h, content_w, reason_h, 10, stroke=1, fill=1)

    ry = box_top - reason_pad
    c.setFont(FONT_BOLD, 10)
    c.setFillColor(C_RED)
    c.drawString(margin_x + 14, ry, texts.t("block_reason_title"))
    ry -= 16
    c.setFont(FONT_BOLD, 9.5)
    c.setFillColor(C_SLATE)
    for line in headline_lines:
        c.drawString(margin_x + 14, ry, line)
        ry -= 13
    c.setFont(FONT_REGULAR, 8.5)
    c.setFillColor(C_MUTED)
    for line in detail_lines:
        c.drawString(margin_x + 14, ry, line)
        ry -= 11
    y = box_top - reason_h - 20

    warn_n = max(0, int(official_warnings or 0))
    warn_win = max(15, int(os.environ.get("PROCTOR_WARN_SUPPRESS_SECONDS", "30")))
    timeline = _ban_timeline_items(
        violations,
        texts,
        window_sec=warn_win,
        official_warnings=warn_n,
        last_violation_type=last_violation_type,
    )

    y = _draw_section_title(c, margin_x + 4, y, texts.t("timeline_title"), color=C_RED)
    y -= 6
    c.setFont(FONT_REGULAR, 7.5)
    c.setFillColor(C_MUTED)
    for note in _wrap_text(
        c,
        texts.t("timeline_note", win=warn_win),
        FONT_REGULAR, 7.5, content_w - 8,
    )[:1]:
        c.drawString(margin_x + 4, y, note)
        y -= 12
    y -= 8

    for item in timeline:
        item_lines: list[str] = []
        for line in item.get("lines") or []:
            item_lines.extend(_wrap_text(c, str(line), FONT_REGULAR, 8.5, content_w - 52))
        row_h = 16 + 12 + len(item_lines) * 11 + 8
        if y - row_h < 80:
            y = new_page()
        single_h = _draw_numbered_timeline(c, margin_x, y, content_w, [item])
        y -= single_h

    if y < 120:
        y = new_page()

    y -= 8
    c.setStrokeColor(C_BORDER)
    c.setLineWidth(0.8)
    c.line(margin_x, y, w - margin_x, y)
    y -= 20
    c.setFont(FONT_REGULAR, 8)
    c.setFillColor(C_MUTED)
    c.drawString(margin_x, y, texts.t("footer_policy"))
    c.setFont(FONT_BOLD, 9)
    c.setFillColor(C_SLATE)
    c.drawString(margin_x, y - 24, texts.t("responsible_sign"))
    c.drawString(330, y - 24, texts.t("date_label"))

    _draw_footer(c, w, texts, texts.page_label(page_no))
    c.showPage()
    c.save()
    return buf.getvalue()
