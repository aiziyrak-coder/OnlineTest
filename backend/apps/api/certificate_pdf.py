"""Sertifikat PDF (reportlab + QR)."""
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


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
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    try:
        import qrcode
        from reportlab.lib.utils import ImageReader

        qr = qrcode.QRCode(version=1, box_size=3, border=1)
        qr.add_data(verify_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        qbuf = BytesIO()
        img.save(qbuf, format="PNG")
        qbuf.seek(0)
        c.drawImage(ImageReader(qbuf), w - 120, h - 120, width=90, height=90)
    except Exception:
        pass
    y = h - 50
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, y, "FJSTI — Onlayn imtihon sertifikati")
    y -= 36
    c.setFont("Helvetica", 10)
    for line in [
        f"Natija ID: {result_id}",
        f"Talaba: {student_name}",
        f"Imtihon: {exam_title}",
        f"Sana: {completed_at}",
        f"Ball: {score} / {total}",
        f"Tekshiruv: {verify_url[:80]}...",
        f"Yaxlitlik kodi: {integrity_code}",
    ]:
        c.drawString(50, y, line[:120])
        y -= 14
    y -= 10
    c.drawString(50, y, "Xulosa:")
    y -= 14
    c.setFont("Helvetica", 9)
    for para in (overview or "")[:2000].split("\n")[:8]:
        c.drawString(50, y, para[:100])
        y -= 12
        if y < 100:
            c.showPage()
            y = h - 50
    y -= 10
    c.setFont("Helvetica-Bold", 9)
    c.drawString(50, y, "Savollar:")
    y -= 14
    c.setFont("Helvetica", 8)
    for r in rows[:40]:
        txt = f"{r.get('index')}. {str(r.get('text',''))[:60]}... — {'✓' if r.get('isCorrect') else '✗'}"
        c.drawString(50, y, txt[:100])
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
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    try:
        import qrcode
        from reportlab.lib.utils import ImageReader

        qr = qrcode.QRCode(version=1, box_size=3, border=1)
        qr.add_data(verify_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        qbuf = BytesIO()
        img.save(qbuf, format="PNG")
        qbuf.seek(0)
        c.drawImage(ImageReader(qbuf), w - 120, h - 120, width=90, height=90)
    except Exception:
        pass

    # Simple official-looking header + emblem placeholder
    c.circle(70, h - 72, 24, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(70, h - 75, "FJSTI")
    c.setFont("Helvetica-Bold", 14)
    c.drawString(110, h - 52, "Farg'ona jamoat salomatligi tibbiyot instituti")
    c.setFont("Helvetica-Bold", 12)
    c.drawString(110, h - 70, "Rasmiy intizomiy bayonnoma (BAN hisobot)")
    c.setFont("Helvetica", 9)
    c.drawString(110, h - 86, "Hujjat raqamli QR orqali tekshiriladi")

    y = h - 120
    c.setFont("Helvetica", 10)
    lines = [
        f"Talaba ID: {student_id}",
        f"Talaba F.I.Sh.: {student_name}",
        f"Imtihon: {exam_title}",
        f"Berilgan sana: {issued_at}",
        f"QR tekshiruv havolasi: {verify_url[:95]}",
    ]
    for line in lines:
        c.drawString(50, y, line)
        y -= 14

    y -= 6
    c.setFont("Helvetica-Bold", 10)
    c.drawString(50, y, "Qayd etilgan qoidabuzarliklar:")
    y -= 14
    c.setFont("Helvetica", 9)
    if not violations:
        c.drawString(50, y, "- Qoidabuzarlik loglari topilmadi.")
        y -= 12
    else:
        for idx, v in enumerate(violations[:60], start=1):
            t = str(v.get("timestamp") or "")[:25]
            vt = str(v.get("violation_type") or "UNKNOWN")[:60]
            c.drawString(50, y, f"{idx}) [{t}] {vt}")
            y -= 11
            if y < 60:
                c.showPage()
                y = h - 50
                c.setFont("Helvetica", 9)

    y -= 8
    c.setFont("Helvetica", 9)
    c.drawString(50, y, "Ushbu hujjat instituting ichki nazorat siyosati asosida avtomatik shakllantirildi.")
    y -= 12
    c.drawString(50, y, "Mas'ul shaxs imzosi: ____________________")
    c.showPage()
    c.save()
    return buf.getvalue()
