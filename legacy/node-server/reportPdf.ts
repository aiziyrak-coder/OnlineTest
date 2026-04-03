import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import fs from 'fs';

type PdfDoc = InstanceType<typeof PDFDocument>;

export type CertificateQuestionRow = {
  index: number;
  text: string;
  isCorrect: boolean;
  studentAnswer: string;
  correctAnswer: string;
  commentCorrect: string;
  whyStudentWrong: string;
  whyCorrectIsRight: string;
};

export type CertificateInput = {
  resultId: string;
  studentName: string;
  examTitle: string;
  completedAtIso: string;
  score: number;
  total: number;
  verifyUrl: string;
  integrityCode: string;
  overview: string;
  rows: CertificateQuestionRow[];
  logoPath: string | null;
};

function drawPageBackground(doc: PdfDoc) {
  doc.save();
  doc.lineWidth(0.35);
  doc.strokeColor('#94a3b8');
  doc.opacity(0.12);
  for (let i = -120; i < 700; i += 28) {
    doc.moveTo(i, 0).lineTo(i + 900, 900).stroke();
  }
  doc.opacity(0.06);
  doc.fillColor('#1e3a5f');
  doc.fontSize(52);
  for (let y = 40; y < 820; y += 140) {
    for (let x = -80; x < 650; x += 180) {
      doc.save();
      doc.translate(x, y);
      doc.rotate(-32);
      doc.text('FJSTI', 0, 0, { width: 200, align: 'center' });
      doc.restore();
    }
  }
  doc.restore();
}

function drawLogoMuted(doc: PdfDoc, logoPath: string | null, x: number, y: number, w: number) {
  if (!logoPath || !fs.existsSync(logoPath)) return;
  try {
    doc.save();
    doc.opacity(0.35);
    doc.image(logoPath, x, y, { width: w });
    doc.restore();
  } catch {
    /* ignore */
  }
}

export async function buildResultCertificatePdf(input: CertificateInput): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: 'FJSTI test natijasi', Author: 'Fjsti Online Exam' } });
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const qrBuf = await QRCode.toBuffer(input.verifyUrl, { type: 'png', margin: 1, width: 132, errorCorrectionLevel: 'M' });

  const writeHeaderBlock = () => {
    drawPageBackground(doc);
    const logoW = 56;
    drawLogoMuted(doc, input.logoPath, doc.page.margins.left, 42, logoW);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text("FARG'ONA JAMOAT SALOMATLIGI TIBBIYOT INSTITUTI", doc.page.margins.left + logoW + 12, 46, {
      width: 380,
    });
    doc.font('Helvetica').fontSize(8.5).fillColor('#475569').text('Fjsti Online Exam · rasmiy test natijasi guvohnomasi', doc.page.margins.left + logoW + 12, 64, { width: 380 });

    doc.image(qrBuf, doc.page.width - doc.page.margins.right - 132, 40, { width: 88, height: 88 });
    doc.font('Helvetica').fontSize(7).fillColor('#64748b').text('Tekshirish (QR)', doc.page.width - doc.page.margins.right - 132, 130, { width: 88, align: 'center' });

    doc.moveTo(doc.page.margins.left, 152).lineTo(doc.page.width - doc.page.margins.right, 152).strokeColor('#cbd5e1').lineWidth(0.8).stroke();

    doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a').text('TEST NATIJASI / GUVOHNOMA', doc.page.margins.left, 168, { align: 'center', width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e40af').text(`ID: ${input.resultId}`, doc.page.margins.left, 192, { align: 'center', width: doc.page.width - doc.page.margins.left - doc.page.margins.right });

    doc.font('Helvetica').fontSize(9).fillColor('#334155');
    const y0 = 218;
    doc.text(`Talaba: ${input.studentName}`, doc.page.margins.left, y0);
    doc.text(`Imtihon: ${input.examTitle}`, doc.page.margins.left, y0 + 14);
    doc.text(`Tugatilgan: ${new Date(input.completedAtIso).toLocaleString('uz-UZ')}`, doc.page.margins.left, y0 + 28);
    doc.font('Helvetica-Bold').text(`Ball: ${input.score} / ${input.total}`, doc.page.margins.left, y0 + 42);
    doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(`Yaxlitlik kodi: ${input.integrityCode}`, doc.page.margins.left, y0 + 58);

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text("Sun'iy intellekt xulosasi (qisqa):", doc.page.margins.left, y0 + 78, { width: doc.page.width - 100 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#334155').text(input.overview || '—', doc.page.margins.left, y0 + 92, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: 'justify',
    });
  };

  writeHeaderBlock();
  let y = 330;

  const pageBottom = doc.page.height - doc.page.margins.bottom;
  const addPage = () => {
    doc.addPage();
    drawPageBackground(doc);
    drawLogoMuted(doc, input.logoPath, doc.page.width - doc.page.margins.right - 48, 36, 40);
    y = doc.page.margins.top;
  };

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('Savollar bo‘yicha tahlil:', doc.page.margins.left, y);
  y += 16;

  for (const row of input.rows) {
    const blockH = 28 + (row.text.length > 120 ? 36 : 22) + (row.isCorrect ? 16 : 52);
    if (y + blockH > pageBottom) addPage();

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(row.isCorrect ? '#166534' : '#991b1b').text(`Savol ${row.index}${row.isCorrect ? ' — to‘g‘ri' : ' — noto‘g‘ri'}`, doc.page.margins.left, y);
    y += 12;
    doc.font('Helvetica').fontSize(8).fillColor('#1e293b').text(row.text, doc.page.margins.left, y, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
    y += row.text.length > 120 ? 36 : 22;
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text(`Talaba javobi: ${row.studentAnswer || '—'}`, doc.page.margins.left, y);
    y += 11;
    if (!row.isCorrect) {
      doc.fillColor('#64748b').text(`To‘g‘ri javob: ${row.correctAnswer}`, doc.page.margins.left, y);
      y += 11;
    }
    if (row.isCorrect && row.commentCorrect) {
      doc.fillColor('#166534').text(row.commentCorrect, doc.page.margins.left, y, { width: doc.page.width - 100 });
      y += 22;
    } else if (!row.isCorrect) {
      doc.fillColor('#991b1b').text(`Nima uchun xato: ${row.whyStudentWrong || '—'}`, doc.page.margins.left, y, { width: doc.page.width - 100 });
      y += 22;
      doc.fillColor('#166534').text(`To‘g‘ri javobning tushuntirishi: ${row.whyCorrectIsRight || '—'}`, doc.page.margins.left, y, { width: doc.page.width - 100 });
      y += 28;
    } else {
      y += 6;
    }
    doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor('#e2e8f0').opacity(0.9).stroke();
    doc.opacity(1);
    y += 10;
  }

  if (y + 40 > pageBottom) addPage();
  doc.font('Helvetica-Oblique').fontSize(7).fillColor('#94a3b').text(
    "Ushbu hujjat tizim tomonidan shakllantirilgan. QR-kod orqali onlayn tekshirish mumkin. Sohtalashtirish qonuniy javobgarlik tug‘diradi.",
    doc.page.margins.left,
    pageBottom - 28,
    { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' },
  );

  doc.end();
  return done;
}
