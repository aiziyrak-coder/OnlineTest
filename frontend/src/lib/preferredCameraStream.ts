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

const PROCTOR_VIDEO: MediaTrackConstraints = {
  width: { ideal: 320 },
  height: { ideal: 240 },
  frameRate: { ideal: 15 },
};

/**
 * Imtihon xonasi: bir vaqtda video+audio ba'zi Windows/Chrome da NotReadableError;
 * alohida olish (PreExamCheck bilan bir xil strategiya).
 */
export async function openPreferredProctorStream(): Promise<MediaStream> {
  try {
    return await openPreferredCameraStream(true, PROCTOR_VIDEO);
  } catch (e: unknown) {
    const name =
      e instanceof DOMException ? e.name : e instanceof Error ? e.name : '';
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      const v = await openPreferredCameraStream(false, PROCTOR_VIDEO);
      const a = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      a.getAudioTracks().forEach((tr) => v.addTrack(tr));
      return v;
    }
    throw e;
  }
}
