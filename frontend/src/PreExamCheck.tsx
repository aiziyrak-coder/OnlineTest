import React, { useState, useEffect, useRef } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from './components/ui';
import { motion } from 'motion/react';
import { translations, Language } from './i18n';
import { readJsonSafe } from './lib/http';
import { apiUrl } from './lib/apiUrl';
import { InstituteLogo } from './components/InstituteLogo';

const VIRTUAL_CAMERA_LABEL_RE = /(droidcam|epoccam|iriun|ivcam|obs|virtual)/i;

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

export function PreExamCheck({ exam, token, user, lang, onComplete, onCancel }: { exam: any, token: string, user: any, lang: Language, onComplete: (examData: any, seId: number) => void, onCancel: () => void }) {
  const [cameraReady, setCameraReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = translations[lang];

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
      } catch (err) {
        setError('Camera or microphone access denied. Please allow permissions to continue.');
      }
    };
    checkDevices();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

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
      
      // Mirror the capture to match the video display
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
          // Kalit sozlanmagan — ixtiyoriy, o'tkazib yuboramiz
          setVerified(true);
          setError('');
        } else {
          // Texnik xato — qayta urinish imkoni
          setError(t.identityVerifyError);
        }
        return;
      }
      if (!response.ok) {
        setError(t.identityVerifyError);
        return;
      }
      if (data.match) {
        setVerified(true);
      } else {
        setError(t.identityVerifyFailed);
      }
    } catch (err) {
      console.error('Verification error:', err);
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
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ pin })
      });
      const data = await readJsonSafe<{ error?: string; exam?: any; studentExamId?: number; startedAt?: string }>(res);
      
      if (!res.ok) {
        setError(data?.error || 'Failed to start exam');
        setStarting(false);
        return;
      }
      
      if (!data?.exam || data.studentExamId == null) {
        setError('Invalid server response');
        setStarting(false);
        return;
      }
      onComplete({ ...data.exam, startedAt: data.startedAt }, data.studentExamId);
    } catch (err) {
      setError('Network error');
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
      <Card className="max-w-3xl w-full">
        <CardHeader className="flex flex-col items-center gap-3">
          <InstituteLogo size="sm" />
          <CardTitle className="text-3xl text-center font-bold tracking-tight text-gray-900">Pre-Exam Check</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          {error && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-red-500/10 border border-red-500/20 text-red-600 p-4 rounded-2xl text-sm backdrop-blur-md">
              {error}
            </motion.div>
          )}
          {exam.exam_mode === 'bank_mixed' && (
            <p className="text-xs text-indigo-800 bg-indigo-50/80 border border-indigo-100 rounded-xl px-4 py-3 leading-relaxed">
              {t.examModeBankHint}
            </p>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="p-5 border border-white/40 bg-white/30 rounded-3xl backdrop-blur-md shadow-sm">
                <h3 className="font-semibold text-lg text-gray-800 mb-4">System Requirements</h3>
                <ul className="space-y-3">
                  <li className="flex items-center gap-3 text-sm font-medium text-gray-700">
                    <span className={`w-3 h-3 rounded-full shadow-sm ${cameraReady ? 'bg-green-500 shadow-green-500/50' : 'bg-red-500 shadow-red-500/50'}`}></span>
                    Camera Access
                  </li>
                  <li className="flex items-center gap-3 text-sm font-medium text-gray-700">
                    <span className={`w-3 h-3 rounded-full shadow-sm ${micReady ? 'bg-green-500 shadow-green-500/50' : 'bg-red-500 shadow-red-500/50'}`}></span>
                    Microphone Access
                  </li>
                </ul>
              </div>
              
              <div className="p-5 border border-white/40 bg-white/30 rounded-3xl backdrop-blur-md shadow-sm">
                <h3 className="font-semibold text-lg text-gray-800 mb-3">{t.rules}</h3>
                <ul className="list-disc pl-5 space-y-2 text-sm text-gray-600">
                  <li>You must remain in full view of the camera.</li>
                  <li>No other people are allowed in the room.</li>
                  <li>No talking or background noise.</li>
                  <li>Do not use phones, books, or other devices.</li>
                  <li>Do not leave the browser window or exit fullscreen.</li>
                  <li className="text-red-600 font-medium">3 warnings will result in an automatic ban.</li>
                </ul>
                {exam.custom_rules && (
                  <div className="mt-4 pt-4 border-t border-black/5">
                    <h4 className="font-semibold text-sm text-gray-800 mb-2">{t.customRules}:</h4>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap">{exam.custom_rules}</p>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex flex-col justify-center space-y-6">
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
                    Waiting for camera...
                  </div>
                )}
              </div>

              {user.profile_image ? (
                <div className="p-5 border border-white/40 bg-white/30 rounded-3xl backdrop-blur-md shadow-sm space-y-4">
                  <div className="flex items-center gap-4">
                    <img src={user.profile_image} alt="Profile" className="w-16 h-16 rounded-2xl object-cover border-2 border-white" referrerPolicy="no-referrer" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-800">{t.identityVerification}</h4>
                      <p className="text-xs text-gray-500">{t.identityVerificationHint}</p>
                    </div>
                  </div>
                  <Button 
                    onClick={verifyIdentity} 
                    disabled={!cameraReady || verifying || verified}
                    className={`w-full rounded-2xl h-12 ${verified ? 'bg-green-500 hover:bg-green-600' : ''}`}
                  >
                    {verifying ? t.identityVerifying : verified ? t.identityVerified : t.identityVerifyBtn}
                  </Button>
                </div>
              ) : (
                <div className="p-5 border border-red-500/30 bg-red-50/80 rounded-3xl backdrop-blur-md text-red-800 text-sm">
                  {t.profilePhotoMissingExam}
                </div>
              )}
              
              {exam.has_pin && (
                <div className="p-5 border border-white/40 bg-white/30 rounded-3xl backdrop-blur-md shadow-sm">
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t.enterPin}</label>
                  <Input 
                    type="password" 
                    value={pin} 
                    onChange={(e) => setPin(e.target.value)} 
                    placeholder="***" 
                    className="text-center tracking-widest text-lg"
                  />
                </div>
              )}
            </div>
          </div>

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

          <div className="flex justify-end gap-4 pt-2">
            <Button variant="outline" onClick={onCancel} className="px-8 rounded-full" disabled={starting}>Cancel</Button>
            <Button 
              onClick={handleStart} 
              disabled={!cameraReady || !micReady || !agreed || starting || (exam.has_pin && !pin) || !user.profile_image || !verified}
              className="px-8 rounded-full shadow-lg shadow-black/10"
            >
              {starting ? 'Starting...' : t.takeExam}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
