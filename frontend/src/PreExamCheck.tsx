import React, { useState, useEffect, useRef } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from './components/ui';
import { motion } from 'motion/react';
import { translations, Language } from './i18n';
import { readJsonSafe } from './lib/http';
import { apiUrl } from './lib/apiUrl';
import { InstituteLogo } from './components/InstituteLogo';

const VIRTUAL_CAMERA_LABEL_RE = /(droidcam|epoccam|iriun|ivcam|obs|virtual|manycam|splitcam)/i;

async function getPreferredCameraStream(withAudio: boolean): Promise<MediaStream> {
  const initial = await navigator.mediaDevices.getUserMedia({ video: true, audio: withAudio });
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
    video: { deviceId: { exact: preferred.deviceId } },
    audio: withAudio,
  });
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
  const [starting, setStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [livenessStep, setLivenessStep] = useState(0);
  // livenessActive: tugma bosilganda "kutilmoqda" holati
  const [livenessActive, setLivenessActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = translations[lang];
  const livenessSigRef = useRef<number>(0);

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

  /**
   * Liveness bosqichini ishga tushiradi.
   * Foydalanuvchi harakatini (ko'z yumish / tabassum) aniqlash uchun:
   * - Boshlang'ich kadr olinadi
   * - 2 soniya davomida bir necha kadr olinadi
   * - Maksimal delta 4000+ bo'lsa harakat aniqlangan
   */
  const runLivenessStep = (nextStep: number, hint: string) => {
    const base = captureFrame();
    if (!base) {
      setError(t.preExamLivenessFail);
      return;
    }
    livenessSigRef.current = base;
    setLivenessActive(true);
    setError(hint);

    let maxDelta = 0;
    let checks = 0;
    const TOTAL_CHECKS = 8;
    const INTERVAL = 250; // ms

    const checkInterval = window.setInterval(() => {
      const current = captureFrame();
      const delta = Math.abs(current - livenessSigRef.current);
      if (delta > maxDelta) maxDelta = delta;
      checks++;

      if (checks >= TOTAL_CHECKS) {
        window.clearInterval(checkInterval);
        setLivenessActive(false);

        // Ko'z yumish: kichikroq delta yetarli (yuz maydonining bir qismi o'zgaradi)
        // Tabassum: og'iz atrofida o'zgarish
        const threshold = nextStep === 1 ? 3500 : 2500;

        if (maxDelta < threshold) {
          setError(t.preExamLivenessFail);
          // Qayta urinish uchun bosqichni reset qilmaymiz
          return;
        }
        setError('');
        setLivenessStep(nextStep);
        if (nextStep >= 2) setLivenessPassed(true);
      }
    }, INTERVAL);
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    const checkDevices = async () => {
      try {
        stream = await getPreferredCameraStream(true);
        setCameraReady(true);
        setMicReady(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch {
        setError(t.preExamCameraError);
      }
    };
    checkDevices();
    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, [t.preExamCameraError]);

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
          profile_image_base64: profilePayload,
          live_capture_base64: capturedImageBase64,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 503) {
        const code = data?.code || '';
        if (code === 'GEMINI_UNAVAILABLE') {
          setVerified(true);
          setError('');
        } else {
          setError(t.identityVerifyError);
        }
        return;
      }
      if (!response.ok) {
        setError(t.identityVerifyError);
        return;
      }
      if (data.match || data.skipped) {
        setVerified(true);
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

  // livenessStep: 0..2 (2 bosqich)

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="min-h-[80vh] flex items-center justify-center p-6"
    >
      <Card className="max-w-3xl w-full">
        <CardHeader className="flex flex-col items-center gap-3">
          <InstituteLogo size="sm" />
          <CardTitle className="text-3xl text-center font-bold tracking-tight text-gray-900">
            {t.preExamTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-500/10 border border-red-500/20 text-red-600 p-4 rounded-2xl text-sm backdrop-blur-md"
            >
              {error}
            </motion.div>
          )}

          {exam.exam_mode === 'bank_mixed' && (
            <p className="text-xs text-indigo-800 bg-indigo-50/80 border border-indigo-100 rounded-xl px-4 py-3 leading-relaxed">
              {t.examModeBankHint}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Chap ustun: tizim talablari + qoidalar */}
            <div className="space-y-6">
              {/* Tizim talablari */}
              <div className="p-5 border border-white/40 bg-white/30 rounded-3xl backdrop-blur-md shadow-sm">
                <h3 className="font-semibold text-lg text-gray-800 mb-4">{t.preExamSysReq}</h3>
                <ul className="space-y-3">
                  <li className="flex items-center gap-3 text-sm font-medium text-gray-700">
                    <span
                      className={`w-3 h-3 rounded-full shadow-sm flex-shrink-0 ${
                        cameraReady
                          ? 'bg-green-500 shadow-green-500/50'
                          : 'bg-red-500 shadow-red-500/50'
                      }`}
                    />
                    {t.preExamCamera}
                  </li>
                  <li className="flex items-center gap-3 text-sm font-medium text-gray-700">
                    <span
                      className={`w-3 h-3 rounded-full shadow-sm flex-shrink-0 ${
                        micReady
                          ? 'bg-green-500 shadow-green-500/50'
                          : 'bg-red-500 shadow-red-500/50'
                      }`}
                    />
                    {t.preExamMic}
                  </li>
                </ul>
              </div>

              {/* Qoidalar */}
              <div className="p-5 border border-white/40 bg-white/30 rounded-3xl backdrop-blur-md shadow-sm">
                <h3 className="font-semibold text-lg text-gray-800 mb-3">{t.rules}</h3>
                <ul className="list-disc pl-5 space-y-2 text-sm text-gray-600">
                  <li>{t.preExamRule1}</li>
                  <li>{t.preExamRule2}</li>
                  <li>{t.preExamRule3}</li>
                  <li>{t.preExamRule4}</li>
                  <li>{t.preExamRule5}</li>
                  <li className="text-red-600 font-medium">{t.preExamRule6}</li>
                </ul>
                {exam.custom_rules && (
                  <div className="mt-4 pt-4 border-t border-black/5">
                    <h4 className="font-semibold text-sm text-gray-800 mb-2">{t.customRules}:</h4>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{exam.custom_rules}</p>
                  </div>
                )}
              </div>
            </div>

            {/* O'ng ustun: kamera + shaxs tekshiruvi */}
            <div className="flex flex-col justify-center space-y-6">
              {/* Kamera ko'rinishi */}
              <div className="aspect-video bg-black/5 rounded-3xl overflow-hidden relative border-4 border-white/50 shadow-lg">
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
              </div>

              {/* Shaxs tasdiqlash */}
              {user.profile_image ? (
                <div className="p-5 border border-white/40 bg-white/30 rounded-3xl backdrop-blur-md shadow-sm space-y-4">
                  <div className="flex items-center gap-4">
                    <img
                      src={user.profile_image}
                      alt={t.profilePhotoLabel}
                      className="w-16 h-16 rounded-2xl object-cover border-2 border-white"
                      referrerPolicy="no-referrer"
                    />
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-800">{t.identityVerification}</h4>
                      <p className="text-xs text-gray-500">{t.identityVerificationHint}</p>
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

                  {/* Jonlilik tekshiruvi */}
                  <div className="space-y-3">
                    <p className="text-xs text-gray-700 font-semibold">{t.preExamLivenessTitle}</p>

                    {/* Bosqich 1: Ko'z yumish */}
                    <div className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${
                      livenessStep >= 1
                        ? 'bg-green-50 border-green-200'
                        : livenessActive && livenessStep === 0
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-white/50 border-gray-200'
                    }`}>
                      <span className={`text-xl flex-shrink-0 ${livenessStep >= 1 ? 'opacity-100' : 'opacity-50'}`}>
                        {livenessStep >= 1 ? '✅' : livenessActive && livenessStep === 0 ? '👁️' : '👁️'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${livenessStep >= 1 ? 'text-green-700' : 'text-gray-700'}`}>
                          {t.preExamLiveness1}
                        </p>
                        {livenessActive && livenessStep === 0 && (
                          <p className="text-xs text-blue-600 mt-0.5 animate-pulse">{t.preExamLivenessHint1}</p>
                        )}
                      </div>
                      {livenessStep === 0 && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={!verified || livenessActive}
                          onClick={() => runLivenessStep(1, t.preExamLivenessHint1)}
                          className="flex-shrink-0 rounded-xl"
                        >
                          {livenessActive ? t.preExamLivenessWaiting : t.preExamLivenessStep1Btn}
                        </Button>
                      )}
                      {livenessStep >= 1 && (
                        <span className="text-green-600 text-sm font-bold flex-shrink-0">✓</span>
                      )}
                    </div>

                    {/* Bosqich 2: Tabassum */}
                    <div className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${
                      livenessStep >= 2
                        ? 'bg-green-50 border-green-200'
                        : livenessActive && livenessStep === 1
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-white/50 border-gray-200'
                    }`}>
                      <span className={`text-xl flex-shrink-0 ${livenessStep >= 2 ? 'opacity-100' : 'opacity-50'}`}>
                        {livenessStep >= 2 ? '✅' : '😊'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${livenessStep >= 2 ? 'text-green-700' : 'text-gray-700'}`}>
                          {t.preExamLiveness2}
                        </p>
                        {livenessActive && livenessStep === 1 && (
                          <p className="text-xs text-blue-600 mt-0.5 animate-pulse">{t.preExamLivenessHint2}</p>
                        )}
                      </div>
                      {livenessStep === 1 && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={!verified || livenessActive}
                          onClick={() => runLivenessStep(2, t.preExamLivenessHint2)}
                          className="flex-shrink-0 rounded-xl"
                        >
                          {livenessActive ? t.preExamLivenessWaiting : t.preExamLivenessStep2Btn}
                        </Button>
                      )}
                      {livenessStep >= 2 && (
                        <span className="text-green-600 text-sm font-bold flex-shrink-0">✓</span>
                      )}
                    </div>

                    {/* Umumiy holat */}
                    {livenessPassed && (
                      <p className="text-sm font-semibold text-green-700 text-center py-1">
                        {t.preExamLivenessPassed}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-5 border border-red-500/30 bg-red-50/80 rounded-3xl backdrop-blur-md text-red-800 text-sm">
                  {t.profilePhotoMissingExam}
                </div>
              )}

              {/* PIN kodi */}
              {exam.has_pin && (
                <div className="p-5 border border-white/40 bg-white/30 rounded-3xl backdrop-blur-md shadow-sm">
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
          </div>

          {/* Rozilik */}
          <div className="pt-6 border-t border-gray-200/50">
            <label className="flex items-center gap-3 cursor-pointer p-4 hover:bg-white/50 rounded-2xl transition-colors">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="w-5 h-5 text-black rounded border-gray-300 focus:ring-black transition-all"
              />
              <span className="font-medium text-gray-800">{t.agree}</span>
            </label>
          </div>

          {/* Tugmalar */}
          <div className="flex justify-end gap-4 pt-2">
            <Button
              variant="outline"
              onClick={onCancel}
              className="px-8 rounded-full"
              disabled={starting}
            >
              {t.cancel}
            </Button>
            <Button
              onClick={handleStart}
              disabled={
                !cameraReady ||
                !micReady ||
                !agreed ||
                starting ||
                (exam.has_pin && !pin) ||
                !user.profile_image ||
                !verified ||
                !livenessPassed ||
                livenessActive
              }
              className="px-8 rounded-full shadow-lg shadow-black/10"
            >
              {starting ? t.preExamStarting : t.takeExam}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
