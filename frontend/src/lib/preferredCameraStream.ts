/**
 * Virtual kamera (DroidCam, OBS va h.k.) dan qochish: ruxsatdan keyin real qurilmani tanlash.
 * Ikkinchi getUserMedia (deviceId: exact) ba'zi Windows/Chrome konfiguratsiyalarida
 * NotReadableError beradi — birinchi muvaffaqiyatli oqimni yo'qotmaslik kerak.
 */
const VIRTUAL_CAMERA_LABEL_RE =
  /(droidcam|epoccam|iriun|ivcam|obs|virtual|manycam|splitcam)/i;

export async function openPreferredCameraStream(
  withAudio: boolean,
  video: true | MediaTrackConstraints
): Promise<MediaStream> {
  const initial = await navigator.mediaDevices.getUserMedia({
    video: video === true ? true : video,
    audio: withAudio,
  });

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

  const currentTrack = initial.getVideoTracks()[0];
  const currentId = currentTrack?.getSettings?.().deviceId;
  if (currentId && currentId === preferred.deviceId) return initial;

  const base: MediaTrackConstraints = video === true ? {} : { ...video };
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

const PROCTOR_VIDEO: MediaTrackConstraints = {
  width: { ideal: 320 },
  height: { ideal: 240 },
  frameRate: { ideal: 15 },
};

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
      const v = await openPreferredCameraStream(false, PROCTOR_VIDEO);
      await attachDefaultMicrophone(v);
      return v;
    }
    throw e;
  }
}
