import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import type { ExamResultPayload } from './components/ExamResultSummary';

const IDENTITY_CHECK_MS = 45000;
const VIRTUAL_CAMERA_LABEL_RE = /(droidcam|epoccam|iriun|ivcam|obs|virtual)/i;

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

async function getPreferredProctorStream(): Promise<MediaStream> {
  const initial = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } },
    audio: true,
  });
  const devices = await navigator.mediaDevices.enumerateDevices();
  const preferred = devices.find(
    (d) => d.kind === 'videoinput' && !VIRTUAL_CAMERA_LABEL_RE.test(d.label || '')
  );
  if (!preferred?.deviceId) return initial;
  const currentTrack = initial.getVideoTracks()[0];
  const currentId = currentTrack?.getSettings?.().deviceId;
  if (currentId && currentId === preferred.deviceId) return initial;
  initial.getTracks().forEach((t) => t.stop());
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: { exact: preferred.deviceId },
      width: { ideal: 320 },
      height: { ideal: 240 },
      frameRate: { ideal: 15 },
    },
    audio: true,
  });
}

export function ExamRoom({ exam, studentExamId, token, user, lang, onFinish }: ExamRoomProps) {
  const t = translations[lang];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flaggedQuestions, setFlaggedQuestions] = useState<number[]>([]);
  const [draftSynced, setDraftSynced] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [banned, setBanned] = useState(false);
  const [timeLeft, setTimeLeft] = useState(() => initialSecondsLeft(exam));
  const [showTimeWarning, setShowTimeWarning] = useState(false);
  const [warnings, setWarnings] = useState(0);
  const [warningMsg, setWarningMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hardBlocked, setHardBlocked] = useState(false);
  const [banPdfBusy, setBanPdfBusy] = useState(false);

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
          headers: { Authorization: `Bearer ${token}` },
        });
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
  }, [exam.id, token]);

  useEffect(() => {
    localStorage.setItem(`exam_answers_${exam.id}`, JSON.stringify(answers));
    localStorage.setItem(`exam_answers_ts_${exam.id}`, String(Date.now()));
  }, [answers, exam.id]);

  useEffect(() => {
    if (banned) return;
    const id = window.setTimeout(() => {
      fetch(apiUrl(`/api/student/exams/${exam.id}/save-progress`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ answers, flaggedQuestions }),
      })
        .then((r) => {
          if (r.ok) {
            setDraftSynced(true);
            window.setTimeout(() => setDraftSynced(false), 2500);
          }
        })
        .catch(() => {});
    }, 22000);
    return () => clearTimeout(id);
  }, [answers, flaggedQuestions, exam.id, token, banned]);

  useEffect(() => {
    if (banned) return;
    const sync = async () => {
      try {
        const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/clock`), {
          headers: { Authorization: `Bearer ${token}` },
        });
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
  }, [exam.id, token, banned]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = t.leaveExamWarning;
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [t.leaveExamWarning]);

  useEffect(() => {
    const ua = navigator.userAgent || '';
    if (/anydesk|teamviewer|rustdesk|splashtop/i.test(ua)) {
      void logViolationRef.current('REMOTE_CONTROL_SUSPECTED');
      setHardBlocked(true);
    }
    const onBlur = () => {
      void logViolationRef.current('TAB_SWITCH_HARD');
      setHardBlocked(true);
    };
    const onFs = () => {
      if (!document.fullscreenElement) {
        void logViolationRef.current('FULLSCREEN_EXIT_HARD');
        setHardBlocked(true);
      }
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  const [qIndex, setQIndex] = useState(0);
  const answeredCount = Object.keys(answers).length;
  const totalQuestions = exam.questions.length;
  const progress = (answeredCount / totalQuestions) * 100;
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
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionsRef = useRef<{ [id: string]: RTCPeerConnection }>({});

  // --- AI Proctoring Setup & Security ---
  useEffect(() => {
    if (banned) return;

    // Security: Disable right click, copy/paste, and keyboard shortcuts
    const handleContextMenu = (e: Event) => e.preventDefault();
    const handleCopyPaste = (e: Event) => e.preventDefault();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('copy', handleCopyPaste);
    document.addEventListener('paste', handleCopyPaste);
    document.addEventListener('keydown', handleKeyDown);

    // Force fullscreen
    const enterFullscreen = () => {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    enterFullscreen();

    const setupAI = async () => {
      try {
        // 1. Setup Media with optimized constraints for lower bandwidth
        const stream = await getPreferredProctorStream();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // Socket.IO alohida realtime server (backend/realtime); devda odatda :3001
        const socketUrl =
          (import.meta.env.VITE_SOCKET_URL as string | undefined)?.trim() ||
          (import.meta.env.DEV ? 'http://127.0.0.1:3001' : undefined);
        const socket = socketUrl
          ? io(socketUrl, { path: '/socket.io', auth: { token } })
          : io({ path: '/socket.io', auth: { token } });
        socketRef.current = socket;

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

        // 2. Setup Audio Analysis
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const analyser = audioCtx.createAnalyser();
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 256;
        audioContextRef.current = audioCtx;
        analyserRef.current = analyser;

        // 3. Setup Vision Models
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        faceDetectorRef.current = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
            delegate: "GPU"
          },
          runningMode: "VIDEO"
        });

        objectDetectorRef.current = await cocoSsd.load();

        // Start processing loop
        animationFrameRef.current = requestAnimationFrame(processFrame);

      } catch (err) {
        console.error("Failed to setup AI proctoring:", err);
        logViolation("Failed to access camera/microphone");
      }
    };

    setupAI();

    // Cleanup
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('copy', handleCopyPaste);
      document.removeEventListener('paste', handleCopyPaste);
      document.removeEventListener('keydown', handleKeyDown);
      
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }

      if (socketRef.current) {
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
  }, [banned, exam.id, token, user.id]);

  // --- AI Processing Loop ---
  const processFrame = async () => {
    if (bannedRef.current || !videoRef.current || isProcessingRef.current) return;
    
    isProcessingRef.current = true;
    const video = videoRef.current;

    try {
      if (video.readyState >= 2) {
        // 1. Audio Check
        if (analyserRef.current) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          if (average > 50) { // Threshold for talking/noise
            logViolation("Suspicious audio detected");
          }
        }

        // 2. Face Detection
        if (faceDetectorRef.current) {
          const faceResult = faceDetectorRef.current.detectForVideo(video, performance.now());
          singleFaceRef.current = faceResult.detections.length === 1;
          if (faceResult.detections.length === 0) {
            if (Date.now() - lastFaceTimeRef.current > 5000) { // 5 seconds without face
              logViolation("Face not visible");
              lastFaceTimeRef.current = Date.now(); // Reset to avoid spamming
            }
          } else if (faceResult.detections.length > 1) {
            logViolation("Multiple faces detected");
          } else {
            lastFaceTimeRef.current = Date.now();
          }
        }

        // 3. Object Detection (Phones, books, etc.)
        if (objectDetectorRef.current) {
          const predictions = await objectDetectorRef.current.detect(video);
          const forbiddenObjects = ['cell phone', 'book', 'laptop'];
          const detectedForbidden = predictions.find(p => forbiddenObjects.includes(p.class));
          if (detectedForbidden) {
            logViolation(`Forbidden object detected: ${detectedForbidden.class}`);
          }
        }
      }
    } catch (err) {
      console.error("Processing error:", err);
    } finally {
      isProcessingRef.current = false;
      if (!bannedRef.current) {
        loopTimeoutRef.current = setTimeout(() => {
          animationFrameRef.current = requestAnimationFrame(processFrame);
        }, 1000); // Process every 1 second to save CPU
      }
    }
  };

  const [identityTerminated, setIdentityTerminated] = useState(false);

  // --- Violation Logging ---
  const logViolation = async (type: string) => {
    if (bannedRef.current) return;
    
    // Capture screenshot
    let screenshotUrl = '';
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        screenshotUrl = canvas.toDataURL('image/jpeg', 0.5); // Compress
      }
    }

    setWarningMsg(type);
    setTimeout(() => setWarningMsg(''), 3000);

    try {
      const res = await fetch(apiUrl('/api/student/violations'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`
        },
        body: JSON.stringify({
          exam_id: examIdRef.current,
          violation_type: type,
          screenshot_url: screenshotUrl
        })
      });
      const data = (await readJsonSafe<{ violationsCount?: number; banned?: boolean }>(res)) || {};
      if (data.violationsCount !== undefined) {
        setWarnings(data.violationsCount);
      }
      if (data.banned) {
        if (type === 'IDENTITY_SUBSTITUTION') setIdentityTerminated(true);
        setBanned(true);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
      }
    } catch (err) {
      console.error("Failed to log violation", err);
    }
  };

  logViolationRef.current = logViolation;

  // --- Periodic identity match (profile vs live video) — Gemini faqat serverda ---
  useEffect(() => {
    if (banned || !user.profile_image) return;

    const runCheck = async () => {
      if (bannedRef.current || identityCheckBusyRef.current || !singleFaceRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      identityCheckBusyRef.current = true;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0);
        const liveB64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        const prof = String(user.profile_image);

        const res = await fetch(apiUrl('/api/student/identity-compare'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenRef.current}`,
          },
          body: JSON.stringify({
            profile_image_base64: prof,
            live_capture_base64: liveB64,
          }),
        });
        if (res.status === 503) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (!data.match) {
          await logViolationRef.current('IDENTITY_SUBSTITUTION');
        }
      } catch (e) {
        console.error('Identity check failed:', e);
      } finally {
        identityCheckBusyRef.current = false;
      }
    };

    const id = window.setInterval(runCheck, IDENTITY_CHECK_MS);
    return () => clearInterval(id);
  }, [banned, user.profile_image]);

  // --- Tab / visibility (masofaviy nazorat) ---
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        void logViolationRef.current(t.switchedTab);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [t.switchedTab]);

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
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ answers: ans, flaggedQuestions: fl }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert((json as { error?: string }).error || t.submitError);
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
          overview: json.overview,
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
    [exam.id, exam.title, token, user.name, user.id, onFinish, isOffline, t.offlineSubmit, t.submitError]
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

  if (banned || hardBlocked) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="min-h-[80vh] flex items-center justify-center p-6"
      >
        <Card className="max-w-md text-center p-8 border-red-500/30 bg-red-50/80 backdrop-blur-xl shadow-2xl shadow-red-500/10">
          <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
          <h2 className="text-3xl font-bold text-red-600 mb-4 tracking-tight">Exam Terminated</h2>
          <p className="text-gray-700 mb-8 leading-relaxed">
            {identityTerminated ? t.examTerminatedIdentity : t.examTerminatedWarnings}
          </p>
          <div className="space-y-3">
            <Button
              className="w-full rounded-full"
              disabled={banPdfBusy}
              onClick={async () => {
                try {
                  setBanPdfBusy(true);
                  const res = await fetch(apiUrl(`/api/student/ban-report.pdf?exam_id=${exam.id}`), {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  if (!res.ok) throw new Error('Ban report yuklab bo‘lmadi');
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `BAN_REPORT_${user.id}.pdf`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                } catch (e) {
                  console.error(e);
                  alert('Ban report PDF yuklab bo‘lmadi');
                } finally {
                  setBanPdfBusy(false);
                }
              }}
            >
              {banPdfBusy ? 'PDF tayyorlanmoqda...' : 'Rasmiy BAN hujjatini yuklab olish'}
            </Button>
            <Button className="w-full rounded-full" variant="outline" onClick={() => onFinish(null)}>
              Return to Dashboard
            </Button>
          </div>
        </Card>
      </motion.div>
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
              {draftSynced && (
                <span className="text-xs text-emerald-600 font-medium ml-2">{t.draftSynced}</span>
              )}
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
                <span className="text-sm">{t.timeWarningBody}</span>
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
                <span className="text-sm">{t.connectionLostBody}</span>
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
                    title="Flag for review"
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
              ← Oldingi
            </Button>
            <Button
              type="button"
              className="rounded-full"
              disabled={qIndex >= totalQuestions - 1}
              onClick={() => setQIndex((i) => Math.min(totalQuestions - 1, i + 1))}
            >
              Keyingi →
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
              Live Proctoring
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
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/40 bg-white/30 backdrop-blur-xl">
          <CardHeader className="py-4 bg-white/40 border-b border-white/20">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-gray-500">
              Questions
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
              <span className="text-sm font-semibold text-gray-700">Warnings</span>
              <div className="flex items-center gap-2">
                {[1, 2, 3].map(num => (
                  <div 
                    key={num} 
                    className={`w-3 h-3 rounded-full transition-colors ${
                      warnings >= num ? 'bg-red-500 shadow-sm shadow-red-500/50' : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">{t.proctoringSidebarHint}</p>
          </CardContent>
        </Card>
      </motion.div>
      <Calculator />
    </div>
  );
}
