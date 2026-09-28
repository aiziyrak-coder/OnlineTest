"""1-kurs ordinatorlar: 1-imkoniyat va 2-imkoniyat bo'yicha to'liq hisobot.

Har bir ordinator uchun asosiy imtihon (1-imkoniyat) va qayta imtihon
(2-imkoniyat) natijalari bir qatorda solishtiriladi, yakuniy holat eng yaxshi
urinish bo'yicha aniqlanadi. Natija: PDF (vedomost) + Excel.
"""
import json
import os

from django.utils import timezone as tz

from apps.api.certificate_pdf import FONT_BOLD, FONT_REGULAR, exam_pass_threshold
from apps.core.models import Exam, StudentExam, ViolationLog

OUT = "/tmp/hisobot"
os.makedirs(OUT, exist_ok=True)

E1 = {e.id: e for e in Exam.objects.filter(audience="ordinator", course=1,
                                           title__startswith="Ordinatura 1-kurs —")}
E2 = {e.id: e for e in Exam.objects.filter(audience="ordinator", course=1,
                                           title__startswith="Ordinatura 1-kurs qayta")}
THR = 56


def subject(exam):
    t = str(exam.title or "")
    for marker in (" qayta imtihon — ", " — "):
        if marker in t:
            t = t.split(marker, 1)[1]
            break
    return t.split(" (")[0].strip()


def total_q(se, exam):
    n = len(json.loads(se.session_questions_json or "[]"))
    if n:
        return n
    return int(exam.bank_question_count or 0) + int(exam.ai_question_count or 0)


def pick(se, exam):
    """Bitta urinishning qisqa holati."""
    tot = total_q(se, exam)
    st = (se.status or "").strip()
    score = se.score
    pct = round((score or 0) / tot * 100) if (tot and score is not None) else None
    if se.ban_reason:
        state, label = "banned", "Chetlatilgan"
    elif st == "Completed":
        state = "passed" if (pct or 0) >= THR else "failed"
        label = "O'tdi" if state == "passed" else "O'tmadi"
    elif st == "In Progress":
        state, label = "running", "Topshirmoqda"
    else:
        state, label = "absent", ("Qatnashmadi" if se.access_granted else "Ruxsat yo'q")
    return {
        "exam_id": exam.id, "subject": subject(exam), "status": st, "score": score,
        "total": tot, "percent": pct, "state": state, "label": label,
        "answered": len(json.loads(se.answers_json or "{}") or {}),
        "started": tz.localtime(se.started_at).strftime("%d.%m.%Y %H:%M") if se.started_at else "",
        "finished": tz.localtime(se.completed_at).strftime("%d.%m.%Y %H:%M") if se.completed_at else "",
        "ban": se.ban_reason or "",
        "verify": se.verify_state or "",
        "minutes": (round((se.completed_at - se.started_at).total_seconds() / 60)
                    if (se.started_at and se.completed_at) else None),
    }


people = {}
for tag, pool in (("a1", E1), ("a2", E2)):
    for se in StudentExam.objects.filter(exam_id__in=list(pool)).select_related("student"):
        p = people.setdefault(se.student_id, {"id": se.student_id, "name": se.student.name,
                                              "a1": None, "a2": None})
        row = pick(se, pool[se.exam_id])
        cur = p[tag]
        # Bir odamga bir nechta sessiya bo'lsa — eng yaxshisini olamiz.
        if cur is None or (row["percent"] or -1) > (cur["percent"] or -1):
            p[tag] = row

viol = {}
for sid, vt in ViolationLog.objects.filter(
        student_id__in=list(people), exam_id__in=list(E1) + list(E2)).values_list("student_id", "violation_type"):
    viol.setdefault(sid, []).append(vt)

for p in people.values():
    best = None
    for k in ("a1", "a2"):
        r = p[k]
        if r and r["percent"] is not None and (best is None or r["percent"] > best["percent"]):
            best = r
    p["best"] = best
    if best and best["percent"] >= THR:
        p["final"], p["final_label"] = "passed", "O'TDI"
    elif best:
        p["final"], p["final_label"] = "failed", "O'TMADI"
    elif (p["a1"] or p["a2"] or {}).get("state") == "running":
        p["final"], p["final_label"] = "running", "TOPSHIRMOQDA"
    else:
        p["final"], p["final_label"] = "absent", "QATNASHMADI"
    p["subject"] = (p["a2"] or p["a1"])["subject"]
    p["violations"] = len(viol.get(p["id"], []))
    # Izoh: qatorni o'qigan odam nima bo'lganini savol bermasdan tushunsin.
    notes = []
    a1, a2 = p["a1"], p["a2"]
    if a1 and a1["state"] == "banned":
        notes.append("1-imkoniyatda chetlatilgan")
    if a1 and a1["state"] == "absent" and a2:
        notes.append("1-imkoniyatda qatnashmagan")
    if a2 and a2["state"] == "absent":
        notes.append("2-imkoniyat berilgan, foydalanmagan")
    if a1 and a2 and a1["percent"] is not None and a2["percent"] is not None:
        d = a2["percent"] - a1["percent"]
        notes.append("2-imkoniyatda %+d%%" % d if d else "natija o'zgarmagan")
    if p["final"] == "passed" and a2 and a2["state"] == "passed" and (not a1 or a1["state"] != "passed"):
        notes.append("2-imkoniyat hisobiga o'tdi")
    if not a2 and p["final"] == "failed":
        notes.append("2-imkoniyat berilmagan")
    p["note"] = "; ".join(notes)

rows = sorted(people.values(), key=lambda p: (p["subject"].lower(), p["name"]))

# ------------------------------------------------------------ statistika --
def stat(key):
    vals = [p[key] for p in rows if p[key]]
    done = [r for r in vals if r["state"] in ("passed", "failed")]
    return {
        "given": len(vals),
        "taken": len(done),
        "passed": sum(1 for r in vals if r["state"] == "passed"),
        "failed": sum(1 for r in vals if r["state"] == "failed"),
        "absent": sum(1 for r in vals if r["state"] == "absent"),
        "banned": sum(1 for r in vals if r["state"] == "banned"),
        "running": sum(1 for r in vals if r["state"] == "running"),
        "avg": round(sum(r["percent"] for r in done) / len(done), 1) if done else 0,
    }


S1, S2 = stat("a1"), stat("a2")
FIN = {
    "people": len(rows),
    "passed": sum(1 for p in rows if p["final"] == "passed"),
    "failed": sum(1 for p in rows if p["final"] == "failed"),
    "absent": sum(1 for p in rows if p["final"] == "absent"),
    "running": sum(1 for p in rows if p["final"] == "running"),
    "second_chance": sum(1 for p in rows if p["a2"]),
    "improved": sum(1 for p in rows if p["a1"] and p["a2"]
                    and p["a1"]["percent"] is not None and p["a2"]["percent"] is not None
                    and p["a2"]["percent"] > p["a1"]["percent"]),
    "saved": sum(1 for p in rows if p["a2"] and p["a2"]["state"] == "passed"
                 and (not p["a1"] or p["a1"]["state"] != "passed")),
}

# ------------------------------------------------------------------- PDF --
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#6b7280")
LINE = colors.HexColor("#d1d5db")
HEAD = colors.HexColor("#1e3a5f")
GREEN = colors.HexColor("#047857")
RED = colors.HexColor("#b91c1c")
AMBER = colors.HexColor("#b45309")
SOFT = colors.HexColor("#f3f4f6")

PS = ParagraphStyle("t", fontName=FONT_REGULAR, fontSize=7.6, leading=9.4, textColor=INK)
PSB = ParagraphStyle("tb", parent=PS, fontName=FONT_BOLD)
H1 = ParagraphStyle("h1", fontName=FONT_BOLD, fontSize=15, leading=18, textColor=HEAD)
H2 = ParagraphStyle("h2", fontName=FONT_BOLD, fontSize=10.5, leading=13, textColor=HEAD,
                    spaceBefore=8, spaceAfter=4)
SUB = ParagraphStyle("sub", fontName=FONT_REGULAR, fontSize=8.4, leading=11, textColor=MUTED)

story = []
now = tz.localtime().strftime("%d.%m.%Y %H:%M")
story.append(Paragraph("FARG'ONA JAMOAT SALOMATLIGI TIBBIYOT INSTITUTI", SUB))
story.append(Paragraph("1-kurs ordinatorlar — imtihon natijalari bo'yicha to'liq vedomost", H1))
story.append(Paragraph(
    "1-imkoniyat (asosiy imtihon) va 2-imkoniyat (qayta imtihon) solishtirmasi · "
    "o'tish chegarasi %d%% · hisobot tuzilgan vaqt: %s" % (THR, now), SUB))
story.append(Spacer(1, 6))


def cell(txt, style=PS):
    return Paragraph(str(txt), style)


def box(title, items):
    data = [[cell(title, PSB)] + [cell("", PS)] * (len(items) - 1),
            [cell(k, SUB) for k, _ in items],
            [cell("<b>%s</b>" % v, PS) for _, v in items]]
    t = Table(data, colWidths=[36 * mm] * len(items))
    t.setStyle(TableStyle([
        ("SPAN", (0, 0), (-1, 0)),
        ("BACKGROUND", (0, 0), (-1, 0), SOFT),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 1), (-1, -1), 0.3, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


story.append(box("1-IMKONIYAT — asosiy imtihon", [
    ("Ruxsat berilgan", S1["given"]), ("Topshirgan", S1["taken"]), ("O'tgan", S1["passed"]),
    ("O'tmagan", S1["failed"]), ("Qatnashmagan", S1["absent"] + S1["running"]),
    ("O'rtacha foiz", "%s%%" % S1["avg"])]))
story.append(Spacer(1, 4))
story.append(box("2-IMKONIYAT — qayta imtihon", [
    ("Ruxsat berilgan", S2["given"]), ("Topshirgan", S2["taken"]), ("O'tgan", S2["passed"]),
    ("O'tmagan", S2["failed"]), ("Qatnashmagan", S2["absent"] + S2["running"]),
    ("O'rtacha foiz", "%s%%" % S2["avg"])]))
story.append(Spacer(1, 4))
story.append(box("YAKUNIY HOLAT", [
    ("Jami ordinator", FIN["people"]), ("O'tdi", FIN["passed"]), ("O'tmadi", FIN["failed"]),
    ("Qatnashmadi", FIN["absent"] + FIN["running"]),
    ("2-imkoniyat berilgan", FIN["second_chance"]), ("2-imkoniyatda qutqarilgan", FIN["saved"])]))
story.append(Spacer(1, 10))


def res_cell(r):
    if not r:
        return cell("—", SUB)
    if r["percent"] is None:
        return cell("<font color='#6b7280'>%s</font>" % r["label"], PS)
    col = {"passed": "#047857", "failed": "#b91c1c"}.get(r["state"], "#b45309")
    return cell("<font color='%s'><b>%s/%s · %s%%</b><br/>%s</font>"
                % (col, r["score"], r["total"], r["percent"], r["label"]), PS)


HEADERS = ["№", "F.I.SH.", "Mutaxassislik (fan)",
           "1-imkoniyat<br/>sana", "1-imkoniyat<br/>natija",
           "2-imkoniyat<br/>sana", "2-imkoniyat<br/>natija", "YAKUNIY", "Izoh"]
WID = [8 * mm, 52 * mm, 38 * mm, 21 * mm, 30 * mm, 21 * mm, 30 * mm, 24 * mm, 49 * mm]

story.append(Paragraph("1. Umumiy vedomost — barcha ordinatorlar", H2))
data = [[cell(h, PSB) for h in HEADERS]]
for i, p in enumerate(rows, 1):
    fcol = {"passed": "#047857", "failed": "#b91c1c"}.get(p["final"], "#b45309")
    data.append([
        cell(i, PS), cell(p["name"], PSB), cell(p["subject"], PS),
        cell((p["a1"] or {}).get("finished") or (p["a1"] or {}).get("started") or "—", SUB),
        res_cell(p["a1"]),
        cell((p["a2"] or {}).get("finished") or (p["a2"] or {}).get("started") or "—", SUB),
        res_cell(p["a2"]),
        cell("<font color='%s'><b>%s</b></font>" % (fcol, p["final_label"]), PS),
        cell(p["note"] or "—", SUB)])

t = Table(data, colWidths=WID, repeatRows=1)
style = [
    ("BACKGROUND", (0, 0), (-1, 0), HEAD), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("GRID", (0, 0), (-1, -1), 0.3, LINE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ALIGN", (0, 0), (0, -1), "CENTER"), ("ALIGN", (3, 0), (-1, -1), "CENTER"),
    ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
]
for i, p in enumerate(rows, 1):
    if p["a2"]:
        style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#fffbeb")))
    elif i % 2 == 0:
        style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#fafafa")))
for h in data[0]:
    pass
t.setStyle(TableStyle(style))
story.append(t)
story.append(Paragraph("Sariq fonli qatorlar — 2-imkoniyat berilgan ordinatorlar.", SUB))

# --- 2-imkoniyat tafsiloti
second = [p for p in rows if p["a2"]]
if second:
    story.append(Paragraph("2. 2-imkoniyat berilganlar — batafsil", H2))
    d2 = [[cell(h, PSB) for h in ["№", "F.I.SH.", "Fan", "1-urinish", "2-urinish",
                                  "O'zgarish", "Javob berdi", "Sarflangan vaqt", "Qaydlar",
                                  "Yakuniy"]]]
    W2 = [9 * mm, 55 * mm, 40 * mm, 24 * mm, 24 * mm, 22 * mm, 20 * mm, 24 * mm, 18 * mm, 22 * mm]
    for i, p in enumerate(second, 1):
        p1 = (p["a1"] or {}).get("percent")
        p2 = (p["a2"] or {}).get("percent")
        if p1 is None or p2 is None:
            chg = "—"
        else:
            diff = p2 - p1
            chg = ("<font color='#047857'>+%d%%</font>" % diff if diff > 0
                   else ("<font color='#b91c1c'>%d%%</font>" % diff if diff < 0 else "0%"))
        fcol = {"passed": "#047857", "failed": "#b91c1c"}.get(p["final"], "#b45309")
        d2.append([
            cell(i, PS), cell(p["name"], PSB), cell(p["subject"], PS),
            cell("%s%%" % p1 if p1 is not None else (p["a1"] or {}).get("label", "—"), PS),
            cell("%s%%" % p2 if p2 is not None else (p["a2"] or {}).get("label", "—"), PS),
            cell(chg, PS),
            cell("%s/%s" % ((p["a2"] or {}).get("answered", 0), (p["a2"] or {}).get("total", 0)), PS),
            cell("%s daq" % (p["a2"] or {}).get("minutes") if (p["a2"] or {}).get("minutes") else "—", PS),
            cell(p["violations"] or "—", PS),
            cell("<font color='%s'><b>%s</b></font>" % (fcol, p["final_label"]), PS)])
    t2 = Table(d2, colWidths=W2, repeatRows=1)
    t2.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEAD), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.3, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (3, 0), (-1, -1), "CENTER"), ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t2)

# --- fan kesimi
story.append(Paragraph("3. Mutaxassisliklar kesimi", H2))
by_subj = {}
for p in rows:
    s = by_subj.setdefault(p["subject"], {"n": 0, "passed": 0, "failed": 0, "absent": 0, "second": 0,
                                          "pcts": []})
    s["n"] += 1
    s[{"passed": "passed", "failed": "failed"}.get(p["final"], "absent")] += 1
    if p["a2"]:
        s["second"] += 1
    if p["best"] and p["best"]["percent"] is not None:
        s["pcts"].append(p["best"]["percent"])
d3 = [[cell(h, PSB) for h in ["Mutaxassislik", "Ordinator", "O'tdi", "O'tmadi", "Qatnashmadi",
                              "2-imkoniyat", "O'rtacha foiz"]]]
for name in sorted(by_subj, key=lambda x: x.lower()):
    s = by_subj[name]
    avg = round(sum(s["pcts"]) / len(s["pcts"])) if s["pcts"] else 0
    d3.append([cell(name, PS), cell(s["n"], PS), cell(s["passed"], PS), cell(s["failed"], PS),
               cell(s["absent"], PS), cell(s["second"] or "—", PS), cell("%s%%" % avg, PS)])
t3 = Table(d3, colWidths=[78 * mm, 24 * mm, 20 * mm, 22 * mm, 26 * mm, 26 * mm, 26 * mm],
           repeatRows=1)
t3.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), HEAD), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("GRID", (0, 0), (-1, -1), 0.3, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ALIGN", (1, 0), (-1, -1), "CENTER"),
    ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
]))
story.append(t3)

story.append(Spacer(1, 12))
story.append(Paragraph(
    "Izoh: yakuniy holat ikki urinishning eng yaxshi natijasi bo'yicha aniqlangan. "
    "O'tish chegarasi %d%%. Hisobot tizim ma'lumotlari asosida avtomatik tuzilgan (%s)."
    % (THR, now), SUB))
story.append(Spacer(1, 14))
sign = Table([[cell("Imtihon komissiyasi raisi _______________", PS),
               cell("Kotib _______________", PS),
               cell("Sana ____________", PS)]],
             colWidths=[95 * mm, 70 * mm, 60 * mm])
sign.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 10)]))
story.append(sign)

pdf_path = os.path.join(OUT, "1-kurs-ordinatorlar-ikki-imkoniyat.pdf")
doc = SimpleDocTemplate(pdf_path, pagesize=landscape(A4),
                        leftMargin=10 * mm, rightMargin=10 * mm,
                        topMargin=10 * mm, bottomMargin=10 * mm,
                        title="1-kurs ordinatorlar hisoboti")
doc.build(story)
print("PDF:", pdf_path, os.path.getsize(pdf_path))

# ----------------------------------------------------------------- Excel --
from openpyxl import Workbook  # Excel ixtiyoriy: ALSO_XLSX=1 bo'lsa yoziladi
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

wb = Workbook()
thin = Side(style="thin", color="D1D5DB")
BRD = Border(left=thin, right=thin, top=thin, bottom=thin)
HF = PatternFill("solid", fgColor="1E3A5F")
HFONT = Font(bold=True, color="FFFFFF", size=10)

ws = wb.active
ws.title = "Vedomost"
cols = ["№", "F.I.SH.", "Mutaxassislik", "1-imkoniyat ball", "1-imkoniyat %",
        "1-imkoniyat natija", "1-imkoniyat sana", "2-imkoniyat ball", "2-imkoniyat %",
        "2-imkoniyat natija", "2-imkoniyat sana", "Yakuniy foiz", "YAKUNIY", "Izoh", "Qaydlar"]
ws.append(cols)
for c in ws[1]:
    c.fill, c.font, c.border = HF, HFONT, BRD
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
for i, p in enumerate(rows, 1):
    a1, a2 = p["a1"] or {}, p["a2"] or {}
    ws.append([i, p["name"], p["subject"],
               "%s/%s" % (a1.get("score"), a1.get("total")) if a1.get("score") is not None else "",
               a1.get("percent") if a1.get("percent") is not None else "",
               a1.get("label", ""), a1.get("finished") or a1.get("started") or "",
               "%s/%s" % (a2.get("score"), a2.get("total")) if a2.get("score") is not None else "",
               a2.get("percent") if a2.get("percent") is not None else "",
               a2.get("label", ""), a2.get("finished") or a2.get("started") or "",
               (p["best"] or {}).get("percent", ""), p["final_label"], p["note"], p["violations"] or ""])
for w, col in zip([5, 38, 30, 14, 13, 16, 17, 14, 13, 16, 17, 12, 14, 44, 9], "ABCDEFGHIJKLMNO"):
    ws.column_dimensions[col].width = w
for r in ws.iter_rows(min_row=2):
    for c in r:
        c.border = BRD
    v = r[12].value
    if v == "O'TDI":
        r[12].fill = PatternFill("solid", fgColor="D1FAE5")
    elif v == "O'TMADI":
        r[12].fill = PatternFill("solid", fgColor="FEE2E2")
    else:
        r[12].fill = PatternFill("solid", fgColor="FEF3C7")
ws.freeze_panes = "A2"
ws.auto_filter.ref = ws.dimensions

w2 = wb.create_sheet("2-imkoniyat")
w2.append(["№", "F.I.SH.", "Fan", "1-urinish %", "2-urinish %", "O'zgarish",
           "Javob berdi", "Vaqt (daq)", "Qaydlar", "Yakuniy"])
for c in w2[1]:
    c.fill, c.font, c.border = HF, HFONT, BRD
for i, p in enumerate(second, 1):
    p1, p2 = (p["a1"] or {}).get("percent"), (p["a2"] or {}).get("percent")
    w2.append([i, p["name"], p["subject"], p1 if p1 is not None else "",
               p2 if p2 is not None else "",
               (p2 - p1) if (p1 is not None and p2 is not None) else "",
               "%s/%s" % ((p["a2"] or {}).get("answered", 0), (p["a2"] or {}).get("total", 0)),
               (p["a2"] or {}).get("minutes") or "", p["violations"] or "", p["final_label"]])
for w, col in zip([5, 38, 30, 12, 12, 11, 12, 11, 9, 14], "ABCDEFGHIJ"):
    w2.column_dimensions[col].width = w

w3 = wb.create_sheet("Fanlar")
w3.append(["Mutaxassislik", "Ordinator", "O'tdi", "O'tmadi", "Qatnashmadi", "2-imkoniyat",
           "O'rtacha %"])
for c in w3[1]:
    c.fill, c.font, c.border = HF, HFONT, BRD
for name in sorted(by_subj, key=lambda x: x.lower()):
    s = by_subj[name]
    w3.append([name, s["n"], s["passed"], s["failed"], s["absent"], s["second"],
               round(sum(s["pcts"]) / len(s["pcts"])) if s["pcts"] else 0])
w3.column_dimensions["A"].width = 46
for col in "BCDEFG":
    w3.column_dimensions[col].width = 13

w4 = wb.create_sheet("Xulosa")
for k, v in [("Jami ordinator", FIN["people"]), ("", ""),
             ("1-IMKONIYAT", ""), ("  ruxsat berilgan", S1["given"]),
             ("  topshirgan", S1["taken"]), ("  o'tgan", S1["passed"]),
             ("  o'tmagan", S1["failed"]), ("  qatnashmagan", S1["absent"] + S1["running"]),
             ("  o'rtacha foiz", S1["avg"]), ("", ""),
             ("2-IMKONIYAT", ""), ("  ruxsat berilgan", S2["given"]),
             ("  topshirgan", S2["taken"]), ("  o'tgan", S2["passed"]),
             ("  o'tmagan", S2["failed"]), ("  qatnashmagan", S2["absent"] + S2["running"]),
             ("  o'rtacha foiz", S2["avg"]), ("", ""),
             ("YAKUNIY", ""), ("  o'tdi", FIN["passed"]), ("  o'tmadi", FIN["failed"]),
             ("  qatnashmadi", FIN["absent"] + FIN["running"]),
             ("  2-imkoniyatda natijasini yaxshilagan", FIN["improved"]),
             ("  2-imkoniyat tufayli o'tgan", FIN["saved"]),
             ("", ""), ("O'tish chegarasi, %", THR), ("Hisobot vaqti", now)]:
    w4.append([k, v])
w4.column_dimensions["A"].width = 42
w4.column_dimensions["B"].width = 16

xls_path = os.path.join(OUT, "1-kurs-ordinatorlar-ikki-imkoniyat.xlsx")
wb.save(xls_path)
print("XLSX:", xls_path, os.path.getsize(xls_path))
print("STAT a1", S1)
print("STAT a2", S2)
print("FINAL", FIN)
print("people", len(rows), "second", len(second))
