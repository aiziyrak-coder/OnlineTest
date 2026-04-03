import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { motion } from 'motion/react';
import { Button, Card, CardContent, CardHeader, CardTitle } from './ui';
import { InstituteLogo } from './InstituteLogo';
import { apiUrl } from '../lib/apiUrl';

export type ResultQuestionRow = {
  id: number;
  text: string;
  options?: string[];
  studentAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
  commentCorrect: string;
  whyStudentWrong: string;
  whyCorrectIsRight: string;
};

export type ExamResultPayload = {
  exam_id?: number;
  result_public_id: string;
  verify_url: string;
  overview: string;
  questions: ResultQuestionRow[];
  score: number;
  total: number;
  integrity_code: string;
  percentage?: number;
  completed_at?: string;
  exam_title?: string;
  student_name?: string;
};

type Props = {
  data: ExamResultPayload;
  token?: string | null;
  /** When set (public verify), PDF is fetched from this URL without auth */
  publicPdfUrl?: string | null;
  onBack?: () => void;
};

export function ExamResultSummary({ data, token, publicPdfUrl, onBack }: Props) {
  const [pdfBusy, setPdfBusy] = useState(false);

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      let url: string;
      const headers: HeadersInit = {};
      if (publicPdfUrl) {
        url = publicPdfUrl.startsWith('http') ? publicPdfUrl : publicPdfUrl;
      } else if (token && data.exam_id != null) {
        url = apiUrl(`/api/student/exams/${data.exam_id}/certificate.pdf`);
        headers.Authorization = `Bearer ${token}`;
      } else {
        return;
      }
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('PDF yuklab olinmadi');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${data.result_public_id}.pdf`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      console.error(e);
      alert('PDF yuklashda xatolik');
    } finally {
      setPdfBusy(false);
    }
  };

  const pct = data.percentage ?? (data.total > 0 ? Math.round((data.score / data.total) * 100) : 0);

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-slate-50 via-white to-emerald-50/30 shadow-[0_20px_60px_-15px_rgba(15,23,42,0.12)]"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 12px, #0f172a 12px, #0f172a 13px)`,
          }}
        />
        <div className="relative p-6 sm:p-10">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="opacity-90">
                <InstituteLogo size="md" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Farg‘ona jamoat salomatligi tibbiyot instituti
                </p>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mt-1">Test natijasi</h1>
                {data.exam_title && <p className="text-slate-600 mt-1 font-medium">{data.exam_title}</p>}
                {data.student_name && <p className="text-sm text-slate-500 mt-0.5">Talaba: {data.student_name}</p>}
              </div>
            </div>
            <div className="flex flex-col items-center gap-2 bg-white/80 backdrop-blur rounded-2xl p-4 border border-slate-200/60 shadow-sm">
              <QRCodeSVG value={data.verify_url} size={112} level="M" includeMargin={false} />
              <span className="text-[10px] text-slate-500 text-center max-w-[140px] leading-tight">Tekshirish uchun QR</span>
            </div>
          </div>

          <div className="mt-8 grid sm:grid-cols-3 gap-4">
            <div className="rounded-2xl bg-white/90 border border-slate-200/80 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Natija ID</p>
              <p className="text-lg font-bold text-indigo-900 font-mono mt-1 break-all">{data.result_public_id}</p>
            </div>
            <div className="rounded-2xl bg-white/90 border border-slate-200/80 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Ball</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {data.score} / {data.total}{' '}
                <span className="text-base font-semibold text-emerald-700">({pct}%)</span>
              </p>
            </div>
            <div className="rounded-2xl bg-white/90 border border-slate-200/80 p-4 shadow-sm">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Yaxlitlik kodi</p>
              <p className="text-sm font-mono font-semibold text-slate-800 mt-1 break-all">{data.integrity_code}</p>
            </div>
          </div>

          {data.completed_at && (
            <p className="text-xs text-slate-500 mt-4 text-center sm:text-left">
              Tugatilgan: {new Date(data.completed_at).toLocaleString()}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3 justify-center sm:justify-start">
            <Button className="rounded-full" onClick={downloadPdf} disabled={pdfBusy}>
              {pdfBusy ? 'Yuklanmoqda…' : 'PDF yuklab olish'}
            </Button>
            {onBack && (
              <Button variant="outline" className="rounded-full" onClick={onBack}>
                Dashboard
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      <Card className="border-slate-200/80 bg-white/70 backdrop-blur-xl shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg text-slate-800">Sun’iy intellekt xulosasi</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-slate-700 leading-relaxed text-sm sm:text-base">{data.overview}</p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-900 px-1">Savollar bo‘yicha</h2>
        {data.questions.map((q, i) => (
          <motion.div
            key={q.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
          >
            <Card
              className={`overflow-hidden border-2 backdrop-blur-xl ${
                q.isCorrect ? 'border-emerald-300/80 bg-emerald-50/40' : 'border-red-300/80 bg-red-50/35'
              }`}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-slate-900 flex items-start gap-2">
                  <span className="text-slate-400 font-normal shrink-0">{i + 1}.</span>
                  <span>{q.text}</span>
                  <span
                    className={`ml-auto shrink-0 text-xs font-bold uppercase px-2 py-0.5 rounded-full ${
                      q.isCorrect ? 'bg-emerald-200 text-emerald-900' : 'bg-red-200 text-red-900'
                    }`}
                  >
                    {q.isCorrect ? "To‘g‘ri" : "Noto‘g‘ri"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-slate-600">
                  <span className="font-medium text-slate-800">Sizning javobingiz:</span> {q.studentAnswer || '—'}
                </p>
                {!q.isCorrect && (
                  <p className="text-emerald-800 font-medium">
                    To‘g‘ri javob: {q.correctAnswer}
                  </p>
                )}
                {q.isCorrect && q.commentCorrect && (
                  <p className="text-emerald-900/90 leading-relaxed">{q.commentCorrect}</p>
                )}
                {!q.isCorrect && (
                  <>
                    {q.whyStudentWrong && (
                      <p className="text-red-900/90 leading-relaxed">
                        <span className="font-semibold">Nega xato: </span>
                        {q.whyStudentWrong}
                      </p>
                    )}
                    {q.whyCorrectIsRight && (
                      <p className="text-emerald-900/90 leading-relaxed">
                        <span className="font-semibold">To‘g‘ri variantning tushuntirishi: </span>
                        {q.whyCorrectIsRight}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
