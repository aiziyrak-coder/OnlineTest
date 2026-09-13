import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { AdminEmpty, AdminInput, AdminSelect, AdminBtn } from './ui';
import { AudienceReport, isTailoredAudience } from './AudienceReport';

interface Props { token: string; lang: Language; }

interface ExamRow {
  id: number;
  title: string;
  audience?: string;
  kafedra_id?: number | null;
  faculty_subject?: string;
  bank_question_count?: number;
  start_time?: string | null;
}

interface ResultRow {
  id: number;
  student_id: string;
  name: string;
  status: string;
  score: number | null;
  completed_at: string | null;
}

interface PersonRow {
  seId: number;
  studentId: string;
  name: string;
  kafedra: string;
  subject: string;
  score: number;
  total: number;
  percent: number;
  passed: boolean;
  date: string;
}

// Serverda hisoblangan kafedra statistikasi (/api/admin/reports/kafedra).
interface KafStatRow {
  kafedra_id: number;
  kafedra_name: string;
  total_teachers: number;
  participated: number;
  unfinished: number;
  not_participated: number;
  passed: number;
  failed: number;
  pass_percent: number;
  participation_percent: number;
}

// Test mavsumi: o'qituvchilar baholovi, ordinatorlar, talabalar semestri va
// ishga qabul testlari bir hisobotda aralashmasligi uchun.
interface PartPerson {
  student_exam_id: number;
  student_id: string;
  name: string;
  subject: string;
  score: number;
  total: number;
  percent: number;
  passed: boolean;
}
interface PartGroup {
  kafedra_id: number;
  kafedra_name: string;
  count: number;
  passed: number;
  failed: number;
  avg_percent: number;
  people: PartPerson[];
}
interface PartReport {
  total_people: number;
  total_passed: number;
  total_failed: number;
  pass_threshold: number;
  groups: PartGroup[];
}

interface Season { key: string; label: string; audience: string; exam_count: number; }

interface AbsentPerson { student_id: string; name: string; state: string; }
interface AbsentGroup {
  kafedra_id: number;
  kafedra_name: string;
  total_teachers: number;
  absent_count: number;
  people: AbsentPerson[];
}
interface AbsentReport { absent_total: number; kafedra_count: number; groups: AbsentGroup[]; }

interface KafStat {
  pass_threshold: number;
  totals: Omit<KafStatRow, "kafedra_id" | "kafedra_name"> & { kafedra_count: number };
  kafedralar: KafStatRow[];
  top: KafStatRow[];
  bottom: KafStatRow[];
}

interface KafedraRow {
  kafedra: string;
  count: number;
  avgPercent: number;
  passed: number;
  failed: number;
  best: number;
  worst: number;
}

const TXT: Record<string, Record<string, string>> = {
  uz: {
    title: 'Imtihonlar hisoboti', overall: 'Umumiy', byKafedra: 'Kafedralar', byPerson: 'Reyting',
    loading: 'Yuklanmoqda', empty: 'Hali topshirilgan imtihon yoq.', download: 'Excelga yuklash',
    threshold: 'Otish chegarasi', submitted: 'Topshirganlar', avg: 'Ortacha natija', passed: 'Otdi',
    failed: 'Otmadi', best: 'Eng yuqori', worst: 'Eng past', kafedra: 'Kafedra', subject: 'Fan',
    person: 'F.I.Sh.', score: 'Ball', percent: 'Foiz', status: 'Holat', date: 'Sana', count: 'Soni',
    passRate: 'Otish foizi', refresh: 'Yangilash', audience: 'Kim uchun', faculty: 'Oqituvchilar',
    student: 'Talabalar', rank: 'N',
    retake: 'Qayta ruxsat', retakeDone: 'Ruxsat berildi',
    retakeConfirm: 'Bu kishiga imtihonni qayta topshirishga ruxsat berilsinmi?',
    banned: 'Banlanganlar', unban: 'Banni ochish', unbanReason: 'Sabab (kamida 8 belgi)',
    unbanFile: 'Asos hujjati (rasm yoki PDF)', save: 'Saqlash', cancel: 'Bekor qilish',
    noBanned: 'Banlangan oqituvchi yoq.',
    inProgress: 'Hozir topshirmoqda',
    loadFail: 'ta imtihon natijasi yuklanmadi — sonlar toliq emas. Yangilang.',
    kafStat: 'Kafedra statistikasi', ranking: 'Reyting (10 ta)',
    totalTeachers: 'Kafedradagi jami', participated: 'Ishtirok etgan',
    notParticipated: 'Ishtirok etmagan', passedT: 'Testdan otgan',
    failedT: 'Ota olmagan', passPct: 'Otish %', coverage: 'Qamrov %',
    topK: 'Eng yuqori korsatkichli kafedralar', bottomK: 'Eng past korsatkichli kafedralar',
    statNote: 'Sonlar serverda hisoblanadi — har yangilashda bir xil chiqadi.',
    noStat: 'Hali hech kim topshirmagan.',
    downloadPdf: 'PDF hisobot', pdfBusy: 'Tayyorlanmoqda...',
    editScore: 'Ballni tahrirlash', saveScore: 'Saqlash', cancelScore: 'Bekor', scoreRange: 'Ball 0 dan jami savollar soniga qadar bolishi kerak.',
    unfinished: 'Boshlagan, yakunlamagan',
    absentTab: 'Qatnashmaganlar', absentTitle: 'Imtihonni topshirmaganlar',
    onlyActive: 'Faqat testni boshlagan kafedralar', allKaf: 'Barcha kafedralar',
    season: 'Test mavsumi',
    partTab: 'Qatnashganlar', avgShort: 'O‘rtacha', tookExam: 'topshirdi',
    fullPdf: 'To‘liq hisobot (PDF)',
    absentEmpty: "Topshirmagan odam yo'q.", absentSearch: "Ism yoki kafedra bo'yicha qidirish...",
    absentStarted: 'boshlagan, yakunlamagan', absentTotal: 'Jami topshirmagan',
    login: 'Login', absentOf: 'kafedradagi jamidan',
  },
  ru: {
    title: 'Otchet po ekzamenam', overall: 'Obshchiy', byKafedra: 'Kafedry', byPerson: 'Reyting',
    loading: 'Zagruzka', empty: 'Poka net sdannykh ekzamenov.', download: 'Skachat v Excel',
    threshold: 'Prokhodnoy ball', submitted: 'Sdali', avg: 'Sredniy rezultat', passed: 'Sdal',
    failed: 'Ne sdal', best: 'Luchshiy', worst: 'Khudshiy', kafedra: 'Kafedra', subject: 'Predmet',
    person: 'F.I.O.', score: 'Ball', percent: 'Protsent', status: 'Status', date: 'Data', count: 'Kol-vo',
    passRate: 'Protsent sdachi', refresh: 'Obnovit', audience: 'Dlya kogo', faculty: 'Prepodavateli',
    student: 'Studenty', rank: 'N',
    retake: 'Razreshit peresdachu', retakeDone: 'Razresheno',
    retakeConfirm: 'Razreshit povtornuyu sdachu ekzamena?',
    banned: 'Zablokirovannye', unban: 'Razblokirovat', unbanReason: 'Prichina (min 8 simvolov)',
    unbanFile: 'Dokument-osnovanie', save: 'Sokhranit', cancel: 'Otmena',
    noBanned: 'Net zablokirovannykh.',
    inProgress: 'Sdayut seychas',
    loadFail: 'ekzamenov ne zagruzilos — dannye nepolnye. Obnovite.',
    kafStat: 'Statistika kafedr', ranking: 'Reyting (10)',
    totalTeachers: 'Vsego na kafedre', participated: 'Uchastvovali',
    notParticipated: 'Ne uchastvovali', passedT: 'Sdali test',
    failedT: 'Ne sdali', passPct: 'Protsent sdachi', coverage: 'Okhvat %',
    topK: 'Luchshie kafedry', bottomK: 'Khudshie kafedry',
    statNote: 'Chisla schitayutsya na servere — odinakovye pri kazhdom obnovlenii.',
    noStat: 'Poka nikto ne sdaval.',
    downloadPdf: 'Otchet v PDF', pdfBusy: 'Formiruetsya...',
    editScore: 'Izmenit ball', saveScore: 'Sokhranit', cancelScore: 'Otmena', scoreRange: 'Ball dolzhen byt ot 0 do chisla voprosov.',
    unfinished: 'Nachal, ne zavershil',
    absentTab: 'Ne sdavshie', absentTitle: 'Ne sdavshie ekzamen',
    onlyActive: 'Tolko kafedry, gde sdavali', allKaf: 'Vse kafedry',
    season: 'Sezon testirovaniya',
    partTab: 'Sdavshie', avgShort: 'Sredniy', tookExam: 'sdali',
    fullPdf: 'Polnyy otchet (PDF)',
    absentEmpty: 'Net takikh.', absentSearch: 'Poisk po FIO ili kafedre...',
    absentStarted: 'nachal, ne zavershil', absentTotal: 'Vsego ne sdali',
    login: 'Login', absentOf: 'iz vsekh na kafedre',
  },
  en: {
    title: 'Exam report', overall: 'Summary', byKafedra: 'Departments', byPerson: 'Ranking',
    loading: 'Loading', empty: 'No completed exams yet.', download: 'Download for Excel',
    threshold: 'Pass mark', submitted: 'Submitted', avg: 'Average', passed: 'Passed',
    failed: 'Failed', best: 'Best', worst: 'Worst', kafedra: 'Department', subject: 'Subject',
    person: 'Name', score: 'Score', percent: 'Percent', status: 'Status', date: 'Date', count: 'Count',
    passRate: 'Pass rate', refresh: 'Refresh', audience: 'Audience', faculty: 'Teachers',
    student: 'Students', rank: 'N',
    retake: 'Allow retake', retakeDone: 'Allowed',
    retakeConfirm: 'Allow this person to retake the exam?',
    banned: 'Banned', unban: 'Unban', unbanReason: 'Reason (min 8 chars)',
    unbanFile: 'Evidence file', save: 'Save', cancel: 'Cancel',
    noBanned: 'No banned teachers.',
    inProgress: 'In progress',
    loadFail: 'exam results failed to load — numbers incomplete. Refresh.',
    kafStat: 'Department statistics', ranking: 'Ranking (10)',
    totalTeachers: 'Teachers total', participated: 'Participated',
    notParticipated: 'Did not participate', passedT: 'Passed the test',
    failedT: 'Did not pass', passPct: 'Pass %', coverage: 'Coverage %',
    topK: 'Top departments', bottomK: 'Lowest departments',
    statNote: 'Computed on the server — identical on every refresh.',
    noStat: 'Nobody has taken the test yet.',
    downloadPdf: 'PDF report', pdfBusy: 'Preparing...',
    editScore: 'Edit score', saveScore: 'Save', cancelScore: 'Cancel', scoreRange: 'Score must be between 0 and the number of questions.',
    unfinished: 'Started, not finished',
    absentTab: 'Did not take', absentTitle: 'Did not take the exam',
    onlyActive: 'Only departments that took part', allKaf: 'All departments',
    season: 'Test season',
    partTab: 'Participants', avgShort: 'Average', tookExam: 'took',
    fullPdf: 'Full report (PDF)',
    absentEmpty: 'Nobody is missing.', absentSearch: 'Search by name or department...',
    absentStarted: 'started, not finished', absentTotal: 'Total missing',
    login: 'Login', absentOf: 'of department total',
  },
};

function tr(lang: string) { return TXT[lang] || TXT.uz; }

// Excel UTF-8 ni faqat BOM bilan togri oqiydi; ajratgich ";" — ru/uz mahalliy
// sozlamalarida "," ustunlarga bolinmaydi.
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

const AUDIENCE_OPTIONS =
  ['faculty', 'ordinator', 'magistr', 'student', 'vacancy', 'entrant'] as const;

function audienceLabelFor(a: string, lang: string): string {
  const uz: Record<string, string> = {
    faculty: "O'qituvchilar", ordinator: 'Ordinatorlar', magistr: 'Magistrlar',
    student: 'Talabalar', vacancy: 'Ishga kiruvchilar',
    entrant: 'Maxsus kiruvchilar',
  };
  const ru: Record<string, string> = {
    faculty: 'Prepodavateli', ordinator: 'Ordinatory', magistr: 'Magistry',
    student: 'Studenty', vacancy: 'Kandidaty',
    entrant: 'Osobye postupayushchie',
  };
  const en: Record<string, string> = {
    faculty: 'Teachers', ordinator: 'Residents', magistr: 'Masters',
    student: 'Students', vacancy: 'Applicants',
    entrant: 'Special entrants',
  };
  const map = lang === 'ru' ? ru : lang === 'en' ? en : uz;
  return map[a] || a;
}

export function ReportsPage({ token, lang }: Props) {
  const t = tr(lang);
  const audienceLabel = (a: string) => audienceLabelFor(a, lang);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState('');
  /* Hisobot kim uchun. Ilgari faqat "faculty" va "student" bor edi -- yangi
     ordinator, magistr va vakansiya testlarining hisobotini umuman ochib
     bo'lmasdi. Endi ro'yxat mavsumlardan avtomatik to'ldiriladi. */
  const [audience, setAudience] = useState<string>('faculty');
  const [threshold, setThreshold] = useState(60);
  const [view, setView] = useState<'overall' | 'kafstat' | 'ranking' | 'part' | 'absent' | 'kafedra' | 'person' | 'banned'>('overall');
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [retaken, setRetaken] = useState<Record<number, boolean>>({});
  const [banned, setBanned] = useState<Array<{ id: string; name: string }>>([]);
  const [unbanFor, setUnbanFor] = useState<{ id: string; name: string } | null>(null);
  const [unbanReason, setUnbanReason] = useState('');
  const [unbanFile, setUnbanFile] = useState<File | null>(null);
  const [unbanErr, setUnbanErr] = useState('');
  const [failedExams, setFailedExams] = useState(0);
  const [inProgress, setInProgress] = useState(0);
  const [kafStat, setKafStat] = useState<KafStat | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [absent, setAbsent] = useState<AbsentReport | null>(null);
  const [absentQ, setAbsentQ] = useState('');
  // Standart: umuman hech kim topshirmagan kafedralar ko'rsatilmaydi.
  const [absentAll, setAbsentAll] = useState(false);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonKey, setSeasonKey] = useState('');
  const [part, setPart] = useState<PartReport | null>(null);
  // Ballni qo'lda tuzatish (faqat admin): apellyatsiya yoki savol xatosi holatlari.
  const [editId, setEditId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setPeople([]);
    const h = { headers: authHeaders(token, lang) };

    // Kafedra statistikasi bitta so'rovda serverdan keladi — ilgari u
    // brauzerda 50+ so'rovdan yig'ilardi va har safar boshqa son chiqardi.
    const snRes = await fetch(apiUrl('/api/admin/reports/seasons'), h);
    let sKey = seasonKey;
    if (snRes.ok) {
      const sj = await readJsonSafe<{ seasons?: Season[] }>(snRes);
      const list = Array.isArray(sj?.seasons) ? sj!.seasons : [];
      setSeasons(list);
      // Mavsum tanlangan toifaga tegishli bo'lsin: ilgari "Ordinatorlar"
      // tanlansa ham o'qituvchilar mavsumi ochilib turardi.
      const own = list.filter((x) => x.audience === audience);
      const pool = own.length ? own : list;
      if (!pool.some((x) => x.key === sKey)) {
        sKey = pool.length ? pool[0].key : '';
        setSeasonKey(sKey);
      }
    }
    // Ordinator / nomzod / maxsus kiruvchi hisoboti o'z komponentida
    // (AudienceReport) serverdan olinadi — kafedra hisobi ular uchun emas.
    if (isTailoredAudience(audience)) {
      setProgress('');
      setLoading(false);
      return;
    }
    const sq = sKey ? '?season=' + encodeURIComponent(sKey) : '';

    const partRes = await fetch(apiUrl('/api/admin/reports/participants' + sq), h);
    if (partRes.ok) {
      const pj = await readJsonSafe<PartReport>(partRes);
      setPart(pj && Array.isArray(pj.groups) ? pj : null);
    }

    const absRes = await fetch(
      apiUrl('/api/admin/reports/absent' + sq + (absentAll ? (sq ? '&' : '?') + 'all=1' : '')),
      h,
    );
    if (absRes.ok) {
      const aj = await readJsonSafe<AbsentReport>(absRes);
      setAbsent(aj && Array.isArray(aj.groups) ? aj : null);
    }

    const statRes = await fetch(apiUrl('/api/admin/reports/kafedra' + sq), h);
    if (statRes.ok) {
      const sj = await readJsonSafe<KafStat>(statRes);
      setKafStat(sj && Array.isArray(sj.kafedralar) ? sj : null);
    }

    const kafRes = await fetch(apiUrl('/api/admin/kafedralar'), h);
    if (!checkAdminAuthResponse(kafRes)) { setLoading(false); return; }
    const kafRaw = await readJsonSafe<any>(kafRes);
    const kafNames = new Map<number, string>();
    const kafList = Array.isArray(kafRaw) ? kafRaw : (kafRaw && kafRaw.results) || [];
    kafList.forEach((k: any) => {
      if (k && k.id != null) kafNames.set(Number(k.id), String(k.name || ''));
    });

    // Banlangan o'qituvchilar: mavjud "Banlanganlar" sahifasi faqat student
    // rolini so'raydi, shuning uchun o'qituvchilar u yerda ko'rinmaydi.
    // Banlanganlar ham TANLANGAN auditoriya bo'yicha: ordinator hisobotida
    // o'qituvchilarning banlari chiqib qolmasin.
    const banRes = await fetch(
      apiUrl('/api/admin/users?role=' + encodeURIComponent(audience) + '&status=Banned&limit=500'),
      h,
    );
    if (banRes.ok) {
      const banRaw = await readJsonSafe<any>(banRes);
      const banArr = Array.isArray(banRaw) ? banRaw : (banRaw && banRaw.results) || [];
      setBanned(banArr.map((b: any) => ({ id: String(b.id), name: String(b.name || b.id) })));
    }

    const exRes = await fetch(apiUrl('/api/admin/exams'), h);
    if (!checkAdminAuthResponse(exRes)) { setLoading(false); return; }
    const exRaw = await readJsonSafe<unknown>(exRes);
    const exams = (Array.isArray(exRaw) ? (exRaw as ExamRow[]) : []).filter(
      (e) => String(e.audience || 'student') === audience,
    );

    // Natijalarni bolib-bolib olamiz: 56 ta sorovni birdan yuborish brauzerni
    // ham, serverni ham bogadi.
    const rows: PersonRow[] = [];
    let failed = 0;
    let running = 0;
    const BATCH = 6;
    for (let i = 0; i < exams.length; i += BATCH) {
      const chunk = exams.slice(i, i + BATCH);
      setProgress(String(Math.min(i + BATCH, exams.length)) + ' / ' + String(exams.length));
      const parts = await Promise.all(
        chunk.map(async (e) => {
          // Ilgari yiqilgan so'rov jimgina tashlab ketilardi va hisobot har
          // yangilashda boshqa son ko'rsatardi. Endi 3 marta urinamiz, baribir
          // bo'lmasa sanab, ekranda ogohlantiramiz.
          let data: any = null;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              const r = await fetch(apiUrl('/api/admin/exams/' + e.id + '/results'), h);
              if (r.ok) { data = await readJsonSafe<any>(r); break; }
            } catch { /* qayta urinamiz */ }
            await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
          }
          if (data == null) { failed += 1; return [] as PersonRow[]; }
          const list: ResultRow[] = Array.isArray(data) ? data : (data && data.results) || [];
          running += list.filter((s) => String(s.status) === 'In Progress').length;
          const total = Number(e.bank_question_count) || 20;
          const kafedra = kafNames.get(Number(e.kafedra_id)) || '-';
          const subject = String(e.faculty_subject || e.title || '');
          return list
            .filter((s) => String(s.status) === 'Completed' && s.score != null)
            .map<PersonRow>((s) => {
              const score = Number(s.score) || 0;
              const percent = total ? Math.round((score / total) * 100) : 0;
              return {
                seId: Number(s.id),
                studentId: String(s.student_id),
                name: String(s.name || ''),
                kafedra,
                subject,
                score,
                total,
                percent,
                passed: percent >= threshold,
                date: s.completed_at ? String(s.completed_at).slice(0, 16).replace('T', ' ') : '',
              };
            });
        }),
      );
      parts.forEach((p) => rows.push(...p));
    }
    rows.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));
    setPeople(rows);
    setFailedExams(failed);
    setInProgress(running);
    setProgress('');
    setLoading(false);
  }, [token, lang, audience, threshold, seasonKey, absentAll]);

  const saveScore = async (row: PersonRow) => {
    const n = Number(editVal);
    if (!Number.isFinite(n) || n < 0 || n > row.total) { setEditErr(t.scoreRange); return; }
    setEditBusy(true); setEditErr('');
    try {
      const res = await fetch(apiUrl('/api/admin/student_exams/' + row.seId + '/score'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token, lang) },
        body: JSON.stringify({ score: n }),
      });
      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<any>(res);
      if (!res.ok) { setEditErr(String((d && d.error) || 'error')); return; }
      // Jadvalni darhol yangilaymiz — foiz va "otdi/otmadi" ball bilan birga o'zgaradi.
      setPeople((list) => list.map((x) => {
        if (x.seId !== row.seId) return x;
        const pct = x.total ? Math.round((n / x.total) * 100) : 0;
        return { ...x, score: n, percent: pct, passed: pct >= threshold };
      }));
      setEditId(null); setEditVal('');
    } finally {
      setEditBusy(false);
    }
  };

  const allowRetake = async (seId: number) => {
    if (!window.confirm(t.retakeConfirm)) return;
    const res = await fetch(apiUrl('/api/admin/student_exams/' + seId + '/retake'), {
      method: 'POST',
      headers: authHeaders(token, lang),
    });
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) setRetaken((m) => ({ ...m, [seId]: true }));
  };

  const doUnban = async () => {
    if (!unbanFor) return;
    if (unbanReason.trim().length < 8) { setUnbanErr(t.unbanReason); return; }
    if (!unbanFile) { setUnbanErr(t.unbanFile); return; }
    const fd = new FormData();
    fd.append('reason', unbanReason.trim());
    fd.append('evidence', unbanFile);
    const res = await fetch(apiUrl('/api/admin/users/' + encodeURIComponent(unbanFor.id) + '/unban'), {
      method: 'POST',
      headers: authHeaders(token, lang),
      body: fd,
    });
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) {
      setBanned((b) => b.filter((x) => x.id !== unbanFor.id));
      setUnbanFor(null); setUnbanReason(''); setUnbanFile(null); setUnbanErr('');
    } else {
      const d = await readJsonSafe<any>(res);
      setUnbanErr(String((d && d.error) || 'error'));
    }
  };

  useEffect(() => { load(); }, [load]);

  const kafedras = useMemo<KafedraRow[]>(() => {
    const m = new Map<string, PersonRow[]>();
    people.forEach((r) => {
      const arr = m.get(r.kafedra) || [];
      arr.push(r);
      m.set(r.kafedra, arr);
    });
    return Array.from(m.entries())
      .map(([kafedra, arr]) => ({
        kafedra,
        count: arr.length,
        avgPercent: Math.round(arr.reduce((s, x) => s + x.percent, 0) / arr.length),
        passed: arr.filter((x) => x.passed).length,
        failed: arr.filter((x) => !x.passed).length,
        best: Math.max.apply(null, arr.map((x) => x.percent)),
        worst: Math.min.apply(null, arr.map((x) => x.percent)),
      }))
      .sort((a, b) => b.avgPercent - a.avgPercent);
  }, [people]);

  const overall = useMemo(() => {
    if (!people.length) return null;
    return {
      count: people.length,
      avg: Math.round(people.reduce((s, x) => s + x.percent, 0) / people.length),
      passed: people.filter((x) => x.passed).length,
      failed: people.filter((x) => !x.passed).length,
      best: Math.max.apply(null, people.map((x) => x.percent)),
      worst: Math.min.apply(null, people.map((x) => x.percent)),
      kafedras: kafedras.length,
    };
  }, [people, kafedras]);

  const exportCurrent = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (view === 'part' && part) {
      downloadCsv('qatnashganlar-' + stamp + '.csv', [
        [t.kafedra, t.person, t.login, t.subject, t.score, t.percent, t.status],
        ...part.groups.flatMap((g) => g.people.map((p) => [
          g.kafedra_name, p.name, p.student_id, p.subject,
          p.score + '/' + p.total, p.percent, p.passed ? t.passed : t.failed,
        ])),
      ]);
      return;
    }
    if (view === 'absent' && absent) {
      downloadCsv('qatnashmaganlar-' + stamp + '.csv', [
        [t.kafedra, t.person, t.login, t.status],
        ...absentGroups.flatMap((g) => g.people.map((p) => [
          g.kafedra_name, p.name, p.student_id,
          p.state === 'unfinished' ? t.absentStarted : t.notParticipated,
        ])),
      ]);
      return;
    }
    if ((view === 'kafstat' || view === 'ranking') && kafStat) {
      const src = view === 'ranking' ? kafStat.top.concat(kafStat.bottom) : kafStat.kafedralar;
      downloadCsv('hisobot-kafedra-statistika-' + stamp + '.csv', [
        [t.rank, t.kafedra, t.totalTeachers, t.participated, t.unfinished, t.notParticipated,
         t.passedT, t.failedT, t.passPct, t.coverage],
        ...src.map((k, i) => [
          i + 1, k.kafedra_name, k.total_teachers, k.participated, k.unfinished, k.not_participated,
          k.passed, k.failed, k.pass_percent, k.participation_percent,
        ]),
      ]);
      return;
    }
    if (view === 'kafedra') {
      downloadCsv('hisobot-kafedralar-' + stamp + '.csv', [
        [t.rank, t.kafedra, t.count, t.avg, t.passed, t.failed, t.passRate, t.best, t.worst],
        ...kafedras.map((k, i) => [
          i + 1, k.kafedra, k.count, k.avgPercent, k.passed, k.failed,
          Math.round((k.passed / k.count) * 100), k.best, k.worst,
        ]),
      ]);
    } else {
      downloadCsv('hisobot-natijalar-' + stamp + '.csv', [
        [t.rank, t.person, t.kafedra, t.subject, t.score, t.percent, t.status, t.date],
        ...people.map((r, i) => [
          i + 1, r.name, r.kafedra, r.subject, r.score + '/' + r.total, r.percent,
          r.passed ? t.passed : t.failed, r.date,
        ]),
      ]);
    }
  };

  // PDF serverda chiziladi (reportlab): institut logotipi, umumiy kartochkalar,
  // reyting va to'liq jadval. Brauzerda yig'ilmaydi — shrift/format bir xil chiqadi.
  // Qatnashmaganlar ro'yxati — qidiruv bo'yicha filtrlangan ko'rinish.
  const absentGroups = useMemo(() => {
    if (!absent) return [] as AbsentGroup[];
    const q = absentQ.trim().toLowerCase();
    if (!q) return absent.groups;
    return absent.groups
      .map((g) => ({
        ...g,
        people: g.kafedra_name.toLowerCase().includes(q)
          ? g.people
          : g.people.filter((p) => p.name.toLowerCase().includes(q) || p.student_id.includes(q)),
      }))
      .filter((g) => g.people.length > 0);
  }, [absent, absentQ]);

  const downloadPartPdf = async () => {
    setPdfBusy(true);
    try {
      const q = seasonKey ? '?season=' + encodeURIComponent(seasonKey) : '';
      const res = await fetch(apiUrl('/api/admin/reports/participants.pdf' + q), { headers: authHeaders(token, lang) });
      if (!checkAdminAuthResponse(res) || !res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a2 = document.createElement('a');
      a2.href = url;
      a2.download = 'qatnashganlar-' + new Date().toISOString().slice(0, 10) + '.pdf';
      document.body.appendChild(a2); a2.click(); document.body.removeChild(a2);
      URL.revokeObjectURL(url);
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadAbsentPdf = async () => {
    setPdfBusy(true);
    try {
      const res = await fetch(
        apiUrl(
          '/api/admin/reports/absent.pdf' +
            (seasonKey ? '?season=' + encodeURIComponent(seasonKey) : '') +
            (absentAll ? (seasonKey ? '&' : '?') + 'all=1' : ''),
        ),
        { headers: authHeaders(token, lang) },
      );
      if (!checkAdminAuthResponse(res) || !res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a2 = document.createElement('a');
      a2.href = url;
      a2.download = 'qatnashmaganlar-' + new Date().toISOString().slice(0, 10) + '.pdf';
      document.body.appendChild(a2); a2.click(); document.body.removeChild(a2);
      URL.revokeObjectURL(url);
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const res = await fetch(apiUrl('/api/admin/reports/full.pdf' + (seasonKey ? '?season=' + encodeURIComponent(seasonKey) : '')), {
        headers: authHeaders(token, lang),
      });
      if (!checkAdminAuthResponse(res) || !res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'imtihon-hisoboti-' + new Date().toISOString().slice(0, 10) + '.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setPdfBusy(false);
    }
  };

  const Stat = ({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) => (
    <div className="bg-gray-50 rounded-xl px-4 py-3">
      <div className="text-[12px] text-gray-500">{label}</div>
      <div className={'text-xl font-semibold ' + (tone || 'text-gray-900')}>{value}</div>
    </div>
  );

  // Ordinator / nomzod / maxsus kiruvchi — o'ziga xos hisobot. O'qituvchilar
  // hisobotidagi "kafedradagi jami" mezoni bu toifalar uchun noto'g'ri edi.
  if (isTailoredAudience(audience)) {
    const own = seasons.filter((s) => s.audience === audience);
    return (
      <AudienceReport
        token={token}
        lang={lang}
        audience={audience}
        audienceOptions={AUDIENCE_OPTIONS.map((a) => ({ value: a, label: audienceLabel(a) }))}
        onAudience={(a) => setAudience(a)}
        seasons={own}
        seasonKey={own.some((s) => s.key === seasonKey) ? seasonKey : ''}
        onSeason={(k) => setSeasonKey(k)}
      />
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grow">
            <div className="text-lg font-semibold text-gray-900">{t.title}</div>
            {progress ? <div className="text-[12px] text-gray-500 mt-0.5">{t.loading} {progress}</div> : null}
          </div>
          <div>
            <div className="text-[12px] text-gray-500 mb-1">{t.season}</div>
            <AdminSelect
              value={seasonKey}
              onChange={(e: any) => {
                const k = e.target.value;
                setSeasonKey(k);
                const sn = seasons.find((x) => x.key === k);
                if (sn && sn.audience !== audience) setAudience(sn.audience);
              }}
            >
              {(seasons.some((x) => x.audience === audience) ? seasons.filter((x) => x.audience === audience) : seasons).map((sn) => (
                <option key={sn.key} value={sn.key}>{sn.label}</option>
              ))}
            </AdminSelect>
          </div>
          <div>
            <div className="text-[12px] text-gray-500 mb-1">{t.audience}</div>
            <AdminSelect value={audience} onChange={(e: any) => setAudience(e.target.value)}>
              {AUDIENCE_OPTIONS.map((a) => (
                <option key={a} value={a}>{audienceLabel(a)}</option>
              ))}
            </AdminSelect>
          </div>
          <div>
            <div className="text-[12px] text-gray-500 mb-1">{t.threshold}</div>
            <AdminSelect value={String(threshold)} onChange={(e: any) => setThreshold(Number(e.target.value))}>
              <option value="50">50%</option>
              <option value="60">60%</option>
              <option value="70">70%</option>
            </AdminSelect>
          </div>
          <AdminBtn variant="ghost" size="sm" onClick={() => load()}>{t.refresh}</AdminBtn>
          <AdminBtn variant="blue" size="sm" onClick={view === 'absent' ? downloadAbsentPdf : view === 'part' ? downloadPartPdf : downloadPdf} loading={pdfBusy} disabled={view === 'absent' ? !absent : view === 'part' ? !part : !kafStat}>
            {pdfBusy ? t.pdfBusy : (view === 'absent' || view === 'part' ? t.downloadPdf : t.fullPdf)}
          </AdminBtn>
          <AdminBtn variant="violet" size="sm" onClick={exportCurrent} disabled={!people.length && !kafStat}>
            {t.download}
          </AdminBtn>
        </div>

        <div className="flex gap-2 mt-4 border-b border-gray-100">
          {([['overall', t.overall], ['kafstat', t.kafStat], ['ranking', t.ranking], ['part', t.partTab + (part ? ' (' + part.total_people + ')' : '')], ['absent', t.absentTab + (absent ? ' (' + absent.absent_total + ')' : '')], ['kafedra', t.byKafedra], ['person', t.byPerson], ['banned', t.banned + ' (' + banned.length + ')']] as Array<[string, string]>).map(
            ([k, label]) => (
              <button
                key={k}
                onClick={() => setView(k as 'overall' | 'kafstat' | 'ranking' | 'part' | 'absent' | 'kafedra' | 'person' | 'banned')}
                className={'px-3 py-2 text-sm font-medium -mb-px border-b-2 ' + (
                  view === k ? 'border-violet-500 text-violet-700' : 'border-transparent text-gray-500'
                )}
              >
                {label}
              </button>
            ),
          )}
        </div>
      </div>

      {!loading && failedExams > 0 ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-2 text-sm">
          {failedExams} {t.loadFail}
        </div>
      ) : null}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-4"><div className="text-sm text-gray-500">{t.loading} {progress}</div></div>
      ) : null}

      {!loading && !people.length && (view === 'kafedra' || view === 'person') ? <AdminEmpty title={t.empty} /> : null}

      {/* Kafedra statistikasi — 8 ta korsatkich, serverdan bitta sorovda. */}
      {!loading && view === 'kafstat' ? (
        kafStat && kafStat.kafedralar.length ? (
          <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <Stat label={t.totalTeachers} value={kafStat.totals.total_teachers} />
              <Stat label={t.participated} value={kafStat.totals.participated} />
              <Stat label={t.unfinished} value={kafStat.totals.unfinished} tone="text-amber-700" />
              <Stat label={t.notParticipated} value={kafStat.totals.not_participated} tone="text-gray-500" />
              <Stat label={t.passedT} value={kafStat.totals.passed} tone="text-emerald-700" />
              <Stat label={t.failedT} value={kafStat.totals.failed} tone="text-red-600" />
              <Stat label={t.passPct} value={kafStat.totals.pass_percent + '%'} />
            </div>
            <div className="text-[12px] text-gray-400">
              {t.statNote} {t.threshold}: {kafStat.pass_threshold}%
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-[12px] border-b border-gray-100">
                    <th className="py-2 pr-2">{t.rank}</th>
                    <th className="py-2 pr-2">{t.kafedra}</th>
                    <th className="py-2 pr-2">{t.totalTeachers}</th>
                    <th className="py-2 pr-2">{t.participated}</th>
                    <th className="py-2 pr-2">{t.unfinished}</th>
                    <th className="py-2 pr-2">{t.notParticipated}</th>
                    <th className="py-2 pr-2">{t.passedT}</th>
                    <th className="py-2 pr-2">{t.failedT}</th>
                    <th className="py-2 pr-2">{t.passPct}</th>
                    <th className="py-2 pr-2">{t.coverage}</th>
                  </tr>
                </thead>
                <tbody>
                  {kafStat.kafedralar.map((k, i) => (
                    <tr key={k.kafedra_id} className="border-b border-gray-50">
                      <td className="py-2 pr-2 text-gray-400">{i + 1}</td>
                      <td className="py-2 pr-2 font-medium text-gray-900">{k.kafedra_name}</td>
                      <td className="py-2 pr-2">{k.total_teachers}</td>
                      <td className="py-2 pr-2">{k.participated}</td>
                      <td className={"py-2 pr-2 " + (k.unfinished ? "text-amber-700" : "text-gray-400")}>{k.unfinished}</td>
                      <td className="py-2 pr-2 text-gray-500">{k.not_participated}</td>
                      <td className="py-2 pr-2 text-emerald-700">{k.passed}</td>
                      <td className="py-2 pr-2 text-red-600">{k.failed}</td>
                      <td className="py-2 pr-2 font-semibold">{k.participated ? k.pass_percent + '%' : '-'}</td>
                      <td className="py-2 pr-2 text-gray-500">{k.participation_percent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : <AdminEmpty title={t.noStat} />
      ) : null}

      {/* Qatnashganlar: kafedra kesimida, ball va o'tdi/o'tmadi bilan.
          Ball ustunidagi qalamcha orqali natijani tuzatish mumkin. */}
      {!loading && view === 'part' ? (
        part && part.groups.length ? (
          <div className="space-y-3">
            <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-3">
              <div className="text-lg font-semibold text-gray-900">{t.partTab}</div>
              <div className="px-3 py-1 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold">
                {t.submitted}: {part.total_people}
              </div>
              <div className="px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-semibold">
                {t.passed}: {part.total_passed}
              </div>
              <div className="px-3 py-1 rounded-lg bg-red-50 text-red-700 text-sm font-semibold">
                {t.failed}: {part.total_failed}
              </div>
              <div className="text-[12px] text-gray-400">{t.threshold}: {part.pass_threshold}%</div>
            </div>

            {part.groups.map((g) => (
              <div key={g.kafedra_id} className="bg-white rounded-lg border border-gray-200">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50/60 rounded-t-lg">
                  <div className="font-semibold text-gray-900 text-[15px]">{g.kafedra_name}</div>
                  <div className="text-[12.5px] text-gray-500 shrink-0">
                    {t.tookExam} {g.count} · 
                    <span className="text-emerald-700 font-semibold">{g.passed}</span> {t.passed} · 
                    <span className="text-red-600 font-semibold">{g.failed}</span> {t.failed} · 
                    {t.avgShort} {g.avg_percent}%
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 text-[12px] border-b border-gray-100">
                        <th className="py-2 pl-4 pr-2">{t.rank}</th>
                        <th className="py-2 pr-2">{t.person}</th>
                        <th className="py-2 pr-2">{t.subject}</th>
                        <th className="py-2 pr-2">{t.score}</th>
                        <th className="py-2 pr-2">{t.percent}</th>
                        <th className="py-2 pr-2">{t.status}</th>
                        <th className="py-2 pr-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.people.map((p, i) => (
                        <tr key={p.student_exam_id} className="border-b border-gray-50 last:border-0">
                          <td className="py-1.5 pl-4 pr-2 text-gray-400">{i + 1}</td>
                          <td className="py-1.5 pr-2 text-gray-900">
                            {p.name}
                            <div className="font-mono text-[11px] text-gray-400">{p.student_id}</div>
                          </td>
                          <td className="py-1.5 pr-2 text-gray-600">{p.subject}</td>
                          <td className="py-1.5 pr-2 whitespace-nowrap">{p.score}/{p.total}</td>
                          <td className={"py-1.5 pr-2 font-semibold " + (p.passed ? "text-emerald-700" : "text-red-600")}>{p.percent}%</td>
                          <td className="py-1.5 pr-2">
                            <span className={"text-[11.5px] px-2 py-0.5 rounded-full " + (p.passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                              {p.passed ? t.passed : t.failed}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                            {!p.passed ? (
                              retaken[p.student_exam_id] ? (
                                <span className="text-[12px] text-gray-400">{t.retakeDone}</span>
                              ) : (
                                <AdminBtn variant="ghost" size="sm" onClick={() => allowRetake(p.student_exam_id)}>
                                  {t.retake}
                                </AdminBtn>
                              )
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : <AdminEmpty title={t.empty} />
      ) : null}

      {/* Qatnashmaganlar: kafedra bo'yicha guruhlangan, ism-familiya bilan. */}
      {!loading && view === 'absent' ? (
        absent && absent.groups.length ? (
          <div className="space-y-3">
            <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-center gap-3">
              <div className="text-lg font-semibold text-gray-900">{t.absentTitle}</div>
              <div className="px-3 py-1 rounded-lg bg-red-50 text-red-700 text-sm font-semibold">
                {t.absentTotal}: {absent.absent_total}
              </div>
              <div className="grow min-w-[200px]">
                <AdminInput
                  placeholder={t.absentSearch}
                  value={absentQ}
                  onChange={(e: any) => setAbsentQ(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-[13px] text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-violet-600"
                  checked={!absentAll}
                  onChange={(e) => setAbsentAll(!e.target.checked)}
                />
                {t.onlyActive}
              </label>
              <AdminBtn variant="blue" size="sm" onClick={downloadAbsentPdf} loading={pdfBusy}>
                {t.downloadPdf}
              </AdminBtn>
              <AdminBtn variant="violet" size="sm" onClick={exportCurrent}>
                {t.download}
              </AdminBtn>
            </div>

            {absentGroups.map((g) => (
              <div key={g.kafedra_id} className="bg-white rounded-lg border border-gray-200">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/60 rounded-t-lg">
                  <div className="font-semibold text-gray-900 text-[15px]">{g.kafedra_name}</div>
                  <div className="text-[13px] text-gray-500 shrink-0">
                    <span className="text-red-600 font-semibold">{g.absent_count}</span>
                    {' / '}{g.total_teachers} {t.absentOf}
                  </div>
                </div>
                <div className="p-2">
                  <table className="w-full text-sm">
                    <tbody>
                      {g.people.map((p, i) => (
                        <tr key={p.student_id} className="border-b border-gray-50 last:border-0">
                          <td className="py-1.5 pl-2 pr-2 text-gray-400 w-8">{i + 1}</td>
                          <td className="py-1.5 pr-2 text-gray-900">{p.name}</td>
                          <td className="py-1.5 pr-2 font-mono text-[12px] text-gray-400 whitespace-nowrap">{p.student_id}</td>
                          <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                            {p.state === 'unfinished' ? (
                              <span className="text-[11.5px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                                {t.absentStarted}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : <AdminEmpty title={t.absentEmpty} />
      ) : null}

      {/* Eng yuqori va eng past 10 ta kafedra. */}
      {!loading && view === 'ranking' ? (
        kafStat && (kafStat.top.length || kafStat.bottom.length) ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {([[t.topK, kafStat.top, true], [t.bottomK, kafStat.bottom, false]] as Array<[string, KafStatRow[], boolean]>).map(
              ([label, list, isTop]) => (
                <div key={label} className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className={'text-sm font-semibold mb-3 ' + (isTop ? 'text-emerald-700' : 'text-red-600')}>
                    {label}
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 text-[12px] border-b border-gray-100">
                        <th className="py-2 pr-2">{t.rank}</th>
                        <th className="py-2 pr-2">{t.kafedra}</th>
                        <th className="py-2 pr-2">{t.participated}</th>
                        <th className="py-2 pr-2">{t.passedT}</th>
                        <th className="py-2 pr-2">{t.passPct}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((k, i) => (
                        <tr key={k.kafedra_id} className="border-b border-gray-50">
                          <td className="py-2 pr-2 text-gray-400">{i + 1}</td>
                          <td className="py-2 pr-2 font-medium text-gray-900">{k.kafedra_name}</td>
                          <td className="py-2 pr-2">{k.participated}</td>
                          <td className="py-2 pr-2 text-emerald-700">{k.passed}</td>
                          <td className={'py-2 pr-2 font-semibold ' + (isTop ? 'text-emerald-700' : 'text-red-600')}>
                            {k.pass_percent}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ),
            )}
          </div>
        ) : <AdminEmpty title={t.noStat} />
      ) : null}

      {!loading && people.length > 0 && view === 'overall' && overall ? (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={t.submitted} value={overall.count} />
            <Stat label={t.avg} value={overall.avg + '%'} />
            <Stat label={t.passed} value={overall.passed} tone="text-emerald-700" />
            <Stat label={t.failed} value={overall.failed} tone="text-red-600" />
            <Stat label={t.best} value={overall.best + '%'} />
            <Stat label={t.worst} value={overall.worst + '%'} />
            <Stat label={t.kafedra} value={overall.kafedras} />
            <Stat label={t.passRate} value={Math.round((overall.passed / overall.count) * 100) + '%'} />
            <Stat label={t.inProgress} value={inProgress} />
          </div>
        </div>
      ) : null}

      {!loading && people.length > 0 && view === 'kafedra' ? (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-[12px] border-b border-gray-100">
                  <th className="py-2 pr-2">{t.rank}</th><th className="py-2 pr-2">{t.kafedra}</th>
                  <th className="py-2 pr-2">{t.count}</th><th className="py-2 pr-2">{t.avg}</th>
                  <th className="py-2 pr-2">{t.passed}</th><th className="py-2 pr-2">{t.failed}</th>
                  <th className="py-2 pr-2">{t.passRate}</th><th className="py-2 pr-2">{t.best}</th>
                </tr>
              </thead>
              <tbody>
                {kafedras.map((k, i) => (
                  <tr key={k.kafedra} className="border-b border-gray-50">
                    <td className="py-2 pr-2 text-gray-400">{i + 1}</td>
                    <td className="py-2 pr-2 font-medium text-gray-900">{k.kafedra}</td>
                    <td className="py-2 pr-2">{k.count}</td>
                    <td className="py-2 pr-2 font-semibold">{k.avgPercent}%</td>
                    <td className="py-2 pr-2 text-emerald-700">{k.passed}</td>
                    <td className="py-2 pr-2 text-red-600">{k.failed}</td>
                    <td className="py-2 pr-2">{Math.round((k.passed / k.count) * 100)}%</td>
                    <td className="py-2 pr-2">{k.best}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && people.length > 0 && view === 'person' ? (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-[12px] border-b border-gray-100">
                  <th className="py-2 pr-2">{t.rank}</th><th className="py-2 pr-2">{t.person}</th>
                  <th className="py-2 pr-2">{t.kafedra}</th><th className="py-2 pr-2">{t.subject}</th>
                  <th className="py-2 pr-2">{t.score}</th><th className="py-2 pr-2">{t.percent}</th>
                  <th className="py-2 pr-2">{t.status}</th>
                  <th className="py-2 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {people.map((r, i) => (
                  <tr key={r.studentId + '|' + r.subject} className="border-b border-gray-50">
                    <td className="py-2 pr-2 text-gray-400">{i + 1}</td>
                    <td className="py-2 pr-2 font-medium text-gray-900">{r.name}</td>
                    <td className="py-2 pr-2 text-gray-600">{r.kafedra}</td>
                    <td className="py-2 pr-2 text-gray-600">{r.subject}</td>
                    <td className="py-2 pr-2">
                      {editId === r.seId ? (
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={r.total}
                            autoFocus
                            value={editVal}
                            onChange={(e) => setEditVal(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveScore(r);
                              if (e.key === 'Escape') { setEditId(null); setEditErr(''); }
                            }}
                            className="w-16 border border-gray-300 rounded-md px-2 py-1 text-sm"
                          />
                          <span className="text-gray-400">/{r.total}</span>
                          <AdminBtn variant="emerald" size="sm" loading={editBusy} onClick={() => saveScore(r)}>
                            {t.saveScore}
                          </AdminBtn>
                          <AdminBtn variant="ghost" size="sm" onClick={() => { setEditId(null); setEditErr(''); }}>
                            {t.cancelScore}
                          </AdminBtn>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span>{r.score}/{r.total}</span>
                          <button
                            type="button"
                            title={t.editScore}
                            onClick={() => { setEditId(r.seId); setEditVal(String(r.score)); setEditErr(''); }}
                            className="text-gray-300 hover:text-violet-600"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        </span>
                      )}
                      {editId === r.seId && editErr ? (
                        <div className="text-[11px] text-red-600 mt-1">{editErr}</div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2 font-semibold">{r.percent}%</td>
                    <td className="py-2 pr-2">
                      <span className={'text-[12px] px-2 py-0.5 rounded-full ' + (
                        r.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      )}>
                        {r.passed ? t.passed : t.failed}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      {!r.passed ? (
                        retaken[r.seId] ? (
                          <span className="text-[12px] text-gray-400">{t.retakeDone}</span>
                        ) : (
                          <AdminBtn variant="ghost" size="sm" onClick={() => allowRetake(r.seId)}>
                            {t.retake}
                          </AdminBtn>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && view === 'banned' ? (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          {banned.length === 0 ? (
            <div className="text-sm text-gray-500">{t.noBanned}</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {banned.map((b) => (
                <li key={b.id} className="py-2 flex items-center gap-3">
                  <span className="grow text-sm text-gray-900">{b.name}</span>
                  <span className="text-[12px] text-gray-400">{b.id}</span>
                  <AdminBtn variant="ghost" size="sm" onClick={() => { setUnbanFor(b); setUnbanErr(''); }}>
                    {t.unban}
                  </AdminBtn>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {unbanFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
             onClick={() => setUnbanFor(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-semibold text-gray-900">{t.unban}</div>
            <div className="text-[13px] text-gray-500 mt-0.5 mb-3">{unbanFor.name}</div>
            <textarea
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              rows={3}
              placeholder={t.unbanReason}
              value={unbanReason}
              onChange={(e) => setUnbanReason(e.target.value)}
            />
            <div className="mt-2">
              <div className="text-[12px] text-gray-500 mb-1">{t.unbanFile}</div>
              <input type="file" accept="image/*,application/pdf"
                     onChange={(e) => setUnbanFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
            </div>
            {unbanErr ? <div className="text-[12px] text-red-600 mt-2">{unbanErr}</div> : null}
            <div className="flex justify-end gap-2 mt-4">
              <AdminBtn variant="ghost" size="sm" onClick={() => setUnbanFor(null)}>{t.cancel}</AdminBtn>
              <AdminBtn variant="violet" size="sm" onClick={doUnban}>{t.save}</AdminBtn>
            </div>
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}
