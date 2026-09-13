"""Kafedra kesimidagi imtihon hisoboti — PDF.

Excel (CSV) o'rniga bosib chiqarishga tayyor hujjat: institut logotipi bilan
sarlavha, umumiy ko'rsatkichlar, eng yuqori/eng past 10 ta kafedra va to'liq
jadval. Reportlab va DejaVu shrifti sertifikat PDF'idan olinadi — kirill va
lotin harflari to'g'ri chiqadi.
"""
from __future__ import annotations

from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas as rl_canvas

from apps.api.certificate_pdf import (
    C_BORDER,
    C_GREEN,
    C_MUTED,
    C_NAVY,
    C_NAVY_LIGHT,
    C_RED,
    C_SLATE,
    FONT_BOLD,
    FONT_REGULAR,
    _get_logo_path,
)

PAGE_W, PAGE_H = landscape(A4)  # 842 x 595
MARGIN = 28

C_ZEBRA = colors.HexColor("#f7f9fc")
C_AMBER = colors.HexColor("#b45309")

# Ustunlar: (sarlavha, nisbiy kenglik, tekislash)
COLUMNS = [
    ("#", 0.030, "right"),
    ("Kafedra", 0.290, "left"),
    ("Jami", 0.072, "right"),
    ("Ishtirok\netgan", 0.086, "right"),
    ("Boshlagan,\nyakunlamagan", 0.106, "right"),
    ("Ishtirok\netmagan", 0.092, "right"),
    ("Testdan\no'tgan", 0.086, "right"),
    ("O'ta\nolmagan", 0.086, "right"),
    ("O'tish %", 0.076, "right"),
    ("Qamrov %", 0.076, "right"),
]


def _season_label(data: dict) -> str:
    """Hisobot qaysi test mavsumiga tegishli ekani."""
    sn = data.get("season") or {}
    return str(sn.get("label") or "Imtihon hisoboti")

def _pct_color(pct: int, participated: int):
    if not participated:
        return C_MUTED
    if pct >= 80:
        return C_GREEN
    if pct >= 50:
        return C_AMBER
    return C_RED


def _fit(c, text: str, font: str, size: float, max_w: float) -> str:
    """Ustunga sig'maydigan nomni "..." bilan qisqartiradi."""
    s = str(text or "")
    if c.stringWidth(s, font, size) <= max_w:
        return s
    while s and c.stringWidth(s + "…", font, size) > max_w:
        s = s[:-1]
    return s + "…"


def _col_x(width: float) -> list[float]:
    xs, acc = [], MARGIN
    for _, w, _a in COLUMNS:
        xs.append(acc)
        acc += w * width
    xs.append(acc)
    return xs


def _draw_page_frame(c, page_no: int, generated: str) -> None:
    c.setFillColor(C_MUTED)
    c.setFont(FONT_REGULAR, 7.5)
    c.drawString(MARGIN, 18, "Farg'ona jamoat salomatligi tibbiyot instituti · " + generated)
    c.drawRightString(PAGE_W - MARGIN, 18, str(page_no) + "-bet")
    c.setStrokeColor(C_BORDER)
    c.setLineWidth(0.5)
    c.line(MARGIN, 28, PAGE_W - MARGIN, 28)


def _draw_title(c, title: str, subtitle: str) -> float:
    """Sarlavha bandi. Kontent boshlanadigan y ni qaytaradi."""
    band_h = 62
    top = PAGE_H - MARGIN
    c.setFillColor(C_NAVY)
    c.rect(MARGIN, top - band_h, PAGE_W - 2 * MARGIN, band_h, stroke=0, fill=1)

    text_x = MARGIN + 18
    logo = _get_logo_path()
    if logo:
        try:
            size = 40
            c.drawImage(
                logo, MARGIN + 16, top - band_h + (band_h - size) / 2,
                width=size, height=size, mask="auto",
            )
            text_x = MARGIN + 16 + size + 14
        except Exception:
            pass

    c.setFillColor(colors.white)
    c.setFont(FONT_BOLD, 15)
    c.drawString(text_x, top - 27, title)
    c.setFont(FONT_REGULAR, 9)
    c.setFillColor(colors.HexColor("#c7d6e8"))
    c.drawString(text_x, top - 43, subtitle)
    return top - band_h - 22


def _draw_cards(c, y: float, totals: dict, threshold: int) -> float:
    cards = [
        ("Kafedradagi jami", str(totals["total_teachers"]), C_SLATE),
        ("Ishtirok etgan", str(totals["participated"]), C_NAVY),
        ("Boshlab, yakunlamagan", str(totals.get("unfinished", 0)), C_AMBER),
        ("Ishtirok etmagan", str(totals["not_participated"]), C_MUTED),
        ("Testdan o'tgan", str(totals["passed"]), C_GREEN),
        ("O'ta olmagan", str(totals["failed"]), C_RED),
        ("O'tish foizi", str(totals["pass_percent"]) + "%", C_NAVY),
    ]
    gap = 10
    total_w = PAGE_W - 2 * MARGIN
    cw = (total_w - gap * (len(cards) - 1)) / len(cards)
    ch = 52
    for i, (label, value, tone) in enumerate(cards):
        x = MARGIN + i * (cw + gap)
        c.setFillColor(C_NAVY_LIGHT)
        c.roundRect(x, y - ch, cw, ch, 6, stroke=0, fill=1)
        c.setFillColor(C_MUTED)
        c.setFont(FONT_REGULAR, 7.5)
        c.drawString(x + 10, y - 17, _fit(c, label, FONT_REGULAR, 7.5, cw - 20))
        c.setFillColor(tone)
        c.setFont(FONT_BOLD, 19)
        c.drawString(x + 10, y - 40, value)

    c.setFillColor(C_MUTED)
    c.setFont(FONT_REGULAR, 7.5)
    c.drawString(
        MARGIN, y - ch - 13,
        "O'tish mezoni: " + str(threshold) + "% va undan yuqori. "
        "Bir o'qituvchi bir necha fandan topshirsa ham bir marta sanaladi (eng yaxshi natijasi bo'yicha).",
    )
    return y - ch - 30


def _draw_table_header(c, y: float, width: float) -> float:
    xs = _col_x(width)
    head_h = 26
    c.setFillColor(C_NAVY)
    c.rect(MARGIN, y - head_h, width, head_h, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont(FONT_BOLD, 7.5)
    for i, (label, _w, align) in enumerate(COLUMNS):
        lines = label.split("\n")
        base = y - 11 if len(lines) > 1 else y - 16
        for j, line in enumerate(lines):
            ly = base - j * 8.5
            if align == "right":
                c.drawRightString(xs[i + 1] - 8, ly, line)
            else:
                c.drawString(xs[i] + 8, ly, line)
    return y - head_h


def _draw_row(c, y: float, width: float, n: int, r: dict, row_h: float, zebra: bool) -> None:
    xs = _col_x(width)
    if zebra:
        c.setFillColor(C_ZEBRA)
        c.rect(MARGIN, y - row_h, width, row_h, stroke=0, fill=1)
    ty = y - row_h + 6.5
    part = int(r["participated"])
    values = [
        (str(n), C_MUTED, FONT_REGULAR),
        (r["kafedra_name"], C_SLATE, FONT_REGULAR),
        (str(r["total_teachers"]), C_SLATE, FONT_REGULAR),
        (str(part), C_SLATE, FONT_REGULAR),
        (str(r.get("unfinished", 0)), C_AMBER if r.get("unfinished") else C_MUTED, FONT_REGULAR),
        (str(r["not_participated"]), C_MUTED, FONT_REGULAR),
        (str(r["passed"]), C_GREEN, FONT_REGULAR),
        (str(r["failed"]), C_RED if r["failed"] else C_MUTED, FONT_REGULAR),
        (str(r["pass_percent"]) + "%" if part else "—", _pct_color(int(r["pass_percent"]), part), FONT_BOLD),
        (str(r["participation_percent"]) + "%", C_MUTED, FONT_REGULAR),
    ]
    for i, (text, tone, font) in enumerate(values):
        align = COLUMNS[i][2]
        size = 8.2
        c.setFillColor(tone)
        c.setFont(font, size)
        if align == "right":
            c.drawRightString(xs[i + 1] - 8, ty, text)
        else:
            cell_w = xs[i + 1] - xs[i] - 16
            c.drawString(xs[i] + 8, ty, _fit(c, text, font, size, cell_w))
    c.setStrokeColor(C_BORDER)
    c.setLineWidth(0.4)
    c.line(MARGIN, y - row_h, MARGIN + width, y - row_h)


def _draw_rank_block(c, x: float, y: float, w: float, title: str, rows: list[dict], tone) -> None:
    c.setFillColor(tone)
    c.setFont(FONT_BOLD, 9.5)
    c.drawString(x, y, title)
    yy = y - 14
    c.setFillColor(C_MUTED)
    c.setFont(FONT_REGULAR, 7)
    c.drawString(x, yy, "Kafedra")
    c.drawRightString(x + w - 92, yy, "Ishtirok")
    c.drawRightString(x + w - 46, yy, "O'tgan")
    c.drawRightString(x + w, yy, "O'tish %")
    yy -= 4
    c.setStrokeColor(C_BORDER)
    c.line(x, yy, x + w, yy)
    for i, r in enumerate(rows):
        yy -= 15
        c.setFillColor(C_MUTED)
        c.setFont(FONT_REGULAR, 8)
        c.drawString(x, yy, str(i + 1) + ".")
        c.setFillColor(C_SLATE)
        c.drawString(x + 14, yy, _fit(c, r["kafedra_name"], FONT_REGULAR, 8, w - 120))
        c.drawRightString(x + w - 92, yy, str(r["participated"]))
        c.setFillColor(C_GREEN)
        c.drawRightString(x + w - 46, yy, str(r["passed"]))
        c.setFillColor(tone)
        c.setFont(FONT_BOLD, 8)
        c.drawRightString(x + w, yy, str(r["pass_percent"]) + "%")


def build_kafedra_report_pdf(data: dict, generated_label: str, start_page: int = 1) -> bytes:
    """Hisobot ma'lumotidan (admin_reports.build_kafedra_report) PDF yasaydi."""
    buf = BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))
    c.setTitle("Kafedralar kesimida imtihon hisoboti")

    width = PAGE_W - 2 * MARGIN
    totals = data["totals"]
    threshold = int(data["pass_threshold"])
    page = start_page

    # --- 1-bet: umumiy ko'rsatkichlar va reyting ---
    y = _draw_title(
        c,
        "Kafedralar kesimida imtihon hisoboti",
        _season_label(data) + " · " + generated_label,
    )
    y = _draw_cards(c, y, totals, threshold)

    col_w = (width - 30) / 2
    top_rows = data.get("top") or []
    bottom_rows = data.get("bottom") or []
    _draw_rank_block(c, MARGIN, y, col_w, "Eng yuqori ko'rsatkichli kafedralar", top_rows, C_GREEN)
    _draw_rank_block(c, MARGIN + col_w + 30, y, col_w, "Eng past ko'rsatkichli kafedralar", bottom_rows, C_RED)

    _draw_page_frame(c, page, generated_label)
    c.showPage()

    # --- 2-bet va keyingilari: to'liq jadval ---
    rows = data.get("kafedralar") or []
    row_h = 18.0
    i = 0
    while i < len(rows) or i == 0:
        page += 1
        y = _draw_title(
            c,
            "Kafedralar kesimida imtihon hisoboti",
            "To'liq jadval · jami " + str(len(rows)) + " ta kafedra",
        )
        y = _draw_table_header(c, y, width)
        while i < len(rows) and y - row_h > 40:
            _draw_row(c, y, width, i + 1, rows[i], row_h, zebra=(i % 2 == 1))
            y -= row_h
            i += 1
        _draw_page_frame(c, page, generated_label)
        c.showPage()
        if i >= len(rows):
            break

    c.save()
    return buf.getvalue()

def build_absent_report_pdf(data: dict, generated_label: str, start_page: int = 1) -> bytes:
    """Topshirmaganlar ro'yxati — kafedra bo'yicha, ism-familiya bilan."""
    buf = BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))
    c.setTitle("Imtihonni topshirmaganlar")
    width = PAGE_W - 2 * MARGIN
    col_w = (width - 24) / 2.0
    page = start_page

    y = _draw_title(
        c,
        "Imtihonni topshirmaganlar",
        _season_label(data) + " · jami "
        + str(data.get("absent_total", 0))
        + " kishi · " + generated_label,
    )
    col = 0
    ytop = y

    def _new_page():
        nonlocal page, y, col, ytop
        _draw_page_frame(c, page, generated_label)
        c.showPage()
        page += 1
        y = _draw_title(c, "Imtihonni topshirmaganlar", "davomi")
        ytop = y
        col = 0

    for g in data.get("groups", []):
        need = 18 + 15 * min(len(g["people"]), 3)
        if y - need < 46:
            if col == 0:
                col = 1
                y = ytop
            else:
                _new_page()
        x = MARGIN + col * (col_w + 24)
        c.setFillColor(C_NAVY)
        c.setFont(FONT_BOLD, 9)
        c.drawString(x, y, _fit(c, g["kafedra_name"], FONT_BOLD, 9, col_w - 70))
        c.setFillColor(C_RED)
        c.setFont(FONT_BOLD, 9)
        c.drawRightString(x + col_w, y, str(g["absent_count"]) + " / " + str(g["total_teachers"]))
        y -= 5
        c.setStrokeColor(C_BORDER)
        c.line(x, y, x + col_w, y)
        y -= 12
        for i, p in enumerate(g["people"], 1):
            if y < 46:
                if col == 0:
                    col = 1
                    y = ytop
                    x = MARGIN + col_w + 24 + MARGIN - MARGIN
                    x = MARGIN + col * (col_w + 24)
                else:
                    _new_page()
                    x = MARGIN
            c.setFillColor(C_MUTED)
            c.setFont(FONT_REGULAR, 7.5)
            c.drawString(x, y, str(i) + ".")
            c.setFillColor(C_SLATE)
            c.setFont(FONT_REGULAR, 8)
            c.drawString(x + 16, y, _fit(c, p["name"], FONT_REGULAR, 8, col_w - 130))
            c.setFillColor(C_MUTED)
            c.setFont(FONT_REGULAR, 7.5)
            c.drawRightString(x + col_w - 44, y, str(p["student_id"]))
            if p.get("state") == "unfinished":
                c.setFillColor(C_AMBER)
                c.drawRightString(x + col_w, y, "boshlagan")
            y -= 13
        y -= 8

    _draw_page_frame(c, page, generated_label)
    c.showPage()
    c.save()
    return buf.getvalue()

# Qatnashganlar jadvali ustunlari.
P_COLUMNS = [
    ("#", 0.035, "right"),
    ("F.I.Sh.", 0.300, "left"),
    ("Login", 0.135, "left"),
    ("Fan", 0.300, "left"),
    ("Ball", 0.090, "right"),
    ("Foiz", 0.070, "right"),
    ("Natija", 0.070, "right"),
]


def _p_col_x(width: float) -> list[float]:
    xs, acc = [], MARGIN
    for _, w, _a in P_COLUMNS:
        xs.append(acc)
        acc += w * width
    xs.append(acc)
    return xs


def build_participants_report_pdf(data: dict, generated_label: str, start_page: int = 1) -> bytes:
    """Topshirganlar — kafedra kesimida, ball va o'tdi/o'tmadi bilan."""
    buf = BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H))
    c.setTitle("Imtihon natijalari — qatnashganlar")
    width = PAGE_W - 2 * MARGIN
    xs = _p_col_x(width)
    page = start_page

    def _title():
        return _draw_title(
            c,
            "Imtihon natijalari — qatnashganlar",
            _season_label(data)
            + " · jami " + str(data.get("total_people", 0))
            + " kishi · o'tdi " + str(data.get("total_passed", 0))
            + " · o'tmadi " + str(data.get("total_failed", 0))
            + " · " + generated_label,
        )

    def _head(y: float) -> float:
        c.setFillColor(C_NAVY)
        c.rect(MARGIN, y - 18, width, 18, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont(FONT_BOLD, 7.5)
        for i, (label, _w, align) in enumerate(P_COLUMNS):
            if align == "right":
                c.drawRightString(xs[i + 1] - 8, y - 12.5, label)
            else:
                c.drawString(xs[i] + 8, y - 12.5, label)
        return y - 18

    y = _title()
    row_h = 14.0

    for g in data.get("groups", []):
        if y - 62 < 40:
            _draw_page_frame(c, page, generated_label)
            c.showPage()
            page += 1
            y = _title()
        c.setFillColor(C_NAVY)
        c.setFont(FONT_BOLD, 10)
        y -= 6
        c.drawString(MARGIN, y - 8, _fit(c, g["kafedra_name"], FONT_BOLD, 10, width - 220))
        c.setFont(FONT_REGULAR, 8)
        c.setFillColor(C_MUTED)
        c.drawRightString(
            MARGIN + width, y - 8,
            "topshirdi " + str(g["count"]) + "  ·  o'tdi " + str(g["passed"])
            + "  ·  o'tmadi " + str(g["failed"]) + "  ·  o'rtacha " + str(g["avg_percent"]) + "%",
        )
        y -= 16
        y = _head(y)
        for i, p in enumerate(g["people"], 1):
            if y - row_h < 40:
                _draw_page_frame(c, page, generated_label)
                c.showPage()
                page += 1
                y = _title()
                y = _head(y)
            if i % 2 == 0:
                c.setFillColor(C_ZEBRA)
                c.rect(MARGIN, y - row_h, width, row_h, stroke=0, fill=1)
            ty = y - row_h + 4.5
            tone = C_GREEN if p["passed"] else C_RED
            cells = [
                (str(i), C_MUTED, FONT_REGULAR),
                (p["name"], C_SLATE, FONT_REGULAR),
                (p["student_id"], C_MUTED, FONT_REGULAR),
                (p["subject"], C_MUTED, FONT_REGULAR),
                (str(p["score"]) + "/" + str(p["total"]), C_SLATE, FONT_REGULAR),
                (str(p["percent"]) + "%", tone, FONT_BOLD),
                ("o'tdi" if p["passed"] else "o'tmadi", tone, FONT_BOLD),
            ]
            for j, (text, col, font) in enumerate(cells):
                size = 7.8
                c.setFillColor(col)
                c.setFont(font, size)
                if P_COLUMNS[j][2] == "right":
                    c.drawRightString(xs[j + 1] - 8, ty, text)
                else:
                    c.drawString(xs[j] + 8, ty, _fit(c, text, font, size, xs[j + 1] - xs[j] - 16))
            c.setStrokeColor(C_BORDER)
            c.setLineWidth(0.3)
            c.line(MARGIN, y - row_h, MARGIN + width, y - row_h)
            y -= row_h
        y -= 10

    _draw_page_frame(c, page, generated_label)
    c.showPage()
    c.save()
    return buf.getvalue()

def build_full_report_pdf(kaf_data: dict, part_data: dict, absent_data: dict,
                          generated_label: str) -> bytes:
    """Uchala bo'limni BITTA hujjatga birlashtiradi.

    Rahbariyatga beriladigan to'liq hisobot: umumiy ko'rsatkichlar va reyting,
    keyin har bir kafedra bo'yicha topshirganlar (ball va o'tdi/o'tmadi bilan),
    oxirida topshirmaganlar ro'yxati. Bet raqamlari uzluksiz boradi.
    """
    from pypdf import PdfReader, PdfWriter

    parts: list[bytes] = []
    page = 1
    for builder, data in (
        (build_kafedra_report_pdf, kaf_data),
        (build_participants_report_pdf, part_data),
        (build_absent_report_pdf, absent_data),
    ):
        if not data:
            continue
        chunk = builder(data, generated_label, page)
        parts.append(chunk)
        page += len(PdfReader(BytesIO(chunk)).pages)

    if len(parts) == 1:
        return parts[0]

    writer = PdfWriter()
    for chunk in parts:
        for pg in PdfReader(BytesIO(chunk)).pages:
            writer.add_page(pg)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()
