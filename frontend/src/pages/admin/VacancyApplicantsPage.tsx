import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { AdminBtn, AdminEmpty, AdminInput, AdminSelect } from './ui';

/**
 * Vakansiyaga ro'yxatdan o'tgan nomzodlar — HR uchun.
 *
 * Ilgari nomzodlar faqat bazada bor edi: kim ro'yxatdan o'tgani, telefoni va
 * testni topshirdimi — admin panelda ko'rinmasdi. Bu sahifa shuni to'ldiradi.
 */

interface Attempt {
  student_exam_id: number;
  subject: string;
  status: string;
  score: number | null;
  total: number;
  percent: number | null;
  passed: boolean;
  completed_at: string | null;
}

interface Applicant {
  id: string;
  name: string;
  phone: string;
  kafedra_id: number | null;
  kafedra_name: string;
  status: string;
  registered_at: string | null;
  has_photo: boolean;
  attempt: Attempt | null;
}

interface Payload {
  pass_threshold: number;
  total: number;
  completed: number;
  passed: number;
  not_started: number;
  applicants: Applicant[];
}

const TXT: Record<string, Record<string, string>> = {
  uz: {
    title: 'Vakansiya nomzodlari', search: 'Ism, pasport yoki telefon boyicha qidirish...',
    all: 'Barcha kafedralar', total: 'Royxatdan otgan', completed: 'Test topshirgan',
    passed: 'Otdi', notStarted: 'Topshirmagan', name: 'F.I.Sh.', passport: 'Pasport (login)',
    phone: 'Telefon', kafedra: 'Ish orni', reg: 'Royxatdan otgan', subject: 'Fan',
    result: 'Natija', notTaken: 'topshirmagan', inProgress: 'topshirmoqda',
    pass: 'otdi', fail: 'otmadi', empty: 'Hali hech kim royxatdan otmagan.',
    download: 'Excelga yuklash', refresh: 'Yangilash', retake: 'Qayta imkon',
    resetPw: 'Parolni tiklash', newPw: 'Yangi parol',
    retakeDone: 'Berildi', noPhoto: 'rasmsiz',
    editScore: 'Ballni tahrirlash', newScore: 'Yangi ball',
    saveScore: 'Saqlash', cancelScore: 'Bekor qilish',
    scoreSaved: 'Ball yangilandi', cert: 'Sertifikat', certBusy: 'Yuklanmoqda…',
    statusAll: 'Barcha holatlar', statusDone: 'Topshirganlar', statusNot: 'Topshirmaganlar',
    statusFail: 'Ota olmaganlar',
  },
  ru: {
    title: 'Kandidaty na vakansiyu', search: 'Poisk po FIO, pasportu ili telefonu...',
    all: 'Vse kafedry', total: 'Zaregistrirovano', completed: 'Sdali test',
    passed: 'Proshli', notStarted: 'Ne sdavali', name: 'FIO', passport: 'Pasport (login)',
    phone: 'Telefon', kafedra: 'Vakansiya', reg: 'Registratsiya', subject: 'Predmet',
    result: 'Rezultat', notTaken: 'ne sdaval', inProgress: 'sdayet',
    pass: 'proshel', fail: 'ne proshel', empty: 'Poka net kandidatov.',
    download: 'Skachat v Excel', refresh: 'Obnovit', retake: 'Peresdacha',
    resetPw: 'Sbros parolya', newPw: 'Novyy parol',
    retakeDone: 'Razresheno', noPhoto: 'bez foto',
    editScore: 'Izmenit ball', newScore: 'Novyy ball',
    saveScore: 'Sohranit', cancelScore: 'Otmena',
    scoreSaved: 'Ball obnovlen', cert: 'Sertifikat', certBusy: 'Zagruzka…',
    statusAll: 'Vse statusy', statusDone: 'Sdavshie', statusNot: 'Ne sdavshie',
    statusFail: 'Ne proshedshie',
  },
  en: {
    title: 'Vacancy applicants', search: 'Search by name, passport or phone...',
    all: 'All departments', total: 'Registered', completed: 'Took the test',
    passed: 'Passed', notStarted: 'Not taken', name: 'Name', passport: 'Passport (login)',
    phone: 'Phone', kafedra: 'Position', reg: 'Registered', subject: 'Subject',
    result: 'Result', notTaken: 'not taken', inProgress: 'in progress',
    pass: 'passed', fail: 'failed', empty: 'No applicants yet.',
    download: 'Download for Excel', refresh: 'Refresh', retake: 'Allow retake',
    resetPw: 'Reset password', newPw: 'New password',
    retakeDone: 'Allowed', noPhoto: 'no photo',
    editScore: 'Edit score', newScore: 'New score',
    saveScore: 'Save', cancelScore: 'Cancel',
    scoreSaved: 'Score updated', cert: 'Certificate', certBusy: 'Downloading…',
    statusAll: 'All statuses', statusDone: 'Took the test', statusNot: 'Not taken',
    statusFail: 'Did not pass',
  },
};

function tr(lang: string) {
  return TXT[lang] || TXT.uz;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export function VacancyApplicantsPage({ token, lang }: { token: string; lang: Language }) {
  const t = tr(lang);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [kafedra, setKafedra] = useState('');
  const [statusF, setStatusF] = useState('');
  const [retaken, setRetaken] = useState<Record<number, boolean>>({});
  /* Ballni qo'lda tuzatish — apellyatsiya yoki savol xatosi holatlari uchun.
     Faqat admin ko'radi, har o'zgarish audit jurnaliga yoziladi. */
  const [editSe, setEditSe] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [certBusy, setCertBusy] = useState<number | null>(null);
  // Parol tiklangach yangi parol BIR MARTA ko'rsatiladi — HR uni yetkazadi.
  const [newPw, setNewPw] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/admin/vacancy/applicants'), {
        headers: authHeaders(token, lang),
      });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<Payload>(res);
      setData(j && Array.isArray(j.applicants) ? j : null);
    } finally {
      setLoading(false);
    }
  }, [token, lang]);

  useEffect(() => {
    load();
  }, [load]);

  /** Nomzod sertifikatini PDF qilib yuklab olish (faqat admin). */
  const downloadCert = async (seId: number, name: string) => {
    setCertBusy(seId);
    try {
      const res = await fetch(
        apiUrl('/api/admin/student_exams/' + seId + '/certificate.pdf'),
        { headers: authHeaders(token, lang) },
      );
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) {
        window.alert(res.status === 409 ? 'Test hali yakunlanmagan' : 'Xatolik');
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = (name || 'sertifikat').replace(/[^\w\-]+/g, '_') + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } finally {
      setCertBusy(null);
    }
  };

  const saveScore = async (seId: number) => {
    const v = Number(editVal);
    if (!Number.isFinite(v) || v < 0) return;
    setEditBusy(true);
    try {
      const res = await fetch(apiUrl('/api/admin/student_exams/' + seId + '/score'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token, lang) },
        body: JSON.stringify({ score: v }),
      });
      if (!checkAdminAuthResponse(res)) return;
      const j = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        window.alert(j?.error ?? 'Xatolik');
        return;
      }
      setEditSe(null);
      setEditVal('');
      load();
    } finally {
      setEditBusy(false);
    }
  };

  const allowRetake = async (seId: number) => {
    const res = await fetch(apiUrl('/api/admin/student_exams/' + seId + '/retake'), {
      method: 'POST',
      headers: authHeaders(token, lang),
    });
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) setRetaken((m) => ({ ...m, [seId]: true }));
  };

  const resetPassword = async (id: string) => {
    const res = await fetch(
      apiUrl('/api/admin/vacancy/applicants/' + encodeURIComponent(id) + '/reset-password'),
      { method: 'POST', headers: authHeaders(token, lang) },
    );
    if (!checkAdminAuthResponse(res) || !res.ok) return;
    const d = await readJsonSafe<{ password?: string }>(res);
    if (d?.password) setNewPw((m) => ({ ...m, [id]: d.password as string }));
  };

  const kafedras = useMemo(() => {
    const m = new Map<string, string>();
    (data?.applicants || []).forEach((a) => {
      if (a.kafedra_name) m.set(String(a.kafedra_id), a.kafedra_name);
    });
    return Array.from(m.entries()).sort((x, y) => x[1].localeCompare(y[1]));
  }, [data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.applicants || []).filter((a) => {
      if (kafedra && String(a.kafedra_id) !== kafedra) return false;
      if (statusF === 'done' && !(a.attempt && a.attempt.status === 'Completed')) return false;
      if (statusF === 'not' && a.attempt) return false;
      if (statusF === 'fail' && !(a.attempt && a.attempt.status === 'Completed' && !a.attempt.passed)) {
        return false;
      }
      if (!needle) return true;
      return (
        a.name.toLowerCase().includes(needle) ||
        a.id.toLowerCase().includes(needle) ||
        a.phone.toLowerCase().includes(needle)
      );
    });
  }, [data, q, kafedra, statusF]);

  const exportCsv = () => {
    downloadCsv('vakansiya-nomzodlar-' + new Date().toISOString().slice(0, 10) + '.csv', [
      [t.name, t.passport, t.phone, t.kafedra, t.reg, t.subject, t.result],
      ...rows.map((a) => [
        a.name,
        a.id,
        a.phone,
        a.kafedra_name,
        fmtDate(a.registered_at),
        a.attempt?.subject || '',
        !a.attempt
          ? t.notTaken
          : a.attempt.status !== 'Completed'
            ? t.inProgress
            : a.attempt.score + '/' + a.attempt.total + ' (' + a.attempt.percent + '%) ' +
              (a.attempt.passed ? t.pass : t.fail),
      ]),
    ]);
  };

  const Stat = ({ label, value, tone }: { label: string; value: number; tone?: string }) => (
    <div className="bg-gray-50 rounded-xl px-4 py-3">
      <div className="text-[12px] text-gray-500">{label}</div>
      <div className={'text-xl font-semibold ' + (tone || 'text-gray-900')}>{value}</div>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-lg font-semibold text-gray-900 grow">{t.title}</div>
          <AdminBtn variant="ghost" size="sm" onClick={() => load()}>{t.refresh}</AdminBtn>
          <AdminBtn variant="violet" size="sm" onClick={exportCsv} disabled={!rows.length}>
            {t.download}
          </AdminBtn>
        </div>

        {data ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={t.total} value={data.total} />
            <Stat label={t.completed} value={data.completed} />
            <Stat label={t.passed} value={data.passed} tone="text-emerald-700" />
            <Stat label={t.notStarted} value={data.not_started} tone="text-gray-500" />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <div className="grow min-w-[220px]">
            <AdminInput placeholder={t.search} value={q} onChange={(e: any) => setQ(e.target.value)} />
          </div>
          <AdminSelect value={kafedra} onChange={(e: any) => setKafedra(e.target.value)}>
            <option value="">{t.all}</option>
            {kafedras.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </AdminSelect>
          <AdminSelect value={statusF} onChange={(e: any) => setStatusF(e.target.value)}>
            <option value="">{t.statusAll}</option>
            <option value="done">{t.statusDone}</option>
            <option value="not">{t.statusNot}</option>
            <option value="fail">{t.statusFail}</option>
          </AdminSelect>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-500">…</div>
      ) : !rows.length ? (
        <AdminEmpty title={t.empty} />
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-[12px] border-b border-gray-100">
                <th className="py-2 pl-4 pr-2">#</th>
                <th className="py-2 pr-2">{t.name}</th>
                <th className="py-2 pr-2">{t.phone}</th>
                <th className="py-2 pr-2">{t.kafedra}</th>
                <th className="py-2 pr-2">{t.reg}</th>
                <th className="py-2 pr-2">{t.result}</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => {
                const at = a.attempt;
                return (
                  <tr key={a.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pl-4 pr-2 text-gray-400">{i + 1}</td>
                    <td className="py-2 pr-2">
                      <div className="text-gray-900">{a.name}</div>
                      <div className="font-mono text-[11px] text-gray-400">
                        {a.id}
                        {!a.has_photo ? <span className="ml-2 text-amber-600">{t.noPhoto}</span> : null}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-gray-700 whitespace-nowrap">{a.phone || '—'}</td>
                    <td className="py-2 pr-2 text-gray-600">
                      <div>{a.kafedra_name || '—'}</div>
                      {at?.subject ? (
                        <div className="text-[11.5px] text-gray-400">{at.subject}</div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2 text-[12px] text-gray-500 whitespace-nowrap">
                      {fmtDate(a.registered_at)}
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {!at ? (
                        <span className="text-[12px] text-gray-400">{t.notTaken}</span>
                      ) : at.status !== 'Completed' ? (
                        <span className="text-[12px] text-blue-600">{t.inProgress}</span>
                      ) : editSe === at.student_exam_id ? (
                        /* Ballni qo'lda tuzatish. Foiz va "o'tdi/o'tmadi"
                           serverda ballga qarab qayta hisoblanadi. */
                        <span className="inline-flex items-center gap-1.5">
                          <AdminInput
                            value={editVal}
                            onChange={(e) => setEditVal(e.target.value.replace(/\D/g, ''))}
                            placeholder={t.newScore}
                            className="h-8 w-16 text-[13px] text-center"
                            autoFocus
                          />
                          <span className="text-[12px] text-gray-400">/ {at.total}</span>
                          <AdminBtn
                            variant="emerald"
                            size="sm"
                            loading={editBusy}
                            onClick={() => saveScore(at.student_exam_id)}
                          >
                            {t.saveScore}
                          </AdminBtn>
                          <AdminBtn variant="ghost" size="sm" onClick={() => setEditSe(null)}>
                            {t.cancelScore}
                          </AdminBtn>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-gray-700">{at.score}/{at.total}</span>
                          <span className={'font-semibold ' + (at.passed ? 'text-emerald-700' : 'text-red-600')}>
                            {at.percent}%
                          </span>
                          <span
                            className={
                              'text-[11.5px] px-2 py-0.5 rounded-full ' +
                              (at.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')
                            }
                          >
                            {at.passed ? t.pass : t.fail}
                          </span>
                          <button
                            type="button"
                            title={t.editScore}
                            onClick={() => {
                              setEditSe(at.student_exam_id);
                              setEditVal(String(at.score ?? ''));
                            }}
                            className="text-gray-400 hover:text-indigo-600 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      {newPw[a.id] ? (
                        <span className="mr-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[12px] text-amber-800 ring-1 ring-amber-200">
                          {t.newPw}: <b className="font-mono">{newPw[a.id]}</b>
                        </span>
                      ) : (
                        <AdminBtn variant="ghost" size="sm" onClick={() => resetPassword(a.id)}>
                          {t.resetPw}
                        </AdminBtn>
                      )}
                      {/* Imkoniyat bitta. Admin xohlagan nomzodga — o'tgan-
                          o'tmaganidan qat'i nazar — qayta imkon bera oladi;
                          shunda unga YANGI savollar bilan test qayta chiqadi. */}
                      {at && at.status === 'Completed' ? (
                        <>
                          <AdminBtn
                            variant="ghost"
                            size="sm"
                            loading={certBusy === at.student_exam_id}
                            onClick={() => downloadCert(at.student_exam_id, a.name)}
                          >
                            {certBusy === at.student_exam_id ? t.certBusy : t.cert}
                          </AdminBtn>
                          {retaken[at.student_exam_id] ? (
                            <span className="text-[12px] text-gray-400">{t.retakeDone}</span>
                          ) : (
                            <AdminBtn variant="ghost" size="sm" onClick={() => allowRetake(at.student_exam_id)}>
                              {t.retake}
                            </AdminBtn>
                          )}
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
