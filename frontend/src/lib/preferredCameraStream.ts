/**
 * Virtual kamera (DroidCam, OBS va h.k.) dan qochish: ruxsatdan keyin real qurilmani tanlash.
 * Ikkinchi getUserMedia (deviceId: exact) ba'zi Windows/Chrome konfiguratsiyalarida
 * NotReadableError beradi — birinchi muvaffaqiyatli oqimni yo'qotmaslik kerak.
 */
const VIRTUAL_CAMERA_LABEL_RE =
  /(droidcam|epoccam|iriun|ivcam|obs|virtual|manycam|splitcam)/i;

/**
 * `video: true` o'rniga yengil cheklovlar: to'liq HD birinchi ochilishi ba'zi USB/Windows
 * konfiguratsiyalarida NotReadableError ("Could not start video source") beradi.
 */
export const LIGHT_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 320, max: 1280 },
  height: { ideal: 240, max: 720 },
  frameRate: { ideal: 15, max: 30 },
};

export async function openPreferredCameraStream(
  withAudio: boolean,
  video: true | MediaTrackConstraints
): Promise<MediaStream> {
  const videoConstraint: MediaTrackConstraints | boolean =
    video === true ? LIGHT_VIDEO_CONSTRAINTS : video;
  const initial = await navigator.mediaDevices.getUserMedia({
    video: videoConstraint,
    audio: withAudio,
  });

  const currentTrack = initial.getVideoTracks()[0];
  const currentLabel = currentTrack?.label || '';
  // Virtual emas, yoritilgan nom bo'lsa — qayta deviceId ochish ko'pincha NotReadable beradi; saqlaymiz
  if (currentLabel && !VIRTUAL_CAMERA_LABEL_RE.test(currentLabel)) {
    return initial;
  }

  let devices: MediaDeviceInfo[];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return initial;
  }

  const preferred = devices.find(
    (d) => d.kind === 'videoinput' && !VIRTUAL_CAMERA_LABEL_RE.test(d.label || '')
  );
  if (!preferred?.deviceId) return initial;

  const currentId = currentTrack?.getSettings?.().deviceId;
  if (currentId && currentId === preferred.deviceId) return initial;

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
    return switched;
  } catch {
    return initial;
  }
}

/**
 * Mavjud video oqimiga default mikrofon izini qo'shadi.
 * Windows/Chrome da qattiq `audio: true` yiqilsa, qayta sinov — echoCancellation va h.k. o'chirilgan.
 */
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
 */
export async function openCameraByTryingVideoInputs(): Promise<MediaStream> {
  await sleep(420);
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoInputs = uniqueVideoInputs(devices);
  let lastErr: unknown;

  const tryConstraints = async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    const s = await navigator.mediaDevices.getUserMedia(constraints);
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

  for (const skipVirtual of [true, false]) {
    for (const d of videoInputs) {
      if (skipVirtual && VIRTUAL_CAMERA_LABEL_RE.test(d.label || '')) continue;
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
    return v;
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
  }

  try {
    const s = await openPreferredCameraStream(true, PROCTOR_VIDEO);
    await attachDefaultMicrophone(s);
    return s;
  } catch (e: unknown) {
    const name =
      e instanceof DOMException ? e.name : e instanceof Error ? e.name : '';
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      try {
        const v = await openPreferredCameraStream(false, PROCTOR_VIDEO);
        await attachDefaultMicrophone(v);
        return v;
      } catch {
        return openCameraByTryingVideoInputs();
      }
    }
    throw e;
  }
}
