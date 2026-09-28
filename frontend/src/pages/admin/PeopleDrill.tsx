import { useEffect, useMemo, useState } from 'react';
import { Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { checkAdminAuthResponse } from '../../lib/http';
import { AdminBtn, AdminInput, AdminModal, AdminSelect } from './ui';

/*
 * Statistika kartochkasi ortidagi odamlar ro'yxati.
 *
 * Hisobotlardagi har bir raqam (qatnashganlar, qatnashmaganlar, o'tganlar...)
 * bosilganda shu oyna ochiladi: familiya bo'yicha tartiblangan ro'yxat, tepasida
 * qidiruv, guruh (kafedra/yo'nalish) va holat filtrlari.
 */

export interface DrillPerson {
  key: string;
  name: string;
  login: string;
  /** Kafedra, yo'nalish yoki fan — guruh filtri shu bo'yicha. */
  group?: string;
  /** Holat yorlig'i (o'tdi / o'tmadi / kelmadi ...) — holat filtri shu bo'yicha. */
  status?: string;
  statusTone?: 'good' | 'bad' | 'warn' | 'muted';
  /** O'ng ustunda ko'rsatiladigan qiymat (ball, foiz). */
  value?: string;
}

export interface DrillState {
  title: string;
  people: DrillPerson[];
  group?: string;
}

const TONE: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-700',
  bad: 'bg-red-50 text-red-700',
  warn: 'bg-amber-50 text-amber-800',
  muted: 'bg-gray-100 text-gray-600',
};

const TX = {
  uz: { search: 'Familiya, ism yoki login', group: 'Guruh', allGroups: 'Barchasi', status: 'Holat', all: 'Barchasi',
    sort: 'Tartib', az: 'Familiya A→Z', za: 'Familiya Z→A', empty: "Filtrga mos odam yo'q.", shown: 'ko‘rsatilmoqda',
    person: 'F.I.Sh.', login: 'Login', result: 'Natija', download: 'Excelga yuklash' },
  ru: { search: 'Фамилия, имя или логин', group: 'Группа', allGroups: 'Все', status: 'Статус', all: 'Все',
    sort: 'Порядок', az: 'Фамилия А→Я', za: 'Фамилия Я→А', empty: 'Нет людей по фильтру.', shown: 'показано',
    person: 'Ф.И.О.', login: 'Логин', result: 'Результат', download: 'Скачать Excel' },
  en: { search: 'Surname, name or login', group: 'Group', allGroups: 'All', status: 'Status', all: 'All',
    sort: 'Order', az: 'Surname A→Z', za: 'Surname Z→A', empty: 'Nobody matches the filter.', shown: 'shown',
    person: 'Full name', login: 'Login', result: 'Result', download: 'Download Excel' },
};

type Cell = string | number;

function downloadCsv(filename: string, columns: string[], rows: Cell[][]) {
  const esc = (v: Cell) => {
    const s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const body = [columns.map(esc).join(';'), ...rows.map((r) => r.map(esc).join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/\.xlsx$/, '.csv');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Fayl nomi uchun xavfsiz qism (kirill/lotin harflar saqlanadi). */
const slug = (s: string) =>
  (s || 'royxat').replace(/[\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'royxat';

/** Ro'yxatdagi F.I.Sh. odatda familiyadan boshlanadi — shuning uchun to'liq ism bo'yicha tartiblaymiz. */
const surnameKey = (name: string) => (name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uz');

export function PeopleDrillModal({
  lang,
  drill,
  onClose,
  groupLabel,
  token,
}: {
  lang: Language;
  drill: DrillState | null;
  onClose: () => void;
  groupLabel?: string;
  /** Berilsa — Excel serverda (.xlsx) yasaladi; aks holda CSV. */
  token?: string;
}) {
  const T = TX[lang as 'uz' | 'ru' | 'en'] || TX.uz;
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [status, setStatus] = useState('');
  const [dir, setDir] = useState<'az' | 'za'>('az');

  useEffect(() => {
    setQ('');
    setStatus('');
    setDir('az');
    setGroup(drill?.group || '');
  }, [drill]);

  const people = drill?.people || [];
  const groups = useMemo(
    () => Array.from(new Set(people.map((p) => p.group || '').filter(Boolean))).sort((a, b) => a.localeCompare(b, 'uz')),
    [people],
  );
  const statuses = useMemo(
    () => Array.from(new Set(people.map((p) => p.status || '').filter(Boolean))).sort((a, b) => a.localeCompare(b, 'uz')),
    [people],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('uz');
    const out = people.filter(
      (p) =>
        (!group || p.group === group) &&
        (!status || p.status === status) &&
        (!needle || p.name.toLocaleLowerCase('uz').includes(needle) || p.login.toLowerCase().includes(needle)),
    );
    out.sort((a, b) => surnameKey(a.name).localeCompare(surnameKey(b.name), 'uz'));
    if (dir === 'za') out.reverse();
    return out;
  }, [people, q, group, status, dir]);

  const hasValue = people.some((p) => p.value);
  const [busy, setBusy] = useState(false);

  /** Ekranda ko'rinib turgan (filtrlangan, tartiblangan) ro'yxatni yuklaydi. */
  const download = async () => {
    if (!drill || !rows.length) return;
    const gl = groupLabel || T.group;
    const columns = ['#', T.person, T.login, gl, T.status, T.result];
    const data: Cell[][] = rows.map((p, i) => [i + 1, p.name, p.login, p.group || '', p.status || '', p.value || '']);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${slug(drill.title)}-${stamp}.xlsx`;
    const sheets = [{ title: drill.title.slice(0, 31), columns, rows: data }];
    if (!token) {
      downloadCsv(filename, columns, data);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(apiUrl('/api/admin/reports/xlsx'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token, lang) },
        body: JSON.stringify({ title: drill.title, filename, sheets }),
      });
      if (!checkAdminAuthResponse(res)) return;
      if (!res.ok) {
        downloadCsv(filename, columns, data);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      downloadCsv(filename, columns, data);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminModal
      open={!!drill}
      onClose={onClose}
      title={drill ? `${drill.title} — ${people.length}` : ''}
      subtitle={rows.length !== people.length ? `${rows.length} ${T.shown}` : undefined}
      maxWidth="max-w-5xl"
      scroll
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
        <AdminInput type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T.search} autoFocus />
        <AdminSelect value={group} onChange={(e) => setGroup(e.target.value)} disabled={groups.length < 2} aria-label={groupLabel || T.group}>
          <option value="">{(groupLabel || T.group) + ': ' + T.allGroups}</option>
          {groups.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </AdminSelect>
        <AdminSelect value={status} onChange={(e) => setStatus(e.target.value)} disabled={statuses.length < 2} aria-label={T.status}>
          <option value="">{T.status + ': ' + T.all}</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </AdminSelect>
        <AdminSelect value={dir} onChange={(e) => setDir(e.target.value as 'az' | 'za')} aria-label={T.sort}>
          <option value="az">{T.az}</option>
          <option value="za">{T.za}</option>
        </AdminSelect>
        <AdminBtn variant="emerald" onClick={() => void download()} loading={busy} disabled={!rows.length || busy}>
          {T.download}
        </AdminBtn>
      </div>

      {rows.length ? (
        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-[13.5px]">
            <thead className="bg-gray-50/80 text-[12px] text-gray-500">
              <tr>
                <th className="w-10 px-3 py-2 text-left font-semibold">#</th>
                <th className="px-3 py-2 text-left font-semibold">{T.person}</th>
                {groups.length ? <th className="px-3 py-2 text-left font-semibold">{groupLabel || T.group}</th> : null}
                {statuses.length ? <th className="px-3 py-2 text-left font-semibold">{T.status}</th> : null}
                {hasValue ? <th className="px-3 py-2 text-right font-semibold" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.key} className="border-t border-gray-100 hover:bg-gray-50/70">
                  <td className="px-3 py-2 tabular-nums text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-gray-900">{p.name || p.login}</div>
                    <div className="font-mono text-[11.5px] text-gray-400">{p.login}</div>
                  </td>
                  {groups.length ? <td className="max-w-[220px] truncate px-3 py-2 text-gray-600" title={p.group}>{p.group || '—'}</td> : null}
                  {statuses.length ? (
                    <td className="px-3 py-2">
                      {p.status ? (
                        <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] ${TONE[p.statusTone || 'muted']}`}>{p.status}</span>
                      ) : null}
                    </td>
                  ) : null}
                  {hasValue ? <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">{p.value || ''}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 text-center text-[13.5px] text-gray-500">{T.empty}</p>
      )}
    </AdminModal>
  );
}
