import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { motion } from 'motion/react';
import { Button } from './ui';
import { InstituteLogo } from './InstituteLogo';
import { apiUrl } from '../lib/apiUrl';
import { translations, Language } from '../i18n';
import { cleanQuestionPrompt } from '../lib/examQuestionUtils';

/** iMentor API bergan manba (kitob/maqola). Izohda [1][2] bilan ishora qilinadi. */
export type ResultReference = {
  title?: string;
  url?: string;
  /** Darslik betlari ("643" yoki "114-118, 220") — kitob manbalarida. */
  pages?: string;
  authors?: string;
  publisher?: string;
  year?: string;
};

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
  /** "api" | "ai" | "fallback" — tushuntirish manbasi */
  explanationSource?: string;
  /** Manbalar ro'yxati — tartibi izohdagi [1][2] raqamlariga mos. */
  references?: ResultReference[];
};

/**
 * Savol izohi ostidagi manbalar ro'yxati. Raqamlash izohdagi [1][2]
 * ishoralariga mos keladi — shuning uchun tartib o'zgartirilmaydi.
 */
function ReferenceList({ refs, label }: { refs?: ResultReference[]; label: string }) {
  const rows = (refs || []).filter((r) => r && (r.title || r.url));
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
        {label}
      </p>
      <ol className="space-y-1">
        {rows.map((r, i) => {
          const pages = r.pages ? `${r.pages}-bet` : '';
          const meta = [pages, r.authors, r.publisher, r.year].filter(Boolean).join(' · ');
          const title = r.title || r.url || '';
          return (
            <li key={`${title}-${i}`} className="text-xs text-slate-500 leading-relaxed flex gap-1.5">
              <span className="shrink-0 tabular-nums text-slate-400">[{i + 1}]</span>
              <span className="min-w-0">
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-indigo-600 hover:text-indigo-700 hover:underline break-words"
                  >
                    {title}
                  </a>
                ) : (
                  <span className="text-slate-600 break-words">{title}</span>
                )}
                {meta && <span className="text-slate-400"> — {meta}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export type ExamResultPayload = {
  exam_id?: number;
  result_public_id: string;
  verify_url: string;
  overview: string;
  questions: ResultQuestionRow[];
  questions_hidden?: boolean;
  questions_visible_from?: string | null;
  score: number;
  total: number;
  integrity_code: string;
  percentage?: number;
  pass_threshold?: number;
  passed?: boolean;
  completed_at?: string;
  exam_title?: string;
  student_name?: string;
  student_group?: string;
  /** "fallback" | "ai" — backend saqlangan tahlil manbasi */
  ai_summary_source?: string;
  /** true bo'lsa, haqiqiy AI tahlil hali hisoblanmoqda */
  ai_summary_pending?: boolean;
};

type Props = {
  data: ExamResultPayload;
  token?: string | null;
  lang?: Language;
  publicPdfUrl?: string | null;
  onBack?: () => void;
};

export function ExamResultSummary({ data, token, lang = 'uz', publicPdfUrl, onBack }: Props) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const t = translations[lang];

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      let url: string;
      const headers: HeadersInit = {};
      if (publicPdfUrl) {
        url = publicPdfUrl.startsWith('http') ? publicPdfUrl : publicPdfUrl;
        if (!url.includes('lang=')) {
          const sep = url.includes('?') ? '&' : '?';
          url = `${url}${sep}lang=${lang}`;
        }
      } else if (token && data.exam_id != null) {
        url = apiUrl(`/api/student/exams/${data.exam_id}/certificate.pdf`);
        headers.Authorization = `Bearer ${token}`;
        headers['X-Student-Lang'] = lang;
      } else {
        return;
      }
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error('PDF');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${data.result_public_id}.pdf`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      console.error(e);
      alert(t.resultPdfError);
    } finally {
      setPdfBusy(false);
    }
  };

  const pct = data.percentage ?? (data.total > 0 ? Math.round((data.score / data.total) * 100) : 0);
  const passThreshold = data.pass_threshold ?? 50;
  const passed = data.passed ?? pct >= passThreshold;
  const RES_L = {
    uz: { passed: 'O‘tdi', failed: 'O‘tmadi' },
    ru: { passed: 'Сдал', failed: 'Не сдал' },
    en: { passed: 'Passed', failed: 'Failed' },
  }[lang];

  // Ball halqasi (SVG) — r=16, aylana ≈ 100.53
  const ringDash = `${Math.max(0, Math.min(100, pct)) * 1.0053} 100.53`;
  const ringColor = passed ? '#059669' : '#dc2626';

  return (
    <div className="w-full max-w-6xl mx-auto min-h-0 px-2 sm:px-4 py-2 sm:py-4 space-y-4 sm:space-y-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60"
      >
        <div className={`h-2 w-full ${passed ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 'bg-gradient-to-r from-red-500 to-rose-400'}`} />
        <div className="p-5 sm:p-8 bg-gradient-to-br from-white via-white to-slate-50/80">
          {/*
            QR o'ngda balandroq — meta-blokni pastga emas, sarlavha ostiga qo'yamiz,
            aks holda o'rtada katta bo'sh joy ochiladi.
          */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-4 lg:gap-5 items-start">
            <div className="min-w-0">
              <div className="flex items-start gap-4 sm:gap-5">
                <InstituteLogo size="xl" className="shrink-0 shadow-lg ring-2 ring-white" />
                <div className="min-w-0 pt-1">
                  <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                    {t.instituteFullName}
                  </p>
                  <h1 className="text-2xl sm:text-[2rem] font-bold text-slate-900 tracking-tight mt-1.5 leading-tight">
                    {t.resultCertTitle}
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1.5">{t.resultCertHint}</p>
                </div>
              </div>

              {/* PDF sertifikatdagi ma'lumotlar bloki — sarlavha ostida */}
              <div className="mt-3 sm:mt-4 rounded-xl border border-sky-200/80 bg-sky-50/70 p-4 sm:p-5">
                <dl className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-x-4 gap-y-2.5 text-sm">
                  {[
                    { label: t.resultIdLabel, value: data.result_public_id },
                    { label: t.resultStudentLabel, value: data.student_name },
                    { label: t.resultGroupLabel, value: data.student_group },
                    { label: t.resultExamLabel, value: data.exam_title },
                    {
                      label: t.resultCompletedLabel,
                      value: data.completed_at
                        ? new Date(data.completed_at).toLocaleString()
                        : '',
                    },
                    { label: t.resultIntegrityLabel, value: data.integrity_code },
                    { label: t.resultVerifyUrlLabel, value: data.verify_url, mono: true, breakAll: true },
                  ]
                    .filter((row) => Boolean(row.value))
                    .map((row) => (
                      <React.Fragment key={row.label}>
                        <dt className="text-[12px] font-semibold text-slate-500 sm:pt-0.5">{row.label}</dt>
                        <dd
                          className={`text-slate-900 font-medium ${row.mono ? 'font-mono text-[12px] sm:text-[13px]' : ''} ${
                            row.breakAll ? 'break-all' : 'break-words'
                          }`}
                        >
                          {row.breakAll && data.verify_url === row.value ? (
                            <a
                              href={String(row.value)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-700 hover:underline"
                            >
                              {row.value}
                            </a>
                          ) : (
                            row.value
                          )}
                        </dd>
                      </React.Fragment>
                    ))}
                </dl>
              </div>
            </div>

            <div className="flex flex-col items-center gap-2.5 bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-sm shrink-0 mx-auto lg:mx-0">
              <QRCodeSVG value={data.verify_url} size={132} level="M" includeMargin={false} />
              <span className="text-[11px] font-medium text-slate-500 text-center">{t.resultQrVerifyLabel}</span>
            </div>
          </div>

          {/* Score focal */}
          <div className="mt-5 flex items-center gap-4 sm:gap-6 rounded-2xl border border-slate-200 bg-white/90 p-4 sm:p-6 shadow-inner">
            <div className="relative w-24 h-24 shrink-0">
              <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
                <circle cx="18" cy="18" r="16" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                <circle cx="18" cy="18" r="16" fill="none" stroke={ringColor} strokeWidth="3" strokeDasharray={ringDash} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-[22px] font-bold tabular-nums ${passed ? 'text-emerald-600' : 'text-red-600'}`}>{pct}%</span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide">{t.resultScore}</span>
                <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {passed ? RES_L.passed : RES_L.failed}
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums mt-1">
                {data.score} <span className="text-slate-400 font-semibold text-xl">/ {data.total}</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {t.passThresholdHint.replace('{n}', String(passThreshold))}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:gap-3">
            <Button className="w-full sm:w-auto" onClick={downloadPdf} disabled={pdfBusy}>
              {pdfBusy ? t.resultDownloading : t.resultDownloadPdf}
            </Button>
            {onBack && (
              <Button variant="outline" className="w-full sm:w-auto" onClick={onBack}>
                {t.studentDash}
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {data.ai_summary_pending && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 px-4 py-3 flex items-center gap-3">
          <span className="inline-block h-2 w-2 rounded-full bg-indigo-500 animate-pulse shrink-0" />
          <p className="text-sm font-medium text-indigo-800">{t.resultAiAnalyzing}</p>
        </div>
      )}

      {data.overview?.trim() && !data.ai_summary_pending && ['ai', 'api', 'mixed'].includes(data.ai_summary_source || '') && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
          <h2 className="text-[15px] font-bold text-slate-900 mb-2 flex items-center gap-2 flex-wrap">
            <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            </span>
            {/* Manba belgisi ("API manba" / "AI manba") olib tashlandi — talaba
                uchun ichki texnik tafsilot, hech narsa anglatmaydi. Haqiqiy
                manba pastdagi "Manbalar" bo'limida ko'rsatiladi. */}
          </h2>
          <p className="text-slate-700 leading-relaxed text-sm sm:text-[15px]">{data.overview}</p>
        </div>
      )}

      <div className="space-y-3">
        {data.questions_hidden ? (
          /* Attestatsiya/tanlov imtihoni: savollar va javoblar muddat tugagach. */
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-4 text-[14px] leading-relaxed text-indigo-900">
            {lang === 'ru'
              ? 'Вопросы и правильные ответы будут показаны после окончания срока экзамена'
              : lang === 'en'
                ? 'Questions and correct answers will be shown after the exam period ends'
                : "Savollar va to'g'ri javoblar imtihon muddati tugagach ko'rsatiladi"}
            {data.questions_visible_from &&
            new Date(data.questions_visible_from).getTime() - Date.now() < 30 * 86400000
              ? ' (' + new Date(data.questions_visible_from).toLocaleString() + ')'
              : ''}
            .
          </div>
        ) : (
          <h2 className="text-[16px] sm:text-[17px] font-bold text-slate-900 px-1">{t.resultByQuestions}</h2>
        )}
        {data.questions.map((q, i) => {
          const src = (q.explanationSource || '').toLowerCase();
          const hasExplain = Boolean(
            (q.isCorrect && q.commentCorrect) ||
              (!q.isCorrect && (q.whyStudentWrong || q.whyCorrectIsRight)),
          );
          return (
          <motion.div
            key={q.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            className={`rounded-xl border overflow-hidden bg-white ${q.isCorrect ? 'border-emerald-200' : 'border-red-200'}`}
          >
            <div className={`px-4 sm:px-5 py-3.5 border-b flex items-start gap-3 ${q.isCorrect ? 'bg-emerald-50/60 border-emerald-100' : 'bg-red-50/60 border-red-100'}`}>
              <span className={`shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-white ${q.isCorrect ? 'bg-emerald-500' : 'bg-red-500'}`}>
                {q.isCorrect ? (
                  <svg className="w-3.5 h-3.5 stroke-[3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="w-3.5 h-3.5 stroke-[3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                )}
              </span>
              <p className="text-sm sm:text-[15px] font-semibold text-slate-900 flex-1 leading-relaxed">
                <span className="text-slate-400 mr-1.5">{i + 1}.</span>
                {cleanQuestionPrompt(q.text)}
              </p>
              <div className="shrink-0 flex flex-col items-end gap-1">
                <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-md ${q.isCorrect ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {q.isCorrect ? t.resultCorrectBadge : t.resultWrongBadge}
                </span>
              </div>
            </div>
            <div className="px-4 sm:px-5 py-4 space-y-2 text-sm">
              <p className="text-slate-700">
                <span className="font-semibold text-slate-900">{t.resultYourAnswer}:</span>{' '}
                {q.studentAnswer || '—'}
              </p>
              {!q.isCorrect && (
                <p className="text-emerald-800 font-medium">
                  {t.resultCorrectAnswerLabel}: {q.correctAnswer}
                </p>
              )}
              {q.isCorrect && q.correctAnswer && (
                <p className="text-emerald-700 text-xs">
                  {t.resultCorrectAnswerLabel}: {q.correctAnswer}
                </p>
              )}
              {q.isCorrect && q.commentCorrect && (
                <p className="text-slate-600 leading-relaxed">{q.commentCorrect}</p>
              )}
              {!q.isCorrect && q.whyStudentWrong && (
                <p className="text-slate-600 leading-relaxed">
                  <span className="font-semibold text-slate-800">{t.resultWhyWrong}: </span>
                  {q.whyStudentWrong}
                </p>
              )}
              {!q.isCorrect && q.whyCorrectIsRight && (
                <p className="text-slate-600 leading-relaxed">
                  <span className="font-semibold text-slate-800">{t.resultWhyCorrectExplain}: </span>
                  {q.whyCorrectIsRight}
                </p>
              )}
              <ReferenceList refs={q.references} label={t.resultReferencesLabel} />
            </div>
          </motion.div>
          );
        })}
      </div>
    </div>
  );
}
