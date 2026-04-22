import React, { useState, useEffect, useRef } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from './components/ui';
import { motion } from 'motion/react';
import { translations, Language, formatPreExamMediaAccessFailure } from './i18n';
import { readJsonSafe } from './lib/http';
import { apiUrl } from './lib/apiUrl';
import { InstituteLogo } from './components/InstituteLogo';
import {
  attachDefaultMicrophone,
  openCameraByTryingVideoInputs,
  openPreferredCameraStream,
  VIRTUAL_CAMERA_BLOCKED_MESSAGE,
} from './lib/preferredCameraStream';

const PASSIVE_LIVE_SAMPLES = 12;
const PASSIVE_LIVE_GAP_MS = 260;
const PASSIVE_LIVE_THRESHOLD = 400;

/** Kadr yoritilishi/piksel yig'indisi o'zgarishi — foydalanuvchi harakat yoki tabiiy harakat */
async function samplePassiveFrameMotion(captureFrame: () => number): Promise<boolean> {
  let maxDelta = 0;
  let prev = 0;
  for (let i = 0; i < PASSIVE_LIVE_SAMPLES; i++) {
    await new Promise((r) => setTimeout(r, PASSIVE_LIVE_GAP_MS));
    const cur = captureFrame();
    if (cur > 0 && prev > 0) {
      maxDelta = Math.max(maxDelta, Math.abs(cur - prev));
    }
    if (cur > 0) prev = cur;
  }
  return maxDelta >= PASSIVE_LIVE_THRESHOLD;
}

export function PreExamCheck({
  exam,
  token,
  user,
  lang,
  onComplete,
  onCancel,
}: {
  exam: any;
  token: string;
  user: any;
  lang: Language;
  onComplete: (examData: any, seId: number) => void;
  onCancel: () => void;
}) {
  const [cameraReady, setCameraReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  /** Kamera bor, mikrofon ochilmagan — qizil xato emas, ogohlantirish */
  const [mediaHint, setMediaHint] = useState('');
  const [starting, setStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [livenessChecking, setLivenessChecking] = useState(false);
  const [livenessRetryKey, setLivenessRetryKey] = useState(0);
  const [livenessFailed, setLivenessFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = translations[lang];

  /**
   * Kamera kadridan piksel yig'indisini hisoblaydi.
   * Ko'z yumish yoki tabassum paytida yuz maydoni o'zgaradi — delta katta bo'ladi.
   */
  const captureFrame = (): number => {
    if (!videoRef.current || !canvasRef.current) return 0;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video.videoWidth || !video.videoHeight) return 0;
    // Faqat yuz joylashgan markaziy qism (yuqori 60%)
    canvas.width = 80;
    canvas.height = 60;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;
    // Markaziy yuz zonasini olish
    const sw = video.videoWidth;
    const sh = video.videoHeight * 0.6;
    const sx = 0;
    const sy = 0;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Yorug'lik intensivligi (grayscale)
      sum += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }
    return sum;
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    const checkDevices = async () => {
      setError('');
      setMediaHint('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t.preExamMediaUnsupported);
        return;
      }
      const host = window.location.hostname;
      const isLocal =
        host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
      // Brauzerlar kamera/mikrofonni oddiy http:// domen uchun bloklaydi (localhost bundan mustasno)
      if (!isLocal && window.location.protocol !== 'https:') {
        setError(t.preExamRequiresHttps);
        return;
      }
      if (!isLocal && !window.isSecureContext) {
        setError(t.preExamRequiresHttps);
        return;
      }

      try {
        const q = navigator.permissions?.query?.bind(navigator.permissions);
        if (q) {
          try {
            const st = await q({ name: 'camera' as PermissionName });
            if (st.state === 'denied') {
              setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
              return;
            }
          } catch {
            /* Chromium: ba'zi versiyalarda query qo'llab-quvvatlanmaydi */
          }
        }
      } catch {
        /* ignore */
      }

      const domName = (err: unknown) =>
        err instanceof DOMException ? err.name : err instanceof Error ? err.name : '';

      const attachStream = (s: MediaStream) => {
        stream = s;
        setCameraReady(s.getVideoTracks().length > 0);
        setMicReady(s.getAudioTracks().length > 0);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      };

      // 1) Avval faqat kamera, keyin mikrofon — Windows/Chrome da bir vaqtda olish ko'pincha yiqiladi.
      try {
        const v = await openPreferredCameraStream(false, true);
        const micOk = await attachDefaultMicrophone(v);
        attachStream(v);
        if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
        return;
      } catch (e0: unknown) {
        const n0 = domName(e0);
        if (n0 === 'NotAllowedError' || n0 === 'PermissionDeniedError') {
          if (e0 instanceof DOMException && e0.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
            setError(t.virtualCameraBlocked);
            return;
          }
          setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
          return;
        }
        if (n0 === 'SecurityError') {
          setError(t.preExamRequiresHttps);
          return;
        }
        if (n0 === 'NotFoundError' || n0 === 'DevicesNotFoundError') {
          setError(t.preExamMediaNotFound);
          return;
        }
        if (n0 === 'NotReadableError' || n0 === 'TrackStartError') {
          try {
            const rotated = await openCameraByTryingVideoInputs();
            attachStream(rotated);
            if (rotated.getAudioTracks().length === 0) {
              setMediaHint(t.preExamMicOnlyFailed);
            }
            setError('');
            return;
          } catch {
            /* keyingi getUserMedia yo'llariga o'tamiz */
          }
        }
      }

      try {
        const s = await openPreferredCameraStream(true, true);
        attachStream(s);
        if (s.getAudioTracks().length === 0) setMediaHint(t.preExamMicOnlyFailed);
      } catch (e1: unknown) {
        const n1 = domName(e1);
        if (e1 instanceof DOMException && e1.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
          setError(t.virtualCameraBlocked);
        } else if (n1 === 'NotReadableError' || n1 === 'TrackStartError' || n1 === 'NotAllowedError') {
          let vOnly: MediaStream | null = null;
          try {
            vOnly = await openPreferredCameraStream(false, true);
            const micOk = await attachDefaultMicrophone(vOnly);
            attachStream(vOnly);
            if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
            setError('');
          } catch (innerErr: unknown) {
            if (vOnly) vOnly.getTracks().forEach((tr) => tr.stop());
            const ni = domName(innerErr);
            const ref = ni || n1;
            if (ref === 'NotAllowedError' || ref === 'PermissionDeniedError') {
              if (innerErr instanceof DOMException && innerErr.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
                setError(t.virtualCameraBlocked);
              } else {
                setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
              }
            } else if (ref === 'SecurityError') {
              setError(t.preExamRequiresHttps);
            } else if (ref === 'NotFoundError' || ref === 'DevicesNotFoundError') {
              setError(t.preExamMediaNotFound);
            } else {
              try {
                const rotated = await openCameraByTryingVideoInputs();
                attachStream(rotated);
                if (rotated.getAudioTracks().length === 0) {
                  setMediaHint(t.preExamMicOnlyFailed);
                }
                setError('');
              } catch {
                try {
                  const raw = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false,
                  });
                  const micOk = await attachDefaultMicrophone(raw);
                  attachStream(raw);
                  if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
                  setError('');
                } catch (rawErr: unknown) {
                  setError(formatPreExamMediaAccessFailure(rawErr, lang));
                }
              }
            }
          }
        } else if (n1 === 'SecurityError') {
          setError(t.preExamRequiresHttps);
        } else if (n1 === 'NotFoundError' || n1 === 'DevicesNotFoundError') {
          setError(t.preExamMediaNotFound);
        } else if (n1 === 'NotAllowedError' || n1 === 'PermissionDeniedError') {
          if (e1 instanceof DOMException && e1.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
            setError(t.virtualCameraBlocked);
          } else {
            setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
          }
        } else {
          setError(t.preExamCameraError);
        }
      }

      if (!stream) {
        try {
          const rotated = await openCameraByTryingVideoInputs();
          attachStream(rotated);
          if (rotated.getAudioTracks().length === 0) {
            setMediaHint(t.preExamMicOnlyFailed);
          }
          setError('');
        } catch {
          try {
            const raw = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
            const micOk = await attachDefaultMicrophone(raw);
            attachStream(raw);
            if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
            setError('');
          } catch (finalErr: unknown) {
            setError((prev) =>
              prev && prev.length > 0 ? prev : formatPreExamMediaAccessFailure(finalErr, lang)
            );
          }
        }
      }
    };
    checkDevices();
    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, [lang]);

  /** Shaxs tasdiqlandi — tugmasiz: kamera kadrlarida yengil harakat qidiriladi */
  useEffect(() => {
    if (!verified || livenessPassed || !cameraReady) return;

    let cancelled = false;
    const run = async () => {
      setLivenessChecking(true);
      setLivenessFailed(false);
      setError('');
      await new Promise((r) => setTimeout(r, 450));
      for (let round = 0; round < 3; round++) {
        if (cancelled) return;
        const ok = await samplePassiveFrameMotion(() => captureFrame());
        if (ok) {
          if (!cancelled) {
            setLivenessPassed(true);
            setLivenessChecking(false);
            setLivenessFailed(false);
            setError('');
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cancelled) {
        setLivenessChecking(false);
        setLivenessFailed(true);
        setError(translations[lang].preExamLivenessFail);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [verified, cameraReady, livenessPassed, livenessRetryKey, lang]);

  const verifyIdentity = async () => {
    if (!videoRef.current || !canvasRef.current || !user.profile_image) return;
    setVerifying(true);
    setError('');
    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0);
      const capturedImageBase64 = canvas.toDataURL('image/jpeg').split(',')[1];
      const profilePayload = String(user.profile_image).includes(',')
        ? user.profile_image
        : `data:image/jpeg;base64,${user.profile_image}`;

      const response = await fetch(apiUrl('/api/student/identity-compare'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          exam_id: exam.id,
          profile_image_base64: profilePayload,
          live_capture_base64: capturedImageBase64,
        }),
      });
      const data = (await readJsonSafe<{ match?: boolean; skipped?: boolean; code?: string }>(response)) || {};
      if (response.status === 503) {
        const code = data?.code || '';
        setError(
          code === 'GEMINI_UNAVAILABLE'
            ? t.identityVerifyServiceDown
            : code === 'GEMINI_ERROR'
              ? t.identityVerifyGeminiError
              : t.identityVerifyError
        );
        return;
      }
      if (!response.ok) {
        setError(t.identityVerifyError);
        return;
      }
      if (data.match === true) {
        setVerified(true);
        setError('');
      } else {
        setError(t.identityVerifyFailed);
      }
    } catch {
      setError(t.identityVerifyError);
    } finally {
      setVerifying(false);
    }
  };

  const handleStart = async () => {
    if (exam.has_pin && !pin) {
      setError(t.enterPin);
      return;
    }
    setStarting(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/start`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pin }),
      });
      const data = await readJsonSafe<{
        error?: string;
        exam?: any;
        studentExamId?: number;
        startedAt?: string;
      }>(res);
      if (!res.ok) {
        setError(data?.error || t.preExamStartError);
        setStarting(false);
        return;
      }
      if (!data?.exam || data.studentExamId == null) {
        setError(t.preExamServerError);
        setStarting(false);
        return;
      }
      onComplete({ ...data.exam, startedAt: data.startedAt }, data.studentExamId);
    } catch {
      setError(t.preExamNetworkError);
      setStarting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="min-h-[80vh] flex items-center justify-center p-6"
    >
      <Card className="max-w-4xl w-full">
        <CardHeader className="flex flex-col items-center gap-3">
          <InstituteLogo size="sm" />
          <CardTitle className="text-3xl text-center font-bold tracking-tight text-gray-900">
            {t.preExamTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-500/10 border border-red-500/20 text-red-600 p-4 rounded-2xl text-sm backdrop-blur-md whitespace-pre-line"
            >
              {error}
            </motion.div>
          )}
          {mediaHint && !error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-amber-500/10 border border-amber-500/25 text-amber-900 p-4 rounded-2xl text-sm backdrop-blur-md"
            >
              {mediaHint}
            </motion.div>
          )}

          {/* Kamera — yuqorida katta, to'liq kenglikda */}
          <div className="relative w-full rounded-3xl overflow-hidden border-4 border-white/60 shadow-xl bg-black"
               style={{ aspectRatio: '16/9', maxHeight: '420px' }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            <canvas ref={canvasRef} className="hidden" />
            {!cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500 font-medium bg-white/50 backdrop-blur-sm">
                {t.preExamWaitCamera}
              </div>
            )}
            {/* Kamera holati badge */}
            <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${cameraReady ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-white text-xs font-medium">
                {cameraReady ? t.preExamCameraActive : t.preExamWaitCamera}
              </span>
            </div>
            {/* Mikrofon holati badge */}
            <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${micReady ? 'bg-green-400' : 'bg-red-400'}`} />
              <span className="text-white text-xs font-medium">
                {micReady ? t.preExamMicActive : t.preExamMicInactive}
              </span>
            </div>
          </div>

          {exam.custom_rules && (
            <div className="p-4 border border-white/40 bg-white/30 rounded-3xl backdrop-blur-md shadow-sm">
              <h4 className="font-semibold text-sm text-gray-800 mb-1">{t.customRules}</h4>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{exam.custom_rules}</p>
            </div>
          )}

          <div className="space-y-4 max-w-xl mx-auto w-full">
              {/* Shaxs tasdiqlash */}
              {user.profile_image ? (
                <div className="p-4 border border-white/40 bg-white/30 rounded-3xl backdrop-blur-md shadow-sm space-y-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={user.profile_image}
                      alt={t.profilePhotoLabel}
                      className="w-14 h-14 rounded-2xl object-cover border-2 border-white shadow"
                      referrerPolicy="no-referrer"
                    />
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-800 text-sm">{t.identityVerification}</h4>
                    </div>
                  </div>

                  <Button
                    onClick={verifyIdentity}
                    disabled={!cameraReady || verifying || verified}
                    className={`w-full rounded-2xl h-12 ${
                      verified ? 'bg-green-500 hover:bg-green-600' : ''
                    }`}
                  >
                    {verifying
                      ? t.identityVerifying
                      : verified
                      ? t.identityVerified
                      : t.identityVerifyBtn}
                  </Button>

                  {/* Jonlilik: avtomatik, tugmasiz */}
                  <div className="space-y-2 pt-1">
                    <p className="text-xs text-gray-600">{t.preExamLivenessTitle}</p>
                    {verified && !livenessPassed && (
                      <p className="text-sm text-gray-700">{t.preExamLivenessSelfHint}</p>
                    )}
                    {verified && livenessChecking && (
                      <p className="text-sm text-blue-700 flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                        {t.preExamLivenessWaiting}
                      </p>
                    )}
                    {livenessPassed && (
                      <p className="text-sm font-semibold text-green-700">{t.preExamLivenessPassed}</p>
                    )}
                    {verified && !livenessPassed && livenessFailed && !livenessChecking && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl w-full"
                        onClick={() => {
                          setLivenessFailed(false);
                          setError('');
                          setLivenessRetryKey((k) => k + 1);
                        }}
                      >
                        {t.preExamLivenessRetryBtn}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-4 border border-red-500/30 bg-red-50/80 rounded-3xl backdrop-blur-md text-red-800 text-sm">
                  {t.profilePhotoMissingExam}
                </div>
              )}

              {/* PIN kodi */}
              {exam.has_pin && (
                <div className="p-4 border border-white/40 bg-white/30 rounded-3xl backdrop-blur-md shadow-sm">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.enterPin}
                  </label>
                  <Input
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="• • •"
                    className="text-center tracking-widest text-lg"
                  />
                </div>
              )}
            </div>

          {/* Rozilik + tugmalar */}
          <div className="pt-4 border-t border-gray-200/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            <label className="flex items-center gap-3 cursor-pointer p-3 hover:bg-white/50 rounded-2xl transition-colors flex-1">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="w-5 h-5 text-black rounded border-gray-300 focus:ring-black transition-all"
              />
              <span className="font-medium text-gray-800 text-sm">{t.agree}</span>
            </label>
            <div className="flex gap-3 shrink-0">
              <Button
                variant="outline"
                onClick={onCancel}
                className="px-6 rounded-full"
                disabled={starting}
              >
                {t.cancel}
              </Button>
              <Button
                onClick={handleStart}
                disabled={
                  !cameraReady ||
                  !agreed ||
                  starting ||
                  (exam.has_pin && !pin) ||
                  !user.profile_image ||
                  !verified ||
                  !livenessPassed ||
                  livenessChecking
                }
                className="px-8 rounded-full shadow-lg shadow-black/10"
              >
                {starting ? t.preExamStarting : t.takeExam}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
