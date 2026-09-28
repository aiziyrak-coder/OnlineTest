import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ADMIN_TOAST_AUTO_MS, pushAdminToast, type AdminPageMsg } from './adminToast';

export type { AdminPageMsg } from './adminToast';
export { AdminToastLayer } from './adminToast';

/*
 * Admin dizayn tizimi — "Quiet Enterprise".
 * Neytral kulrang asos + bitta indigo urg'u. Tekis ikonkalar, ingichka
 * chegaralar, kam soya, o'lchovli radius. Linear / Stripe / Vercel uslubi.
 *   accent  : indigo-600 (tugma/active/raqam/link)
 *   focus   : indigo-500 ring
 *   border  : gray-200   |  surface: white  |  app bg: gray-50
 */

const FOCUS = 'focus:outline-none focus:ring-4 focus:ring-indigo-500/15 focus:border-indigo-500';

/* ── Input ──────────────────────────────────────────────────────────────── */
export const AdminInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>((props, ref) => (
  <input
    ref={ref}
    {...props}
    className={`h-10 w-full rounded-lg border border-gray-300/80 bg-white px-3 text-[14px] text-gray-900 placeholder:text-gray-400 hover:border-gray-400/70 shadow-[0_1px_1px_rgba(13,27,42,0.03)] ${FOCUS} transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${props.className ?? ''}`}
  />
));
AdminInput.displayName = 'AdminInput';

/* ── File Input (custom — native "Choose File" o'rniga, bir xil ko'rinish) ── */
interface FileInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  buttonText?: string;
  placeholder?: string;
}
export const AdminFileInput = React.forwardRef<HTMLInputElement, FileInputProps>(
  ({ buttonText = 'Choose file', placeholder = 'No file selected', onChange, disabled, className, ...rest }, ref) => {
    const [fileName, setFileName] = React.useState('');
    return (
      <label
        className={`relative flex items-center gap-3 h-10 w-full rounded-lg border border-gray-300/80 bg-white px-1.5 transition-colors ${
          disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'cursor-pointer hover:border-gray-300 focus-within:ring-2 focus-within:ring-indigo-500/25 focus-within:border-indigo-500'
        }`}
      >
        <span className="inline-flex items-center gap-1.5 shrink-0 rounded-md bg-gray-100 text-gray-700 font-medium px-2.5 h-7 text-[13px]">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          {buttonText}
        </span>
        <span className={`truncate text-[13px] ${fileName ? 'text-gray-700' : 'text-gray-400'}`}>
          {fileName || placeholder}
        </span>
        <input
          ref={ref}
          type="file"
          disabled={disabled}
          onChange={(e) => {
            setFileName(e.target.files?.[0]?.name ?? '');
            onChange?.(e);
          }}
          {...rest}
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </label>
    );
  }
);
AdminFileInput.displayName = 'AdminFileInput';

/* ── Textarea ───────────────────────────────────────────────────────────── */
export const AdminTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>((props, ref) => (
  <textarea
    ref={ref}
    {...props}
    className={`w-full min-h-[72px] rounded-lg border border-gray-300/80 bg-white hover:border-gray-400/70 px-3 py-2 text-[14px] text-gray-900 placeholder:text-gray-400 ${FOCUS} transition-colors resize-y disabled:opacity-50 disabled:cursor-not-allowed ${props.className ?? ''}`}
  />
));
AdminTextarea.displayName = 'AdminTextarea';

/* ── Select ─────────────────────────────────────────────────────────────── */
export const AdminSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>((props, ref) => (
  <select
    ref={ref}
    {...props}
    className={`h-10 w-full rounded-lg border border-gray-300/80 bg-white px-3 pr-8 text-[14px] text-gray-900 hover:border-gray-400/70 shadow-[0_1px_1px_rgba(13,27,42,0.03)] ${FOCUS} transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${props.className ?? ''}`}
  />
));
AdminSelect.displayName = 'AdminSelect';

/* ── Label ──────────────────────────────────────────────────────────────── */
interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}
export const AdminLabel = ({ children, required, className, ...rest }: LabelProps) => (
  <label
    {...rest}
    className={`text-[13px] font-medium text-gray-600 block mb-1.5 ${className ?? ''}`}
  >
    {children}
    {required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
);

/* ── Field (Label + input slot) ─────────────────────────────────────────── */
interface FieldProps {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}
export const AdminField = ({ label, required, children, className }: FieldProps) => (
  <div className={`flex flex-col ${className ?? ''}`}>
    <AdminLabel required={required}>{label}</AdminLabel>
    {children}
  </div>
);

/* ── Button ─────────────────────────────────────────────────────────────── */
/* Variant nomlari saqlangan (call-site'lar buzilmaydi), lekin palitra jiddiy:
 * primary harakatlar = indigo; muvaffaqiyat = emerald; xavf = red; neytral = ghost. */
type BtnVariant = 'blue' | 'violet' | 'emerald' | 'red' | 'amber' | 'ghost' | 'red-ghost';

const PRIMARY = 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_4px_12px_-6px_rgba(14,109,137,0.75)]';
const VARIANT_CLS: Record<BtnVariant, string> = {
  blue:       PRIMARY,
  violet:     PRIMARY,
  amber:      'bg-amber-500 hover:bg-amber-600 text-white',
  emerald:    'bg-emerald-600 hover:bg-emerald-700 text-white',
  red:        'bg-red-600 hover:bg-red-700 text-white',
  ghost:      'border border-gray-300/80 text-gray-800 hover:bg-gray-50 hover:border-gray-400/70 bg-white shadow-[0_1px_1px_rgba(13,27,42,0.04)]',
  'red-ghost':'border border-red-200 text-red-600 hover:bg-red-50 bg-white',
};

type BtnSize = 'sm' | 'md' | 'lg';
const SIZE_CLS: Record<BtnSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-[13.5px]',
  lg: 'h-10 px-5 text-[14px]',
};

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export const AdminBtn = ({
  variant = 'blue',
  size = 'md',
  loading,
  icon,
  iconRight,
  children,
  disabled,
  className,
  ...rest
}: BtnProps) => (
  <button
    type="button"
    disabled={disabled || loading}
    {...rest}
    className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all active:translate-y-px focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${VARIANT_CLS[variant]} ${SIZE_CLS[size]} ${className ?? ''}`}
  >
    {loading ? (
      <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    ) : icon ? (
      <span className="shrink-0">{icon}</span>
    ) : null}
    {children}
    {iconRight && !loading && <span className="shrink-0">{iconRight}</span>}
  </button>
);

/* ── Section Label (bo'lim sarlavhasi — bir xil typografiya) ──────────────── */
export const AdminSectionLabel = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <h2
    className={`text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500 ${className ?? 'mb-3'}`}
  >
    {children}
  </h2>
);

/* ── Icon Button (yopish / kichik ikonka tugmalar) ───────────────────────── */
interface IconBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'gray' | 'red';
}
const ICON_BTN_TONE: Record<NonNullable<IconBtnProps['tone']>, string> = {
  gray: 'hover:bg-gray-100 text-gray-500 hover:text-gray-700',
  red: 'hover:bg-red-50 text-red-500',
};
export const AdminIconButton = ({ tone = 'gray', className, children, ...rest }: IconBtnProps) => (
  <button
    type="button"
    {...rest}
    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${ICON_BTN_TONE[tone]} ${className ?? ''}`}
  >
    {children}
  </button>
);

/* ── Section Card ────────────────────────────────────────────────────────── */
/* Ikonka endi neytral tekis kvadrat (rangli gradient tile emas). iconBg prop
 * mosligi uchun saqlangan, ammo e'tiborga olinmaydi. */
interface SectionCardProps {
  icon?: React.ReactNode;
  iconBg?: string;
  title: string;
  subtitle?: string;
  count?: number;
  right?: React.ReactNode;
  borderColor?: string;
  headerBg?: string;
  children: React.ReactNode;
}

export const AdminCard = ({
  icon,
  title,
  subtitle,
  count,
  right,
  borderColor = 'border-gray-200',
  headerBg = '',
  children,
}: SectionCardProps) => (
  <div className={`bg-white rounded-2xl border ${borderColor} overflow-hidden shadow-[0_1px_2px_rgba(13,27,42,0.04),0_8px_24px_-16px_rgba(13,27,42,0.10)]`}>
    <div className={`px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3 ${headerBg}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && (
          <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-gray-900 leading-tight truncate">{title}</h2>
          {subtitle && <p className="text-[12px] text-gray-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {count !== undefined && (
          <span className="text-[12.5px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full tabular-nums">{count}</span>
        )}
        {right}
      </div>
    </div>
    <div>{children}</div>
  </div>
);

/* ── Arrow icon (chap→o'ng) ──────────────────────────────────────────────── */
export const ChevronRight = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
  </svg>
);

/* ── Plus icon ───────────────────────────────────────────────────────────── */
export const PlusIcon = ({ size = 18 }: { size?: number }) => (
  <svg style={{ width: size, height: size }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
  </svg>
);

/* ── Spinner icon ────────────────────────────────────────────────────────── */
export const SpinnerIcon = () => (
  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

/* ── Empty state ─────────────────────────────────────────────────────────── */
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
}
export const AdminEmpty = ({ icon, title, subtitle }: EmptyStateProps) => (
  <div className="text-center py-14 px-6">
    {icon && (
      <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-3 text-indigo-600">
        {icon}
      </div>
    )}
    <p className="text-[14px] font-medium text-gray-600">{title}</p>
    {subtitle && <p className="text-[13px] text-gray-400 mt-1">{subtitle}</p>}
  </div>
);

/* ── Alert (error / success) ─────────────────────────────────────────────── */
export type AdminAlertType = 'error' | 'success' | 'warning';

interface AlertProps {
  type: AdminAlertType;
  children: React.ReactNode;
  compact?: boolean;
}
const ALERT_CLS: Record<AdminAlertType, string> = {
  error:   'text-red-700 bg-red-50 border-red-200',
  success: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  warning: 'text-amber-800 bg-amber-50 border-amber-200',
};
const ALERT_ICON: Record<AdminAlertType, React.ReactNode> = {
  error: (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  success: (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
};

export const AdminAlert = ({ type, children, compact }: AlertProps) => (
  <div
    className={`flex items-start gap-2.5 text-[13.5px] font-medium rounded-xl px-3.5 py-2.5 border ${compact ? 'mb-0' : 'mb-4'} ${ALERT_CLS[type]}`}
    role="alert"
  >
    {ALERT_ICON[type]}
    <div className="flex-1 min-w-0 leading-snug pt-0.5">{children}</div>
  </div>
);

export function normalizeAdminAlertType(type: AdminPageMsg['type']): AdminAlertType {
  if (type === 'ok' || type === 'success') return 'success';
  if (type === 'warning') return 'warning';
  return 'error';
}

interface AdminPageMessageProps {
  message: AdminPageMsg | null | undefined;
  onDismiss?: () => void;
  autoHideMs?: number;
}

/** Bitta sahifa xabari — global toast (sahifa almashtirilsa ham qoladi). */
export const AdminPageMessage = ({
  message,
  onDismiss,
  autoHideMs = ADMIN_TOAST_AUTO_MS,
}: AdminPageMessageProps) => {
  const pushedRef = useRef<string | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!message?.text) return;
    const sig = `${message.type}::${message.text}`;
    if (pushedRef.current === sig) return;
    pushedRef.current = sig;
    pushAdminToast(message, () => onDismissRef.current?.(), autoHideMs);
  }, [message?.type, message?.text, autoHideMs]);

  return null;
};

interface AdminPageMessageStackProps {
  messages: Array<AdminPageMsg | null | undefined>;
  onDismiss?: (message: AdminPageMsg) => void;
}

/** Bir nechta xabar — global toast stack. */
export const AdminPageMessageStack = ({ messages, onDismiss }: AdminPageMessageStackProps) => {
  const pushedRef = useRef<Set<string>>(new Set());
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const items = messages.filter((m): m is AdminPageMsg => Boolean(m?.text));
    items.forEach((m) => {
      const sig = `${m.type}::${m.text}`;
      if (pushedRef.current.has(sig)) return;
      pushedRef.current.add(sig);
      const canDismiss = m.dismissible !== false && Boolean(onDismissRef.current);
      pushAdminToast(m, canDismiss ? () => onDismissRef.current!(m) : undefined);
    });
  }, [messages]);

  return null;
};

/* ── Modal (bir xil backdrop + panel + header) ───────────────────────────── */
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  titleClassName?: string;
  maxWidth?: string;
  scroll?: boolean;
  children: React.ReactNode;
}
export const AdminModal = ({
  open,
  onClose,
  title,
  subtitle,
  titleClassName,
  maxWidth = 'max-w-lg',
  scroll = false,
  children,
}: ModalProps) => createPortal(
  <AnimatePresence>
    {open && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[100] bg-gray-950/45 backdrop-blur-[2px] flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          initial={{ scale: 0.98, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.98, opacity: 0, y: 8 }}
          transition={{ duration: 0.15 }}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : undefined}
          className={`admin-modal-panel w-full ${maxWidth} ${scroll ? 'max-h-[85vh] overflow-y-auto' : ''} bg-white rounded-2xl border border-gray-200 shadow-[0_24px_64px_-16px_rgba(13,27,42,0.35)] p-6`}
        >
          {(title || subtitle) && (
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="min-w-0">
                {title && (
                  <h3 className={`text-[17px] font-bold text-gray-900 truncate ${titleClassName ?? ''}`}>
                    {title}
                  </h3>
                )}
                {subtitle && <p className="text-[12.5px] text-gray-400 mt-0.5">{subtitle}</p>}
              </div>
              <AdminIconButton onClick={onClose}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </AdminIconButton>
            </div>
          )}
          {children}
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>, document.body
);

/* ── Pagination ─────────────────────────────────────────────────────────── */
export const ADMIN_PAGE_SIZE = 20;

/** Ro'yxatni sahifalarga bo'ladi (client-side). Filtr/qidiruv o'zgarsa sahifa
 * avtomatik 1-ga qaytadi. */
export function usePagedList<T>(items: T[], pageSize: number = ADMIN_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);
  const start = (safePage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  return { page: safePage, setPage, totalPages, pageItems, total: items.length, pageSize };
}

export function AdminPagination({
  page,
  totalPages,
  onPageChange,
  total,
  pageSize,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  total?: number;
  pageSize?: number;
}) {
  if (totalPages <= 1) return null;
  const from = total != null && pageSize ? (page - 1) * pageSize + 1 : null;
  const to = total != null && pageSize ? Math.min(page * pageSize, total) : null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100 flex-wrap">
      {from != null && to != null ? (
        <span className="text-[12px] text-gray-500">{from}–{to} / {total}</span>
      ) : <span />}
      <div className="flex items-center gap-1.5">
        <AdminBtn variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          ‹
        </AdminBtn>
        <span className="text-[13px] text-gray-600 font-medium tabular-nums px-1">
          {page} / {totalPages}
        </span>
        <AdminBtn variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          ›
        </AdminBtn>
      </div>
    </div>
  );
}
