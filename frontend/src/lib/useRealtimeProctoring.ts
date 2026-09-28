import { useEffect } from 'react';
import { RealtimeProctor, type RealtimeViolation, type FaceStatusLive, type LiveSignalType } from './realtimeProctor';

interface UseRealtimeProctoringOpts {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Real-time signal — odatda ExamRoom dagi logViolation ga ulanadi. */
  onViolation: (type: RealtimeViolation, detail?: string) => void;
  testCenter?: boolean;
  /** Person-swap shubhasi — darhol server identity-compare ishga tushiriladi. */
  onRecheckIdentity?: () => void;
  /** Har kadrda real-time yuz holati — kamera overlay uchun. */
  onFaceStatus?: (status: FaceStatusLive) => void;
  /** Davomiy signal (gapirish/bosh burilishi/pozitsiya) kichik→katta eskalatsiya holati. */
  onLiveSignal?: (type: LiveSignalType | null, elapsedMs: number) => void;
  /** Og'iz qimirlashi (Silero nutqini o'zi/boshqa deb ajratish). */
  onMouthActivity?: (active: boolean) => void;
  /** Har kadrda chetga qarash holati (javobdan oldin qarash naqshi uchun). */
  onSideGaze?: (dir: 'L' | 'R' | null) => void;
  /** Kichik ogohlantirish bosqichidagi barcha signallar — "3 kichik → rasmiy" qonuni uchun. */
  onSmallWarningStage?: (types: LiveSignalType[]) => void;
  /** Stream tayyor bo'lgani: shu o'zgarganda engine qayta ishga tushadi. */
  streamRevision?: number;
  /** Imtihon oldi tekshiruvida o'lchangan tabiiy ko'z ochiqligi (nisbiy nigoh nazorati). */
  eyeBaseline?: number | null;
  disabled?: boolean;
  /** Engine holati (+ yiqilgan bo'lsa sabab) — server logiga yuborish uchun. */
  onReady?: (ok: boolean, detail?: string) => void;
}

/**
 * MediaPipe asosidagi real-time proctoring (gaze/bosh burilishi, qimirlash,
 * qo'l/imo-ishora, ko'p yuz, yuz yo'q). Server proctoring bilan birga (gibrid) ishlaydi.
 * Model yuklanmasa jim o'chadi.
 */
export function useRealtimeProctoring({
  videoRef,
  onViolation,
  onRecheckIdentity,
  onFaceStatus,
  onLiveSignal,
  onMouthActivity,
  onSideGaze,
  onSmallWarningStage,
  streamRevision = 0,
  eyeBaseline = null,
  testCenter = false,
  disabled = false,
  onReady,
}: UseRealtimeProctoringOpts): void {
  useEffect(() => {
    if (disabled) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    const proctor = new RealtimeProctor(video, {
      onViolation,
      onRecheckIdentity,
      onFaceStatus,
      onLiveSignal,
      onMouthActivity,
      onSideGaze,
      onSmallWarningStage,
      onReady,
      onStatus: (m) => console.info('[realtime-proctor]', m),
    }, eyeBaseline, testCenter);

    void proctor.init().then((ok) => {
      if (cancelled) {
        proctor.dispose();
        return;
      }
      if (ok) proctor.start();
    });

    return () => {
      cancelled = true;
      proctor.dispose();
    };
    // streamRevision o'zgarsa (kamera qayta ishga tushsa) engine qayta yaratiladi.
  }, [disabled, streamRevision, testCenter]);
}
