"""Shared-room signals must not punish background people or room equipment."""
import json

# On-site staff, not automated person counting/matching, supervise the room.
PERSON_MONITORING_ENABLED = False
DISABLED_PERSON_SIGNALS = frozenset({'IDENTITY_SUBSTITUTION', 'MULTIPLE_FACES'})

CENTER_IGNORED = frozenset({
    # Imtihon kutubxonada o'tkaziladi: javonlardagi kitoblar, stoldagi
    # qog'ozlar va daftarlar kadrga tushib qoladi va qoidabuzarlik emas.
    'FORBIDDEN_OBJECT_BOOK',
    'SUSPICIOUS_AUDIO', 'WHISPER_OR_CONVERSATION_SUSPECTED',
    'MICROPHONE_MUTED', 'MOUTH_MOVEMENT_TALKING',
    'HAND_GESTURE_SUSPECTED', 'HAND_NEAR_EAR', 'FORBIDDEN_OBJECT_LAPTOP',
    'MULTIPLE_FACES', 'SIDE_CONVERSATION_SUSPECTED',
    'GAZE_AWAY_LEFT', 'GAZE_AWAY_RIGHT', 'GAZE_AWAY_UP', 'GAZE_AWAY_DOWN',
    'GAZE_DOWN_TOTAL', 'GAZE_SIDE_TOTAL', 'GAZE_ANSWER_PATTERN', 'FACE_TURNED_AWAY',
    'FACE_TOO_FAR', 'FACE_TOO_CLOSE', 'FACE_OFF_CENTER', 'EXCESSIVE_MOVEMENT',
})

def confirmed_observer(detail):
    try:
        evidence = json.loads(detail)
        duration = evidence.get('continuous_ms')
        return (evidence.get('policy') == 'center_observer_v1'
                and type(duration) in (int, float)
                and 6000 <= duration <= 120000)
    except (TypeError, ValueError, AttributeError):
        return False

def suppress_center_signal(kind, detail=''):
    # In a staffed room these ambiguous behaviours are assessed by the proctor.
    # Camera loss, verified devices and identity substitution remain protected.
    return kind in CENTER_IGNORED

def center_frame_payload(payload):
    # A single still frame cannot establish six seconds of continuous presence.
    return {**payload, 'violations': [v for v in payload.get('violations', [])
                                    if not suppress_center_signal(v)]}

# Test markazida xonada nazoratchi aylanib turadi: avtomatik ogohlantirish va
# chetlatish O'CHIRILGAN. Har bir hodisa baribir yozib boriladi (dalil sifatida
# admin panelida ko'rinadi), lekin topshiruvchiga xabar chiqmaydi va ball yoki
# imtihon holatiga ta'sir qilmaydi. Hukmni faqat nazoratchi chiqaradi.
PROCTOR_ONLY = True
