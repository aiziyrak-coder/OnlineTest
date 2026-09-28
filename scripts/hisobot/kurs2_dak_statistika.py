"""2-kurs ordinatorlar (DAK) — yakuniy statistika: PDF + Excel."""
import json
import os
from collections import Counter

from django.utils import timezone as tz

from apps.api.certificate_pdf import FONT_BOLD, FONT_REGULAR
from apps.core.models import AppUser, Exam, StudentExam, ViolationLog

OUT = "/tmp/hisobot"
os.makedirs(OUT, exist_ok=True)
THR = 56

E1 = {e.id: e for e in Exam.objects.filter(audience="ordinator", course=2,
                                           title__startswith="Ordinatura 2-kurs DAK")}
E2 = {e.id: e for e in Exam.objects.filter(audience="ordinator", course=2,
                                           title__contains="qayta imtihon")}
ALL = {**E1, **E2}


def subject(exam):
    t = str(exam.title or "")
    for m in (" qayta imtihon — ", " DAK — "):
        if m in t:
            t = t.split(m, 1)[1]
            break
    return t.split(" (")[0].strip()


viol = Counter()
for sid, in ViolationLog.objects.filter(exam_id__in=list(ALL)).values_list("student_id"):
    viol[str(sid)] += 1

people = {}
for se in StudentExam.objects.filter(exam_id__in=list(ALL)).select_related("student", "exam"):
    e = ALL[se.exam_id]
    qs = json.loads(se.session_questions_json or "[]")
    tot = len(qs) or 25
    pct = round((se.score or 0) / tot * 100) if se.score is not None else None
    st = (se.status or "").strip()
    if se.ban_reason:
        state, label = "banned", "Chetlatilgan"
    elif st == "Completed":
        state = "passed" if (pct or 0) >= THR else "failed"
        label = "O'tdi" if state == "passed" else "O'tmadi"
    elif st == "In Progress":
        state, label = "running", "Topshirmoqda"
    else:
        state, label = "absent", ("Qatnashmadi" if se.access_granted else "Ruxsat yopiq")
    row = {
        "id": str(se.student_id), "name": se.student.name, "subject": subject(e),
        "score": se.score, "total": tot, "percent": pct, "state": state, "label": label,
        "answered": len(json.loads(se.answers_json or "{}") or {}),
        "finished": tz.localtime(se.completed_at).strftime("%d.%m.%Y %H:%M") if se.completed_at else "",
        "minutes": (round((se.completed_at - se.started_at).total_seconds() / 60)
                    if (se.started_at and se.completed_at) else None),
        "retake_exam": se.exam_id in E2,
        "violations": viol.get(str(se.student_id), 0),
        "verify": se.verify_state or "",
    }
    cur = people.get(se.student_id)
    if cur is None or (row["percent"] or -1) > (cur["percent"] or -1):
        people[se.student_id] = row

# Ruxsat berilgan, lekin sessiyasi umuman yo'q hisoblar hisobotga kirmaydi —
# ular imtihonga biriktirilmagan (ro'yxatda yo'q) deb qaraladi.
rows = sorted(people.values(), key=lambda p: (p["subject"].lower(), p["name"]))
done = [p for p in rows if p["state"] in ("passed", "failed")]
passed = [p for p in rows if p["state"] == "passed"]
failed = [p for p in rows if p["state"] == "failed"]
absent = [p for p in rows if p["state"] in ("absent", "running")]
banned = [p for p in rows if p["state"] == "banned"]
pcts = [p["percent"] for p in done]
mins = [p["minutes"] for p in done if p["minutes"]]
avg = round(sum(pcts) / len(pcts), 1) if pcts else 0
med = sorted(pcts)[len(pcts) // 2] if pcts else 0
TOTAL_ACCOUNTS = AppUser.objects.filter(role="ordinator", course=2).count()

# --- fan kesimi
by_subj = {}
for p in rows:
    s = by_subj.setdefault(p["subject"], {"n": 0, "passed": 0, "failed": 0, "absent": 0, "pcts": []})
    s["n"] += 1
    s[{"passed": "passed", "failed": "failed"}.get(p["state"], "absent")] += 1
    if p["percent"] is not None:
        s["pcts"].append(p["percent"])

# --- taqsimot
BUCKETS = [(0, 39, "0-39%"), (40, 55, "40-55%"), (56, 69, "56-69%"),
           (70, 84, "70-84%"), (85, 100, "85-100%")]
dist = [(lbl, sum(1 for x in pcts if lo <= x <= hi)) for lo, hi, lbl in BUCKETS]

# ------------------------------------------------------------------- PDF --
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#6b7280")
LINE = colors.HexColor("#d1d5db")
HEAD = colors.HexColor("#1e3a5f")
SOFT = colors.HexColor("#f3f4f6")
PS = ParagraphStyle("t", fontName=FONT_REGULAR, fontSize=7.8, leading=9.6, textColor=INK)
PSB = ParagraphStyle("tb", parent=PS, fontName=FONT_BOLD)
H1 = ParagraphStyle("h1", fontName=FONT_BOLD, fontSize=15, leading=18, textColor=HEAD)
H2 = ParagraphStyle("h2", fontName=FONT_BOLD, fontSize=10.5, leading=13, textColor=HEAD,
                    spaceBefore=9, spaceAfter=4)
SUB = ParagraphStyle("sub", fontName=FONT_REGULAR, fontSize=8.4, leading=11, textColor=MUTED)


def C(t, s=PS):
    return Paragraph(str(t), s)


def grid(data, widths, extra=None):
    t = Table(data, colWidths=widths, repeatRows=1)
    st = [("BACKGROUND", (0, 0), (-1, 0), HEAD), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
          ("GRID", (0, 0), (-1, -1), 0.3, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
          ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
          ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]
    t.setStyle(TableStyle(st + (extra or [])))
    return t


story = []
now = tz.localtime().strftime("%d.%m.%Y %H:%M")
story.append(C("FARG'ONA JAMOAT SALOMATLIGI TIBBIYOT INSTITUTI", SUB))
story.append(C("2-kurs ordinatorlar — davlat attestatsiyasi (DAK) yakuniy statistikasi", H1))
story.append(C("Imtihon kunlari 21–23.09.2026 · o'tish chegarasi %d%% · hisobot: %s" % (THR, now), SUB))
story.append(Spacer(1, 8))

box = [[C("ASOSIY KO'RSATKICHLAR", PSB)] + [C("")] * 5,
       [C(k, SUB) for k in ("Imtihonga chiqqan", "Topshirgan", "O'tdi", "O'tmadi",
                            "Qatnashmagan", "O'tish foizi")],
       [C("<b>%s</b>" % v) for v in (len(rows), len(done), len(passed), len(failed),
                                     len(absent) + len(banned),
                                     "%d%%" % round(len(passed) / len(done) * 100) if done else "0%")]]
story.append(grid(box, [44 * mm] * 6, [("SPAN", (0, 0), (-1, 0)), ("BACKGROUND", (0, 0), (-1, 0), SOFT)]))
story.append(Spacer(1, 4))
box2 = [[C("BALL VA VAQT", PSB)] + [C("")] * 5,
       [C(k, SUB) for k in ("O'rtacha foiz", "Mediana", "Eng yuqori", "Eng past",
                            "O'rtacha vaqt", "Chetlatilgan")],
       [C("<b>%s</b>" % v) for v in ("%s%%" % avg, "%s%%" % med,
                                     "%s%%" % (max(pcts) if pcts else 0),
                                     "%s%%" % (min(pcts) if pcts else 0),
                                     "%s daq" % (round(sum(mins) / len(mins)) if mins else 0),
                                     len(banned))]]
story.append(grid(box2, [44 * mm] * 6, [("SPAN", (0, 0), (-1, 0)), ("BACKGROUND", (0, 0), (-1, 0), SOFT)]))
story.append(Spacer(1, 10))

story.append(C("1. Natijalar taqsimoti", H2))
d = [[C(h, PSB) for h in ["Ball oralig'i", "Ordinator", "Ulushi", "Diagramma"]]]
for lbl, n in dist:
    share = round(n / len(pcts) * 100) if pcts else 0
    d.append([C(lbl), C(n), C("%s%%" % share),
              C("<font color='%s'>%s</font>" % ("#b91c1c" if lbl in ("0-39%", "40-55%") else "#047857",
                                                "█" * max(0, round(share / 2)))) ])
story.append(grid(d, [34 * mm, 26 * mm, 22 * mm, 110 * mm],
                  [("ALIGN", (1, 1), (2, -1), "CENTER")]))

story.append(C("2. Mutaxassisliklar kesimi", H2))
d3 = [[C(h, PSB) for h in ["Mutaxassislik", "Ordinator", "O'tdi", "O'tmadi", "Qatnashmadi",
                           "O'tish %", "O'rtacha ball %"]]]
for name in sorted(by_subj, key=lambda x: (-by_subj[x]["n"], x.lower())):
    s = by_subj[name]
    dn = s["passed"] + s["failed"]
    d3.append([C(name), C(s["n"]), C(s["passed"]), C(s["failed"]), C(s["absent"]),
               C("%d%%" % round(s["passed"] / dn * 100) if dn else "—"),
               C("%d%%" % round(sum(s["pcts"]) / len(s["pcts"])) if s["pcts"] else "—")])
story.append(grid(d3, [72 * mm, 24 * mm, 20 * mm, 22 * mm, 28 * mm, 24 * mm, 32 * mm],
                  [("ALIGN", (1, 1), (-1, -1), "CENTER")]))

story.append(C("3. O'tmaganlar (%d kishi)" % len(failed), H2))
if failed:
    d4 = [[C(h, PSB) for h in ["№", "F.I.SH.", "Mutaxassislik", "Ball", "Foiz", "Vaqt", "Qayd"]]]
    for i, p in enumerate(sorted(failed, key=lambda x: (x["percent"] or 0)), 1):
        d4.append([C(i), C(p["name"], PSB), C(p["subject"]),
                   C("%s/%s" % (p["score"], p["total"])),
                   C("<font color='#b91c1c'><b>%s%%</b></font>" % p["percent"]),
                   C("%s daq" % p["minutes"] if p["minutes"] else "—"),
                   C(p["violations"] or "—")])
    story.append(grid(d4, [9 * mm, 74 * mm, 62 * mm, 20 * mm, 20 * mm, 22 * mm, 18 * mm],
                      [("ALIGN", (3, 1), (-1, -1), "CENTER")]))

if absent or banned:
    story.append(C("4. Qatnashmagan va chetlatilganlar (%d kishi)" % (len(absent) + len(banned)), H2))
    d5 = [[C(h, PSB) for h in ["№", "F.I.SH.", "Mutaxassislik", "Holat"]]]
    for i, p in enumerate(sorted(absent + banned, key=lambda x: x["name"]), 1):
        d5.append([C(i), C(p["name"], PSB), C(p["subject"]), C(p["label"])])
    story.append(grid(d5, [9 * mm, 80 * mm, 70 * mm, 40 * mm]))

story.append(C("5. To'liq vedomost", H2))
d6 = [[C(h, PSB) for h in ["№", "F.I.SH.", "Mutaxassislik", "Ball", "Foiz", "Sana",
                           "Vaqt", "Qayd", "Natija"]]]
for i, p in enumerate(rows, 1):
    col = {"passed": "#047857", "failed": "#b91c1c"}.get(p["state"], "#b45309")
    d6.append([C(i), C(p["name"], PSB), C(p["subject"]),
               C("%s/%s" % (p["score"], p["total"]) if p["score"] is not None else "—"),
               C("%s%%" % p["percent"] if p["percent"] is not None else "—"),
               C(p["finished"] or "—", SUB),
               C("%s daq" % p["minutes"] if p["minutes"] else "—"),
               C(p["violations"] or "—"),
               C("<font color='%s'><b>%s</b></font>" % (col, p["label"]))])
story.append(grid(d6, [9 * mm, 66 * mm, 55 * mm, 18 * mm, 16 * mm, 28 * mm, 18 * mm, 14 * mm, 24 * mm],
                  [("ALIGN", (3, 1), (-1, -1), "CENTER")]))

story.append(Spacer(1, 12))
story.append(C("Izoh: hisobot tizimdagi sessiyalar asosida avtomatik tuzilgan. Bir kishida bir necha "
               "urinish bo'lsa, eng yaxshi natija olingan. Tizimda 2-kurs sifatida %d ta hisob bor, "
               "shundan %d tasi imtihonga chiqqan." % (TOTAL_ACCOUNTS, len(rows)), SUB))
story.append(Spacer(1, 14))
story.append(Table([[C("DAK raisi _______________"), C("A'zolar _______________"),
                     C("Kotib _______________"), C("Sana __________")]],
                   colWidths=[70 * mm, 70 * mm, 60 * mm, 45 * mm],
                   style=TableStyle([("TOPPADDING", (0, 0), (-1, -1), 10)])))

pdf_path = os.path.join(OUT, "2-kurs-ordinatorlar-yakuniy-statistika.pdf")
SimpleDocTemplate(pdf_path, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm,
                  topMargin=10 * mm, bottomMargin=10 * mm,
                  title="2-kurs ordinatorlar DAK statistikasi").build(story)
print("PDF:", pdf_path, os.path.getsize(pdf_path))

# ----------------------------------------------------------------- Excel --
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

thin = Side(style="thin", color="D1D5DB")
BRD = Border(left=thin, right=thin, top=thin, bottom=thin)
HF = PatternFill("solid", fgColor="1E3A5F")
HFONT = Font(bold=True, color="FFFFFF", size=10)
wb = Workbook()

ws = wb.active
ws.title = "Vedomost"
ws.append(["№", "F.I.SH.", "Mutaxassislik", "Ball", "Jami savol", "Foiz", "Natija",
           "Topshirgan sana", "Vaqt (daq)", "Qaydlar"])
for c in ws[1]:
    c.fill, c.font, c.border = HF, HFONT, BRD
    c.alignment = Alignment(horizontal="center", wrap_text=True)
for i, p in enumerate(rows, 1):
    ws.append([i, p["name"], p["subject"], p["score"], p["total"], p["percent"], p["label"],
               p["finished"], p["minutes"], p["violations"] or ""])
for col, w in zip("ABCDEFGHIJ", [5, 40, 34, 8, 11, 8, 15, 18, 11, 9]):
    ws.column_dimensions[col].width = w
for r in ws.iter_rows(min_row=2):
    for c in r:
        c.border = BRD
    v = r[6].value
    r[6].fill = PatternFill("solid", fgColor="D1FAE5" if v == "O'tdi"
                            else ("FEE2E2" if v == "O'tmadi" else "FEF3C7"))
ws.freeze_panes = "A2"
ws.auto_filter.ref = ws.dimensions

w2 = wb.create_sheet("Fanlar")
w2.append(["Mutaxassislik", "Ordinator", "O'tdi", "O'tmadi", "Qatnashmadi", "O'tish %", "O'rtacha %"])
for c in w2[1]:
    c.fill, c.font, c.border = HF, HFONT, BRD
for name in sorted(by_subj, key=lambda x: (-by_subj[x]["n"], x.lower())):
    s = by_subj[name]
    dn = s["passed"] + s["failed"]
    w2.append([name, s["n"], s["passed"], s["failed"], s["absent"],
               round(s["passed"] / dn * 100) if dn else 0,
               round(sum(s["pcts"]) / len(s["pcts"])) if s["pcts"] else 0])
w2.column_dimensions["A"].width = 46
for col in "BCDEFG":
    w2.column_dimensions[col].width = 13

w3 = wb.create_sheet("O'tmaganlar")
w3.append(["№", "F.I.SH.", "Mutaxassislik", "Ball", "Foiz", "Vaqt (daq)", "Qaydlar"])
for c in w3[1]:
    c.fill, c.font, c.border = HF, HFONT, BRD
for i, p in enumerate(sorted(failed, key=lambda x: (x["percent"] or 0)), 1):
    w3.append([i, p["name"], p["subject"], p["score"], p["percent"], p["minutes"], p["violations"] or ""])
for col, w in zip("ABCDEFG", [5, 40, 34, 8, 8, 11, 9]):
    w3.column_dimensions[col].width = w

w4 = wb.create_sheet("Xulosa")
for k, v in [("2-kurs hisoblari (tizimda)", TOTAL_ACCOUNTS), ("Imtihonga chiqqan", len(rows)),
             ("Topshirgan", len(done)), ("O'tdi", len(passed)), ("O'tmadi", len(failed)),
             ("Qatnashmagan", len(absent)), ("Chetlatilgan", len(banned)), ("", ""),
             ("O'tish foizi, %", round(len(passed) / len(done) * 100) if done else 0),
             ("O'rtacha ball, %", avg), ("Mediana, %", med),
             ("Eng yuqori, %", max(pcts) if pcts else 0), ("Eng past, %", min(pcts) if pcts else 0),
             ("O'rtacha sarflangan vaqt, daq", round(sum(mins) / len(mins)) if mins else 0), ("", ""),
             ("O'tish chegarasi, %", THR), ("Mutaxassisliklar soni", len(by_subj)),
             ("Hisobot vaqti", now)]:
    w4.append([k, v])
w4.column_dimensions["A"].width = 34
w4.column_dimensions["B"].width = 16
for lbl, n in dist:
    w4.append(["  " + lbl, n])

xls = os.path.join(OUT, "2-kurs-ordinatorlar-yakuniy-statistika.xlsx")
wb.save(xls)
print("XLSX:", xls, os.path.getsize(xls))
print("STAT", {"chiqqan": len(rows), "topshirgan": len(done), "o'tdi": len(passed),
               "o'tmadi": len(failed), "qatnashmadi": len(absent), "ban": len(banned),
               "o'rtacha": avg, "mediana": med, "fanlar": len(by_subj)})
print("TAQSIMOT", dist)
