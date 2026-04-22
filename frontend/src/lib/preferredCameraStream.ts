/**
 * Virtual kamera (OBS, DroidCam va h.k.) dan himoya — imtihonda haqiqiy qurilmani talab qilish (VAC security).
 *
 * Lab rejimi: frontend/.env da VITE_ALLOW_VIRTUAL_CAMERA=true bo'lsa virtuall qurilmaga fallback qaytadi (faqat ichki test).
 */

/** Brauzer blokirovkasi — DOMException.message bilan solishtirish uchun */
export const VIRTUAL_CAMERA_BLOCKED_MESSAGE = 'VAC_VIRTUAL_BLOCKED';

/** Lab ichki test uchun virtual kamerani yoqilish (prod build da odatda yozilmaydi) */
const ALLOW_VIRTUAL_FALLBACK =
  String(import.meta.env.VITE_ALLOW_VIRTUAL_CAMERA || '').toLowerCase().trim() === 'true';

/**
 * Qurilma nomlarida tez-tez uchraydigan virtual/dasturiy webcam belgilari (kichik harf).
 * Uzunligi — ortiqcha false positive bermasligi uchun substring sifatida.
 */
const VIRTUAL_CAMERA_MARKERS = [
  'droidcam',
  'epoccam',
  'iriun',
  'iriun webcam',
  'ivcam',
  'e2esoft ivcam',
  'obs virtual',
  'obs-camera',
  'obs camera',
  'virtual camera',
  'virtualcamera',
  'manycam',
  'splitcam',
  'split cam',
  'webcamoid',
  'chromacam',
  'chroma cam',
  'akvcam',
  'snap camera',
  'ndi webcam',
  'ndi virtual',
  'ndi webcamera',
  'unitycapture',
  'unity capture',
  'xsplit',
  'vcam',
  'streamlabs virtual',
  'eos webcam utility',
  'dslr webcam',
  'dslr webcam utility',
  'canon webcam utility',
  'finecam',
  'youcam',
  'cyberlink',
  'perfectcam',
  'perfect cam',
  'nvidia broadcast',
  'mmhmm',
  'kinoni',
  'webcamera for obs',
  'smartphone as webcam',
  'ndi hx',
  'vmix',
  'mmhmm virtual',
];

/** Brauzer "" qaytarganda aniqlash mumkin emas — false */
export function isVirtualCameraLabel(label: string): boolean {
  const L = (label || '').toLowerCase();
  if (!L.trim()) return false;

  if (/\bobs virtual\b|\bobs-camera\b|\bvirtualcam\b|\bvirtual cam\b|\bndi webcam\b|\bndi virtual\b/i.test(L)) {
    return true;
  }

  /* "OBS Virtual Camera", "OBS-Camera", "OBS Studio Virtual" */
  if (/\bobs\b/i.test(L) && /virtual|studio|camera|cam/i.test(L)) {
    return true;
  }

  return VIRTUAL_CAMERA_MARKERS.some((m) => L.includes(m));
}

export function streamLooksLikeVirtualCamera(stream: MediaStream | null | undefined): boolean {
  const track = stream?.getVideoTracks?.()?.[0];
  return Boolean(track?.label && isVirtualCameraLabel(track.label));
}

/** Virtual bo'lsa tracklarni to'xtatadi va DOMException uchiradi */
export function rejectVirtualCameraStream(stream: MediaStream): void {
  if (!streamLooksLikeVirtualCamera(stream)) return;
  stream.getTracks().forEach((t) => t.stop());
  throw new DOMException(VIRTUAL_CAMERA_BLOCKED_MESSAGE, 'NotAllowedError');
}

/**
 * `video: true` o'rniga yengil cheklovlar: to'liq HD birinchi ochilishi ba'zi USB/Windows
 * konfiguratsiyalarida NotReadableError ("Could not start video source") beradi.
 */
export const LIGHT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 320, max: 1280 },
  height: { ideal: 240, max: 720 },
  frameRate: { ideal: 15, max: 30 },
};

/** Virtual bo'lsa va qat'iy rejim bo'lsa — stream to'xtatiladi va xato; lab rejimida ogohlantirish. */
function finalizePhysicalStream(stream: MediaStream, ctx: string): MediaStream {
  if (!streamLooksLikeVirtualCamera(stream)) return stream;
  if (ALLOW_VIRTUAL_FALLBACK) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[VAC]', ctx, 'virtual camera allowed (VITE_ALLOW_VIRTUAL_CAMERA=true)');
    }
    return stream;
  }
  rejectVirtualCameraStream(stream);
  return stream;
}

export async function openPreferredCameraStream(
  withAudio: boolean,
  video: true | MediaTrackConstraints,
): Promise<MediaStream> {
  const videoConstraint: MediaTrackConstraints | boolean =
    video === true ? LIGHT_VIDEO_CONSTRAINTS : video;
  const initial = await navigator.mediaDevices.getUserMedia({
    video: videoConstraint,
    audio: withAudio,
  });

  const currentTrack = initial.getVideoTracks()[0];
  const currentLabel = currentTrack?.label || '';
  if (currentLabel && !isVirtualCameraLabel(currentLabel)) {
    return finalizePhysicalStream(initial, 'openPreferred initial ok');
  }

  let devices: MediaDeviceInfo[];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return finalizePhysicalStream(initial, 'enumerateDevices failed');
  }

  const preferred = devices.find(
    (d) => d.kind === 'videoinput' && !isVirtualCameraLabel(d.label || ''),
  );
  if (!preferred?.deviceId) {
    return finalizePhysicalStream(initial, 'no non-virtual device id');
  }

  const currentId = currentTrack?.getSettings?.().deviceId;
  if (currentId && currentId === preferred.deviceId) return finalizePhysicalStream(initial, 'same device');

  const base: MediaTrackConstraints =
    video === true ? { ...LIGHT_VIDEO_CONSTRAINTS } : { ...(video as MediaTrackConstraints) };
  const switchedVideo: MediaTrackConstraints = {
    ...base,
    deviceId: { exact: preferred.deviceId },
  };

  try {
    const switched = await navigator.mediaDevices.getUserMedia({
      video: switchedVideo,
      audio: withAudio,
    });
    initial.getTracks().forEach((t) => t.stop());
    return finalizePhysicalStream(switched, 'switched device');
  } catch {
    return finalizePhysicalStream(initial, 'switch failed');
  }
}

export async function attachDefaultMicrophone(videoStream: MediaStream): Promise<boolean> {
  try {
    const a = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    a.getAudioTracks().forEach((tr) => videoStream.addTrack(tr));
    return true;
  } catch {
    try {
      const a = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      a.getAudioTracks().forEach((tr) => videoStream.addTrack(tr));
      return true;
    } catch {
      return false;
    }
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function uniqueVideoInputs(devices: MediaDeviceInfo[]): MediaDeviceInfo[] {
  const seen = new Set<string>();
  const out: MediaDeviceInfo[] = [];
  for (const d of devices) {
    if (d.kind !== 'videoinput' || !d.deviceId) continue;
    if (seen.has(d.deviceId)) continue;
    seen.add(d.deviceId);
    out.push(d);
  }
  const rank = (d: MediaDeviceInfo) => {
    const L = (d.label || '').toLowerCase();
    if (/integrated|built-in|internal|facetime/.test(L)) return 0;
    if (/usb|hd|webcam/.test(L)) return 1;
    return 2;
  };
  out.sort((a, b) => rank(a) - rank(b));
  return out;
}

/**
 * Default kamera NotReadable bo'lsa — har bir videoinput ni bir necha cheklov bilan,
 * qurilmalar orasida qisqa kutish bilan sinaymiz (Chrome: "Could not start video source").
 * Prod: virtual kameraga fallback yo'q (faqat VITE_ALLOW_VIRTUAL_CAMERA=true).
 */
export async function openCameraByTryingVideoInputs(): Promise<MediaStream> {
  await sleep(420);
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoInputs = uniqueVideoInputs(devices);
  let lastErr: unknown;

  const skipVirtualPasses = ALLOW_VIRTUAL_FALLBACK ? [true, false] : [true];

  const tryConstraints = async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    if (streamLooksLikeVirtualCamera(s)) {
      if (ALLOW_VIRTUAL_FALLBACK) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[VAC] openCameraByTryingVideoInputs: virtual stream allowed (lab)');
        }
      } else {
        rejectVirtualCameraStream(s);
      }
    }
    await attachDefaultMicrophone(s);
    return s;
  };

  const variantsForDevice = (id: string): MediaStreamConstraints[] => [
    { video: { deviceId: { ideal: id } }, audio: false },
    {
      video: {
        deviceId: { ideal: id },
        width: { max: 320 },
        height: { max: 240 },
        frameRate: { max: 15 },
      },
      audio: false,
    },
    {
      video: {
        deviceId: { exact: id },
        width: { max: 320 },
        height: { max: 240 },
        frameRate: { max: 15 },
      },
      audio: false,
    },
    {
      video: {
        deviceId: { ideal: id },
        width: { ideal: 160 },
        height: { ideal: 120 },
      },
      audio: false,
    },
    {
      video: {
        deviceId: { exact: id },
        width: { ideal: 160 },
        height: { ideal: 120 },
      },
      audio: false,
    },
  ];

  for (const skipVirtual of skipVirtualPasses) {
    for (const d of videoInputs) {
      if (skipVirtual && isVirtualCameraLabel(d.label || '')) continue;
      for (const constraints of variantsForDevice(d.deviceId)) {
        try {
          await sleep(320);
          return await tryConstraints(constraints);
        } catch (e) {
          lastErr = e;
        }
      }
      await sleep(180);
    }
  }

  const globalFallbacks: MediaStreamConstraints[] = [
    { video: { facingMode: 'user' }, audio: false },
    { video: LIGHT_VIDEO_CONSTRAINTS, audio: false },
    {
      video: { width: { max: 320 }, height: { max: 240 }, frameRate: { max: 10 } },
      audio: false,
    },
    { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 24 } }, audio: false },
    { video: true, audio: false },
  ];
  for (const constraints of globalFallbacks) {
    try {
      await sleep(380);
      return await tryConstraints(constraints);
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new DOMException('Could not open any camera', 'NotReadableError');
}

const PROCTOR_VIDEO: MediaTrackConstraints = LIGHT_VIDEO_CONSTRAINTS;

/**
 * Imtihon xonasi: avval video, keyin mikrofon (Windows'da birgalikdagi NotReadable kamayadi).
 * Mikrofon ochilmasa ham video oqimi qaytariladi.
 */
export async function openPreferredProctorStream(): Promise<MediaStream> {
  try {
    const v = await openPreferredCameraStream(false, PROCTOR_VIDEO);
    await attachDefaultMicrophone(v);
    return finalizePhysicalStream(v, 'proctor v0');
  } catch (e0: unknown) {
    const n0 =
      e0 instanceof DOMException ? e0.name : e0 instanceof Error ? e0.name : '';
    if (
      n0 === 'NotAllowedError' ||
      n0 === 'PermissionDeniedError' ||
      n0 === 'SecurityError' ||
      n0 === 'NotFoundError' ||
      n0 === 'DevicesNotFoundError'
    ) {
      throw e0;
    }
    if (e0 instanceof DOMException && e0.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
      throw e0;
    }
  }

  try {
    const s = await openPreferredCameraStream(true, PROCTOR_VIDEO);
    await attachDefaultMicrophone(s);
    return finalizePhysicalStream(s, 'proctor audio+video');
  } catch (e: unknown) {
    const name =
      e instanceof DOMException ? e.name : e instanceof Error ? e.name : '';
    if (e instanceof DOMException && e.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
      throw e;
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      try {
        const v = await openPreferredCameraStream(false, PROCTOR_VIDEO);
        await attachDefaultMicrophone(v);
        return finalizePhysicalStream(v, 'proctor retry video');
      } catch {
        const fallback = await openCameraByTryingVideoInputs();
        return finalizePhysicalStream(fallback, 'proctor openCameraByTryingVideoInputs');
      }
    }
    throw e;
  }
}
