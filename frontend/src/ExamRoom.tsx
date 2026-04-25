import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, CardContent, CardHeader, CardTitle } from './components/ui';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import '@tensorflow/tfjs';
import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision';
import { motion, AnimatePresence } from 'motion/react';
import { Calculator } from './components/Calculator';
import { io, Socket } from 'socket.io-client';
import { translations, Language } from './i18n';
import { readJsonSafe } from './lib/http';
import { apiUrl } from './lib/apiUrl';
import { examAuthHeaders } from './lib/deviceFingerprint';
import { buildGuardedExamHeaders } from './lib/examRequestGuard';
import type { ExamResultPayload } from './components/ExamResultSummary';
import {
  openPreferredProctorStream,
  VIRTUAL_CAMERA_BLOCKED_MESSAGE,
} from './lib/preferredCameraStream';

// Identity check: har 90 soniyada (45s → 90s: Gemini token tejash)
const IDENTITY_CHECK_MS = 90_000;
/** Yuz yo'q deb hisoblashdan oldin kutish (FACE_NOT_VISIBLE). */
const NO_FACE_VIOLATION_MS = 4500;
/** COCO: telefon/kitob/noutbuk uchun minimal ishonch. */
const FORBIDDEN_OBJECT_MIN_SCORE = 0.52;

// Rasm hajmini kamaytirish uchun (Gemini ga yuborishdan oldin)
function compressToJpeg(video: HTMLVideoElement, quality = 0.55, maxW = 320): string {
  const scale = maxW / (video.videoWidth || maxW);
  const w = Math.round((video.videoWidth || maxW) * Math.min(scale, 1));
  const h = Math.round((video.videoHeight || 240) * Math.min(scale, 1));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05
    }
  }
};

const item: any = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

interface ExamRoomProps {
  exam: any;
  studentExamId: number;
  token: string;
  user: any;
  lang: Language;
  onFinish: (submitPayload?: ExamResultPayload | null) => void;
}

function extractQuestionImages(text: string): { cleanText: string; images: string[] } {
  const src = text || '';
  const images: string[] = [];
  const mdRe = /!\[[^\]]*\]\((https?:\/\/[^\s)]+\.(?:png|jpe?g|gif|webp))\)/gi;
  let clean = src.replace(mdRe, (_, url: string) => {
    images.push(url);
    return '';
  });
  const rawRe = /(https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|webp))/gi;
  clean = clean.replace(rawRe, (url: string) => {
    if (!images.includes(url)) images.push(url);
    return '';
  });
  return { cleanText: clean.trim(), images };
}

function initialSecondsLeft(exam: ExamRoomProps['exam']) {
  if (exam.submission_deadline) {
    const end = new Date(exam.submission_deadline).getTime();
    const s = Math.floor((end - Date.now()) / 1000);
    if (!Number.isNaN(end) && s > 0) return s;
  }
  if (!exam.startedAt) return exam.duration_minutes * 60;
  const startedAtTime = new Date(exam.startedAt).getTime();
  const elapsedSeconds = Math.floor((Date.now() - startedAtTime) / 1000);
  const totalDurationSeconds = exam.duration_minutes * 60;
  const remaining = totalDurationSeconds - elapsedSeconds;
  return remaining > 0 ? remaining : 0;
}

// Ogohlantirish modal uchun state turi
interface ViolationWarning {
  reason: string;
  warningNumber: number;
  isFinalWarning: boolean;
}

export function ExamRoom({ exam, studentExamId, token, user, lang, onFinish }: ExamRoomProps) {
  const t = translations[lang];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flaggedQuestions, setFlaggedQuestions] = useState<number[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  /** Internet bor, lekin Socket.io (proktor/realtime) ulanmagan yoki uzilgan. */
  const [realtimeSyncOffline, setRealtimeSyncOffline] = useState(false);
  const [banned, setBanned] = useState(false);
  const [timeLeft, setTimeLeft] = useState(() => initialSecondsLeft(exam));
  const [showTimeWarning, setShowTimeWarning] = useState(false);
  /** Ogohlantirish bosqichi 1–3 (serverdagi warn_types soni; ban 4-chi hodisada). */
  const [strikeLevel, setStrikeLevel] = useState(0);
  const [warningMsg, setWarningMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hardBlocked, setHardBlocked] = useState(false);
  const [banPdfBusy, setBanPdfBusy] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [appealFile, setAppealFile] = useState<File | null>(null);
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealMsg, setAppealMsg] = useState('');
  /** BAN paytida serverdagi jami violation yozuvlari (3 ta "!" o‘rniga) */
  const [banViolationsCount, setBanViolationsCount] = useState<number | null>(null);
  // Ogohlantirish modal
  const [violationWarning, setViolationWarning] = useState<ViolationWarning | null>(null);
  /** Kamera oqimi video elementga ulangach +1 (async setup va ref vaqti sinxroni). */
  const [proctorStreamRevision, setProctorStreamRevision] = useState(0);
  const [cameraPreviewOk, setCameraPreviewOk] = useState(false);
  const [cameraErrorHint, setCameraErrorHint] = useState('');
  const seqRef = useRef<number>(Number(exam.sessionSeqStart || 1));

  useEffect(() => {
    seqRef.current = Number(exam.sessionSeqStart || 1);
  }, [exam.sessionSeqStart, exam.id]);

  const nextGuardHeaders = useCallback(
    async (method: string, path: string) =>
      buildGuardedExamHeaders({
        token,
        examId: exam.id,
        studentExamId,
        studentId: String(user.id),
        sessionKey: exam.sessionKey,
        challengeSeed: exam.sessionChallenge,
        seq: seqRef.current,
        method,
        path,
      }),
    [token, exam.id, exam.sessionKey, exam.sessionChallenge, studentExamId, user.id],
  );

  const advanceSeq = () => {
    seqRef.current += 1;
  };

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/draft`), {
          headers: await nextGuardHeaders('GET', `/api/student/exams/${exam.id}/draft`),
        });
        advanceSeq();
        const data = await readJsonSafe<{
          answers?: Record<string, string>;
          flaggedQuestions?: number[];
          updated_at?: string | null;
        }>(res);
        if (!res.ok || cancelled) return;
        const localRaw = localStorage.getItem(`exam_answers_${exam.id}`);
        const localAns = localRaw ? (JSON.parse(localRaw) as Record<string, string>) : {};
        const srv = (data.answers && typeof data.answers === 'object' ? data.answers : {}) as Record<string, string>;
        const merged = { ...srv, ...localAns };
        if (Object.keys(merged).length > 0) setAnswers(merged);
        if (Array.isArray(data.flaggedQuestions) && data.flaggedQuestions.length > 0) {
          setFlaggedQuestions(data.flaggedQuestions);
        }
      } catch {
        const saved = localStorage.getItem(`exam_answers_${exam.id}`);
        if (saved && !cancelled) setAnswers(JSON.parse(saved) as Record<string, string>);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exam.id, token, nextGuardHeaders]);

  useEffect(() => {
    localStorage.setItem(`exam_answers_${exam.id}`, JSON.stringify(answers));
    localStorage.setItem(`exam_answers_ts_${exam.id}`, String(Date.now()));
  }, [answers, exam.id]);

  useEffect(() => {
    if (banned) return;
    const id = window.setTimeout(() => {
      const body = JSON.stringify({ answers, flaggedQuestions });
      const attempt = async (n: number): Promise<void> => {
        try {
          const r = await fetch(apiUrl(`/api/student/exams/${exam.id}/save-progress`), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(await nextGuardHeaders('POST', `/api/student/exams/${exam.id}/save-progress`)),
            },
            body,
          });
          advanceSeq();
          if (r.ok) {
            return;
          }
          if (n < 2 && (r.status >= 500 || r.status === 429)) {
            await new Promise((res) => setTimeout(res, 800 * (n + 1)));
            return attempt(n + 1);
          }
        } catch {
          if (n < 2) {
            await new Promise((res) => setTimeout(res, 800 * (n + 1)));
            return attempt(n + 1);
          }
        }
      };
      void attempt(0);
    }, 22000);
    return () => clearTimeout(id);
  }, [answers, flaggedQuestions, exam.id, token, banned, nextGuardHeaders]);

  useEffect(() => {
    if (banned) return;
    const sync = async () => {
      try {
        const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/clock`), {
          headers: await nextGuardHeaders('GET', `/api/student/exams/${exam.id}/clock`),
        });
        advanceSeq();
        const data = await readJsonSafe<{ seconds_remaining?: number }>(res);
        if (res.ok && typeof data.seconds_remaining === 'number') {
          setTimeLeft((prev) => {
            const srv = data.seconds_remaining ?? 0;
            if (Math.abs(srv - prev) > 120) return srv;
            return prev;
          });
        }
      } catch {
        /* ignore */
      }
    };
    sync();
    const iv = window.setInterval(sync, 45000);
    return () => clearInterval(iv);
  }, [exam.id, token, banned, nextGuardHeaders]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t.leaveExamWarning;
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [t.leaveExamWarning]);

  // Fullscreen kirish vaqtini kuzatish (blur/fullscreenchange false positive oldini olish)
  const fullscreenRequestedRef = useRef(false);
  const fullscreenEnteredRef = useRef(false);
  const blurIgnoreUntilRef = useRef(0); // timestamp: shu vaqtgacha blur ignore qilinadi

  useEffect(() => {
    const ua = navigator.userAgent || '';
    if (/anydesk|teamviewer|rustdesk|splashtop/i.test(ua)) {
      void logViolationRef.current('REMOTE_CONTROL_SUSPECTED');
    }
    if ((navigator as any).webdriver) {
      void logViolationRef.current('REMOTE_CONTROL_SUSPECTED');
    }
    // Eslatma: maxTouchPoints + tor brauzer oynasi (masalan 900px) "mobil" deb noto'g'ri
    // REMOTE_CONTROL yuborardi — Windows sensorli noutbuklar tez-tez ban. Alohida yuborilmaydi.

    const clearBlurTimer = () => {
      if (blurViolationTimerRef.current !== null) {
        window.clearTimeout(blurViolationTimerRef.current);
        blurViolationTimerRef.current = null;
      }
    };

    // Blur: faqat fullscreen rejimida va fullscreen so'ralayotgan paytda emas
    const onBlur = () => {
      if (bannedRef.current) return;
      const now = Date.now();
      // Fullscreen so'ralayotgan paytda (2 soniya) blur ignore
      if (now < blurIgnoreUntilRef.current) return;
      clearBlurTimer();
      blurViolationTimerRef.current = window.setTimeout(() => {
        blurViolationTimerRef.current = null;
        if (bannedRef.current) return;
        if (document.hasFocus()) return;
        // Fullscreen bo'lmagan holatda blur ko'p false-positive beradi (OS popup, browser UI).
        // Shu sabab blur eventdan HARD violation yubormaymiz.
        if (!document.fullscreenElement) {
          return;
        }
        // Fullscreen rejimida blur — boshqa dastur focus oldi, lekin biz hali fullscreendamiz
        // Bu hard block emas — soft violation
        void logViolationRef.current('TAB_SWITCH_SOFT');
      }, 900);
    };

    // Fullscreen o'zgarishi
    const onFs = () => {
      if (bannedRef.current) return;
      if (document.fullscreenElement) {
        // Fullscreen kirildi — bu yaxshi
        fullscreenEnteredRef.current = true;
        fullscreenRequestedRef.current = false;
        clearBlurTimer();
        return;
      }
      // Fullscreen chiqildi
      if (!fullscreenEnteredRef.current) {
        // Hali fullscreanga kirmagan — ignore (boshlang'ich holat)
        return;
      }
      // Foydalanuvchi fullscreendan chiqdi — ogohlantirish, darhol ban emas
      void logViolationRef.current('FULLSCREEN_EXIT_HARD');
    };

    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      clearBlurTimer();
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  const [qIndex, setQIndex] = useState(0);
  const answeredCount = Object.keys(answers).length;
  const totalQuestions = exam.questions.length;
  const progress = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;
  const currentQ = exam.questions[qIndex];
  const currentQParsed = extractQuestionImages(currentQ?.text || '');

  const videoRef = useRef<HTMLVideoElement>(null);
  const bannedRef = useRef(banned);
  const tokenRef = useRef(token);
  const examIdRef = useRef(exam.id);
  const answersRef = useRef(answers);
  const flaggedRef = useRef(flaggedQuestions);
  const submittingRef = useRef(false);
  const loopTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  useEffect(() => {
    flaggedRef.current = flaggedQuestions;
  }, [flaggedQuestions]);

  useEffect(() => {
    bannedRef.current = banned;
  }, [banned]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    examIdRef.current = exam.id;
  }, [exam.id]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  
  const faceDetectorRef = useRef<FaceDetector | null>(null);
  const objectDetectorRef = useRef<cocoSsd.ObjectDetection | null>(null);
  const lastFaceTimeRef = useRef(Date.now());
  const singleFaceRef = useRef(false);
  const identityCheckBusyRef = useRef(false);
  const logViolationRef = useRef<(type: string) => Promise<void>>(async () => {});
  const isProcessingRef = useRef(false);
  /** DevTools/clipboard/varaq — bir "urinish"da yuboriladigan bir nechta signal; bittasini yuborish. */
  const focusBurstLockUntilRef = useRef(0);
  const blurViolationTimerRef = useRef<number | null>(null);
  const hiddenViolationTimerRef = useRef<number | null>(null);
  const FOCUS_BURST_TYPES = new Set([
    'DEVTOOLS_OPEN',
    'CLIPBOARD_ATTEMPT',
    'TAB_SWITCH_HARD',
    'TAB_SWITCH_SOFT',
    'FULLSCREEN_EXIT_HARD',
  ]);
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionsRef = useRef<{ [id: string]: RTCPeerConnection }>({});

  useEffect(() => {
    if (banned) return;
    const s = streamRef.current;
    const v = videoRef.current;
    if (!s || !v) return;
    const tz = translations[lang];
    if (v.srcObject !== s) v.srcObject = s;
    const tryPlay = () => {
      void v
        .play()
        .then(() => {
          setCameraPreviewOk(true);
          setCameraErrorHint('');
        })
        .catch(() => {
          setCameraPreviewOk(false);
          setCameraErrorHint(tz.examCameraPlayBlocked);
        });
    };
    tryPlay();
    v.addEventListener('loadeddata', tryPlay, { once: true });
    const t1 = window.setTimeout(tryPlay, 350);
    const t2 = window.setTimeout(tryPlay, 900);
    return () => {
      v.removeEventListener('loadeddata', tryPlay);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [proctorStreamRevision, banned, lang]);

  // --- AI Proctoring Setup & Security ---
  useEffect(() => {
    if (banned) return;

    // Security: Disable right click, copy/paste, and keyboard shortcuts (+ hard violation logging)
    const handleContextMenu = (e: Event) => {
      e.preventDefault();
      void logViolationRef.current('CLIPBOARD_ATTEMPT');
    };
    const handleCopyPaste = (e: Event) => {
      e.preventDefault();
      void logViolationRef.current('CLIPBOARD_ATTEMPT');
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || '').toLowerCase();
      const isClipboardCombo = (e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'a'].includes(key);
      const isDevtoolsCombo =
        key === 'f12' ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(key)) ||
        ((e.ctrlKey || e.metaKey) && key === 'u');
      if (key === 'printscreen') {
        e.preventDefault();
        void logViolationRef.current('PRINT_SCREEN');
        return;
      }
      if (isDevtoolsCombo) {
        e.preventDefault();
        void logViolationRef.current('DEVTOOLS_OPEN');
        return;
      }
      if (isClipboardCombo) {
        e.preventDefault();
        void logViolationRef.current('CLIPBOARD_ATTEMPT');
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleCopyPaste);
    document.addEventListener('paste', handleCopyPaste);
    document.addEventListener('cut', handleCopyPaste);
    document.addEventListener('keydown', handleKeyDown);

    const devtoolsTick = window.setInterval(() => {
      if (bannedRef.current) return;
      const dw = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
      const dh = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
      if (dw > 200 && dh > 100) {
        void logViolationRef.current('DEVTOOLS_OPEN');
      }
    }, 12_000);

    // requestFullscreen faqat foydalanuvchi jesti (click/touch) bilan — useEffect o'zi "user gesture" emas
    const onFirstUserGesture = () => {
      if (document.fullscreenElement) {
        window.removeEventListener('pointerdown', onFirstUserGesture, true);
        return;
      }
      if (document.documentElement.requestFullscreen) {
        fullscreenRequestedRef.current = true;
        blurIgnoreUntilRef.current = Date.now() + 3000;
        void document.documentElement.requestFullscreen().then(
          () => {
            window.removeEventListener('pointerdown', onFirstUserGesture, true);
          },
          () => {
            fullscreenRequestedRef.current = false;
          }
        );
      } else {
        window.removeEventListener('pointerdown', onFirstUserGesture, true);
      }
    };
    window.addEventListener('pointerdown', onFirstUserGesture, { capture: true });

    const setupAI = async () => {
      try {
        setCameraErrorHint('');
        setCameraPreviewOk(false);
        const stream = await openPreferredProctorStream();
        streamRef.current = stream;
        setProctorStreamRevision((n) => n + 1);

        // Socket.IO alohida realtime server (backend/realtime); devda odatda :3001
        const socketUrl =
          (import.meta.env.VITE_SOCKET_URL as string | undefined)?.trim() ||
          (import.meta.env.DEV ? 'http://127.0.0.1:3001' : undefined);
        const socketOpts = {
          path: '/socket.io',
          auth: { token },
          reconnectionDelay: 3000,
          reconnectionDelayMax: 20000,
          reconnectionAttempts: 12,
        };
        const socket = socketUrl ? io(socketUrl, socketOpts) : io(socketOpts);
        socketRef.current = socket;

        const socketEverConnectedRef = { current: false };
        socket.on('connect', () => {
          socketEverConnectedRef.current = true;
          setRealtimeSyncOffline(false);
        });
        socket.on('disconnect', () => {
          if (socketEverConnectedRef.current) setRealtimeSyncOffline(true);
        });
        socket.on('reconnect', () => {
          setRealtimeSyncOffline(false);
        });
        socket.on('reconnect_failed', () => {
          setRealtimeSyncOffline(true);
        });

        let socketExplainLogged = false;
        socket.on('connect_error', () => {
          setRealtimeSyncOffline(true);
          if (socketExplainLogged) return;
          socketExplainLogged = true;
          console.warn(
            '[ExamRoom] Socket.io ulanmadi (502: onlinetest-realtime o\'chiq yoki nginx → 127.0.0.1:9082). Server: sudo systemctl status onlinetest-realtime'
          );
        });

        socket.emit('join-exam', exam.id, 'student', user.id);

        socket.on('offer', async (fromId: string, offer: RTCSessionDescriptionInit) => {
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
          });
          peerConnectionsRef.current[fromId] = pc;

          stream.getTracks().forEach(track => pc.addTrack(track, stream));

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              socket.emit('ice-candidate', fromId, event.candidate);
            }
          };

          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('answer', fromId, answer);
        });

        socket.on('ice-candidate', async (fromId: string, candidate: RTCIceCandidateInit) => {
          const pc = peerConnectionsRef.current[fromId];
          if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        });

        // 2. Setup Audio Analysis (mikrofon izlari bo'lmasa — ovoz tahlilini o'tkazib yuboramiz)
        if (stream.getAudioTracks().length > 0) {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const analyser = audioCtx.createAnalyser();
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);
          analyser.fftSize = 256;
          audioContextRef.current = audioCtx;
          analyserRef.current = analyser;
        } else {
          audioContextRef.current = null;
          analyserRef.current = null;
        }

        // 3. Setup Vision Models
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        faceDetectorRef.current = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
            // CPU: GPU da ichki Canvas2D getImageData ogohlantirishlari kamroq; tezlik hali yetarli
            delegate: "CPU",
          },
          runningMode: "VIDEO",
        });

        objectDetectorRef.current = await cocoSsd.load();

        // Start processing loop
        animationFrameRef.current = requestAnimationFrame(processFrame);

      } catch (err) {
        setCameraPreviewOk(false);
        if (err instanceof DOMException && err.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
          setCameraErrorHint(translations[lang].virtualCameraBlocked);
          setWarningMsg(translations[lang].virtualCameraBlocked);
          void logViolationRef.current('VIRTUAL_WEBCAM_SUSPECTED');
        } else {
          console.error('Failed to setup AI proctoring:', err);
          setCameraErrorHint(translations[lang].examCameraPlayBlocked);
          void logViolationRef.current('CAMERA_MIC_ACCESS_FAILED');
        }
      }
    };

    setupAI();

    // Cleanup
    return () => {
      window.removeEventListener('pointerdown', onFirstUserGesture, true);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleCopyPaste);
      document.removeEventListener('paste', handleCopyPaste);
      document.removeEventListener('cut', handleCopyPaste);
      document.removeEventListener('keydown', handleKeyDown);
      clearInterval(devtoolsTick);
      
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }

      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
      }
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close());

      if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [banned, exam.id, token, user.id, lang]);

  // Frame counter — object detection ni kamroq chaqirish uchun
  const frameCountRef = useRef(0);
  /** Yuz bbox markazini kenglik/balandlikka nisbatan: chap/o'ng/tepa/past (~3s ketma-ket, 2 frame). */
  const gazeLeftStreakRef = useRef(0);
  const gazeRightStreakRef = useRef(0);
  const gazeUpStreakRef = useRef(0);
  const gazeDownStreakRef = useRef(0);
  /** Bitta yuz + o'rtacha ovoz past–o'rta diapazon (gapirish/pichirlash shubhasi). */
  const whisperStreakRef = useRef(0);
  /** Spektr tarqalishi katta — boshqa ovoz / suhbat shubhasi. */
  const conversationPatternStreakRef = useRef(0);

  // --- AI Processing Loop ---
  // OPTIMALLASHTIRISH:
  // - Face detection: har 1.5 soniyada (lokal model, API yo'q)
  // - Object detection: har 6 soniyada (og'ir model, CPU tejash)
  // - Audio: har 2 soniyada
  // - Violation dedup: logViolation ichida ~14s bir xil tur uchun (spam oldini olish)
  const processFrame = async () => {
    if (bannedRef.current || !videoRef.current || isProcessingRef.current) return;

    isProcessingRef.current = true;
    const video = videoRef.current;
    frameCountRef.current += 1;
    const frame = frameCountRef.current;

    try {
      if (video.readyState < 2) return;

      // 1. Yuz aniqlash + kamera markazidan uzoq qarash (bbox markazi) — keyingi bloklar uchun singleFaceRef
      if (faceDetectorRef.current) {
        const faceResult = faceDetectorRef.current.detectForVideo(video, performance.now());
        const faceCount = faceResult.detections.length;
        singleFaceRef.current = faceCount === 1;

        if (faceCount === 0) {
          gazeLeftStreakRef.current = 0;
          gazeRightStreakRef.current = 0;
          gazeUpStreakRef.current = 0;
          gazeDownStreakRef.current = 0;
          if (Date.now() - lastFaceTimeRef.current > NO_FACE_VIOLATION_MS) {
            void logViolationRef.current('FACE_NOT_VISIBLE');
            lastFaceTimeRef.current = Date.now();
          }
        } else if (faceCount > 1) {
          gazeLeftStreakRef.current = 0;
          gazeRightStreakRef.current = 0;
          gazeUpStreakRef.current = 0;
          gazeDownStreakRef.current = 0;
          void logViolationRef.current('MULTIPLE_FACES');
        } else {
          lastFaceTimeRef.current = Date.now();
          const det = faceResult.detections[0];
          const bb = det?.boundingBox;
          const vw = video.videoWidth || 1;
          const vh = video.videoHeight || 1;
          const gazeFramesNeeded = 2;
          if (bb && vw > 40 && vh > 40) {
            const cx = (bb.originX + bb.width / 2) / vw;
            const cy = (bb.originY + bb.height / 2) / vh;
            if (cy < 0.38) {
              gazeUpStreakRef.current += 1;
              gazeDownStreakRef.current = 0;
              if (gazeUpStreakRef.current >= gazeFramesNeeded) {
                gazeUpStreakRef.current = 0;
                void logViolationRef.current('GAZE_AWAY_UP');
              }
            } else if (cy > 0.62) {
              gazeDownStreakRef.current += 1;
              gazeUpStreakRef.current = 0;
              if (gazeDownStreakRef.current >= gazeFramesNeeded) {
                gazeDownStreakRef.current = 0;
                void logViolationRef.current('GAZE_AWAY_DOWN');
              }
            } else {
              gazeUpStreakRef.current = 0;
              gazeDownStreakRef.current = 0;
            }
            if (cx < 0.4) {
              gazeLeftStreakRef.current += 1;
              gazeRightStreakRef.current = 0;
              if (gazeLeftStreakRef.current >= gazeFramesNeeded) {
                gazeLeftStreakRef.current = 0;
                void logViolationRef.current('GAZE_AWAY_LEFT');
              }
            } else if (cx > 0.6) {
              gazeRightStreakRef.current += 1;
              gazeLeftStreakRef.current = 0;
              if (gazeRightStreakRef.current >= gazeFramesNeeded) {
                gazeRightStreakRef.current = 0;
                void logViolationRef.current('GAZE_AWAY_RIGHT');
              }
            } else {
              gazeLeftStreakRef.current = 0;
              gazeRightStreakRef.current = 0;
            }
          }
        }
      }

      // 2. Audio: baland shovqin; past–o'rta — gapirish; spektr keng — boshqa ovoz / suhbat shubhasi
      if (frame % 2 === 0 && analyserRef.current) {
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        let max = 0;
        let min = 255;
        for (let i = 0; i < dataArray.length; i++) {
          const v = dataArray[i];
          sum += v;
          if (v > max) max = v;
          if (v < min) min = v;
        }
        const avg = sum / dataArray.length;
        const spread = max - min;
        if (avg > 42) {
          whisperStreakRef.current = 0;
          conversationPatternStreakRef.current = 0;
          void logViolationRef.current('SUSPICIOUS_AUDIO');
        } else if (singleFaceRef.current && spread > 88 && avg >= 18 && avg <= 50) {
          whisperStreakRef.current = 0;
          conversationPatternStreakRef.current += 1;
          if (conversationPatternStreakRef.current >= 3) {
            conversationPatternStreakRef.current = 0;
            void logViolationRef.current('WHISPER_OR_CONVERSATION_SUSPECTED');
          }
        } else if (singleFaceRef.current && avg >= 18 && avg <= 52) {
          conversationPatternStreakRef.current = 0;
          whisperStreakRef.current += 1;
          if (whisperStreakRef.current >= 3) {
            whisperStreakRef.current = 0;
            void logViolationRef.current('WHISPER_OR_CONVERSATION_SUSPECTED');
          }
        } else {
          whisperStreakRef.current = Math.max(0, whisperStreakRef.current - 1);
          conversationPatternStreakRef.current = Math.max(0, conversationPatternStreakRef.current - 1);
        }
      }

      // 3. Ob'ekt aniqlash (har 2-frame: ~3 soniyada) — og'ir model
      if (frame % 2 === 0 && objectDetectorRef.current) {
        const predictions = await objectDetectorRef.current.detect(video);
        const forbidden = ['cell phone', 'book', 'laptop'];
        const found = predictions.find(
          (p) => forbidden.includes(p.class) && p.score > FORBIDDEN_OBJECT_MIN_SCORE
        );
        if (found) {
          void logViolationRef.current(`FORBIDDEN_OBJECT_${found.class.replace(' ', '_').toUpperCase()}`);
        }
      }
    } catch {
      // Silent — loop to'xtamasin
    } finally {
      isProcessingRef.current = false;
      if (!bannedRef.current) {
        // Face: ~1.5s, Object: ~6s (4 * 1.5s)
        loopTimeoutRef.current = setTimeout(() => {
          animationFrameRef.current = requestAnimationFrame(processFrame);
        }, 1500);
      }
    }
  };

  const [identityTerminated, setIdentityTerminated] = useState(false);

  // --- Violation logging ---
  const logViolation = async (type: string) => {
    if (bannedRef.current) return;

    // Server: strict VAC da faqat IDENTITY_SUBSTITUTION darhol ban; qolganlari ogohlantirish ketma-ketligi.
    const INSTANT_BAN_TYPES = new Set(['IDENTITY_SUBSTITUTION']);

    // Dedup: bir xil tur uchun qisqa interval (server 60s ichida bitta rasmiy ogohlantirishni birlashtiradi)
    const now = Date.now();
    if (FOCUS_BURST_TYPES.has(type) && now < focusBurstLockUntilRef.current) {
      return;
    }
    const dedupeKey = `viol_last_${type}`;
    const lastSent = parseInt(sessionStorage.getItem(dedupeKey) || '0', 10);
    const MIN_INTERVAL = INSTANT_BAN_TYPES.has(type) ? 0 : 14_000;
    if (MIN_INTERVAL > 0 && now - lastSent < MIN_INTERVAL) {
      return;
    }
    if (FOCUS_BURST_TYPES.has(type)) {
      focusBurstLockUntilRef.current = now + 4500;
    }
    sessionStorage.setItem(dedupeKey, String(now));

    try {
      const res = await fetch(apiUrl('/api/student/violations'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await nextGuardHeaders('POST', '/api/student/violations')),
        },
        body: JSON.stringify({
          exam_id: examIdRef.current,
          violation_type: type,
        }),
      });
      advanceSeq();
      const data = (await readJsonSafe<{
        error?: string;
        code?: string;
        violationsCount?: number;
        banned?: boolean;
        warningNumber?: number;
        violationReason?: string;
        isFinalWarning?: boolean;
        warningSuppressed?: boolean;
        officialWarnings?: number;
        mergeWindowSeconds?: number;
      }>(res)) || {};

      if (!res.ok) {
        const hint = data.violationReason || data.error || data.code || `HTTP ${res.status}`;
        setWarningMsg(String(hint));
        setTimeout(() => setWarningMsg(''), 5000);
        return;
      }

      if (data.warningSuppressed) {
        const detail = (data.violationReason || type).trim();
        const sec = typeof data.mergeWindowSeconds === 'number' ? data.mergeWindowSeconds : 30;
        setWarningMsg(`${t.warningSuppressedToast.replace('{s}', String(sec))} ${detail}`.trim());
        setTimeout(() => setWarningMsg(''), 7000);
        return;
      }

      if (data.banned) {
        if (type === 'IDENTITY_SUBSTITUTION') setIdentityTerminated(true);
        setViolationWarning(null);
        setStrikeLevel(3);
        if (typeof data.violationsCount === 'number') {
          setBanViolationsCount(data.violationsCount);
        } else {
          setBanViolationsCount(null);
        }
        setBanned(true);
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } else if (typeof data.warningNumber === 'number' && data.warningNumber > 0) {
        setStrikeLevel(typeof data.officialWarnings === 'number' ? data.officialWarnings : data.warningNumber);
        setViolationWarning({
          reason: data.violationReason || type,
          warningNumber: data.warningNumber,
          isFinalWarning: data.isFinalWarning === true,
        });
      } else {
        // Faqat status bar da ko'rsatish
        setWarningMsg(data.violationReason || type);
        setTimeout(() => setWarningMsg(''), 3500);
      }
    } catch {
      // Tarmoq xatosi — local state
      setWarningMsg(type);
      setTimeout(() => setWarningMsg(''), 3000);
    }
  };

  logViolationRef.current = logViolation;

  // --- Periodic identity match (Gemini serverda) ---
  // TOKEN TEJASH:
  // - 90 soniyada bir marta (avval 45s edi)
  // - Rasm: 280x210, quality=0.55 (avval full res, quality=0.85 edi)
  // - Faqat yuz aniqlanganida (singleFace=true)
  // - Ketma-ket 3 ta muvaffaqiyatsiz bo'lsa blok (yolg'on positive kamaytirish)
  const identityFailCountRef = useRef(0);

  useEffect(() => {
    if (banned || !user.profile_image) return;

    const runCheck = async () => {
      if (bannedRef.current || identityCheckBusyRef.current || !singleFaceRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      identityCheckBusyRef.current = true;
      try {
        // Kichik rasm: 280x210 (token tejash uchun)
        const liveDataUrl = compressToJpeg(video, 0.55, 280);
        if (!liveDataUrl) return;
        const liveB64 = liveDataUrl.split(',')[1];

        // Profile image: agar allaqachon kichik bo'lsa to'g'ridan yuboramiz
        const prof = String(user.profile_image);

        const res = await fetch(apiUrl('/api/student/identity-compare'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await nextGuardHeaders('POST', '/api/student/identity-compare')),
          },
          body: JSON.stringify({
            exam_id: examIdRef.current,
            profile_image_base64: prof,
            live_capture_base64: liveB64,
          }),
        });
        advanceSeq();

        if (res.status === 503 || res.status === 429) {
          // Rate limit yoki Gemini yetmaydi — skip
          identityFailCountRef.current = 0;
          return;
        }
        if (!res.ok) return;

        const data = (await readJsonSafe<{ match?: boolean }>(res)) || {};
        if (!data.match) {
          identityFailCountRef.current += 1;
          // 3 ta ketma-ket muvaffaqiyatsiz → blok (yolg'on positive oldini olish)
          if (identityFailCountRef.current >= 3) {
            await logViolationRef.current('IDENTITY_SUBSTITUTION');
          }
        } else {
          identityFailCountRef.current = 0;
        }
      } catch {
        // Tarmoq xatosi — skip
      } finally {
        identityCheckBusyRef.current = false;
      }
    };

    const id = window.setInterval(runCheck, IDENTITY_CHECK_MS);
    return () => clearInterval(id);
  }, [banned, user.profile_image, nextGuardHeaders]);

  // --- Tab / visibility (masofaviy nazorat) ---
  useEffect(() => {
    const clearHiddenTimer = () => {
      if (hiddenViolationTimerRef.current !== null) {
        window.clearTimeout(hiddenViolationTimerRef.current);
        hiddenViolationTimerRef.current = null;
      }
    };

    const onVis = () => {
      if (bannedRef.current) return;
      if (document.visibilityState === 'hidden') {
        // Qisqa hidden holatlari false positive bermasligi uchun delay.
        clearHiddenTimer();
        hiddenViolationTimerRef.current = window.setTimeout(() => {
          hiddenViolationTimerRef.current = null;
          if (bannedRef.current) return;
          if (document.visibilityState === 'hidden') {
            void logViolationRef.current('TAB_SWITCH_SOFT');
          }
        }, 1200);
      } else {
        clearHiddenTimer();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearHiddenTimer();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const runSubmitCore = useCallback(
    async (ans: Record<string, string>, fl: number[]) => {
      if (submittingRef.current || bannedRef.current) return;
      if (isOffline) {
        alert(t.offlineSubmit);
        return;
      }
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/submit`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await nextGuardHeaders('POST', `/api/student/exams/${exam.id}/submit`)),
          },
          body: JSON.stringify({ answers: ans, flaggedQuestions: fl }),
        });
        advanceSeq();
        const json = await readJsonSafe<ExamResultPayload & { error?: string }>(res);
        if (!res.ok) {
          alert(String(json?.error || t.submitError));
          submittingRef.current = false;
          setSubmitting(false);
          return;
        }
        if (!json?.result_public_id || !Array.isArray(json.questions)) {
          alert(t.submitError);
          submittingRef.current = false;
          setSubmitting(false);
          return;
        }
        localStorage.removeItem(`exam_answers_${exam.id}`);
        localStorage.removeItem(`exam_answers_ts_${exam.id}`);
        const payload: ExamResultPayload = {
          exam_id: json.exam_id,
          result_public_id: json.result_public_id,
          verify_url: json.verify_url,
          overview: json.overview ?? '',
          questions: json.questions,
          score: json.score,
          total: json.total,
          integrity_code: json.integrity_code,
          percentage: json.percentage,
          completed_at: json.completed_at,
          exam_title: exam.title,
          student_name: user.name || user.id,
        };
        onFinish(payload);
      } catch (err) {
        console.error('Failed to submit', err);
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [exam.id, exam.title, token, user.name, user.id, onFinish, isOffline, t.offlineSubmit, t.submitError, nextGuardHeaders]
  );

  const handleSubmit = () => runSubmitCore(answersRef.current, flaggedRef.current);

  // --- Countdown (oxirgi javoblar ref orqali) ---
  useEffect(() => {
    if (banned) return;
    const timer = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === 300) {
          setShowTimeWarning(true);
          window.setTimeout(() => setShowTimeWarning(false), 5000);
        }
        if (prev <= 1) {
          window.clearInterval(timer);
          void runSubmitCore(answersRef.current, flaggedRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [banned, runSubmitCore]);

  // --- Ogohlantirish modal (ban emas, davom etish mumkin) ---
  if (violationWarning && !banned && !hardBlocked) {
    const isFinal = violationWarning.isFinalWarning;
    const warnNum = violationWarning.warningNumber;

    const warnTitle = t.violationWarningTitle.replace('{n}', String(warnNum));
    const warnContinue = t.violationContinueExam;
    const finalMsg = t.violationFinalNotice;
    const reasonLabel = t.violationReasonLabel;

    return createPortal(
      <div
        className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto overscroll-y-contain px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="violation-warn-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className={`w-full max-w-lg max-h-[min(90dvh,calc(100dvh-2rem))] flex flex-col min-h-0 rounded-2xl sm:rounded-3xl border-2 shadow-2xl ${
            isFinal ? 'border-red-400 bg-red-50' : 'border-orange-400 bg-orange-50'
          }`}
        >
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain p-5 sm:p-7">
            <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-5 ${isFinal ? 'bg-red-100' : 'bg-orange-100'}`}>
              <svg className={`w-7 h-7 sm:w-9 sm:h-9 ${isFinal ? 'text-red-600' : 'text-orange-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>

            <h2 id="violation-warn-title" className={`text-lg sm:text-xl font-bold text-center mb-3 leading-snug ${isFinal ? 'text-red-700' : 'text-orange-700'}`}>
              {warnTitle}
            </h2>

            <div className="bg-white/80 rounded-xl sm:rounded-2xl px-4 py-3 sm:px-5 sm:py-4 mb-4 text-center border border-white/60">
              <p className="text-[10px] sm:text-xs text-gray-500 mb-1 uppercase tracking-wide font-medium">{reasonLabel}</p>
              <p className="text-sm sm:text-base font-semibold text-gray-800 break-words">{violationWarning.reason}</p>
            </div>

            <div className="flex justify-center gap-2 sm:gap-3 mb-4">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold border-2 transition-all ${
                    n <= warnNum
                      ? isFinal
                        ? 'bg-red-100 text-red-700 border-red-400'
                        : 'bg-orange-100 text-orange-700 border-orange-400'
                      : 'bg-gray-100 text-gray-400 border-gray-200'
                  }`}
                >
                  {n <= warnNum ? '!' : n}
                </div>
              ))}
            </div>

            {isFinal && (
              <div className="bg-red-100 border border-red-300 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3 mb-4 text-center">
                <p className="text-xs sm:text-sm font-semibold text-red-700 leading-snug">{finalMsg}</p>
              </div>
            )}

            <p className="text-[11px] sm:text-xs text-gray-500 text-center mb-4 sm:mb-5 leading-relaxed">{t.violationFooterHonest}</p>
          </div>

          <div className="shrink-0 border-t border-black/5 p-4 sm:p-5 pt-3 sm:pt-4 bg-white/40 rounded-b-2xl sm:rounded-b-3xl">
            <button
              type="button"
              onClick={() => setViolationWarning(null)}
              className={`w-full py-3 sm:py-3.5 rounded-xl sm:rounded-2xl font-semibold text-sm sm:text-base transition-all active:scale-[0.98] text-white ${
                isFinal ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-500 hover:bg-orange-600'
              }`}
            >
              {warnContinue}
            </button>
          </div>
        </motion.div>
      </div>,
      document.body,
    );
  }

  // --- Ban ekrani (to'liq bloklash) ---
  if (banned || hardBlocked) {
    const banTitle = t.examEndedTitle;
    const banMsg = identityTerminated ? t.examTerminatedIdentity : t.examTerminatedWarnings;
    const banPdfLabel = t.banReportDownload;
    const backLabel = t.banBackToDashboard;

    return createPortal(
      <div
        className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 backdrop-blur-sm overflow-y-auto overscroll-y-contain px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ban-ended-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-lg my-auto"
        >
          <Card className="w-full text-center p-6 sm:p-8 md:p-10 max-h-[min(92dvh,100dvh-1rem)] overflow-y-auto overscroll-y-contain border-red-500/30 bg-red-50/95 backdrop-blur-xl shadow-2xl shadow-red-500/10">
          <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 id="ban-ended-title" className="text-2xl font-bold text-red-600 mb-3 tracking-tight">{banTitle}</h2>
          <p className="text-gray-700 mb-4 leading-relaxed text-sm">{banMsg}</p>
          {banViolationsCount != null && (
            <p className="text-sm text-red-800/90 font-medium mb-5">
              {t.banRecordCountHint.replace('{n}', String(banViolationsCount))}
            </p>
          )}

          <div className="space-y-3">
            <Button
              className="w-full rounded-full bg-red-600 hover:bg-red-700 text-white"
              disabled={banPdfBusy}
              onClick={async () => {
                try {
                  setBanPdfBusy(true);
                  const res = await fetch(apiUrl(`/api/student/ban-report.pdf?exam_id=${exam.id}`), {
                    headers: examAuthHeaders(token),
                  });
                  if (!res.ok) throw new Error('yuklab bo\'lmadi');
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `BAN_REPORT_${user.id}.pdf`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                } catch (e) {
                  console.error(e);
                } finally {
                  setBanPdfBusy(false);
                }
              }}
            >
              {banPdfBusy ? t.downloading : banPdfLabel}
            </Button>
            <Button className="w-full rounded-full" variant="outline" onClick={() => onFinish(null)}>
              {backLabel}
            </Button>
          </div>
          <div className="mt-5 border-t border-red-200/70 pt-5 text-left space-y-3">
            <p className="text-sm font-semibold text-gray-800">BAN bo'yicha appeal yuborish</p>
            <textarea
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              placeholder="Vaziyatni batafsil yozing (kamida 12 belgi)"
              className="w-full min-h-[90px] rounded-2xl border border-red-200 bg-white/80 px-3 py-2 text-sm"
            />
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => setAppealFile(e.target.files?.[0] || null)}
              className="w-full text-xs"
            />
            {appealMsg ? <p className="text-xs text-gray-600">{appealMsg}</p> : null}
            <Button
              className="w-full rounded-full"
              disabled={appealBusy || appealReason.trim().length < 12}
              onClick={async () => {
                try {
                  setAppealBusy(true);
                  setAppealMsg('');
                  let evidence_base64 = '';
                  let evidence_name = '';
                  let evidence_mime = '';
                  if (appealFile) {
                    evidence_name = appealFile.name;
                    evidence_mime = appealFile.type || '';
                    evidence_base64 = await new Promise<string>((resolve) => {
                      const r = new FileReader();
                      r.onloadend = () => resolve(String(r.result || ''));
                      r.readAsDataURL(appealFile);
                    });
                  }
                  const res = await fetch(apiUrl('/api/student/ban-appeals'), {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...examAuthHeaders(token),
                    },
                    body: JSON.stringify({
                      exam_id: exam.id,
                      reason: appealReason.trim(),
                      evidence_base64,
                      evidence_name,
                      evidence_mime,
                    }),
                  });
                  const data = await readJsonSafe<{ error?: string }>(res);
                  if (!res.ok) {
                    setAppealMsg(data?.error || 'Appeal yuborishda xatolik');
                    return;
                  }
                  setAppealMsg('Appeal yuborildi. Admin ko‘rib chiqadi.');
                  setAppealReason('');
                  setAppealFile(null);
                } finally {
                  setAppealBusy(false);
                }
              }}
            >
              {appealBusy ? 'Yuborilmoqda...' : 'Appeal yuborish'}
            </Button>
          </div>
        </Card>
        </motion.div>
      </div>,
      document.body,
    );
  }

  const toggleFlag = (qId: number) => {
    setFlaggedQuestions(prev => 
      prev.includes(qId) ? prev.filter(id => id !== qId) : [...prev, qId]
    );
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 p-4 md:p-8 max-w-7xl mx-auto">
      {/* Main Exam Area */}
      <motion.div 
        variants={container}
        initial="hidden"
        animate="show"
        className="flex-1 space-y-8"
      >
        <motion.div variants={item} className="sticky top-24 z-40 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white/70 backdrop-blur-2xl p-5 rounded-3xl shadow-sm border border-white/50 gap-4">
          <div className="flex-1 w-full">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 mb-2">{exam.title}</h1>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
                {t.questionProgress
                  .replace('{cur}', String(qIndex + 1))
                  .replace('{total}', String(totalQuestions))
                  .replace('{answered}', String(answeredCount))}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-6 w-full sm:w-auto justify-between sm:justify-end">
            <div className={`flex flex-col items-end ${timeLeft < 300 ? 'text-red-600' : 'text-gray-700'}`}>
              <span className="text-xs font-medium uppercase tracking-wider opacity-70">{t.timeRemaining}</span>
              <span className="font-mono text-2xl font-bold tracking-tight">
                {formatTime(timeLeft)}
              </span>
            </div>
            <Button onClick={handleSubmit} disabled={submitting} className="rounded-full px-8 shadow-lg shadow-black/5">
              {submitting ? t.submitting : t.submitExam}
            </Button>
          </div>
        </motion.div>

        <AnimatePresence>
          {timeLeft <= 0 && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="bg-red-500/10 border border-red-400/30 text-red-800 px-6 py-4 rounded-2xl backdrop-blur-md shadow-sm text-sm font-medium"
            >
              {t.examTimeExpiredHint}
            </motion.div>
          )}
          {showTimeWarning && (
            <motion.div 
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-orange-500/10 border border-orange-500/20 text-orange-700 px-6 py-4 rounded-2xl relative backdrop-blur-md flex items-center gap-3 shadow-sm"
            >
              <svg className="w-6 h-6 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div>
                <strong className="font-semibold block">{t.timeWarningTitle}</strong>
                {t.timeWarningBody.trim() ? <span className="text-sm">{t.timeWarningBody}</span> : null}
              </div>
            </motion.div>
          )}
          {isOffline && (
            <motion.div 
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 px-6 py-4 rounded-2xl relative backdrop-blur-md flex items-center gap-3 shadow-sm"
            >
              <svg className="w-6 h-6 text-yellow-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <div>
                <strong className="font-semibold block">{t.connectionLostTitle}</strong>
                {t.connectionLostBody.trim() ? <span className="text-sm">{t.connectionLostBody}</span> : null}
              </div>
            </motion.div>
          )}
          {!isOffline && realtimeSyncOffline && (
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-amber-500/10 border border-amber-500/25 text-amber-900 px-6 py-4 rounded-2xl relative backdrop-blur-md flex items-center gap-3 shadow-sm"
            >
              <svg className="w-6 h-6 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div>
                <strong className="font-semibold block">{t.realtimeSyncOfflineTitle}</strong>
                <span className="text-sm">{t.realtimeSyncOfflineBody}</span>
              </div>
            </motion.div>
          )}
          {warningMsg && (
            <motion.div 
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-red-500/10 border border-red-500/20 text-red-700 px-6 py-4 rounded-2xl relative backdrop-blur-md flex items-center gap-3 shadow-sm"
            >
              <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <div>
                <strong className="font-semibold block">{t.proctorWarningTitle}</strong>
                <span className="text-sm">{warningMsg}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-6 pb-20">
          {currentQ && (
            <motion.div variants={item} key={currentQ.id} id={`question-${currentQ.id}`}>
              <Card className={`overflow-hidden border-white/40 bg-white/40 backdrop-blur-xl transition-all hover:bg-white/50 ${flaggedQuestions.includes(currentQ.id) ? 'ring-2 ring-yellow-400' : ''}`}>
                <CardHeader className="bg-white/30 border-b border-white/20 pb-4 flex flex-row items-start justify-between">
                  <CardTitle className="text-lg font-medium leading-relaxed text-gray-800 flex-1">
                    <span className="text-gray-400 font-normal mr-2">{qIndex + 1}.</span>
                    {currentQParsed.cleanText || currentQ.text}
                  </CardTitle>
                  <button
                    type="button"
                    onClick={() => toggleFlag(currentQ.id)}
                    className={`ml-4 p-2 rounded-full transition-colors ${flaggedQuestions.includes(currentQ.id) ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                    title={t.flagQuestion}
                  >
                    <svg className="w-5 h-5" fill={flaggedQuestions.includes(currentQ.id) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" /></svg>
                  </button>
                </CardHeader>
                <CardContent className="p-6 space-y-3">
                  {currentQParsed.images.map((img, idx) => (
                    <div key={`${currentQ.id}-img-${idx}`} className="mb-3">
                      <img
                        src={img}
                        alt={`Question ${qIndex + 1} image ${idx + 1}`}
                        className="max-h-72 w-auto rounded-xl border border-gray-200"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ))}
                  {currentQ.options.map((opt: string, optIndex: number) => (
                    <label
                      key={optIndex}
                      className={`flex items-center space-x-4 p-4 rounded-2xl cursor-pointer transition-all duration-200 border ${
                        answers[currentQ.id] === opt
                          ? 'bg-black/5 border-black/10 shadow-inner'
                          : 'bg-white/50 border-transparent hover:bg-white/80 hover:border-white/80 hover:shadow-sm'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
                        answers[currentQ.id] === opt ? 'border-black bg-black' : 'border-gray-300 bg-white'
                      }`}>
                        {answers[currentQ.id] === opt && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                      <input
                        type="radio"
                        name={`q-${currentQ.id}`}
                        value={opt}
                        checked={answers[currentQ.id] === opt}
                        onChange={() => setAnswers({ ...answers, [currentQ.id]: opt })}
                        className="sr-only"
                      />
                      <span className={`text-base ${answers[currentQ.id] === opt ? 'font-medium text-black' : 'text-gray-700'}`}>{opt}</span>
                    </label>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}
          <div className="flex flex-wrap gap-3 justify-between items-center">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              disabled={qIndex <= 0}
              onClick={() => setQIndex((i) => Math.max(0, i - 1))}
            >
              {t.examNavPrev}
            </Button>
            <Button
              type="button"
              className="rounded-full"
              disabled={qIndex >= totalQuestions - 1}
              onClick={() => setQIndex((i) => Math.min(totalQuestions - 1, i + 1))}
            >
              {t.examNavNext}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Proctoring Sidebar */}
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 30 }}
        className="w-full lg:w-80 space-y-6 lg:sticky lg:top-24 h-fit"
      >
        <Card className="overflow-hidden border-white/40 bg-white/30 backdrop-blur-xl">
          <CardHeader className="py-4 bg-white/40 border-b border-white/20">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-gray-500 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              {t.examPanelCamera}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <div className="rounded-2xl overflow-hidden bg-black/5 border border-white/20 shadow-inner relative aspect-video">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }} // Mirror
              />
              {(cameraErrorHint || !cameraPreviewOk) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center bg-white/75 backdrop-blur-sm text-[11px] sm:text-xs text-gray-800">
                  {cameraErrorHint ? (
                    <>
                      <span className="font-semibold text-red-700 leading-snug">{cameraErrorHint}</span>
                      <button
                        type="button"
                        className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
                        onClick={() => window.location.reload()}
                      >
                        {t.examCameraReload}
                      </button>
                    </>
                  ) : (
                    <span className="font-medium text-gray-600">{t.examCameraLoadingPreview}</span>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/40 bg-white/30 backdrop-blur-xl">
          <CardHeader className="py-4 bg-white/40 border-b border-white/20">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-gray-500">
              {t.examPanelQuestions}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-5 gap-2">
              {exam.questions.map((q: any, i: number) => {
                const isAnswered = !!answers[q.id];
                const isFlagged = flaggedQuestions.includes(q.id);
                const isCurrent = i === qIndex;
                return (
                  <button
                    type="button"
                    key={q.id}
                    onClick={() => setQIndex(i)}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-medium transition-all ${
                      isCurrent ? 'ring-2 ring-offset-2 ring-indigo-500' : ''
                    } ${
                      isFlagged ? 'bg-yellow-100 text-yellow-700 border-2 border-yellow-400' :
                      isAnswered ? 'bg-blue-500 text-white shadow-md shadow-blue-500/20' :
                      'bg-white/50 text-gray-600 border border-gray-200 hover:bg-white'
                    }`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/40 bg-white/30 backdrop-blur-xl">
          <CardContent className="p-6">
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm font-semibold text-gray-700">{t.examPanelWarnings}</span>
              <div className="flex items-center gap-2">
                {[1, 2, 3].map(num => (
                  <div 
                    key={num} 
                    className={`w-3 h-3 rounded-full transition-colors ${
                      strikeLevel >= num ? 'bg-red-500 shadow-sm shadow-red-500/50' : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
      <Calculator />
    </div>
  );
}
