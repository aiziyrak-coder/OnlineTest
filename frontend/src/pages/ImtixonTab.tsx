import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { translations, Language } from '../i18n';
import { readJsonSafe, parseAdminUsersList, checkAdminAuthResponse, fetchWithTimeout } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { authHeaders } from '../lib/uiLangHeader';
import {
  defaultExamEndLocal,
  defaultExamStartLocal,
  isValidDatetimeLocal,
  toDatetimeLocalValue,
} from '../lib/datetimeLocal';
import { DateTimeField } from '../components/DateTimeField';
import { GroupMultiSelect } from '../components/GroupMultiSelect';
import {
  AdminInput,
  AdminSelect,
  AdminField,
  AdminLabel,
  AdminTextarea,
  AdminBtn,
  AdminCard,
  AdminModal,
  AdminPageMessageStack,
  PlusIcon,
} from './admin/ui';

type FacultyAssessmentDept = {
  kafedra_id: number;
  name: string;
  date: string;
  subjects: string[];
};

type StudentRow = { id: string; name: string; group_id: number | null };
type StaffRow = { id: string; name: string; role: string };
type ImentorDepartment = {
  code: string;
  name: string;
  sort_order?: number;
  subjects_count?: number;
  /** Shu kafedrada e'lon qilingan testlar soni (iMentor API). */
  tests_count?: number;
};
type ImentorTopic = { code: string; id?: string; title: string };
type ImentorVariant = { label: string; file_name?: string; topics: ImentorTopic[] };
type ImentorSubject = {
  subject_code: string;
  subject_name: string;
  department_code?: string;
  department_name?: string;
  test_count: number;
  questions_total?: number;
  variants_count?: number;
  topics_count?: number;
  variant_labels?: string[];
  variants?: ImentorVariant[];
};

function toIsoOrNull(localValue: string): string | null {
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function ImtixonTab({
  token,
  lang,
  adminUserId,
}: {
  token: string;
  lang: Language;
  adminUserId?: string;
}) {
  const t = translations[lang];
  const h = authHeaders(token, lang);

  const [groups, setGroups] = useState<any[]>([]);
  const [groupDirectionFilter, setGroupDirectionFilter] = useState('');
  const [imentorDepartments, setImentorDepartments] = useState<ImentorDepartment[]>([]);
  const [imentorSubjects, setImentorSubjects] = useState<ImentorSubject[]>([]);
  const [imentorConfigured, setImentorConfigured] = useState(true);
  const [imentorApiError, setImentorApiError] = useState('');
  const [staffUsers, setStaffUsers] = useState<StaffRow[]>([]);
  const [facultySchedule, setFacultySchedule] = useState<FacultyAssessmentDept[]>([]);
  /* O'qituvchi baholash jadvalida atigi 25 ta kafedra bor (DOCX dan), bazada
     esa 96 ta. Ordinator, magistr va vakansiya imtihonini istalgan kafedraga
     yaratish kerak -- shuning uchun ular uchun to'liq ro'yxat olinadi. */
  const [allKafedralar, setAllKafedralar] = useState<{ id: number; name: string }[]>([]);
  const [selFacultyKafedraId, setSelFacultyKafedraId] = useState('');
  const [facultySubject, setFacultySubject] = useState('');

  const [title, setTitle] = useState('');
  const [startLocal, setStartLocal] = useState(defaultExamStartLocal);
  const [endLocal, setEndLocal] = useState(() => defaultExamEndLocal(60));
  const [duration, setDuration] = useState(60);
  const [technicalRetakesAllowed, setTechnicalRetakesAllowed] = useState(3);
  /** Tashqi shovqin nazorati — default YOQILGAN. Institut binosida
   *  o'tkaziladigan imtihonda o'chiriladi (atrofdagi tabiiy shovqin soxta
   *  ogohlantirish bermasin). Talabaning o'zi gapirishi bunga bog'liq emas. */
  const [ambientAudioEnabled, setAmbientAudioEnabled] = useState(true);
  /** Test markazi PIN (4 raqam) — bo'sh bo'lsa rejim yo'q. */
  const [testCenterPin, setTestCenterPin] = useState('');
  const [language, setLanguage] = useState('auto');
  const [customRules, setCustomRules] = useState('');
  const [responsibleStaffId, setResponsibleStaffId] = useState('');
  const [selDepartment, setSelDepartment] = useState('');
  const [selSubject, setSelSubject] = useState('');
  const [selVariant, setSelVariant] = useState('');
  const [selTopic, setSelTopic] = useState('');
  const [imentorMaxQ, setImentorMaxQ] = useState(0);
  const [imentorQLimits, setImentorQLimits] = useState({ min: 10, max: 30 });
  const [subjectsLoading, setSubjectsLoading] = useState(false);

  const [selGroups, setSelGroups] = useState<number[]>([]);
  // 'vacancy' — ishga kiruvchilar. Kafedra + fan bo'yicha, o'qituvchi
  // imtihoni bilan bir xil oqim; farqi faqat kimga mo'ljallanganida.
  const [audience, setAudience] = useState<
    'student' | 'faculty' | 'vacancy' | 'ordinator' | 'magistr' | 'entrant'
  >('student');
  // Ordinator/magistr: savollarni AI emas, ADMIN yuklaydi. Imtihon avval
  // bo'sh bank bilan yaratiladi, savollar "Ordinatorlar"/"Magistrlar"
  // sahifasidagi "Savollarni yuklash" oynasidan qo'yiladi.
  const [ordQuestionCount, setOrdQuestionCount] = useState(20);
  /* Ordinatura kursi: 1-kurs va 2-kurs (DAK) imtihonlari aralashmasin. */
  const [ordCourse, setOrdCourse] = useState('2');
  /* Savollarning nechtasini AI ayni paytda yaratsin — bank tarqalib
     ketgan bo'lsa ham har kimga yangi savollar tushishi uchun. */
  const [ordAiCount, setOrdAiCount] = useState(10);
  const isUploadAudience =
    audience === 'ordinator' || audience === 'magistr' || audience === 'entrant';

  // Guruh ro'yxatida allaqachon direction_id/direction_name bor (admin/groups
  // javobidan) — Kafedra→Yo'nalish→Guruh integratsiyasi uchun qo'shimcha API
  // so'rov shart emas, shu yerdan noyob yo'nalishlar ro'yxatini chiqaramiz.
  const groupDirectionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      if (g.direction_id != null) map.set(String(g.direction_id), g.direction_name || String(g.direction_id));
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [groups]);

  const selectAllGroupsInDirection = () => {
    if (!groupDirectionFilter) return;
    const ids = groups
      .filter((g) => String(g.direction_id) === groupDirectionFilter)
      .map((g) => g.id as number);
    setSelGroups((prev) => Array.from(new Set([...prev, ...ids])));
  };
  const [exModal, setExModal] = useState(false);
  const [poolStudents, setPoolStudents] = useState<StudentRow[]>([]);
  const [exMap, setExMap] = useState<Record<string, { on: boolean; reason: string }>>({});

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });

  const loadMeta = useCallback(async () => {
    const [gr, st, im, fs] = await Promise.all([
      fetch(apiUrl('/api/admin/groups'), { headers: h }),
      fetch(apiUrl('/api/admin/users?role=staff'), { headers: h }),
      fetch(apiUrl('/api/admin/imentor/departments'), { headers: h }),
      fetch(apiUrl('/api/admin/faculty-assessment/schedule'), { headers: h }),
    ]);
    if (!checkAdminAuthResponse(gr) || !checkAdminAuthResponse(st) || !checkAdminAuthResponse(im) || !checkAdminAuthResponse(fs)) return;
    const gj = gr.ok ? await readJsonSafe<any[]>(gr) : null;
    const sj = st.ok ? await readJsonSafe<unknown>(st) : null;
    const ij = im.ok
      ? await readJsonSafe<{
          configured?: boolean;
          departments?: ImentorDepartment[];
          published_tests_total?: number;
          error?: string;
          question_limit_bounds?: { min?: number; max?: number };
        }>(im)
      : null;
    const fj = fs.ok
      ? await readJsonSafe<{ departments?: FacultyAssessmentDept[] }>(fs)
      : null;
    setGroups(Array.isArray(gj) ? gj : []);
    setStaffUsers(parseAdminUsersList<StaffRow>(sj));
    setFacultySchedule(Array.isArray(fj?.departments) ? fj!.departments! : []);
    setImentorConfigured(ij?.configured !== false);
    setImentorApiError(String(ij?.error || '').trim());
    setImentorDepartments(Array.isArray(ij?.departments) ? ij!.departments! : []);
    const b = ij?.question_limit_bounds;
    if (b && typeof b.min === 'number' && typeof b.max === 'number') {
      setImentorQLimits({ min: b.min, max: b.max });
    }
  }, [token]);

  const loadDepartmentSubjects = useCallback(
    async (departmentCode: string) => {
      if (!departmentCode) {
        setImentorSubjects([]);
        return;
      }
      setSubjectsLoading(true);
      try {
        const res = await fetch(
          apiUrl(`/api/admin/imentor/departments/${encodeURIComponent(departmentCode)}/subjects`),
          { headers: h },
        );
        if (!checkAdminAuthResponse(res)) return;
        const data = await readJsonSafe<{
          subjects?: ImentorSubject[];
          question_limit_bounds?: { min?: number; max?: number };
        }>(res);
        setImentorSubjects(Array.isArray(data?.subjects) ? data!.subjects! : []);
        const b = data?.question_limit_bounds;
        if (b && typeof b.min === 'number' && typeof b.max === 'number') {
          setImentorQLimits({ min: b.min, max: b.max });
        }
      } finally {
        setSubjectsLoading(false);
      }
    },
    [token],
  );

  /* Kafedra ro'yxati auditoriyaga qarab tanlanadi. */
  const kafedraOptions = useMemo(
    () =>
      isUploadAudience || audience === 'vacancy'
        ? allKafedralar.map((k) => ({ kafedra_id: k.id, name: k.name }))
        : facultySchedule.map((k) => ({ kafedra_id: k.kafedra_id, name: k.name })),
    [isUploadAudience, audience, allKafedralar, facultySchedule],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(apiUrl('/api/admin/kafedralar'), { headers: h });
        if (!r.ok) return;
        const raw = await readJsonSafe<any>(r);
        const list = Array.isArray(raw) ? raw : (raw && raw.results) || [];
        if (!cancelled) {
          setAllKafedralar(
            list
              .filter((k: any) => k.is_active !== false)
              .map((k: any) => ({ id: Number(k.id), name: String(k.name || '') })),
          );
        }
      } catch { /* ro'yxat bo'sh qolsa jadvaldagilar ishlatiladi */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedFacultyDept = useMemo(
    () => facultySchedule.find((d) => String(d.kafedra_id) === selFacultyKafedraId) ?? null,
    [facultySchedule, selFacultyKafedraId],
  );

  useEffect(() => {
    setFacultySubject('');
  }, [selFacultyKafedraId]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    setSelSubject('');
    setSelVariant('');
    setSelTopic('');
    if (selDepartment) {
      loadDepartmentSubjects(selDepartment);
    } else {
      setImentorSubjects([]);
    }
  }, [selDepartment, loadDepartmentSubjects]);

  useEffect(() => {
    setSelVariant('');
    setSelTopic('');
  }, [selSubject]);

  useEffect(() => {
    setSelTopic('');
  }, [selVariant]);

  const onDepartmentChange = (code: string) => {
    setSelDepartment(code);
  };

  const subjectsWithTests = useMemo(
    () => imentorSubjects.filter((s) => (s.test_count ?? 0) > 0),
    [imentorSubjects],
  );

  const selectedSubject = useMemo(
    () => imentorSubjects.find((s) => s.subject_code === selSubject) || null,
    [imentorSubjects, selSubject],
  );

  const subjectVariants = useMemo(() => {
    const vars = selectedSubject?.variants;
    if (Array.isArray(vars) && vars.length > 0) return vars;
    const labels = selectedSubject?.variant_labels || [];
    return labels.map((label) => ({ label, topics: [] as ImentorTopic[] }));
  }, [selectedSubject]);

  const selectedVariant = useMemo(
    () => subjectVariants.find((v) => v.label === selVariant) || null,
    [subjectVariants, selVariant],
  );

  const subjectTopics = useMemo(() => selectedVariant?.topics || [], [selectedVariant]);

  const catalogStep = !selDepartment ? 1 : 2;

  const openExceptions = async () => {
    if (selGroups.length === 0) {
      setMsg({ type: 'err', text: t.examCreateSelectGroup });
      return;
    }
    setMsg({ type: '', text: '' });
    const lists = await Promise.all(
      selGroups.map(async (gid) => {
        const res = await fetch(apiUrl(`/api/admin/users?group_id=${gid}&role=student`), { headers: h });
        if (!checkAdminAuthResponse(res)) return [];
        const j = await readJsonSafe<unknown>(res);
        return parseAdminUsersList<StudentRow>(j);
      }),
    );
    const merged: StudentRow[] = [];
    const seen = new Set<string>();
    for (const row of lists.flat()) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
    merged.sort((a, b) => a.name.localeCompare(b.name));
    setPoolStudents(merged);
    setExMap((prev) => {
      const next = { ...prev };
      for (const s of merged) {
        if (!next[s.id]) next[s.id] = { on: false, reason: '' };
      }
      return next;
    });
    setExModal(true);
  };

  const exceptionsPayload = useMemo(
    () =>
      Object.entries(exMap)
        .filter(([, v]) => v.on)
        .map(([student_id, v]) => ({ student_id, reason: v.reason.trim() || t.exceptionsHint })),
    [exMap, t.exceptionsHint],
  );

  /** Boshlanish-tugash oynasi (daqiqa). Uchala vaqt maydoni shu orqali bog'lanadi. */
  const examWindowMinutes = React.useMemo(() => {
    const a = toIsoOrNull(startLocal);
    const b = toIsoOrNull(endLocal);
    if (!a || !b) return null;
    const mins = Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000);
    return Number.isFinite(mins) ? mins : null;
  }, [startLocal, endLocal]);

  const validate = (): string | null => {
    if (!title.trim()) return t.title + ' ' + t.examManualEmptyQuestion.toLowerCase();
    if (audience === 'student' && selGroups.length === 0) return t.examCreateSelectGroup;
    if (!isValidDatetimeLocal(startLocal) || !isValidDatetimeLocal(endLocal)) return t.examDateTimeRequired;
    const startIso = toIsoOrNull(startLocal);
    const endIso = toIsoOrNull(endLocal);
    if (!startIso || !endIso) return t.examInvalidDateTime;
    if (new Date(startIso).getTime() >= new Date(endIso).getTime()) return t.examStartMustBeBeforeEnd;
    if (!Number.isFinite(duration) || duration <= 0) return t.examDurationInvalid;
    const windowMin = Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
    if (duration > windowMin)
      return t.examDurationExceedsWindow
        .replace('{dur}', String(duration))
        .replace('{window}', String(windowMin));
    if (audience !== 'student') {
      if (!selFacultyKafedraId) return t.examFacultyPickKafedra;
      if (!facultySubject.trim()) return t.examFacultyPickSubject;
      return null;
    }
    if (!imentorConfigured) return t.imentorNotConfigured;
    if (!selDepartment) return t.imentorPickDepartment;
    if (!selSubject) return t.imentorPickSubject;
    const picked = imentorSubjects.find((s) => s.subject_code === selSubject);
    if (!picked || (picked.test_count ?? 0) < 1) return t.imentorNoSubjects;
    if (imentorMaxQ !== 0 && (imentorMaxQ < imentorQLimits.min || imentorMaxQ > imentorQLimits.max)) {
      return t.imentorQuestionLimitInvalid;
    }
    return null;
  };

  const createExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });
    const err = validate();
    if (err) {
      setMsg({ type: 'err', text: err });
      return;
    }

    const startIso = toIsoOrNull(startLocal)!;
    const endIso = toIsoOrNull(endLocal)!;

    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        start_time: startIso,
        end_time: endIso,
        duration_minutes: duration,
        language,
        ambient_audio_enabled: ambientAudioEnabled,
        test_center_pin: testCenterPin,
        custom_rules: customRules,
        group_ids: audience !== 'student' ? [] : selGroups,
        exam_exceptions: audience !== 'student' ? [] : exceptionsPayload,
        audience,
        exam_mode: isUploadAudience
          ? 'static'
          : audience !== 'student'
            ? 'faculty_ai_books'
            : 'imentor_mixed',
        course: isUploadAudience ? Number(ordCourse) || 0 : 0,
        ai_question_count: isUploadAudience ? ordAiCount : 0,
        bank_question_count: isUploadAudience
          ? ordQuestionCount
          : audience !== 'student'
            ? 20
            : Math.max(0, imentorMaxQ),
        technical_retakes_allowed: Math.max(0, Math.min(20, technicalRetakesAllowed)),
      };
      if (audience === 'student') {
        body.imentor_subject_codes = selSubject ? [selSubject] : [];
        if (selVariant) body.imentor_variant_label = selVariant;
        if (selTopic) body.imentor_topic_code = selTopic;
      }
      if (audience !== 'student') {
        body.kafedra_id = Number(selFacultyKafedraId);
        body.faculty_subject = facultySubject.trim();
      }
      if (responsibleStaffId.trim()) body.teacher_id = responsibleStaffId.trim();

      // iMentor rejimida savollar shu so'rov ICHIDA olib, AI orqali 3 tilga
      // tarjima qilinadi — ko'p savol/fanda bir necha daqiqa cho'zilishi
      // mumkin. Ilgari bu yerda aniq timeout YO'Q edi va `catch` ham yo'q edi —
      // haqiqiy tarmoq xatosi bo'lsa foydalanuvchiga HECH NARSA ko'rsatilmasdi
      // (jim "osilib qolgan" tugma). Endi ikkalasi ham tuzatildi.
      // faculty_ai_books: savollar start paytida — create tez.
      const res = await fetchWithTimeout(
        apiUrl('/api/admin/exams'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...h },
          body: JSON.stringify(body),
        },
        audience !== 'student' ? 60_000 : 480_000,
      );

      if (!checkAdminAuthResponse(res)) return;
      const d = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) {
        setMsg({ type: 'err', text: d?.error || t.errorGeneric });
        return;
      }

      setMsg({ type: 'ok', text: t.examCreated });
      setTitle('');
      setCustomRules('');
      setResponsibleStaffId('');
      setSelDepartment('');
      setSelSubject('');
      setSelVariant('');
      setSelTopic('');
      setSelGroups([]);
      setSelFacultyKafedraId('');
      setFacultySubject('');
      setExMap({});
      setStartLocal(defaultExamStartLocal());
      setEndLocal(defaultExamEndLocal(duration));
    } catch {
      setMsg({ type: 'err', text: t.importNetworkError });
    } finally {
      setBusy(false);
    }
  };

  const stickyAlerts = useMemo(() => {
    const items: Array<{ type: 'ok' | 'err' | 'error' | 'success' | 'warning'; text: string; dismissible?: boolean }> = [];
    if (msg.text) {
      items.push({
        type: msg.type === 'ok' ? 'ok' : 'err',
        text: msg.text,
        dismissible: true,
      });
    }
    if (!imentorConfigured) {
      items.push({ type: 'warning', text: t.imentorNotConfigured, dismissible: true });
    } else if (imentorApiError) {
      items.push({ type: 'error', text: imentorApiError, dismissible: true });
    }
    return items;
  }, [msg, imentorConfigured, imentorApiError, t]);

  return (
    <div className="space-y-5">
      <AdminPageMessageStack
        messages={stickyAlerts}
        onDismiss={(m) => {
          if (msg.text && m.text === msg.text) setMsg({ type: '', text: '' });
        }}
      />
      <AdminCard
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        }
        iconBg="bg-blue-600"
        title={t.addExam}
        subtitle={t.examMethodImentor}
      >
        <div className="px-5 py-5 space-y-5">
          <form onSubmit={createExam} noValidate className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-4">
              <AdminField label={t.title} required>
                <AdminInput value={title} onChange={(e) => setTitle(e.target.value)} required />
              </AdminField>
              <AdminField label={t.language}>
                <AdminSelect value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="auto">{t.langAuto}</option>
                  <option value="uz">{t.langUzbek}</option>
                  <option value="ru">{t.langRussian}</option>
                  <option value="en">{t.langEnglish}</option>
                </AdminSelect>
              </AdminField>
            </div>

            <AdminField label={t.examAudienceLabel} required>
              <AdminSelect
                value={audience}
                onChange={(e) => {
                  const v = e.target.value;
                  setAudience(
                    v === 'faculty' || v === 'vacancy' || v === 'ordinator'
                      || v === 'magistr' || v === 'entrant'
                      ? v
                      : 'student',
                  );
                }}
              >
                <option value="student">{t.examAudienceStudent}</option>
                <option value="faculty">{t.examAudienceFaculty}</option>
                <option value="ordinator">
                  {lang === 'ru' ? 'Ordinator' : lang === 'en' ? 'Resident' : 'Ordinator'}
                </option>
                <option value="magistr">
                  {lang === 'ru' ? 'Magistr' : lang === 'en' ? 'Master student' : 'Magistr'}
                </option>
                <option value="entrant">
                  {lang === 'ru' ? 'Osobyy postupayushchiy' : lang === 'en'
                    ? 'Special entrant' : 'Maxsus kiruvchi'}
                </option>
                <option value="vacancy">{t.examAudienceVacancy}</option>
              </AdminSelect>
            </AdminField>
            {audience !== 'student' && (
              <>
                <p className="text-[13px] text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                  {isUploadAudience
                    ? lang === 'ru'
                      ? 'Voprosy zagruzhayet administrator (PDF/DOCX) na stranitse Ordinatory/Magistry. Kazhdomu vydayetsya sluchaynyy nabor, pri kazhdoy popytke — drugiye voprosy.'
                      : lang === 'en'
                        ? 'The administrator uploads the questions (PDF/DOCX) on the Residents / Masters page. Each person gets a random subset, and every attempt draws different questions.'
                        : "Savollarni AI emas, ADMIN yuklaydi (PDF/DOCX) — \"Ordinatorlar\" yoki \"Magistrlar\" sahifasidan. Har bir topshiruvchiga bankdan tasodifiy savollar tushadi, har urinishda boshqasi."
                    : t.examFacultyAiHint}
                </p>
                <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-4 sm:p-5 space-y-4">
                  <AdminField label={t.kafedraLabel} required>
                    <AdminSelect
                      value={selFacultyKafedraId}
                      onChange={(e) => setSelFacultyKafedraId(e.target.value)}
                    >
                      <option value="">{t.examFacultyPickKafedra}</option>
                      {kafedraOptions.map((kf) => (
                        <option key={kf.kafedra_id} value={String(kf.kafedra_id)}>
                          {kf.name}
                        </option>
                      ))}
                    </AdminSelect>
                    {kafedraOptions.length === 0 && (
                      <p className="text-[12px] text-amber-700 mt-1.5">{t.emptyKafedralar}</p>
                    )}
                  </AdminField>
                  {isUploadAudience ? (
                    <>
                      <AdminField label={t.imentorSubjectsLabel} required>
                        <AdminInput
                          value={facultySubject}
                          onChange={(e) => setFacultySubject(e.target.value)}
                          placeholder={
                            lang === 'ru'
                              ? 'Naprimer: DAK ordinatury 2 kurs'
                              : lang === 'en'
                                ? 'e.g. Residency final exam, year 2'
                                : "Masalan: 2-kurs ordinatura DAK"
                          }
                        />
                      </AdminField>
                      <AdminField
                        label={lang === 'ru' ? 'Kurs' : lang === 'en' ? 'Year' : 'Kurs'}
                        required
                      >
                        <AdminSelect
                          value={ordCourse}
                          onChange={(e) => setOrdCourse(e.target.value)}
                        >
                          <option value="1">
                            {lang === 'ru' ? '1 kurs' : lang === 'en' ? 'Year 1' : '1-kurs'}
                          </option>
                          <option value="2">
                            {lang === 'ru' ? '2 kurs (DAK)' : lang === 'en' ? 'Year 2 (final)' : '2-kurs (DAK)'}
                          </option>
                          <option value="0">
                            {lang === 'ru' ? 'Vse kursy' : lang === 'en' ? 'All years' : 'Barcha kurslar'}
                          </option>
                        </AdminSelect>
                      </AdminField>
                      <AdminField
                        label={
                          lang === 'ru'
                            ? 'Voprosov na cheloveka'
                            : lang === 'en'
                              ? 'Questions per person'
                              : 'Har bir kishiga savollar soni'
                        }
                        required
                      >
                        <AdminInput
                          type="number"
                          min={1}
                          max={200}
                          value={String(ordQuestionCount)}
                          onChange={(e) =>
                            setOrdQuestionCount(Math.max(1, Math.min(200, Number(e.target.value) || 20)))
                          }
                        />
                      </AdminField>
                      <AdminField
                        label={
                          lang === 'ru'
                            ? 'Iz nih sozdayet AI'
                            : lang === 'en'
                              ? 'Of these, generated by AI'
                              : 'Shundan AI yaratadi'
                        }
                      >
                        <AdminInput
                          type="number"
                          min={0}
                          max={50}
                          value={String(ordAiCount)}
                          onChange={(e) =>
                            setOrdAiCount(Math.max(0, Math.min(50, Number(e.target.value) || 0)))
                          }
                        />
                        <p className="text-[12px] text-gray-400 mt-1.5">
                          {lang === 'ru'
                            ? 'Ostalnye berutsya iz zagruzhennogo banka.'
                            : lang === 'en'
                              ? 'The rest come from the uploaded bank.'
                              : 'Qolgani yuklangan bankdan olinadi. Bank tarqalib ketgan bo\u2018lsa ham har bir topshiruvchiga yangi savollar tushadi.'}
                        </p>
                      </AdminField>
                    </>
                  ) : (
                  <AdminField label={t.imentorSubjectsLabel} required>
                    <AdminSelect
                      value={facultySubject}
                      onChange={(e) => setFacultySubject(e.target.value)}
                      disabled={!selectedFacultyDept}
                    >
                      <option value="">{t.examFacultyPickSubject}</option>
                      {(selectedFacultyDept?.subjects ?? []).map((subj) => (
                        <option key={subj} value={subj}>
                          {subj}
                        </option>
                      ))}
                    </AdminSelect>
                    <p className="text-[12px] text-gray-400 mt-1.5">{t.examFacultySubjectHint}</p>
                  </AdminField>
                  )}
                </div>
              </>
            )}

            {audience === 'student' && (
            <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium">
                {[
                  { n: 1, label: t.imentorStepDepartment },
                  { n: 2, label: t.imentorStepSubject },
                ].map((step) => {
                  const done =
                    (step.n === 1 && !!selDepartment) || (step.n === 2 && !!selSubject);
                  const active = catalogStep === step.n;
                  return (
                    <div key={step.n} className="flex items-center gap-2">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                          done
                            ? 'bg-blue-600 text-white'
                            : active
                              ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300'
                              : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {done ? '✓' : step.n}
                      </span>
                      <span className={active || done ? 'text-slate-700' : 'text-slate-400'}>{step.label}</span>
                      {step.n < 2 && <span className="text-slate-300 mx-1">→</span>}
                    </div>
                  );
                })}
              </div>

              <AdminField label={t.imentorDepartmentLabel} required>
                <AdminSelect
                  value={selDepartment}
                  onChange={(e) => onDepartmentChange(e.target.value)}
                  disabled={!imentorConfigured}
                >
                  <option value="">{t.imentorPickDepartment}</option>
                  {imentorDepartments.map((d) => {
                    const tests = d.tests_count ?? 0;
                    // Test soni ko'rsatiladi: o'qituvchi kafedrani ochmasdan
                    // turib unda imtihon uchun material bor-yo'qligini biladi.
                    const meta = tests > 0
                      ? `${d.subjects_count ?? 0} ${t.subjectsShort} · ${tests} ${t.testsShort}`
                      : `${d.subjects_count ?? 0} ${t.subjectsShort} · ${t.imentorDepartmentNoTests}`;
                    return (
                      <option key={d.code} value={d.code}>
                        {d.name} ({meta})
                      </option>
                    );
                  })}
                </AdminSelect>
                <p className="text-[12px] text-gray-400 mt-1.5">{t.imentorDepartmentHint}</p>
                {imentorConfigured && imentorDepartments.length === 0 && (
                  <p className="text-[12px] text-amber-700 mt-1.5">{t.imentorNoDepartments}</p>
                )}
              </AdminField>

              {selDepartment && (
                <AdminField label={t.imentorSubjectsLabel} required>
                  <AdminSelect
                    value={selSubject}
                    onChange={(e) => setSelSubject(e.target.value)}
                    disabled={subjectsLoading || imentorSubjects.length === 0}
                  >
                    <option value="">
                      {subjectsLoading
                        ? '…'
                        : subjectsWithTests.length === 0
                          ? t.imentorNoSubjects
                          : t.imentorPickSubject}
                    </option>
                    {imentorSubjects.map((s) => {
                      const hasTests = (s.test_count ?? 0) > 0;
                      const testLabel =
                        t.testsShort;
                      const meta = hasTests
                        ? `${s.test_count} ${testLabel}`
                        : t.imentorSubjectNoTests;
                      return (
                        <option key={s.subject_code} value={s.subject_code} disabled={!hasTests}>
                          {s.subject_name}
                          {meta ? ` (${meta})` : ''}
                        </option>
                      );
                    })}
                  </AdminSelect>
                  <p className="text-[12px] text-gray-400 mt-1.5">{t.imentorSubjectsHint}</p>
                </AdminField>
              )}

              {selSubject && subjectVariants.length > 0 && (
                <AdminField label={t.imentorVariantLabelOptional}>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelVariant('');
                        setSelTopic('');
                      }}
                      className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                        !selVariant
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50'
                      }`}
                    >
                      {t.imentorAnyVariant}
                    </button>
                    {subjectVariants.map((v) => {
                      const active = selVariant === v.label;
                      return (
                        <button
                          key={v.label}
                          type="button"
                          onClick={() => setSelVariant(v.label)}
                          className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                            active
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50'
                          }`}
                        >
                          {v.label}
                          {v.topics?.length ? (
                            <span className={`ml-1.5 text-[11px] ${active ? 'text-blue-100' : 'text-slate-400'}`}>
                              {v.topics.length}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[12px] text-gray-400 mt-1.5">{t.imentorVariantHint}</p>
                </AdminField>
              )}

              {selVariant && subjectTopics.length > 0 && (
                <AdminField label={t.imentorTopicLabelOptional}>
                  <AdminSelect value={selTopic} onChange={(e) => setSelTopic(e.target.value)}>
                    <option value="">{t.imentorAnyTopic}</option>
                    {subjectTopics.map((topic) => (
                      <option key={topic.code} value={topic.code}>
                        {topic.title} ({topic.code})
                      </option>
                    ))}
                  </AdminSelect>
                  <p className="text-[12px] text-gray-400 mt-1.5">{t.imentorTopicHint}</p>
                </AdminField>
              )}

              <AdminField label={t.imentorMaxQuestionsLabel}>
                <AdminInput
                  type="number"
                  min={0}
                  max={imentorQLimits.max}
                  value={imentorMaxQ}
                  onChange={(e) => setImentorMaxQ(Number(e.target.value))}
                  className="max-w-[180px]"
                />
                <p className="text-[12px] text-gray-400 mt-1.5">
                  {t.imentorMaxQuestionsHint
                    .replace('{min}', String(imentorQLimits.min))
                    .replace('{max}', String(imentorQLimits.max))}
                </p>
              </AdminField>
            </div>
            )}

            <AdminField label={t.examResponsibleLabel}>
              <AdminSelect value={responsibleStaffId} onChange={(e) => setResponsibleStaffId(e.target.value)}>
                <option value="">
                  {adminUserId ? `${t.examResponsibleSelf} (${adminUserId})` : t.examResponsibleSelf}
                </option>
                {staffUsers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.id}
                  </option>
                ))}
              </AdminSelect>
              {staffUsers.length === 0 && (
                <p className="text-[12px] text-amber-700 mt-1.5">{t.examNoStaffRosterHint}</p>
              )}
            </AdminField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AdminField label={t.startTime} required>
                <DateTimeField
                  value={startLocal}
                  onChange={(value) => {
                    setStartLocal(value);
                    if (isValidDatetimeLocal(value)) {
                      const end = new Date(value);
                      end.setMinutes(end.getMinutes() + duration);
                      setEndLocal(toDatetimeLocalValue(end));
                    }
                  }}
                  dateLabel={t.examDateLabel}
                  timeLabel={t.examTimeLabel}
                  hint={t.dateTimeHint24h}
                />
                <p className="text-[12px] text-gray-400 mt-1">{t.examDateTimeHint}</p>
              </AdminField>
              <AdminField label={t.endTime} required>
                <DateTimeField
                  value={endLocal}
                  onChange={setEndLocal}
                  min={startLocal || undefined}
                  dateLabel={t.examDateLabel}
                  timeLabel={t.examTimeLabel}
                  hint={t.dateTimeHint24h}
                />
              </AdminField>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-[160px_160px_1fr] gap-4">
              <AdminField label={`${t.duration} (min)`} required>
                <AdminInput
                  type="number"
                  min={5}
                  value={duration}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setDuration(next);
                    // Uchala maydon bog'liq: davomiylik oynadan katta bo'lib
                    // qolmasin — tugash vaqti avtomatik cho'ziladi. Aks holda
                    // admin faqat "Yaratish" bosganda xato ko'rardi.
                    if (Number.isFinite(next) && next > 0 && isValidDatetimeLocal(startLocal)) {
                      const minEnd = new Date(startLocal);
                      minEnd.setMinutes(minEnd.getMinutes() + next);
                      const curEnd = isValidDatetimeLocal(endLocal) ? new Date(endLocal) : null;
                      if (!curEnd || curEnd.getTime() < minEnd.getTime()) {
                        setEndLocal(toDatetimeLocalValue(minEnd));
                      }
                    }
                  }}
                  required
                />
                <p
                  className={`text-[12px] mt-1 ${
                    examWindowMinutes != null && duration > examWindowMinutes
                      ? 'text-red-600 font-medium'
                      : 'text-gray-400'
                  }`}
                >
                  {examWindowMinutes == null
                    ? ''
                    : t.examWindowHint
                        .replace('{window}', String(examWindowMinutes))
                        .replace('{dur}', String(duration))}
                </p>
              </AdminField>
              <AdminField label={t.technicalRetakesAllowedLabel}>
                <AdminInput
                  type="number"
                  min={0}
                  max={20}
                  value={technicalRetakesAllowed}
                  onChange={(e) => setTechnicalRetakesAllowed(Number(e.target.value))}
                  className="max-w-[180px]"
                />
              </AdminField>
              <AdminField label={t.ambientAudioLabel}>
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={ambientAudioEnabled}
                    onChange={(e) => setAmbientAudioEnabled(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-gray-800">
                      {ambientAudioEnabled ? t.ambientAudioOn : t.ambientAudioOff}
                    </span>
                    <span className="block text-[12px] text-gray-400 leading-snug mt-0.5">
                      {t.ambientAudioHint}
                    </span>
                  </span>
                </label>
              </AdminField>
              <AdminField label={lang === 'ru' ? 'PIN тестового центра (4 цифры)' : lang === 'en' ? 'Test-centre PIN (4 digits)' : 'Test markazi PIN (4 raqam)'}>
                <AdminInput
                  inputMode="numeric"
                  maxLength={4}
                  value={testCenterPin}
                  onChange={(e) => setTestCenterPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="—"
                  className="max-w-[140px] tracking-[0.3em]"
                />
                <p className="text-[12px] text-gray-400 mt-1.5 leading-snug">
                  {lang === 'ru'
                    ? 'Проверяющий вводит этот PIN на компьютере в тестовом центре: микрофон не контролируется, камера — полностью. Пусто — режим выключен.'
                    : lang === 'en'
                      ? 'The proctor enters this PIN on test-centre computers: the microphone is not monitored, the camera fully is. Empty — mode off.'
                      : "Tekshiruvchi test markazidagi kompyuterda kiritadi: mikrofon nazorat qilinmaydi, kamera to'liq ishlaydi. Bo'sh — rejim o'chiq."}
                </p>
              </AdminField>
              <AdminField label={`${t.customRules} (opt.)`}>
                <AdminTextarea value={customRules} onChange={(e) => setCustomRules(e.target.value)} />
              </AdminField>
            </div>

            {audience === 'student' && (
            <div>
              <AdminLabel required>{t.selectGroups}</AdminLabel>
              {groupDirectionOptions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <select
                    value={groupDirectionFilter}
                    onChange={(e) => setGroupDirectionFilter(e.target.value)}
                    className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[13px] text-gray-900"
                  >
                    <option value="">{t.selectDirectionFilter}</option>
                    {groupDirectionOptions.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  <AdminBtn
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!groupDirectionFilter}
                    onClick={selectAllGroupsInDirection}
                  >
                    {t.selectAllGroupsInDirection}
                  </AdminBtn>
                </div>
              )}
              <GroupMultiSelect
                groups={groups}
                value={selGroups}
                onChange={setSelGroups}
                lang={lang}
                onRefresh={loadMeta}
              />
              <AdminBtn type="button" variant="ghost" size="sm" className="mt-2" onClick={openExceptions}>
                {t.exceptionsBtn}
                {exceptionsPayload.length > 0 ? ` (${exceptionsPayload.length})` : ''}
              </AdminBtn>
            </div>
            )}

            <div className="pt-1">
              <AdminBtn
                type="submit"
                variant="blue"
                size="lg"
                loading={busy}
                icon={<PlusIcon size={16} />}
                className="w-full sm:w-auto"
              >
                {t.createExam}
              </AdminBtn>
            </div>
          </form>
        </div>
      </AdminCard>

      <AdminModal
        open={exModal}
        onClose={() => setExModal(false)}
        title={t.exceptionsTitle}
        subtitle={t.exceptionsHint}
        scroll
      >
        {exModal && (
          <>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {poolStudents.map((s) => (
                <div key={s.id} className="p-3 rounded-xl border border-gray-200 bg-gray-50/60 space-y-2">
                  <label className="flex items-center gap-2 text-[14px] font-medium text-gray-800">
                    <input
                      type="checkbox"
                      checked={exMap[s.id]?.on ?? false}
                      onChange={(e) =>
                        setExMap((p) => ({
                          ...p,
                          [s.id]: { on: e.target.checked, reason: p[s.id]?.reason || '' },
                        }))
                      }
                      className="w-4 h-4 rounded border-gray-300 accent-violet-600"
                    />
                    {s.name}
                    <span className="text-[12px] text-gray-400 font-mono">{s.id}</span>
                  </label>
                  {(exMap[s.id]?.on ?? false) && (
                    <AdminInput
                      placeholder={t.exceptionReason}
                      value={exMap[s.id]?.reason || ''}
                      onChange={(e) =>
                        setExMap((p) => ({
                          ...p,
                          [s.id]: { on: true, reason: e.target.value },
                        }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <AdminBtn variant="ghost" onClick={() => setExModal(false)}>
                {t.cancel}
              </AdminBtn>
              <AdminBtn variant="blue" onClick={() => setExModal(false)}>
                OK
              </AdminBtn>
            </div>
          </>
        )}
      </AdminModal>
    </div>
  );
}
