import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ExamResultSummary, type ExamResultPayload } from '../components/ExamResultSummary';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';

export function PublicVerifyResult() {
  const { resultId } = useParams<{ resultId: string }>();
  const [searchParams] = useSearchParams();
  const k = searchParams.get('k') || '';
  const [data, setData] = useState<ExamResultPayload | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!resultId || !k) {
        setErr('Havola to‘liq emas (kalit yo‘q).');
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
          completed_at?: string;
          exam_title?: string;
          student_name?: string;
        }>(res);
        if (!res.ok) {
          if (!cancelled) setErr(json?.error || 'Topilmadi');
          return;
        }
        if (!json?.result_public_id) {
          if (!cancelled) setErr('Server javobi noto‘g‘ri formatda');
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
            completed_at: json.completed_at ?? '',
            exam_title: json.exam_title ?? '',
            student_name: json.student_name ?? '',
          });
        }
      } catch {
        if (!cancelled) setErr('Server bilan aloqa xatosi');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resultId, k]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
        <p className="text-slate-600 font-medium">Tekshirilmoqda…</p>
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-100 to-slate-200">
        <div className="max-w-md text-center rounded-2xl bg-white shadow-lg border border-slate-200 p-8">
          <h1 className="text-xl font-bold text-slate-900 mb-2">Natija topilmadi</h1>
          <p className="text-slate-600 text-sm">{err || 'Noto‘g‘ri havola'}</p>
        </div>
      </div>
    );
  }

  const pdfUrl =
    resultId && k
      ? `/api/public/verify-result/${encodeURIComponent(resultId)}/certificate.pdf?k=${encodeURIComponent(k)}`
      : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-emerald-50/40 py-8">
      <ExamResultSummary data={data} publicPdfUrl={pdfUrl} />
    </div>
  );
}
