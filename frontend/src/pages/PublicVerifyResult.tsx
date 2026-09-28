import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ExamResultSummary, type ExamResultPayload } from '../components/ExamResultSummary';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { translations, Language } from '../i18n';

const SUPPORTED_LANGS: Language[] = ['uz', 'ru', 'en'];

export function PublicVerifyResult() {
  const { resultId } = useParams<{ resultId: string }>();
  const [searchParams] = useSearchParams();
  const k = searchParams.get('k') || '';
  const [data, setData] = useState<ExamResultPayload | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Language>(() => {
    try {
      const raw = (localStorage.getItem('lang') || 'uz').trim() as Language;
      return SUPPORTED_LANGS.includes(raw) ? raw : 'uz';
    } catch {
      return 'uz';
    }
  });

  const t = translations[lang];

  useEffect(() => {
    try {
      localStorage.setItem('lang', lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tr = translations[lang];
      if (!resultId || !k) {
        setErr(tr.verifyResultIncompleteLink);
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(
          apiUrl(`/api/public/verify-result/${encodeURIComponent(resultId)}?k=${encodeURIComponent(k)}`),
        );
        const json = await readJsonSafe<{
          error?: string;
          result_public_id?: string;
          overview?: string;
          questions?: any[];
          score?: number;
          total?: number;
          integrity_code?: string;
          percentage?: number;
          pass_threshold?: number;
          completed_at?: string;
          exam_title?: string;
          student_name?: string;
          student_group?: string;
        }>(res);
        if (!res.ok) {
          if (!cancelled) setErr(json?.error || tr.verifyResultNotFoundTitle);
          return;
        }
        if (!json?.result_public_id) {
          if (!cancelled) setErr(tr.verifyResultBadResponse);
          return;
        }
        if (!cancelled) {
          setData({
            result_public_id: json.result_public_id,
            verify_url: `${window.location.origin}/verify/result/${encodeURIComponent(json.result_public_id)}?k=${encodeURIComponent(k)}`,
            overview: json.overview ?? '',
            questions: json.questions ?? [],
            score: json.score ?? 0,
            total: json.total ?? 0,
            integrity_code: json.integrity_code ?? '',
            percentage: json.percentage ?? 0,
            pass_threshold: json.pass_threshold,
            completed_at: json.completed_at ?? '',
            exam_title: json.exam_title ?? '',
            student_name: json.student_name ?? '',
            student_group: json.student_group ?? '',
          });
        }
      } catch {
        if (!cancelled) setErr(tr.verifyResultNetworkError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resultId, k, lang]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 gap-4">
        <div className="flex items-center h-9 rounded-lg bg-white/80 p-0.5 shadow-sm">
          {SUPPORTED_LANGS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`h-full px-3 rounded-md text-xs font-semibold transition-colors ${
                lang === l ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {l === 'uz' ? "O'z" : l === 'ru' ? 'Ру' : 'En'}
            </button>
          ))}
        </div>
        <p className="text-slate-600 font-medium">{t.verifyResultLoading}</p>
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-100 to-slate-200 gap-4">
        <div className="flex items-center h-9 rounded-lg bg-white/80 p-0.5 shadow-sm">
          {SUPPORTED_LANGS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`h-full px-3 rounded-md text-xs font-semibold transition-colors ${
                lang === l ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {l === 'uz' ? "O'z" : l === 'ru' ? 'Ру' : 'En'}
            </button>
          ))}
        </div>
        <div className="max-w-md text-center rounded-2xl bg-white shadow-lg border border-slate-200 p-8">
          <h1 className="text-xl font-bold text-slate-900 mb-2">{t.verifyResultNotFoundTitle}</h1>
          <p className="text-slate-600 text-sm">{err || t.verifyResultInvalidLink}</p>
        </div>
      </div>
    );
  }

  const pdfUrl =
    resultId && k
      ? apiUrl(`/api/public/verify-result/${encodeURIComponent(resultId)}/certificate.pdf?k=${encodeURIComponent(k)}`)
      : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-emerald-50/40 py-4 sm:py-8 px-2 sm:px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="flex justify-end max-w-3xl mx-auto mb-3 px-1">
        <div className="flex items-center h-9 rounded-lg bg-white/90 border border-gray-200 p-0.5 shadow-sm">
          {SUPPORTED_LANGS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`h-full px-3 rounded-md text-xs font-semibold transition-colors ${
                lang === l ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {l === 'uz' ? "O'z" : l === 'ru' ? 'Ру' : 'En'}
            </button>
          ))}
        </div>
      </div>
      <ExamResultSummary data={data} publicPdfUrl={pdfUrl} lang={lang} />
    </div>
  );
}
