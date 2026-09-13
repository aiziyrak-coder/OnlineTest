"""Ordinator / nomzod / maxsus kiruvchi hisobotlari — PDF (har biri o'ziga xos).

Kafedra hisoboti PDF'i (`kafedra_report_pdf.py`) bilan bir xil uslub: institut
logotipli sarlavha bandi, ko'rsatkich kartochkalari, jadvallar. Lekin mazmun
toifaga mos:
  * ordinator — yo'nalishlar kesimi, har yo'nalish bo'yicha ro'yxat,
    hali topshirmaganlar va qarzdorlar;
  * nomzod — har bir lavozim (kafedra + fan) bo'yicha tanlov reytingi va
    tavsiya etiladigan nomzod, topshirmaganlar telefoni bilan;
  * maxsus kiruvchi — har bir kishiga alohida natija varaqasi va imzo joyi.
"""
from __future__ import annotations

from io import BytesIO

from reportlab.lib import colors
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
)
from apps.api.kafedra_report_pdf import (
    C_AMBER,
    C_ZEBRA,
    MARGIN,
    PAGE_H,
    PAGE_W,
    _draw_page_frame,
    _draw_title,
    _fit,
)

BOTTOM = 40


def _pct_tone(pct, thr):
    if pct is None:
        return C_MUTED
    thr = thr or 60
    if pct >= thr:
        return C_GREEN
    if pct >= thr - 15:
        return C_AMBER
    return C_RED


def _mins(v) -> str:
    return "" if v is None else ("%.1f" % v).rstrip("0").rstrip(".")


def _viol_text(p: dict) -> str:
    v = p.get("violations") or {}
    n = int(v.get("total") or 0)
    tech = int(v.get("technical") or 0)
    parts = []
    if n:
        parts.append("%d ta" % n)
    if tech:
        parts.append("texnik %d" % tech)
    if p.get("flags"):
        parts.append("SHUBHALI")
    return ", ".join(parts) or "—"


def _cell(v):
    if isinstance(v, tuple):
        text = v[0]
        tone = v[1] if len(v) > 1 else None
        bold = v[2] if len(v) > 2 else False
    else:
        text, tone, bold = v, None, False
    return ("" if text is None else str(text)), (tone or C_SLATE), bool(bold)


class _Doc:
    """Sahifalash va chizish yordamchisi (sarlavha, kartochka, jadval)."""

    def __init__(self, title: str, subtitle: str, generated: str):
        self.buf = BytesIO()
        self.c = rl_canvas.Canvas(self.buf, pagesize=(PAGE_W, PAGE_H))
        self.c.setTitle(title)
        self.title = title
        self.generated = generated
        self.page = 1
        self.width = PAGE_W - 2 * MARGIN
        self.y = _draw_title(self.c, title, subtitle)

    def new_page(self, subtitle: str = "davomi") -> None:
        _draw_page_frame(self.c, self.page, self.generated)
        self.c.showPage()
        self.page += 1
        self.y = _draw_title(self.c, self.title, subtitle)

    def ensure(self, h: float) -> None:
        if self.y - h < BOTTOM:
            self.new_page()

    def cards(self, items: list) -> None:
        c = self.c
        gap = 10
        n = max(1, len(items))
        cw = (self.width - gap * (n - 1)) / n
        ch = 50
        self.ensure(ch + 8)
        for i, (label, value, tone) in enumerate(items):
            x = MARGIN + i * (cw + gap)
            c.setFillColor(C_NAVY_LIGHT)
            c.roundRect(x, self.y - ch, cw, ch, 6, stroke=0, fill=1)
            c.setFillColor(C_MUTED)
            c.setFont(FONT_REGULAR, 7.5)
            c.drawString(x + 9, self.y - 16, _fit(c, label, FONT_REGULAR, 7.5, cw - 18))
            c.setFillColor(tone)
            c.setFont(FONT_BOLD, 18)
            c.drawString(x + 9, self.y - 39, _fit(c, str(value), FONT_BOLD, 18, cw - 18))
        self.y -= ch + 12

    def note(self, text: str, tone=None, size: float = 7.8) -> None:
        c = self.c
        lines, line = [], ""
        for w in str(text).split():
            t = (line + " " + w).strip()
            if c.stringWidth(t, FONT_REGULAR, size) > self.width and line:
                lines.append(line)
                line = w
            else:
                line = t
        if line:
            lines.append(line)
        for ln in lines:
            self.ensure(12)
            c.setFillColor(tone or C_MUTED)
            c.setFont(FONT_REGULAR, size)
            c.drawString(MARGIN, self.y - 9, ln)
            self.y -= 11
        self.y -= 3

    def heading(self, text: str, right: str = "", tone=None, size: float = 10.5) -> None:
        self.ensure(48)
        c = self.c
        self.y -= 4
        right_w = (c.stringWidth(right, FONT_REGULAR, 8) + 24) if right else 0
        c.setFillColor(tone or C_NAVY)
        c.setFont(FONT_BOLD, size)
        c.drawString(MARGIN, self.y - 10, _fit(c, text, FONT_BOLD, size, self.width - right_w))
        if right:
            c.setFillColor(C_MUTED)
            c.setFont(FONT_REGULAR, 8)
            c.drawRightString(MARGIN + self.width, self.y - 10, right)
        self.y -= 15
        c.setStrokeColor(C_BORDER)
        c.setLineWidth(0.6)
        c.line(MARGIN, self.y, MARGIN + self.width, self.y)
        self.y -= 5

    def table(self, cols: list, rows: list, row_h: float = 14.0, size: float = 7.8) -> None:
        """cols: [(sarlavha, nisbiy_kenglik, tekislash)], rows: [[matn | (matn, rang, qalin)]]."""
        c = self.c
        xs = [MARGIN]
        for _label, w, _a in cols:
            xs.append(xs[-1] + w * self.width)

        def head():
            c.setFillColor(C_NAVY)
            c.rect(MARGIN, self.y - 17, self.width, 17, stroke=0, fill=1)
            c.setFillColor(colors.white)
            c.setFont(FONT_BOLD, 7.3)
            for i, (label, _w, align) in enumerate(cols):
                if align == "right":
                    c.drawRightString(xs[i + 1] - 6, self.y - 11.5, label)
                elif align == "center":
                    c.drawCentredString((xs[i] + xs[i + 1]) / 2, self.y - 11.5, label)
                else:
                    c.drawString(xs[i] + 6, self.y - 11.5, label)
            self.y -= 17

        if self.y - 17 - row_h < BOTTOM:
            self.new_page()
        head()
        for n, row in enumerate(rows):
            if self.y - row_h < BOTTOM:
                self.new_page()
                head()
            if n % 2 == 1:
                c.setFillColor(C_ZEBRA)
                c.rect(MARGIN, self.y - row_h, self.width, row_h, stroke=0, fill=1)
            ty = self.y - row_h + 4.3
            for i, raw in enumerate(row):
                text, tone, bold = _cell(raw)
                font = FONT_BOLD if bold else FONT_REGULAR
                c.setFillColor(tone)
                c.setFont(font, size)
                align = cols[i][2]
                cell_w = xs[i + 1] - xs[i] - 12
                text = _fit(c, text, font, size, cell_w)
                if align == "right":
                    c.drawRightString(xs[i + 1] - 6, ty, text)
                elif align == "center":
                    c.drawCentredString((xs[i] + xs[i + 1]) / 2, ty, text)
                else:
                    c.drawString(xs[i] + 6, ty, text)
            c.setStrokeColor(C_BORDER)
            c.setLineWidth(0.3)
            c.line(MARGIN, self.y - row_h, MARGIN + self.width, self.y - row_h)
            self.y -= row_h
        self.y -= 8

    def signatures(self, roles: list[str]) -> None:
        self.ensure(40)
        c = self.c
        self.y -= 14
        col_w = self.width / max(1, len(roles))
        for i, role in enumerate(roles):
            x = MARGIN + i * col_w
            c.setFillColor(C_SLATE)
            c.setFont(FONT_REGULAR, 8.5)
            c.drawString(x, self.y, role)
            c.setStrokeColor(C_MUTED)
            c.setLineWidth(0.5)
            c.line(x, self.y - 16, x + col_w - 30, self.y - 16)
            c.setFillColor(C_MUTED)
            c.setFont(FONT_REGULAR, 6.5)
            c.drawString(x, self.y - 24, "(imzo, F.I.Sh.)")
        self.y -= 34

    def finish(self) -> bytes:
        _draw_page_frame(self.c, self.page, self.generated)
        self.c.showPage()
        self.c.save()
        return self.buf.getvalue()


def _subtitle(d: dict) -> str:
    sn = d.get("season") or {}
    return "%s · %s" % (sn.get("label") or "", d.get("generated_label") or "")


# --------------------------------------------------------------- ordinator --
def build_ordinator_pdf(d: dict) -> bytes:
    t = d["totals"]
    thr = d.get("pass_threshold")
    doc = _Doc(d["title"], _subtitle(d), d.get("generated_label") or "")
    doc.cards([
        ("Ruxsat berilgan", t["allowed"], C_NAVY),
        ("Topshirdi", t["completed"], C_SLATE),
        ("O'tdi", t["passed"], C_GREEN),
        ("O'tmadi", t["failed"], C_RED),
        ("Hali topshirmagan", t["remaining"], C_AMBER),
        ("Qarzdor (ruxsat yo'q)", t["debt"], C_RED),
        ("O'tish foizi", "%d%%" % t["pass_percent"], C_NAVY),
    ])
    doc.note(
        "Hisob asosi — ruxsat berilganlar (attestatsiya grafigi bo'yicha), kafedradagi barcha ordinator emas. "
        + ("O'tish mezoni: %d%% va undan yuqori. " % thr if thr else "O'tish mezoni har yo'nalishning o'z chegarasi. ")
        + ("Imtihon BIR MARTALIK — qayta topshirish faqat administrator qarori bilan. " if d.get("one_attempt") else "")
        + "Qamrov: %d%% (topshirganlar / ruxsat berilganlar). O'rtacha natija: %d%%."
        % (t["coverage_percent"], t["avg_percent"])
    )

    doc.heading("Yo'nalishlar kesimida", "%d ta yo'nalish" % t["directions"])
    cols = [
        ("#", 0.03, "right"), ("Yo'nalish", 0.27, "left"), ("Kafedra", 0.245, "left"),
        ("Ruxsat", 0.06, "right"), ("Topshirdi", 0.07, "right"), ("O'tdi", 0.06, "right"),
        ("O'tmadi", 0.065, "right"), ("Qolgan", 0.065, "right"), ("Qarzdor", 0.065, "right"),
        ("O'rtacha", 0.07, "right"),
    ]
    rows = []
    for i, g in enumerate(d.get("groups") or [], 1):
        rows.append([
            (i, C_MUTED), g["direction"], (g["kafedra_name"], C_MUTED), g["allowed"], g["completed"],
            (g["passed"], C_GREEN), (g["failed"], C_RED if g["failed"] else C_MUTED),
            (g["not_started"] + g["in_progress"], C_AMBER if (g["not_started"] + g["in_progress"]) else C_MUTED),
            (g["debt"], C_RED if g["debt"] else C_MUTED),
            (("%d%%" % g["avg_percent"]) if g["completed"] else "—", _pct_tone(g["avg_percent"] if g["completed"] else None, g["threshold"]), True),
        ])
    doc.table(cols, rows)

    pcols = [
        ("#", 0.03, "right"), ("F.I.Sh.", 0.30, "left"), ("Login", 0.12, "left"),
        ("Holat", 0.15, "left"), ("Ball", 0.07, "right"), ("Foiz", 0.06, "right"),
        ("Natija", 0.08, "center"), ("Vaqt, daq.", 0.08, "right"), ("Nazorat qaydlari", 0.11, "left"),
    ]
    for g in d.get("groups") or []:
        if not g["people"]:
            continue
        doc.heading(
            g["direction"],
            "ruxsat %d · topshirdi %d · o'tdi %d · o'rtacha %s"
            % (g["allowed"], g["completed"], g["passed"], ("%d%%" % g["avg_percent"]) if g["completed"] else "—"),
        )
        rows = []
        for i, p in enumerate(g["people"], 1):
            done = p["state"] == "completed"
            rows.append([
                (i, C_MUTED), p["name"], (p["student_id"], C_MUTED),
                (p["state_label"], C_SLATE if done else C_AMBER),
                ("%d/%d" % (p["score"], p["total"])) if done else "—",
                (("%d%%" % p["percent"]) if done else "—", _pct_tone(p["percent"], g["threshold"]), True),
                (("o'tdi" if p["passed"] else "o'tmadi") if done else "", C_GREEN if p["passed"] else C_RED, True),
                _mins(p["minutes"]),
                (_viol_text(p), C_RED if p["violations"]["total"] else C_MUTED),
            ])
        doc.table(pcols, rows)

    todo = d.get("todo") or []
    if todo:
        doc.heading("Ruxsat berilgan, lekin hali topshirmaganlar", "%d kishi" % len(todo), tone=C_AMBER)
        doc.table(
            [("#", 0.04, "right"), ("F.I.Sh.", 0.38, "left"), ("Login", 0.14, "left"),
             ("Yo'nalish", 0.30, "left"), ("Holat", 0.14, "left")],
            [[(i, C_MUTED), p["name"], (p["student_id"], C_MUTED), p["direction"], (p["state_label"], C_AMBER)]
             for i, p in enumerate(todo, 1)],
        )
    sus = d.get("suspects") or []
    if sus:
        doc.heading("Shubhali natijalar — amaliy ko'nikma kuni og'zaki tekshirish uchun",
                    "%d kishi" % len(sus), tone=C_RED)
        doc.note("Bu avtomatik jazo emas: tizim ko'chirish belgilarini topgan natijalar. Komissiya "
                 "2-3 ta og'zaki savol bilan bilimni tasdiqlashi tavsiya etiladi.")
        doc.table(
            [("#", 0.03, "right"), ("F.I.Sh.", 0.25, "left"), ("Login", 0.11, "left"),
             ("Yo'nalish", 0.17, "left"), ("Ball", 0.06, "right"), ("Sabab", 0.38, "left")],
            [[(i, C_MUTED), p["name"], (p["student_id"], C_MUTED), p.get("direction") or "",
              (("%d%%" % p["percent"]) if p.get("percent") is not None else "—", C_SLATE, True),
              ("; ".join(f["label"] for f in p.get("flags") or []), C_RED)]
             for i, p in enumerate(sus, 1)],
            row_h=15.0,
        )
    debtors = d.get("debtors") or []
    if debtors:
        doc.heading("Fandan qarzdorlar — test topshirishga ruxsat berilmagan", "%d kishi" % len(debtors), tone=C_RED)
        doc.table(
            [("#", 0.04, "right"), ("F.I.Sh.", 0.38, "left"), ("Login", 0.14, "left"),
             ("Yo'nalish", 0.30, "left"), ("Holat", 0.14, "left")],
            [[(i, C_MUTED), p["name"], (p["student_id"], C_MUTED), p["direction"], ("qarzdor", C_RED, True)]
             for i, p in enumerate(debtors, 1)],
        )
    doc.signatures(["Magistratura va klinik ordinatura bo'limi boshlig'i", "O'quv ishlari bo'yicha prorektor"])
    return doc.finish()


# ------------------------------------------------------------------ nomzod --
def build_vacancy_pdf(d: dict) -> bytes:
    t = d["totals"]
    doc = _Doc(d["title"] + " — hisobot", _subtitle(d), d.get("generated_label") or "")
    doc.cards([
        ("Ro'yxatdan o'tgan", t["registered"], C_NAVY),
        ("Topshirdi", t["completed"], C_SLATE),
        ("O'tdi", t["passed"], C_GREEN),
        ("O'tmadi", t["failed"], C_RED),
        ("Topshirmagan", t["not_started"] + t["absent"], C_AMBER),
        ("Chetlatilgan", t["banned"], C_RED),
        ("Tavsiya etilgan", t["recommended"], C_GREEN),
    ])
    doc.note(
        "Har bir lavozim (kafedra + fan) bo'yicha nomzodlar natija foizi bo'yicha saralangan; teng foizda "
        "tezroq yakunlagan yuqorida. \"Tavsiya etiladi\" — tanlovdagi eng yuqori natija va o'tish chegarasidan "
        "yuqori. Teng natijada yakuniy qarorni komissiya qabul qiladi. Lavozimlar: %d ta, shundan raqobatli "
        "(1 dan ortiq nomzod): %d ta, g'olibi aniqlanmagan: %d ta." % (t["competitions"], t["contested"], t["no_winner"])
    )

    doc.heading("Lavozimlar bo'yicha qisqacha", "%d ta lavozim" % t["competitions"])
    rows = []
    for i, c in enumerate(d.get("competitions") or [], 1):
        win = ", ".join(c["winner"]) if c["winner"] else "—"
        rows.append([
            (i, C_MUTED), c["kafedra_name"], c["subject"], c["candidates"], c["completed"],
            (c["passed"], C_GREEN if c["passed"] else C_MUTED),
            (("%d%%" % c["best_percent"]) if c["completed"] else "—", _pct_tone(c["best_percent"] if c["completed"] else None, c["threshold"]), True),
            (("teng: " if c["tie"] else "") + win, C_GREEN if c["winner"] else C_MUTED, bool(c["winner"])),
        ])
    doc.table(
        [("#", 0.03, "right"), ("Kafedra", 0.24, "left"), ("Fan (lavozim)", 0.24, "left"),
         ("Nomzod", 0.06, "right"), ("Topshirdi", 0.07, "right"), ("O'tdi", 0.05, "right"),
         ("Eng yuqori", 0.07, "right"), ("Tavsiya etilgan", 0.24, "left")],
        rows,
    )

    ccols = [
        ("O'rin", 0.05, "center"), ("F.I.Sh.", 0.27, "left"), ("Telefon", 0.13, "left"),
        ("Ball", 0.07, "right"), ("Foiz", 0.06, "right"), ("Vaqt, daq.", 0.08, "right"),
        ("Nazorat qaydlari", 0.12, "left"), ("Xulosa", 0.22, "left"),
    ]
    verdict_tone = {"recommended": C_GREEN, "tie": C_AMBER, "passed": C_GREEN, "failed": C_RED,
                    "banned": C_RED, "absent": C_MUTED}
    for c in d.get("competitions") or []:
        doc.heading("%s — %s" % (c["kafedra_name"], c["subject"]),
                    "%d nomzod · chegara %d%%" % (c["candidates"], c["threshold"]))
        rows = []
        for p in c["people"]:
            done = p["state"] == "completed"
            rows.append([
                (p.get("rank") or "—", C_NAVY if p.get("rank") == 1 else C_MUTED, p.get("rank") == 1),
                (p["name"], C_SLATE, p.get("verdict") == "recommended"),
                (p.get("phone") or "—", C_MUTED),
                ("%d/%d" % (p["score"], p["total"])) if done else "—",
                (("%d%%" % p["percent"]) if done else "—", _pct_tone(p["percent"], c["threshold"]), True),
                _mins(p["minutes"]),
                (_viol_text(p), C_RED if p["violations"]["total"] else C_MUTED),
                (p.get("verdict_label") or "", verdict_tone.get(p.get("verdict"), C_MUTED), p.get("verdict") in ("recommended", "tie")),
            ])
        doc.table(ccols, rows)

    nt = d.get("not_taken") or []
    if nt:
        doc.heading("Testni topshirmagan nomzodlar", "%d kishi" % len(nt), tone=C_AMBER)
        doc.table(
            [("#", 0.04, "right"), ("F.I.Sh.", 0.28, "left"), ("Telefon", 0.13, "left"),
             ("Kafedra", 0.24, "left"), ("Fan (lavozim)", 0.21, "left"), ("Holat", 0.10, "left")],
            [[(i, C_MUTED), p["name"], (p.get("phone") or "—", C_MUTED), p["kafedra_name"], p["subject"],
              (p["state_label"], C_AMBER)] for i, p in enumerate(nt, 1)],
        )
    doc.signatures(["Kadrlar bo'limi boshlig'i", "Tanlov komissiyasi raisi", "Komissiya kotibi"])
    return doc.finish()


# --------------------------------------------------------- maxsus kiruvchi --
def _kv_table(doc: _Doc, pairs: list) -> None:
    doc.table(
        [("Ko'rsatkich", 0.32, "left"), ("Qiymat", 0.68, "left")],
        [[(k, C_MUTED), v] for k, v in pairs],
        row_h=13.5,
        size=8.0,
    )


def _result_banner(doc: _Doc, p: dict) -> None:
    c = doc.c
    doc.ensure(58)
    done = p["state"] == "completed"
    tone = (C_GREEN if p["passed"] else C_RED) if done else C_AMBER
    h = 46
    c.setFillColor(C_NAVY_LIGHT)
    c.roundRect(MARGIN, doc.y - h, doc.width, h, 8, stroke=0, fill=1)
    c.setFillColor(tone)
    c.rect(MARGIN, doc.y - h, 6, h, stroke=0, fill=1)
    c.setFont(FONT_BOLD, 20)
    if done:
        big = "%d / %d   (%d%%)" % (p["score"], p["total"], p["percent"])
        verdict = "O'TDI" if p["passed"] else "O'TMADI"
    else:
        big = p["state_label"]
        verdict = ""
    c.drawString(MARGIN + 20, doc.y - 30, big)
    if verdict:
        c.setFont(FONT_BOLD, 18)
        c.drawRightString(MARGIN + doc.width - 18, doc.y - 24, verdict)
        c.setFillColor(C_MUTED)
        c.setFont(FONT_REGULAR, 8)
        c.drawRightString(MARGIN + doc.width - 18, doc.y - 37, "o'tish chegarasi %d%%" % p["threshold"])
    doc.y -= h + 12


def _subject_bars(doc: _Doc, subjects: list, thr: int) -> None:
    c = doc.c
    row_h = 20
    label_w = doc.width * 0.34
    bar_w = doc.width * 0.46
    for s in subjects:
        doc.ensure(row_h + 4)
        y = doc.y - 14
        c.setFillColor(C_SLATE)
        c.setFont(FONT_REGULAR, 8.5)
        c.drawString(MARGIN, y, _fit(c, s["subject"], FONT_REGULAR, 8.5, label_w - 10))
        x = MARGIN + label_w
        c.setFillColor(colors.HexColor("#e5eaf1"))
        c.roundRect(x, y - 3, bar_w, 10, 3, stroke=0, fill=1)
        tone = _pct_tone(s["percent"], thr)
        if s["percent"]:
            c.setFillColor(tone)
            c.roundRect(x, y - 3, max(4, bar_w * s["percent"] / 100.0), 10, 3, stroke=0, fill=1)
        c.setFillColor(tone)
        c.setFont(FONT_BOLD, 8.5)
        c.drawRightString(MARGIN + doc.width, y,
                          "%d / %d  (%d%%)" % (s["correct"], s["total"], s["percent"]))
        doc.y -= row_h
    doc.y -= 6


def build_entrant_pdf(d: dict) -> bytes:
    people = d.get("people") or []
    doc = _Doc("Maxsus kiruvchi — individual natija varaqasi", _subtitle(d), d.get("generated_label") or "")
    if not people:
        doc.note("Bu mavsumda topshiruvchi yo'q.")
        return doc.finish()
    for n, p in enumerate(people):
        if n:
            doc.new_page(_subtitle(d))
        doc.heading(p["name"], "Login: " + p["student_id"], size=13)
        doc.note(p.get("exam_title") or "", tone=C_SLATE, size=9)
        _result_banner(doc, p)
        if p.get("subjects"):
            doc.heading("Fanlar kesimida natija", "reja: " + ", ".join(
                "%s — %d" % (x["subject"], x["count"]) for x in (p.get("plan") or [])) if p.get("plan") else "")
            _subject_bars(doc, p["subjects"], p["threshold"])
            if not p.get("subjects_exact", True):
                doc.note("Izoh: fanlar kesimidagi taqsimot javoblar bo'yicha qayta hisoblangan; rasmiy natija — umumiy ball.")
        ident = p.get("identity") or {}
        cons = p.get("consent") or {}
        viol = p.get("violations") or {}
        mic = cons.get("mic")
        doc.heading("Imtihon jarayoni")
        pairs = [
            ("Holat", p["state_label"]),
            ("Boshlangan", p.get("started_label") or "—"),
            ("Yakunlangan", p.get("completed_label") or "—"),
            ("Sarflangan vaqt", ("%s daqiqa (ruxsat: %d daqiqa)" % (_mins(p["minutes"]), p["duration_limit"]))
             if p.get("minutes") is not None else "—"),
            ("Javob berilgan savollar", "%d / %d" % (p.get("answered") or 0, p["total"])),
            ("Shaxs tasdig'i", (ident.get("verified_at") or "—")
             + ("" if ident.get("matched") is None else (" · mos keldi" if ident.get("matched") else " · MOS KELMADI"))),
            ("Nazorat qoidalariga rozilik", (cons.get("at") or "berilmagan")
             + (" · IP " + cons["ip"] if cons.get("ip") else "")),
            ("Mikrofon darajasi (boshida)", "—" if mic is None else "%.3f" % float(mic)),
            ("Rasmiy ogohlantirishlar", str(p.get("warnings") or 0)),
            ("Nazorat qaydlari", "%d ta%s" % (int(viol.get("total") or 0),
                                              (" · texnik uzilish %d" % viol["technical"]) if viol.get("technical") else "")),
            ("Natija raqami (sertifikat)", p.get("result_id") or "—"),
        ]
        tl = p.get("timeline") or []
        # Qayd kam bo'lsa — jadval ichida: varaq bitta betga sig'adi.
        if 0 < len(tl) <= 3:
            pairs.insert(len(pairs) - 1, ("Qaydlar tafsiloti", "; ".join(
                "%s — %s" % (x["at"][-5:], x["label"]) for x in tl)))
        _kv_table(doc, pairs)
        if len(tl) > 3:
            doc.heading("Nazorat qaydlari xronologiyasi", "%d ta yozuv" % len(tl))
            doc.table(
                [("Vaqt", 0.20, "left"), ("Qayd", 0.62, "left"), ("Turi", 0.18, "left")],
                [[(x["at"], C_MUTED), x["label"], ("texnik" if x["technical"] else "nazorat",
                                                   C_MUTED if x["technical"] else C_AMBER)] for x in tl],
            )
        doc.signatures(["Qabul komissiyasi raisi", "Komissiya a'zosi", "Komissiya a'zosi"])
    return doc.finish()


def build_audience_pdf(d: dict) -> bytes:
    kind = d.get("kind")
    if kind == "ordinator":
        return build_ordinator_pdf(d)
    if kind == "vacancy":
        return build_vacancy_pdf(d)
    if kind == "entrant":
        return build_entrant_pdf(d)
    raise ValueError("unknown report kind: %r" % kind)
