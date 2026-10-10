import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { createRealtimeSocket, buildRealtimeUrl } from '../lib/realtimeSocket';
import { apiUrl } from '../lib/apiUrl';
import { authHeaders } from '../lib/uiLangHeader';
import { checkAdminAuthResponse } from '../lib/http';
import { translations, Language } from '../i18n';
import { AdminBtn } from '../pages/admin/ui';

interface LiveMonitorProps {
  examId: number;
  token: string;
  lang: Language;
  onClose: () => void;
}

interface BanAlert {
  student_id: string;
  student_name: string;
  student_exam_id: number;
  reason: string;
  violations_count: number;
  resolved?: boolean;
}

interface StudentEntry {
  id: string;
  channel: string;
  name?: string;
}

export function LiveMonitor({ examId, token, lang, onClose }: LiveMonitorProps) {
  const t = translations[lang];
  const [students, setStudents] = useState<StudentEntry[]>([]);
  const [banAlerts, setBanAlerts] = useState<BanAlert[]>([]);
  /** Kritik hodisalar: topshiruvchiga ko'rsatilmaydi, nazoratchi shu yerda ko'radi. */
  const [proctorAlerts, setProctorAlerts] = useState<
    { id: string; student_id: string; student_name: string; label: string; at: string }[]
  >([]);
  const [unblockError, setUnblockError] = useState('');
  const [unblockBusy, setUnblockBusy] = useState<Record<number, boolean>>({});
  const wsRef = useRef<ReturnType<typeof createRealtimeSocket> | null>(null);
  const myChannelRef = useRef<string | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  const handleUnblock = async (seId: number, canRetake: boolean) => {
    setUnblockBusy((prev) => ({ ...prev, [seId]: true }));
    setUnblockError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/student_exams/${seId}/unblock`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(token, lang),
        },
        body: JSON.stringify({ can_retake: canRetake }),
      });
      if (!checkAdminAuthResponse(res) || !res.ok) {
        const errText = await res.text().catch(() => '');
        setUnblockError(errText || t.liveMonitorUnblockFailed);
        return;
      }
      setBanAlerts((prev) =>
        prev.map((a) => (a.student_exam_id === seId ? { ...a, resolved: true } : a)),
      );
    } catch {
      setUnblockError(t.liveMonitorUnblockFailed);
    } finally {
      setUnblockBusy((prev) => ({ ...prev, [seId]: false }));
    }
  };

  const handleGrantTechnicalRetakes = async (seId: number) => {
    setUnblockBusy((prev) => ({ ...prev, [seId]: true }));
    setUnblockError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/student_exams/${seId}/grant-technical-retakes`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(token, lang),
        },
        body: JSON.stringify({}),
      });
      if (!checkAdminAuthResponse(res) || !res.ok) {
        const errText = await res.text().catch(() => '');
        setUnblockError(errText || t.liveMonitorUnblockFailed);
        return;
      }
      setBanAlerts((prev) =>
        prev.map((a) => (a.student_exam_id === seId ? { ...a, resolved: true } : a)),
      );
    } catch {
      setUnblockError(t.liveMonitorUnblockFailed);
    } finally {
      setUnblockBusy((prev) => ({ ...prev, [seId]: false }));
    }
  };

  const handleFailStudent = async (seId: number) => {
    setUnblockBusy((prev) => ({ ...prev, [seId]: true }));
    setUnblockError('');
    try {
      const res = await fetch(apiUrl(`/api/admin/student_exams/${seId}/fail`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(token, lang),
        },
        body: JSON.stringify({}),
      });
      if (!checkAdminAuthResponse(res) || !res.ok) {
        const errText = await res.text().catch(() => '');
        setUnblockError(errText || t.liveMonitorUnblockFailed);
        return;
      }
      setBanAlerts((prev) =>
        prev.map((a) => (a.student_exam_id === seId ? { ...a, resolved: true } : a)),
      );
    } catch {
      setUnblockError(t.liveMonitorUnblockFailed);
    } finally {
      setUnblockBusy((prev) => ({ ...prev, [seId]: false }));
    }
  };

  useEffect(() => {
    const wsUrl = buildRealtimeUrl(token);
    const wsInstance = createRealtimeSocket(wsUrl, async (msg) => {
      if (msg.type === 'connected') {
        myChannelRef.current = msg.channel as string;
        wsInstance.send({ type: 'join_exam', exam_id: examId, role: 'proctor' });
      } else if (msg.type === 'student_banned') {
        const md = msg as any;
        setBanAlerts((prev) => {
          if (prev.find((a) => a.student_exam_id === md.student_exam_id)) return prev;
          return [
            ...prev,
            {
              student_id: md.student_id,
              student_name: md.student_name || md.student_id,
              student_exam_id: md.student_exam_id,
              reason: md.reason,
              violations_count: md.violations_count,
            },
          ];
        });
      } else if (msg.type === 'proctor_alert') {
        const a = msg as any;
        setProctorAlerts((prev) => [
          {
            id: `${a.student_id}:${a.violation_type}:${a.at}`,
            student_id: String(a.student_id || ''),
            student_name: String(a.student_name || a.student_id || ''),
            label: String(a.label || a.violation_type || ''),
            at: String(a.at || ''),
          },
          ...prev,
        ].slice(0, 30));
      } else if (msg.type === 'student_joined') {
        const channel = msg.channel as string;
        const userId = msg.user_id as string;
        const userName = (msg as any).user_name as string | undefined;

        setStudents((prev) => {
          if (prev.find((s) => s.channel === channel)) return prev;
          return [...prev, { id: userId, channel, name: userName }];
        });

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        peerConnectionsRef.current[channel] = pc;

        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            wsInstance.send({
              type: 'ice_candidate',
              to: channel,
              candidate: ev.candidate.toJSON(),
            });
          }
        };

        pc.ontrack = (ev) => {
          const video = videoRefs.current[channel];
          if (video) video.srcObject = ev.streams[0];
        };

        const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        wsInstance.send({
          type: 'offer',
          to: channel,
          offer,
          from_id: myChannelRef.current ?? '',
        });
      } else if (msg.type === 'answer') {
        const fromChannel = msg.from as string;
        const pc = peerConnectionsRef.current[fromChannel];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.answer as RTCSessionDescriptionInit));
        }
      } else if (msg.type === 'ice_candidate') {
        const fromChannel = msg.from as string;
        const pc = peerConnectionsRef.current[fromChannel];
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate as RTCIceCandidateInit));
        }
      }
    });
    wsRef.current = wsInstance;

    return () => {
      wsRef.current?.destroy();
      Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
    };
  }, [examId, token]);

  const activeAlerts = banAlerts.filter((a) => !a.resolved);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50">

      {/* ── Header ── */}
      <div className="shrink-0 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between px-5 h-14 gap-3">
          {/* Left: back + title */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 bg-white text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              {t.goBack}
            </button>

            <div className="h-4 w-px bg-gray-200 shrink-0" />

            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="text-[14px] font-semibold text-gray-900 truncate">
                {(t.liveMonitorTitle ?? 'Live Monitor — #{id}').replace('{id}', String(examId))}
              </span>
            </div>
          </div>

          {/* Right: student count badge */}
          <div className="flex items-center gap-2 shrink-0">
            {students.length > 0 && (
              <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-[12px] font-semibold">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {students.length}
              </span>
            )}
            {activeAlerts.length > 0 && (
              <span className="inline-flex items-center h-7 px-2.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-[12px] font-semibold">
                {activeAlerts.length} {t.bannedShort}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Ban alerts ── */}
      <AnimatePresence>
        {proctorAlerts.length > 0 && (
          <div className="shrink-0 px-5 pt-4">
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-bold text-amber-900">
                  Diqqat talab qiladigan hodisalar ({proctorAlerts.length})
                </span>
                <button
                  type="button"
                  onClick={() => setProctorAlerts([])}
                  className="text-[12px] font-medium text-amber-800 underline-offset-2 hover:underline"
                >
                  Tozalash
                </button>
              </div>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {proctorAlerts.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-[12.5px] text-amber-900">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" />
                    <span className="font-semibold">{a.student_name}</span>
                    <span className="truncate">{a.label}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-amber-700">
                      {a.at ? new Date(a.at).toLocaleTimeString() : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {(activeAlerts.length > 0 || unblockError) && (
          <div className="shrink-0 px-5 pt-4 space-y-2">
            {unblockError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-[13px] text-red-700 font-medium">
                {unblockError}
              </div>
            )}
            {activeAlerts.map((alert) => (
              <motion.div
                key={alert.student_exam_id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="bg-white border border-red-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wide mb-0.5">
                    {t.liveMonitorBannedAlert ?? 'TALABA BLOKLANDI'}
                  </p>
                  <p className="font-semibold text-gray-900 text-[14px] truncate">
                    {alert.student_name}
                    <span className="text-gray-400 font-normal ml-1.5 text-[12px] font-mono">#{alert.student_id}</span>
                  </p>
                  <p className="text-gray-500 text-[13px] mt-0.5">
                    <span className="font-medium text-gray-700">{t.liveMonitorReason ?? 'Sabab'}:</span>{' '}
                    {alert.reason}
                    <span className="ml-2 text-gray-400">· {alert.violations_count} qoidabuzarlik</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <AdminBtn
                    variant="emerald"
                    size="sm"
                    loading={unblockBusy[alert.student_exam_id]}
                    onClick={() => handleUnblock(alert.student_exam_id, true)}
                  >
                    {t.liveMonitorAllowRetake ?? 'Davom etishga ruxsat'}
                  </AdminBtn>
                  <AdminBtn
                    variant="blue"
                    size="sm"
                    loading={unblockBusy[alert.student_exam_id]}
                    onClick={() => handleGrantTechnicalRetakes(alert.student_exam_id)}
                  >
                    {t.liveMonitorGrantTechnicalRetakes ?? '+3 texnik imkon'}
                  </AdminBtn>
                  <AdminBtn
                    variant="red"
                    size="sm"
                    loading={unblockBusy[alert.student_exam_id]}
                    onClick={() => handleFailStudent(alert.student_exam_id)}
                  >
                    {t.liveMonitorFailStudent ?? 'Yiqib yuborish'}
                  </AdminBtn>
                  <AdminBtn
                    variant="ghost"
                    size="sm"
                    loading={unblockBusy[alert.student_exam_id]}
                    onClick={() => handleUnblock(alert.student_exam_id, false)}
                  >
                    {t.liveMonitorKeepBanned ?? 'Blokda qoldirish'}
                  </AdminBtn>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-5">
        {students.length === 0 ? (
          /* Empty state */
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="bg-white border border-gray-200 rounded-xl p-10 max-w-sm w-full">
              <div className="w-14 h-14 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-[15px] font-semibold text-gray-800 mb-1">
                {t.liveMonitorNoStudents ?? 'Hozircha talabalar ulanmagan'}
              </p>
              <p className="text-[13px] text-gray-500 mb-6">
                {t.liveMonitorNoStudentsHint ?? "Talabalar imtihonga kirganda bu yerda ko'rinadi."}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center gap-2 w-full h-9 rounded-lg border border-gray-200 bg-white text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                {t.goBackLong}
              </button>
            </div>
          </div>
        ) : (
          /* Student grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {students.map((student) => {
              const isBanned = banAlerts.some((a) => a.student_id === student.id && !a.resolved);
              const banAlert = banAlerts.find((a) => a.student_id === student.id && !a.resolved);
              return (
                <div
                  key={student.channel}
                  className={`bg-white rounded-lg border overflow-hidden transition-all ${
                    isBanned ? 'border-red-200' : 'border-gray-200'
                  }`}
                >
                  {/* Card header */}
                  <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${isBanned ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'}`}>
                    <div className={`w-2 h-2 rounded-full shrink-0 ${isBanned ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`} />
                    <span className="text-[13px] font-medium text-gray-800 truncate flex-1">
                      {student.name ?? `${t.liveMonitorStudentLabel ?? 'Talaba'} #${student.id}`}
                    </span>
                    {isBanned && (
                      <span className="text-[10px] font-bold text-red-600 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-md shrink-0">
                        {t.liveMonitorBanned ?? 'BLOKLANDI'}
                      </span>
                    )}
                  </div>

                  {/* Video */}
                  <div className="aspect-video bg-gray-900 relative">
                    <video
                      ref={(el) => { videoRefs.current[student.channel] = el; }}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />
                    {isBanned && banAlert && (
                      <div className="absolute inset-0 bg-gray-900/75 flex flex-col items-center justify-center gap-3 p-3">
                        <div className="w-10 h-10 rounded-full bg-red-500/20 border border-red-400/30 flex items-center justify-center">
                          <svg className="w-5 h-5 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                          </svg>
                        </div>
                        <span className="text-white/80 text-[11px] font-semibold tracking-widest uppercase">
                          {t.liveMonitorBanned ?? 'BLOKLANDI'}
                        </span>
                        <div className="flex flex-wrap gap-2 justify-center">
                          <button
                            type="button"
                            disabled={unblockBusy[banAlert.student_exam_id]}
                            onClick={() => handleUnblock(banAlert.student_exam_id, true)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors"
                          >
                            {t.liveMonitorAllowRetake ?? 'Ruxsat'}
                          </button>
                          <button
                            type="button"
                            disabled={unblockBusy[banAlert.student_exam_id]}
                            onClick={() => handleGrantTechnicalRetakes(banAlert.student_exam_id)}
                            className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors"
                          >
                            +3
                          </button>
                          <button
                            type="button"
                            disabled={unblockBusy[banAlert.student_exam_id]}
                            onClick={() => handleFailStudent(banAlert.student_exam_id)}
                            className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors"
                          >
                            {t.liveMonitorFailStudent ?? 'Yiqish'}
                          </button>
                          <button
                            type="button"
                            disabled={unblockBusy[banAlert.student_exam_id]}
                            onClick={() => handleUnblock(banAlert.student_exam_id, false)}
                            className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white text-[11px] font-semibold transition-colors border border-white/20"
                          >
                            {t.liveMonitorKeepBanned ?? 'Blok'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
