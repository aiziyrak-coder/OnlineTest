import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import { AdminEntityCrud } from './AdminEntityCrud';
import { AdminPageMessage, AdminTabs, AdminBtn, ChevronRight } from './ui';
import type { Level, Kafedra, Direction, Group } from './types';

/*
 * Kafedra → Yo'nalish → Kurs — bitta sahifa, uchta tab. Uchalasi ham bir xil
 * "nomli ro'yxat" CRUD'i bo'lgani uchun xatti-harakat `AdminEntityCrud` da.
 * Eski `/admin/levels`, `/admin/kafedralar`, `/admin/directions` havolalari
 * ishlashda davom etadi — ular mos tabni ochadi (`initialTab`).
 */

export type StructureTab = 'kafedralar' | 'directions' | 'levels';
const TAB_IDS: StructureTab[] = ['kafedralar', 'directions', 'levels'];

const ICONS = {
  kafedralar: (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 6v-3a1 1 0 011-1h2a1 1 0 011 1v3" />
    </svg>
  ),
  directions: (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0112 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
    </svg>
  ),
  levels: (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
};

interface Props {
  token: string;
  lang: Language;
  onViewGroups: (level: Level) => void;
  initialTab?: StructureTab;
}

export function StructurePage({ token, lang, onViewGroups, initialTab }: Props) {
  const t = translations[lang];
  const h = authHeaders(token, lang);
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('tab') as StructureTab | null;
  const tab: StructureTab =
    rawTab && TAB_IDS.includes(rawTab) ? rawTab : (initialTab ?? 'kafedralar');

  const [kafedralar, setKafedralar] = useState<Kafedra[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [msg, setMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [rK, rD, rL, rG] = await Promise.all([
      fetch(apiUrl('/api/admin/kafedralar'), { headers: h }),
      fetch(apiUrl('/api/admin/directions'), { headers: h }),
      fetch(apiUrl('/api/admin/levels'), { headers: h }),
      fetch(apiUrl('/api/admin/groups'), { headers: h }),
    ]);
    if (![rK, rD, rL, rG].every(checkAdminAuthResponse)) return;
    const [jK, jD, jL, jG] = await Promise.all([
      readJsonSafe<Kafedra[]>(rK),
      readJsonSafe<Direction[]>(rD),
      readJsonSafe<Level[]>(rL),
      readJsonSafe<Group[]>(rG),
    ]);
    setKafedralar(Array.isArray(jK) ? jK : []);
    setDirections(Array.isArray(jD) ? jD : []);
    setLevels(Array.isArray(jL) ? jL : []);
    setGroups(Array.isArray(jG) ? jG : []);
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const onSuccess = (text: string) => setMsg({ type: 'success', text });
  const onError = (text: string) => setMsg({ type: 'error', text });

  const groupsInLevel = (id: number) => groups.filter((g) => g.level_id === id).length;
  const groupsInDirection = (id: number) => groups.filter((g) => g.direction_id === id).length;

  const shared = { token, lang, onChanged: reload, onSuccess, onError };

  return (
    <div className="space-y-5">
      <AdminPageMessage message={msg} onDismiss={() => setMsg(null)} />

      <AdminTabs<StructureTab>
        tabs={[
          { id: 'kafedralar', label: t.kontingentKafedralar, count: kafedralar.length },
          { id: 'directions', label: t.kontingentDirections, count: directions.length },
          { id: 'levels', label: t.kontingentLevels, count: levels.length },
        ]}
        active={tab}
        onChange={(id) => setSearchParams({ tab: id }, { replace: true })}
      />

      {tab === 'kafedralar' && (
        <AdminEntityCrud<Kafedra>
          {...shared}
          endpoint="/api/admin/kafedralar"
          items={kafedralar}
          addTitle={t.kontingentAddKafedra}
          addSubtitle={t.kafedraSubtitle}
          addHint={t.kafedraHint}
          addButtonLabel={t.kontingentAddKafedra}
          addedOkText={t.kafedraAddedOk}
          listTitle={t.kontingentKafedralar}
          emptyTitle={t.emptyKafedralar}
          emptyHint={t.kafedraEmptyHint}
          emptyIcon={ICONS.kafedralar}
          fields={[
            { key: 'name', label: t.kafedraLabel, placeholder: t.kafedraPlaceholder, required: true },
            { key: 'code', label: t.kafedraCodeLabel, placeholder: t.kafedraCodePlaceholder, editClassName: 'w-28' },
          ]}
          editValues={(kf) => ({ name: kf.name, code: kf.code || '' })}
          toBody={(v, _aux, mode) => ({
            name: v.name.trim(),
            code: v.code.trim() || (mode === 'create' ? undefined : null),
          })}
          primaryText={(kf) => (
            <>
              {kf.name}
              {kf.code ? <span className="ml-2 text-[12px] font-mono text-gray-400">{kf.code}</span> : null}
            </>
          )}
          metaText={(kf) => `${kf.direction_count ?? 0} ${t.kontingentDirections}`}
          deleteBlockedText={(kf) =>
            (kf.direction_count ?? 0) > 0
              ? t.kafedraHasDirections.replace('{n}', String(kf.direction_count ?? 0))
              : null
          }
          deleteConfirmText={(kf) => t.kafedraDeleteConfirm.replace('{name}', kf.name)}
        />
      )}

      {tab === 'directions' && (
        <AdminEntityCrud<Direction>
          {...shared}
          endpoint="/api/admin/directions"
          items={directions}
          addTitle={t.kontingentAddDirection}
          addSubtitle={t.directionSubtitle}
          addHint={t.directionHint}
          addButtonLabel={t.kontingentAddDirection}
          addedOkText={t.directionAddedOk}
          listTitle={t.kontingentDirections}
          emptyTitle={t.emptyDirections}
          emptyHint={t.directionEmptyHint}
          emptyIcon={ICONS.directions}
          fields={[
            { key: 'name', label: t.directionLabel, placeholder: t.directionPlaceholder, required: true },
          ]}
          aux={{
            label: t.directionKafedraLabel,
            emptyText: t.directionKafedraNone,
            options: kafedralar.map((k) => ({ id: k.id, name: k.name })),
          }}
          auxInitial={(dr) =>
            dr.kafedra_ids?.length ? dr.kafedra_ids : (dr.kafedra_id ? [dr.kafedra_id] : [])
          }
          editValues={(dr) => ({ name: dr.name })}
          toBody={(v, auxIds) => ({ name: v.name.trim(), kafedra_ids: auxIds })}
          primaryText={(dr) => dr.name}
          metaText={(dr) => {
            const names = dr.kafedra_names?.length ? dr.kafedra_names.join(', ') : (dr.kafedra_name || '');
            const gc = `${groupsInDirection(dr.id)} ${t.kontingentGroups}`;
            return names ? `${names} · ${gc}` : gc;
          }}
          deleteBlockedText={(dr) =>
            groupsInDirection(dr.id) > 0
              ? t.directionHasGroups.replace('{n}', String(groupsInDirection(dr.id)))
              : null
          }
          deleteConfirmText={(dr) => t.directionDeleteConfirm.replace('{name}', dr.name)}
        />
      )}

      {tab === 'levels' && (
        <AdminEntityCrud<Level>
          {...shared}
          endpoint="/api/admin/levels"
          items={levels}
          addTitle={t.kontingentAddLevel}
          addSubtitle={t.levelSubtitle}
          addHint={t.levelHint}
          addButtonLabel={t.kontingentAddLevel}
          addedOkText={t.levelAddedOk}
          listTitle={t.kontingentLevels}
          emptyTitle={t.emptyLevels}
          emptyHint={t.levelEmptyHint}
          emptyIcon={ICONS.levels}
          fields={[
            { key: 'name', label: t.levelLabel, placeholder: t.levelPlaceholder, required: true },
          ]}
          editValues={(lv) => ({ name: lv.name })}
          toBody={(v) => ({ name: v.name.trim() })}
          primaryText={(lv) => lv.name}
          metaText={(lv) => `${groupsInLevel(lv.id)} ${t.kontingentGroups}`}
          deleteBlockedText={(lv) =>
            groupsInLevel(lv.id) > 0
              ? t.levelHasGroups.replace('{n}', String(groupsInLevel(lv.id)))
              : null
          }
          deleteConfirmText={(lv) => t.levelDeleteConfirm.replace('{name}', lv.name)}
          rowActions={(lv) => (
            <AdminBtn
              variant="violet"
              size="sm"
              onClick={() => onViewGroups(lv)}
              icon={<ChevronRight className="w-3.5 h-3.5 sm:hidden" />}
            >
              <span className="hidden sm:inline">{t.kontingentGroups}</span>
            </AdminBtn>
          )}
        />
      )}
    </div>
  );
}
