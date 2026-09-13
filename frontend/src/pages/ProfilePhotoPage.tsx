import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../lib/apiUrl';

// Profil rasmini o'zi yangilash.
//
// NEGA: o'qituvchilar HR bazasidan 47x60 piksellik kadrlar bilan import
// qilingan. Bunday rasmda yuz ~40 piksel bo'ladi va imtihonga kirishdagi
// solishtiruv "mos kelmadi" deb rad etadi. Odam pasportidagi sifatli rasmni
// yuklab, jonli selfi bilan tasdiqlasa - profil rasmi yangilanadi.
//
// Tekshiruvni server LOKAL qiladi (OpenCV), tashqi AI ishlatilmaydi.

type Lang = 'uz' | 'ru' | 'en';

const TXT: Record<string, Record<string, string>> = {
  uz: {
    title: 'Profil rasmini yangilash',
    intro:
      'Imtihonga kirishda yuzingiz shu rasm bilan solishtiriladi. Rasm sifatsiz bo‘lsa tizim sizni tanimaydi. Pasportingizdagi rasmni yuklab, kamerada o‘zingizni tasdiqlang.',
    current: 'Hozirgi rasmingiz',
    noCurrent: 'Rasm yo‘q',
    step1: '1-qadam. Pasport rasmini yuklang',
    step1hint: 'Pasportning rasm bor sahifasini suratga oling yoki fayl tanlang. Yuz aniq ko‘rinsin.',
    pickFile: 'Pasport rasmini tanlash',
    pickHint: 'Bosing yoki faylni shu yerga tashlang · JPG, PNG',
    fileNone: 'Hali fayl tanlanmadi',
    step2: '2-qadam. Kamerada o‘zingizni suratga oling',
    startCam: 'Kamerani yoqish',
    capture: 'Suratga olish',
    retake: 'Qayta olish',
    submit: 'Tekshirish va yangilash',
    working: 'Tekshirilmoqda…',
    okTitle: 'Rasm yangilandi',
    okText: 'Endi imtihonga kirishda tanish muammosi bo‘lmasligi kerak.',
    noMatch:
      'Pasportdagi yuz kameradagi yuzga mos kelmadi. Yorug‘lik yuzingizga tushsin, kameraga to‘g‘ri qarang va pasport rasmi aniq ko‘rinsin.',
    faceNot: 'Yuz aniqlanmadi. Pasport rasmi aniqroq bo‘lsin va kameraga to‘g‘ridan qarang.',
    needBoth: 'Ikkalasi ham kerak: pasport rasmi va kameradagi surat.',
    err: 'Xatolik yuz berdi. Qayta urinib ko‘ring.',
    noAuth: 'Avval tizimga kiring.',
    login: 'Kirish sahifasi',
    camErr: 'Kamera ochilmadi. Brauzerda kameraga ruxsat bering.',
  },
  ru: {
    title: 'Обновление фото профиля',
    intro:
      'При входе на экзамен ваше лицо сравнивается с этим фото. Если фото плохого качества, система вас не узнает. Загрузите фото из паспорта и подтвердите себя на камеру.',
    current: 'Текущее фото',
    noCurrent: 'Фото нет',
    step1: 'Шаг 1. Загрузите фото паспорта',
    step1hint: 'Сфотографируйте страницу паспорта с фото. Лицо должно быть чётко видно.',
    pickFile: 'Выбрать фото паспорта',
    pickHint: 'Нажмите или перетащите файл сюда · JPG, PNG',
    fileNone: 'Файл ещё не выбран',
    step2: 'Шаг 2. Сделайте снимок на камеру',
    startCam: 'Включить камеру',
    capture: 'Сделать снимок',
    retake: 'Переснять',
    submit: 'Проверить и обновить',
    working: 'Проверяется…',
    okTitle: 'Фото обновлено',
    okText: 'Теперь при входе на экзамен проблем с распознаванием быть не должно.',
    noMatch:
      'Лицо в паспорте не совпало с лицом на камере. Свет должен падать на лицо, смотрите прямо в камеру, фото паспорта должно быть чётким.',
    faceNot: 'Лицо не обнаружено. Сделайте фото паспорта чётче и смотрите прямо в камеру.',
    needBoth: 'Нужны оба: фото паспорта и снимок с камеры.',
    err: 'Произошла ошибка. Попробуйте ещё раз.',
    noAuth: 'Сначала войдите в систему.',
    login: 'Страница входа',
    camErr: 'Камера не открылась. Разрешите доступ к камере в браузере.',
  },
  en: {
    title: 'Update profile photo',
    intro:
      'Your face is compared against this photo when entering an exam. If the photo is poor, the system will not recognise you. Upload your passport photo and confirm yourself on camera.',
    current: 'Current photo',
    noCurrent: 'No photo',
    step1: 'Step 1. Upload passport photo',
    step1hint: 'Photograph the passport page with your photo. The face must be clearly visible.',
    pickFile: 'Choose passport photo',
    pickHint: 'Click or drop the file here · JPG, PNG',
    fileNone: 'No file chosen yet',
    step2: 'Step 2. Take a camera snapshot',
    startCam: 'Start camera',
    capture: 'Capture',
    retake: 'Retake',
    submit: 'Verify and update',
    working: 'Verifying…',
    okTitle: 'Photo updated',
    okText: 'Exam entry should now recognise you without trouble.',
    noMatch:
      'The passport face did not match the camera. Light should fall on your face, look straight at the camera, and the passport photo must be sharp.',
    faceNot: 'No face detected. Make the passport photo sharper and look straight at the camera.',
    needBoth: 'Both are required: passport photo and camera snapshot.',
    err: 'Something went wrong. Please try again.',
    noAuth: 'Please sign in first.',
    login: 'Sign-in page',
    camErr: 'Camera did not open. Allow camera access in the browser.',
  },
};

function readStore(key: string): string | null {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      resolve(s.includes(',') ? s.split(',')[1] : s);
    };
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(file);
  });
}

export function ProfilePhotoPage() {
  const lang = ((readStore('lang') || 'uz').trim() as Lang) || 'uz';
  const t = TXT[lang] || TXT.uz;
  const token = (readStore('token') || '').trim();

  let user: any = null;
  try {
    user = JSON.parse(readStore('user') || 'null');
  } catch {
    user = null;
  }

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [passportB64, setPassportB64] = useState('');
  const [passportName, setPassportName] = useState('');
  const [shotB64, setShotB64] = useState('');
  const [camOn, setCamOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [okPhoto, setOkPhoto] = useState('');

  const stopCam = useCallback(() => {
    try {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    } catch {
      /* ignore */
    }
    streamRef.current = null;
    setCamOn(false);
  }, []);

  useEffect(() => () => stopCam(), [stopCam]);

  const startCam = async () => {
    setMsg('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      streamRef.current = s;
      setCamOn(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => undefined);
        }
      }, 50);
    } catch {
      setMsg(t.camErr);
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    setShotB64(c.toDataURL('image/jpeg', 0.9).split(',')[1]);
    stopCam();
  };

  const submit = async () => {
    if (!passportB64 || !shotB64) {
      setMsg(t.needBoth);
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(apiUrl('/api/student/profile-photo'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          passport_image_base64: passportB64,
          live_capture_base64: shotB64,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.ok) {
        // MUHIM: brauzerda saqlangan `user` obyektidagi rasmni ham
        // almashtiramiz. Imtihon oldi tekshiruvi aynan shu keshlangan
        // rasmni serverga yuboradi — busiz odam rasmni yangilasa ham
        // imtihonga ESKI rasm bilan kirardi va yuz tanilmasdi.
        const fresh = String((data && data.photo) || passportB64);
        try {
          [window.sessionStorage, window.localStorage].forEach((store) => {
            const raw = store.getItem('user');
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              parsed.profile_image = fresh;
              store.setItem('user', JSON.stringify(parsed));
            }
          });
        } catch {
          /* kesh yangilanmasa ham ishlashda davom etamiz */
        }
        setOkPhoto(fresh);
        setMsg('');
      } else {
        const code = String((data && data.code) || '');
        setMsg(
          code === 'FACE_NOT_DETECTED' || code === 'IMAGE_TOO_SMALL'
            ? t.faceNot
            : code === 'NO_MATCH' || (data && data.ok === false && data.score != null)
              ? t.noMatch
              : t.err,
        );
      }
    } catch {
      setMsg(t.err);
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-2xl shadow p-6 text-center max-w-sm">
          <div className="text-gray-900 font-semibold mb-2">{t.noAuth}</div>
          <a className="text-indigo-600 underline" href="/login">{t.login}</a>
        </div>
      </div>
    );
  }

  const currentSrc = user && user.profile_image
    ? String(user.profile_image).startsWith('data:')
      ? String(user.profile_image)
      : 'data:image/jpeg;base64,' + String(user.profile_image)
    : '';

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow p-6">
        <h1 className="text-xl font-semibold text-gray-900">{t.title}</h1>
        <p className="text-sm text-gray-600 mt-2">{t.intro}</p>

        {okPhoto ? (
          <div className="mt-6 text-center">
            <div className="text-emerald-700 font-semibold text-lg">{t.okTitle}</div>
            <p className="text-sm text-gray-600 mt-1">{t.okText}</p>
            <img
              src={'data:image/jpeg;base64,' + okPhoto}
              alt=""
              className="mt-4 mx-auto rounded-xl max-h-64 border border-emerald-200"
            />
            {/* Kabinetga TO'LIQ qayta yuklash bilan qaytamiz: ilova
                foydalanuvchi obyektini brauzer xotirasidan o'qiydi, ya'ni
                yangi rasm shundan keyin amalda ishlaydi. */}
            <button
              type="button"
              onClick={() => { window.location.href = '/'; }}
              className="mt-5 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
            >
              {lang === 'ru' ? 'Вернуться в кабинет' : lang === 'en' ? 'Back to cabinet' : 'Kabinetga qaytish'}
            </button>
          </div>
        ) : (
          <>
            <div className="mt-5">
              <div className="text-[13px] text-gray-500 mb-1">{t.current}</div>
              {currentSrc ? (
                <img src={currentSrc} alt="" className="h-28 rounded-lg border border-gray-200" />
              ) : (
                <div className="text-sm text-gray-400">{t.noCurrent}</div>
              )}
            </div>

            <div className="mt-6">
              <div className="font-medium text-gray-900">{t.step1}</div>
              <div className="text-[13px] text-gray-500 mb-2">{t.step1hint}</div>
              {/* Yalang'och <input type="file"> oddiy matndek ko'rinib,
                  o'qituvchilar bu yerda fayl yuklash kerakligini tushunmasdi. */}
              <label
                htmlFor="passport-file"
                className="flex items-center gap-3 w-full cursor-pointer rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 px-4 py-4 hover:bg-indigo-50 transition-colors"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6H16a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-indigo-700">{t.pickFile}</span>
                  <span className="block text-[13px] text-gray-500 truncate">
                    {passportName || t.pickHint}
                  </span>
                </span>
              </label>
              <input
                id="passport-file"
                type="file"
                className="sr-only"
                accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files && e.target.files[0];
                  if (!f) return;
                  setPassportName(f.name);
                  try {
                    setPassportB64(await fileToBase64(f));
                  } catch {
                    setMsg(t.err);
                  }
                }}
              />
              {!passportB64 ? (
                <div className="mt-2 text-[13px] text-gray-400">{t.fileNone}</div>
              ) : null}
              {passportB64 ? (
                <img
                  src={'data:image/jpeg;base64,' + passportB64}
                  alt={passportName}
                  className="mt-3 h-40 rounded-lg border border-gray-200"
                />
              ) : null}
            </div>

            <div className="mt-6">
              <div className="font-medium text-gray-900 mb-2">{t.step2}</div>
              {shotB64 ? (
                <div>
                  <img
                    src={'data:image/jpeg;base64,' + shotB64}
                    alt=""
                    className="h-40 rounded-lg border border-gray-200"
                  />
                  <button
                    className="mt-2 px-3 py-1.5 text-sm rounded-lg border border-gray-300"
                    onClick={() => { setShotB64(''); startCam(); }}
                  >
                    {t.retake}
                  </button>
                </div>
              ) : camOn ? (
                <div>
                  <video ref={videoRef} muted playsInline className="h-48 rounded-lg bg-black" />
                  <button
                    className="mt-2 px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white"
                    onClick={capture}
                  >
                    {t.capture}
                  </button>
                </div>
              ) : (
                <button
                  className="px-4 py-2 text-sm rounded-lg border border-gray-300"
                  onClick={startCam}
                >
                  {t.startCam}
                </button>
              )}
            </div>

            {msg ? <div className="mt-4 text-sm text-red-600">{msg}</div> : null}

            <button
              className="mt-6 w-full py-3 rounded-xl bg-indigo-600 text-white font-medium disabled:opacity-50"
              disabled={busy || !passportB64 || !shotB64}
              onClick={submit}
            >
              {busy ? t.working : t.submit}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
