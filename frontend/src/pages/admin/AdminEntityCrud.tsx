import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../../i18n';
import { apiUrl } from '../../lib/apiUrl';
import { authHeaders } from '../../lib/uiLangHeader';
import { readJsonSafe, checkAdminAuthResponse } from '../../lib/http';
import {
  AdminInput, AdminField, AdminBtn, AdminCard, AdminEmpty,
  AdminPagination, usePagedList, PlusIcon,
} from './ui';

/*
 * Bitta nomli ro'yxat (Kafedra / Yo'nalish / Kurs) uchun umumiy CRUD.
 * Ilgari uchala sahifa alohida ~300 qatordan yozilgan va bir-biridan ozgina
 * farq qilardi (raqamlash, xabar, tasdiq oynasi). Endi xatti-harakat bitta
 * joyda — farq faqat konfiguratsiyada.
 */

export type CrudEntity = { id: number };

export type CrudFieldSpec = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  /** Tahrirlash qatoridagi kenglik klassi, masalan 'w-28'. */
  editClassName?: string;
};

/** Ko'p tanlovli qo'shimcha maydon (yo'nalish → kafedralar). */
export type CrudAuxSpec = {
  label: string;
  emptyText: string;
  options: { id: number; name: string }[];
};

type Values = Record<string, string>;

interface Props<T extends CrudEntity> {
  token: string;
  lang: Language;
  endpoint: string;
  items: T[];
  onChanged: () => void;
  onSuccess: (text: string) => void;
  onError: (text: string) => void;

  addTitle: string;
  addSubtitle?: string;
  addHint?: string;
  addButtonLabel: string;
  addedOkText: string;

  listTitle: string;
  emptyTitle: string;
  emptyHint?: string;
  emptyIcon?: React.ReactNode;

  fields: CrudFieldSpec[];
  aux?: CrudAuxSpec;
  auxInitial?: (item: T) => number[];

  editValues: (item: T) => Values;
  toBody: (values: Values, auxIds: number[], mode: 'create' | 'update') => unknown;

  primaryText: (item: T) => React.ReactNode;
  metaText: (item: T) => React.ReactNode;
  deleteBlockedText?: (item: T) => string | null;
  deleteConfirmText: (item: T) => string;
  rowActions?: (item: T) => React.ReactNode;
}

const EditIcon = () => (
  <svg className="w-3.5 h-3.5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-3.5 h-3.5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const WarnIcon = () => (
  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

function AuxPicker({
  aux,
  selected,
  onToggle,
  compact,
}: {
  aux: CrudAuxSpec;
  selected: number[];
  onToggle: (id: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={`${compact ? 'w-full max-h-36' : 'max-h-44'} overflow-y-auto rounded-lg border border-gray-200 bg-white px-2 py-1.5 space-y-0.5`}>
      {aux.options.length === 0 ? (
        <p className="text-[12px] text-gray-400 px-1 py-1">{aux.emptyText}</p>
      ) : (
        aux.options.map((opt) => (
          <label
            key={opt.id}
            className="flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50 text-[13px] text-gray-700 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.includes(opt.id)}
              onChange={() => onToggle(opt.id)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="truncate">{opt.name}</span>
          </label>
        ))
      )}
    </div>
  );
}

export function AdminEntityCrud<T extends CrudEntity>({
  token, lang, endpoint, items, onChanged, onSuccess, onError,
  addTitle, addSubtitle, addHint, addButtonLabel, addedOkText,
  listTitle, emptyTitle, emptyHint, emptyIcon,
  fields, aux, auxInitial,
  editValues, toBody,
  primaryText, metaText, deleteBlockedText, deleteConfirmText, rowActions,
}: Props<T>) {
  const t = translations[lang];
  const h = authHeaders(token, lang);
  const paged = usePagedList(items);

  const emptyValues = (): Values => Object.fromEntries(fields.map((f) => [f.key, '']));

  const [newValues, setNewValues] = useState<Values>(emptyValues);
  const [newAux, setNewAux] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editVals, setEditVals] = useState<Values>({});
  const [editAux, setEditAux] = useState<number[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const toggle = (list: number[], id: number) =>
    (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const requiredMissing = fields.some((f) => f.required && !(newValues[f.key] || '').trim());

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (requiredMissing) return;
    setSaving(true);
    const res = await fetch(apiUrl(endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify(toBody(newValues, newAux, 'create')),
    });
    setSaving(false);
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) {
      setNewValues(emptyValues());
      setNewAux([]);
      onSuccess(addedOkText);
      onChanged();
    } else {
      const d = await readJsonSafe<{ error?: string }>(res);
      onError(d?.error || t.errorGeneric);
    }
  };

  const startEdit = (item: T) => {
    setEditingId(item.id);
    setEditVals(editValues(item));
    setEditAux(auxInitial ? auxInitial(item) : []);
    setEditError('');
    setDeleteConfirmId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditVals({});
    setEditAux([]);
    setEditError('');
  };

  const saveEdit = async (id: number) => {
    const first = fields.find((f) => f.required);
    if (first && !(editVals[first.key] || '').trim()) return;
    setEditSaving(true);
    setEditError('');
    const res = await fetch(apiUrl(`${endpoint}/${id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify(toBody(editVals, editAux, 'update')),
    });
    setEditSaving(false);
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) {
      cancelEdit();
      onChanged();
    } else {
      const d = await readJsonSafe<{ error?: string }>(res);
      setEditError(d?.error || t.errorGeneric);
    }
  };

  const remove = async (id: number) => {
    setDeletingId(id);
    const res = await fetch(apiUrl(`${endpoint}/${id}`), { method: 'DELETE', headers: h });
    setDeletingId(null);
    setDeleteConfirmId(null);
    if (!checkAdminAuthResponse(res)) return;
    if (res.ok) {
      onChanged();
    } else {
      const d = await readJsonSafe<{ error?: string }>(res);
      onError(d?.error || t.errorGeneric);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5 items-start">
      {/* ── Qo'shish ── */}
      <AdminCard icon={<PlusIcon />} title={addTitle} subtitle={addSubtitle}>
        <div className="px-5 py-4 space-y-4">
          <form onSubmit={add} className="space-y-4">
            {fields.map((f) => (
              <AdminField key={f.key} label={f.label} required={f.required}>
                <AdminInput
                  value={newValues[f.key] ?? ''}
                  onChange={(e) => setNewValues((p) => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  required={f.required}
                />
              </AdminField>
            ))}
            {aux && (
              <AdminField label={aux.label}>
                <AuxPicker aux={aux} selected={newAux} onToggle={(id) => setNewAux((p) => toggle(p, id))} />
              </AdminField>
            )}
            <AdminBtn
              type="submit"
              variant="blue"
              size="lg"
              loading={saving}
              disabled={requiredMissing}
              icon={<PlusIcon size={16} />}
              className="w-full"
            >
              {addButtonLabel}
            </AdminBtn>
          </form>
          {addHint && (
            <p className="text-[12px] text-gray-400 leading-relaxed border-t border-gray-100 pt-3">{addHint}</p>
          )}
        </div>
      </AdminCard>

      {/* ── Ro'yxat ── */}
      <AdminCard title={listTitle} count={items.length}>
        <div className="divide-y divide-gray-100">
          {items.length === 0 ? (
            <AdminEmpty icon={emptyIcon} title={emptyTitle} subtitle={emptyHint} />
          ) : (
            paged.pageItems.map((item, i) => {
              const isEditing = editingId === item.id;
              const isDeleteConfirm = deleteConfirmId === item.id;
              const blocked = deleteBlockedText ? deleteBlockedText(item) : null;

              return (
                <motion.div key={item.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-5 py-3 sm:py-4 transition-colors ${isEditing || isDeleteConfirm ? 'bg-gray-50/80' : 'hover:bg-gray-50'}`}>
                    <div className="w-9 h-9 rounded-lg bg-gray-100 text-gray-600 font-semibold flex items-center justify-center text-[15px] shrink-0 tabular-nums">
                      {paged.startIndex + i + 1}
                    </div>

                    {isEditing ? (
                      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
                        {fields.map((f, fi) => (
                          <AdminInput
                            key={f.key}
                            value={editVals[f.key] ?? ''}
                            onChange={(e) => setEditVals((p) => ({ ...p, [f.key]: e.target.value }))}
                            placeholder={f.placeholder}
                            autoFocus={fi === 0}
                            className={f.editClassName ?? 'flex-1 min-w-[140px]'}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit(item.id);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                          />
                        ))}
                        {aux && (
                          <AuxPicker aux={aux} selected={editAux} onToggle={(id) => setEditAux((p) => toggle(p, id))} compact />
                        )}
                        <AdminBtn variant="blue" size="sm" loading={editSaving} onClick={() => saveEdit(item.id)}>
                          {t.save}
                        </AdminBtn>
                        <AdminBtn variant="ghost" size="sm" onClick={cancelEdit}>
                          {t.cancel}
                        </AdminBtn>
                        {editError && <span className="text-[12px] text-red-600 w-full">{editError}</span>}
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-[130px]">
                          <p className="font-semibold text-gray-900 text-[14px] sm:text-[15px] truncate">
                            {primaryText(item)}
                          </p>
                          <p className="text-[12px] sm:text-[13px] text-gray-400 mt-0.5 truncate">{metaText(item)}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {rowActions?.(item)}
                          <AdminBtn variant="ghost" size="sm" onClick={() => startEdit(item)} icon={<EditIcon />}>
                            <span className="hidden sm:inline">{t.edit}</span>
                          </AdminBtn>
                          <AdminBtn
                            variant="red-ghost"
                            size="sm"
                            onClick={() => { setDeleteConfirmId(item.id); setEditingId(null); }}
                            icon={<TrashIcon />}
                          >
                            <span className="hidden sm:inline">{t.delete}</span>
                          </AdminBtn>
                        </div>
                      </>
                    )}
                  </div>

                  <AnimatePresence>
                    {isDeleteConfirm && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mx-5 mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                          {blocked ? (
                            <>
                              <p className="text-[13px] font-semibold text-red-700 flex items-center gap-2 mb-3">
                                <WarnIcon />
                                {blocked}
                              </p>
                              <AdminBtn variant="ghost" size="sm" onClick={() => setDeleteConfirmId(null)}>
                                {t.cancel}
                              </AdminBtn>
                            </>
                          ) : (
                            <>
                              <p className="text-[13px] font-semibold text-red-700 mb-3">{deleteConfirmText(item)}</p>
                              <div className="flex gap-2">
                                <AdminBtn variant="red" size="sm" loading={deletingId === item.id} onClick={() => remove(item.id)}>
                                  {t.adminDeleteBtn}
                                </AdminBtn>
                                <AdminBtn variant="ghost" size="sm" onClick={() => setDeleteConfirmId(null)}>
                                  {t.cancel}
                                </AdminBtn>
                              </div>
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })
          )}
        </div>
        <AdminPagination
          page={paged.page}
          totalPages={paged.totalPages}
          onPageChange={paged.setPage}
          total={paged.total}
          pageSize={paged.pageSize}
        />
      </AdminCard>
    </div>
  );
}
