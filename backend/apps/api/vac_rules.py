"""Nazorat qoidalari — TOPSHIRUVCHIGA ko'rsatiladigan rasmiy matn.

MUHIM PRINSIP: matn qo'lda yozilmaydi, JONLI SOZLAMALARDAN yaratiladi.
Agar chegara yoki ro'yxat o'zgarsa, topshiruvchi ko'radigan matn ham
o'sha zahoti o'zgaradi. Aks holda "qoidada boshqacha yozilgan edi"
degan e'tiroz haqli bo'lib qolardi — bu apellyatsiyada institutni
himoyasiz qoldiradi.

Matnning barmoq izi (`version`) rozilik bilan birga saqlanadi. Shunda
keyinchalik qoidalar o'zgarsa ham, topshiruvchi AYNAN nimaga rozi
bo'lgani aniqlanadi.
"""
from __future__ import annotations

import hashlib
import json
import os

from apps.api.proctor_config import max_warnings_before_ban
from apps.api.proctor_exam_retake import (
    exam_identity_retakes_allowed,
    exam_violation_retakes_allowed,
)
from apps.api.vac_settings import (
    vac_device_lock_enabled,
    vac_pc_only_enabled,
)

# --- sozlamalarni o'qish (student.py dagi bilan BIR XIL manbadan) --------


def _env_set(name: str, default: str) -> set[str]:
    raw = os.environ.get(name, default)
    return {x.strip().upper() for x in raw.split(",") if x.strip()}


def _instant_types() -> set[str]:
    strict = str(os.environ.get("VAC_STRICT_MODE", "1")).strip() not in (
        "0", "false", "False",
    )
    if not strict:
        return set()
    return _env_set(
        "PROCTOR_INSTANT_BAN_VIOLATIONS",
        "IDENTITY_SUBSTITUTION,FORBIDDEN_OBJECT_CELL_PHONE,"
        "FORBIDDEN_OBJECT_LAPTOP,FORBIDDEN_OBJECT_BOOK,"
        "REMOTE_CONTROL_SUSPECTED,VIRTUAL_WEBCAM_SUSPECTED",
    )


def _technical_types() -> set[str]:
    return _env_set(
        "PROCTOR_TECHNICAL_VIOLATIONS",
        "PROCTOR_FEED_LOST,CAMERA_MIC_ACCESS_FAILED",
    )


def _ignored_types() -> set[str]:
    return _env_set(
        "PROCTOR_IGNORED_VIOLATIONS",
        "GAZE_AWAY_DOWN,GAZE_AWAY_UP,FACE_TURNED_AWAY,FACE_OFF_CENTER,"
        "FACE_TOO_FAR,FACE_TOO_CLOSE,EXCESSIVE_MOVEMENT",
    )


def _no_retake_types() -> set[str]:
    from apps.api.proctor_exam_retake import DELIBERATE_CHEAT_VIOLATIONS

    raw = os.environ.get("PROCTOR_NO_RETAKE_VIOLATIONS")
    if raw is None:
        return set(DELIBERATE_CHEAT_VIOLATIONS)
    return {x.strip().upper() for x in raw.split(",") if x.strip()}


# --- turlarning inson tilidagi nomlari -----------------------------------

NAMES: dict[str, tuple[str, str, str]] = {
    "IDENTITY_SUBSTITUTION": (
        "kamerada boshqa odam ko'rinishi (shaxs almashtirish)",
        "в кадре другой человек (подмена личности)",
        "another person on camera (identity substitution)",
    ),
    "FORBIDDEN_OBJECT_CELL_PHONE": (
        "qo'lda yoki stolda telefon",
        "телефон в руке или на столе",
        "a phone in hand or on the desk",
    ),
    "FORBIDDEN_OBJECT_LAPTOP": (
        "ikkinchi kompyuter yoki planshet",
        "второй компьютер или планшет",
        "a second computer or tablet",
    ),
    "FORBIDDEN_OBJECT_BOOK": (
        "kitob, daftar yoki qog'oz",
        "книга, тетрадь или лист бумаги",
        "a book, notebook or sheet of paper",
    ),
    "REMOTE_CONTROL_SUSPECTED": (
        "masofaviy boshqaruv dasturi",
        "программа удалённого управления",
        "remote-control software",
    ),
    "VIRTUAL_WEBCAM_SUSPECTED": (
        "virtual (soxta) kamera",
        "виртуальная (поддельная) камера",
        "a virtual (fake) webcam",
    ),
    "MICROPHONE_MUTED": (
        "mikrofonni o'chirib qo'yish",
        "отключение микрофона",
        "muting the microphone",
    ),
    "WHISPER_OR_CONVERSATION_SUSPECTED": (
        "pichirlash yoki yoningizdagi odamning gapirishi",
        "шёпот или разговор рядом с вами",
        "whispering or someone talking next to you",
    ),
    "MOUTH_MOVEMENT_TALKING": (
        "sizning gapirishingiz",
        "ваша речь",
        "you speaking",
    ),
    "SUSPICIOUS_AUDIO": (
        "xonadagi baland shovqin",
        "громкий шум в помещении",
        "loud noise in the room",
    ),
    "MULTIPLE_FACES": (
        "kadrda bir nechta yuz",
        "несколько лиц в кадре",
        "multiple faces in frame",
    ),
    "GAZE_AWAY_LEFT": (
        "uzoq vaqt chapga qarash",
        "долгий взгляд влево",
        "looking to the left for a long time",
    ),
    "GAZE_AWAY_RIGHT": (
        "uzoq vaqt o'ngga qarash",
        "долгий взгляд вправо",
        "looking to the right for a long time",
    ),
    "TAB_SWITCH_HARD": (
        "boshqa oyna yoki ilovaga o'tish",
        "переход в другое окно или приложение",
        "switching to another window or app",
    ),
    "TAB_SWITCH_SOFT": (
        "imtihon oynasidan chiqish",
        "выход из окна экзамена",
        "leaving the exam window",
    ),
    "FULLSCREEN_EXIT_HARD": (
        "to'liq ekran rejimidan chiqish",
        "выход из полноэкранного режима",
        "exiting full-screen mode",
    ),
    "CLIPBOARD_ATTEMPT": (
        "nusxa olish / qo'yish",
        "копирование / вставка",
        "copy / paste",
    ),
    "PRINT_SCREEN": (
        "ekran rasmini olish",
        "снимок экрана",
        "taking a screenshot",
    ),
    "DEVTOOLS_OPEN": (
        "brauzer dasturchi vositalarini ochish",
        "открытие инструментов разработчика",
        "opening browser developer tools",
    ),
    "MULTI_MONITOR_DETECTED": (
        "ikkinchi monitor",
        "второй монитор",
        "a second monitor",
    ),
    "FACE_NOT_VISIBLE": (
        "yuzingiz kadrda ko'rinmasligi",
        "лицо не видно в кадре",
        "your face not visible in frame",
    ),
    "EXCESSIVE_MOVEMENT": (
        "o'rindiqda qimirlash, joylashib olish",
        "движения на стуле, попытки удобнее сесть",
        "moving or shifting in your seat",
    ),
    "FACE_OFF_CENTER": (
        "yuzning kadr markazidan siljishi",
        "смещение лица от центра кадра",
        "your face off the centre of the frame",
    ),
    "FACE_TOO_CLOSE": (
        "kameraga yaqin o'tirish",
        "слишком близко к камере",
        "sitting too close to the camera",
    ),
    "FACE_TOO_FAR": (
        "kameradan uzoq o'tirish",
        "слишком далеко от камеры",
        "sitting too far from the camera",
    ),
    "FACE_TURNED_AWAY": (
        "boshni bir zum burish",
        "кратковременный поворот головы",
        "briefly turning your head",
    ),
    "GAZE_AWAY_DOWN": (
        "pastga (ekranga yoki klaviaturaga) qarash",
        "взгляд вниз (на экран или клавиатуру)",
        "looking down (at the screen or keyboard)",
    ),
    "GAZE_AWAY_UP": (
        "tepaga qarash, o'ylanib turish",
        "взгляд вверх, задумчивость",
        "looking up while thinking",
    ),
    "PROCTOR_FEED_LOST": (
        "kamera tasviri uzilishi",
        "прерывание видеопотока",
        "camera feed interruption",
    ),
    "CAMERA_MIC_ACCESS_FAILED": (
        "kamera yoki mikrofon ishlamay qolishi",
        "отказ камеры или микрофона",
        "camera or microphone failure",
    ),
    "SCREEN_SHARE_STOPPED": (
        "ekranni ulashishni to'xtatish",
        "остановка демонстрации экрана",
        "stopping screen sharing",
    ),
    "DESKTOP_FORBIDDEN_APP": (
        "taqiqlangan dasturni ochish (messenjer, AI yordamchi, ekran yozish)",
        "запуск запрещённой программы (мессенджер, AI-помощник, запись экрана)",
        "opening a forbidden app (messenger, AI assistant, screen recorder)",
    ),
    "GAZE_DOWN_TOTAL": (
        "imtihon davomida jami uzoq vaqt pastga qarash (telefon, qog'oz)",
        "длительный суммарный взгляд вниз за экзамен (телефон, бумага)",
        "looking down for a long total time during the exam (phone, paper)",
    ),
    "BLUETOOTH_AUDIO_DEVICE": (
        "simsiz (Bluetooth) quloqchin, AirPods yoki naushnik ulash",
        "подключение беспроводных (Bluetooth) наушников, AirPods",
        "connecting wireless (Bluetooth) earphones or AirPods",
    ),
    "HAND_NEAR_EAR": (
        "qo'lni uzoq vaqt quloq yonida ushlab turish (telefon, quloqchin)",
        "длительно держать руку у уха (телефон, наушник)",
        "keeping a hand near the ear for a long time (phone, earpiece)",
    ),
    "GAZE_SIDE_TOTAL": (
        "imtihon davomida jami uzoq chetga (yonga) qarash (yonidagi kishi yoki qog'oz)",
        "длительный суммарный взгляд в сторону (сосед или бумага)",
        "looking to the side for a long total time (a person or paper beside you)",
    ),
}

_L = {"uz": 0, "ru": 1, "en": 2}


def _name(code: str, lang: str) -> str:
    row = NAMES.get(code)
    if not row:
        return code
    return row[_L.get(lang, 0)]


def _names(codes, lang: str) -> list[str]:
    return sorted(_name(c, lang) for c in codes)


# --- qoidalar matnini yig'ish --------------------------------------------

def build_vac_rules(exam, lang: str = "uz", user_id: str = "") -> dict:
    """Topshiruvchiga ko'rsatiladigan qoidalar + matnning barmoq izi."""
    lang = lang if lang in _L else "uz"
    i = _L[lang]

    instant = _instant_types()
    technical = _technical_types()
    ignored = _ignored_types()
    no_retake = _no_retake_types()
    max_warn = max_warnings_before_ban()
    # Qoidalar matni tizimning HAQIQIY xatti-harakatiga mos bo'lsin:
    # yumshatilgan toifada nazorat qanday bo'lsa, matn ham shunday.
    from apps.api.proctor_profile import relaxed_profile

    _rp = relaxed_profile(exam)
    if _rp:
        instant = {t for t in instant if t not in _rp["no_instant"]}
        ignored = set(ignored) | set(_rp["ignored"])
        max_warn = max(max_warn, _rp["max_warnings"])
    tech_retakes = exam_violation_retakes_allowed(exam)
    id_retakes = exam_identity_retakes_allowed(exam)
    duration = int(getattr(exam, "duration_minutes", 0) or 0)
    n_q = int(getattr(exam, "bank_question_count", 0) or 0)

    # Ogohlantirish beradigan (darhol to'xtatmaydigan, e'tiborsiz emas) turlar
    from apps.api.proctor_profile import audio_review_types

    # Ovoz gumoni yolg'iz o'zi ogohlantirish emas — "Nima kuzatiladi" bandida
    # alohida tushuntiriladi (qoidalar matni tizim xatti-harakatiga mos bo'lsin).
    _audio = audio_review_types()
    from apps.api.proctor_profile import screen_share_required

    # Ekranni ulashish faqat talab qilingan imtihonda matnga kiradi — boshqa
    # imtihonlarda qoidalar (va rozilik versiyasi) o'zgarmaydi.
    _screen = screen_share_required(exam, user_id)
    from apps.api.desktop_guard import desktop_required

    # FerMI Exam ilovasi talab qilinganda qoidalar matniga ilova bandlari qo'shiladi.
    _desktop = desktop_required()
    from apps.api.question_lock import (
        per_question_seconds,
        question_lock_enabled,
        room_scan_required,
        webcam_snapshots_enabled,
    )

    _qlock_on = question_lock_enabled(exam)
    _qsec = per_question_seconds(exam, n_q)
    _room = room_scan_required()
    _webcam = webcam_snapshots_enabled()
    warn_like = [
        c for c in NAMES
        if c not in instant and c not in technical and c not in ignored and c not in _audio
        and (c != "SCREEN_SHARE_STOPPED" or _screen)
        and (c != "DESKTOP_FORBIDDEN_APP" or _desktop)
    ]

    T = {
        "title": (
            "Imtihon nazorati qoidalari",
            "Правила контроля экзамена",
            "Exam proctoring rules",
        )[i],
        "intro": (
            "Imtihon avtomatik nazorat ostida o'tadi. Quyidagilarni diqqat "
            "bilan o'qing — imtihonni boshlash uchun roziligingiz talab "
            "etiladi. Rozilik bergan payt va matn tizimda saqlanadi.",
            "Экзамен проходит под автоматическим контролем. Внимательно "
            "прочитайте правила — для начала экзамена требуется ваше "
            "согласие. Время согласия и текст сохраняются в системе.",
            "The exam is automatically proctored. Read this carefully — your "
            "consent is required to start. The time of consent and the text "
            "are stored in the system.",
        )[i],
        "watched_title": (
            "1. Nima kuzatiladi",
            "1. Что контролируется",
            "1. What is monitored",
        )[i],
        "instant_title": (
            "2. Imtihon DARHOL to'xtatiladigan holatlar",
            "2. Случаи НЕМЕДЛЕННОГО прекращения экзамена",
            "2. Cases that IMMEDIATELY end the exam",
        )[i],
        "instant_note": (
            "Bu holatlarda ogohlantirish berilmaydi va qayta topshirish "
            "imkoniyati BERILMAYDI.",
            "В этих случаях предупреждение не выдаётся и повторная попытка "
            "НЕ предоставляется.",
            "In these cases no warning is given and no retake is granted.",
        )[i],
        "warn_title": (
            "3. Ogohlantirish beriladigan holatlar",
            "3. Случаи с предупреждением",
            "3. Cases that produce a warning",
        )[i],
        "warn_note": (
            "Avval ekranda ogohlantirish chiqadi — o'zingizni to'g'rilashga "
            "vaqt beriladi. Rasmiy ogohlantirish faqat holat DAVOM ETSA "
            "yoziladi. %d ta rasmiy ogohlantirish beriladi, %d-marta "
            "takrorlansa imtihon to'xtatiladi." % (max(1, max_warn - 1), max_warn),
            "Сначала на экране появится предупреждение — вам даётся время "
            "исправиться. Официальное предупреждение фиксируется, только "
            "если ситуация ПРОДОЛЖАЕТСЯ. Даётся %d официальных предупреждения, "
            "при %d-м нарушении экзамен прекращается." % (max(1, max_warn - 1), max_warn),
            "First an on-screen notice appears, giving you time to correct. "
            "A formal warning is recorded only if the situation CONTINUES. "
            "%d formal warnings are given; on violation number %d the exam "
            "is stopped." % (max(1, max_warn - 1), max_warn),
        )[i],
        "free_title": (
            "4. Jazolanmaydigan holatlar",
            "4. Что НЕ наказывается",
            "4. What is NOT penalised",
        )[i],
        "free_note": (
            "Bular texnik nosozlik yoki kamera burchagi sabab yuzaga "
            "keladigan tabiiy holatlar. Ular qayd etiladi, lekin "
            "ogohlantirish ham, jazo ham bermaydi. Imtihon davomida "
            "qimirlash, o'rindiqda joylashib olish, ekranga qarash — "
            "bularning hammasi tabiiy va jazolanmaydi.",
            "Это технические сбои или естественные ситуации из-за угла "
            "камеры. Они фиксируются, но не дают ни предупреждения, ни "
            "наказания. Двигаться, поправляться на стуле, смотреть на экран "
            "— это естественно и не наказывается.",
            "These are technical faults or natural situations caused by the "
            "camera angle. They are logged but produce neither a warning nor "
            "a penalty. Moving, adjusting your seat, looking at the screen — "
            "all natural and not penalised.",
        )[i],
        "retake_title": (
            "5. Qayta topshirish: qachon beriladi, qachon berilmaydi",
            "5. Повторная попытка: когда даётся, когда нет",
            "5. Retakes: when granted and when not",
        )[i],
        "data_title": (
            "6. Sizning ma'lumotlaringiz",
            "6. Ваши данные",
            "6. Your data",
        )[i],
        "appeal_title": (
            "7. Norozilik bildirish (apellyatsiya)",
            "7. Апелляция",
            "7. Appeals",
        )[i],
        "consent_label": (
            "Yuqoridagi qoidalarni to'liq o'qidim, tushundim va roziman.",
            "Я полностью прочитал(а) правила выше, понял(а) и согласен(на).",
            "I have read, understood and accept the rules above.",
        )[i],
    }

    watched = [
        (
            "Kamera: yuzingiz imtihon davomida ko'rinib turishi kerak.",
            "Камера: ваше лицо должно быть видно на протяжении экзамена.",
            "Camera: your face must remain visible throughout the exam.",
        )[i],
        (
            "Mikrofon: xonadagi ovoz tahlil qilinadi. Ovoz YOZIB OLINMAYDI "
            "— faqat gapirish bor-yo'qligi aniqlanadi. Gaplashish yoki "
            "pichirlash aniqlansa, ekranda ogohlantirish chiqadi va holat "
            "admin ko'rib chiqishi uchun qayd etiladi; faqat ovoz signaliga "
            "ko'ra imtihon to'xtatilmaydi. Ovoz kamerada ko'rinadigan holat "
            "(ikkinchi odam, chetga qarash, telefon) bilan birga bo'lsa — "
            "rasmiy ogohlantirish beriladi.",
            "Микрофон: звук в помещении анализируется. Звук НЕ записывается "
            "— определяется только наличие речи. При обнаружении разговора "
            "или шёпота на экране появится предупреждение, случай фиксируется "
            "для рассмотрения администратором; только по звуку экзамен не "
            "прекращается. Если звук сопровождается видимым нарушением "
            "(второй человек, взгляд в сторону, телефон) — выносится "
            "официальное предупреждение.",
            "Microphone: room audio is analysed. Audio is NOT recorded — only "
            "the presence of speech is detected. If talking or whispering is "
            "detected, an on-screen notice appears and the case is logged for "
            "administrator review; the exam is not stopped on audio alone. If "
            "audio coincides with a visible violation (second person, looking "
            "away, phone), a formal warning is issued.",
        )[i],
        (
            "Ekran: imtihon to'liq ekran rejimida o'tadi, boshqa oynaga "
            "o'tish qayd etiladi.",
            "Экран: экзамен идёт в полноэкранном режиме, переход в другое "
            "окно фиксируется.",
            "Screen: the exam runs full-screen; switching windows is logged.",
        )[i],
        (
            "Brauzer: sahifaga qo'shilgan kengaytmalar va begona dasturlar (AI "
            "yordamchilar va h.k.) aniqlanadi va admin ko'rib chiqishi uchun qayd "
            "etiladi. Imtihondan oldin barcha kengaytmalarni o'chiring. Har bir "
            "savolga sarflangan vaqt ham qayd etiladi.",
            "Браузер: расширения и посторонние программы (AI-помощники и т.п.), "
            "встроенные в страницу, обнаруживаются и фиксируются для рассмотрения "
            "администратором. Перед экзаменом отключите все расширения. Время на "
            "каждый вопрос также фиксируется.",
            "Browser: extensions and foreign tools (AI assistants etc.) injected into "
            "the page are detected and logged for administrator review. Disable all "
            "extensions before the exam. Time spent on each question is also logged.",
        )[i],
    ]
    if vac_device_lock_enabled():
        watched.append((
            "Imtihon boshlangan QURILMAGA bog'lanadi — boshqa qurilmadan "
            "davom ettirib bo'lmaydi.",
            "Экзамен привязывается к УСТРОЙСТВУ — продолжить с другого "
            "устройства нельзя.",
            "The exam is bound to the DEVICE — it cannot be continued from "
            "another device.",
        )[i])
    if vac_pc_only_enabled():
        watched.append((
            "Imtihon faqat kompyuterda topshiriladi (telefon/planshet emas).",
            "Экзамен сдаётся только на компьютере (не телефон/планшет).",
            "The exam may be taken only on a computer (not phone/tablet).",
        )[i])

    if _qlock_on:
        watched.append((
            "Savollar: har bir savolga %d soniya beriladi. «Keyingi» bosilganda yoki vaqt "
            "tugaganda javob qulflanadi — oldingi savolga qaytib bo'lmaydi." % _qsec,
            "Вопросы: на каждый вопрос даётся %d секунд. После нажатия «Далее» или окончания "
            "времени ответ фиксируется — вернуться к предыдущему вопросу нельзя." % _qsec,
            "Questions: each question has %d seconds. When you press \"Next\" or the time runs "
            "out, the answer is locked — you cannot go back to a previous question." % _qsec,
        )[i])
    if _room:
        watched.append((
            "Xona: imtihon oldidan kamerani sekin aylantirib xonani, stolni va stol ostini "
            "20 soniya ko'rsatasiz; kadrlar saqlanadi.",
            "Помещение: перед экзаменом вы 20 секунд медленно показываете камерой комнату, "
            "стол и пространство под столом; кадры сохраняются.",
            "Room: before the exam you slowly show the room, the desk and under the desk to "
            "the camera for 20 seconds; the frames are stored.",
        )[i])
    if _webcam:
        watched.append((
            "Kamera kadrlari: imtihon davomida har 30 soniyada kamera kadri saqlanadi — "
            "komissiya butun imtihonni ko'rib chiqishi mumkin.",
            "Кадры камеры: во время экзамена каждые 30 секунд сохраняется кадр — комиссия "
            "может просмотреть весь экзамен.",
            "Camera frames: a camera frame is saved every 30 seconds during the exam — the "
            "commission may review the whole exam.",
        )[i])

    if _desktop:
        watched.append((
            "Ilova: imtihon faqat FerMI Exam Platform ilovasida topshiriladi. Imtihon davomida "
            "ilova butun ekranni egallaydi va yopilmaydi. Kompyuterda ochiq dasturlar (masofaviy "
            "boshqaruv, messenjer, AI yordamchi, ekran yozish) va monitorlar soni tekshiriladi, "
            "ekran rasmi vaqti-vaqti bilan saqlanadi.",
            "Приложение: экзамен сдаётся только в приложении FerMI Exam Platform. Во время "
            "экзамена приложение занимает весь экран и не закрывается. Проверяются открытые "
            "программы (удалённое управление, мессенджеры, AI-помощники, запись экрана) и "
            "число мониторов, периодически сохраняется снимок экрана.",
            "App: the exam is taken only in the FerMI Exam Platform app. During the exam the app "
            "fills the screen and cannot be closed. Running apps (remote control, messengers, AI "
            "assistants, screen recorders) and the number of monitors are checked, and a "
            "screenshot is saved periodically.",
        )[i])

    if _screen:
        watched.append((
            "Ekran: imtihon oldidan BUTUN ekraningizni ulashasiz. Imtihon davomida "
            "ekran rasmi vaqti-vaqti bilan saqlanadi. Ulashishni to'xtatsangiz, savollar "
            "yopiladi va ogohlantirish yoziladi; qayta ulashsangiz imtihon davom etadi.",
            "Экран: перед экзаменом вы открываете доступ ко ВСЕМУ экрану. Во время "
            "экзамена периодически сохраняется снимок экрана. Если остановить "
            "демонстрацию, вопросы скрываются и фиксируется предупреждение; после "
            "повторного доступа экзамен продолжается.",
            "Screen: before the exam you share your ENTIRE screen. A screenshot is saved "
            "periodically during the exam. If you stop sharing, the questions are hidden "
            "and a warning is recorded; sharing again resumes the exam.",
        )[i])

    retake_rules = [
        (
            "Texnik sabab (kamera yoki internet uzilishi, mikrofon "
            "nosozligi) — imtihon qayta ochiladi. Jami %d marta." % tech_retakes,
            "Техническая причина (обрыв камеры или интернета, отказ "
            "микрофона) — экзамен открывается заново. Всего %d раза." % tech_retakes,
            "Technical cause (camera or internet loss, microphone failure) — "
            "the exam is reopened. Up to %d times." % tech_retakes,
        )[i],
        (
            "Ogohlantirish chegarasiga yetish — agar sabab ataylab qilingan "
            "chiterlik BO'LMASA, yuqoridagi %d imkoniyat hisobidan qayta "
            "ochiladi. DIQQAT: bunda yozgan javoblaringiz O'CHADI va "
            "savollar yangidan tuziladi." % tech_retakes,
            "Достижение порога предупреждений — если причина НЕ является "
            "умышленным списыванием, экзамен открывается заново за счёт тех "
            "же %d попыток. ВНИМАНИЕ: ваши ответы БУДУТ УДАЛЕНЫ, вопросы "
            "формируются заново." % tech_retakes,
            "Reaching the warning limit — if the cause is NOT deliberate "
            "cheating, the exam is reopened using those %d attempts. NOTE: "
            "your answers are DELETED and questions are regenerated." % tech_retakes,
        )[i],
        (
            "Ataylab chiterlik (2-bo'limdagi holatlar) — qayta topshirish "
            "BERILMAYDI.",
            "Умышленное списывание (случаи из раздела 2) — повторная попытка "
            "НЕ предоставляется.",
            "Deliberate cheating (section 2) — no retake is granted.",
        )[i],
        (
            "Imkoniyatlar tugagach — imtihon yopiladi. Yangi imkoniyat "
            "faqat ADMIN RUXSATI bilan ochiladi.",
            "После исчерпания попыток экзамен закрывается. Новая попытка "
            "открывается только С РАЗРЕШЕНИЯ АДМИНИСТРАТОРА.",
            "Once attempts are exhausted the exam is closed. A new attempt is "
            "opened only WITH ADMINISTRATOR APPROVAL.",
        )[i],
    ]
    if id_retakes:
        retake_rules.insert(2, (
            "Shaxsni tasdiqlash xatosi (yorug'lik yomon, kamera sifatsiz) — "
            "%d marta qayta urinish beriladi." % id_retakes,
            "Ошибка подтверждения личности (плохой свет, слабая камера) — "
            "%d повторная попытка." % id_retakes,
            "Identity verification error (poor light, weak camera) — %d "
            "retry is granted." % id_retakes,
        )[i])
    if tech_retakes == 0 and id_retakes == 0:
        # Bir martalik imtihon (1-kurs grant attestatsiyasi): matn tizimning
        # haqiqiy xatti-harakatiga mos — avtomatik qayta urinish umuman yo'q.
        retake_rules = [r[i] for r in (
            (
                "Bu imtihon BIR MARTALIK: faqat bitta urinish beriladi, qayta "
                "topshirish BERILMAYDI.",
                "Этот экзамен ОДНОРАЗОВЫЙ: даётся только одна попытка, "
                "пересдача НЕ предоставляется.",
                "This exam is ONE-TIME: only one attempt is given, no retake is "
                "granted.",
            ),
            (
                "Texnik uzilishda (internet, kamera, elektr) javoblaringiz "
                "saqlanadi: o'sha kompyuterdan qayta kirib, qolgan vaqt ichida "
                "davom ettirasiz. Taymer to'xtamaydi.",
                "При техническом сбое (интернет, камера, электричество) ответы "
                "сохраняются: войдите снова с того же компьютера и продолжите в "
                "оставшееся время. Таймер не останавливается.",
                "On a technical interruption (internet, camera, power) your "
                "answers are saved: sign in again from the same computer and "
                "continue within the remaining time. The timer does not stop.",
            ),
            (
                "Ogohlantirish chegarasiga yetilsa yoki 2-bo'limdagi holat "
                "aniqlansa — imtihon to'xtatiladi, yangi urinish berilmaydi.",
                "При достижении порога предупреждений или случае из раздела 2 "
                "экзамен прекращается, новая попытка не даётся.",
                "If the warning limit is reached or a section 2 case is "
                "detected, the exam is stopped and no new attempt is given.",
            ),
            (
                "Istisno faqat ADMINISTRATOR qarori bilan — asosli yozma "
                "murojaat (apellyatsiya) ko'rib chiqilgandan so'ng.",
                "Исключение — только по решению АДМИНИСТРАТОРА после "
                "рассмотрения обоснованного письменного обращения (апелляции).",
                "Exceptions only by ADMINISTRATOR decision after a justified "
                "written appeal is reviewed.",
            ),
        )]

    data_rules = [
        (
            "Imtihon davomida kamera kadrlari va qoidabuzarlik yozuvlari "
            "saqlanadi. Ular faqat imtihon halolligini tekshirish va "
            "apellyatsiyani ko'rib chiqish uchun ishlatiladi.",
            "Во время экзамена сохраняются кадры с камеры и записи нарушений. "
            "Они используются только для проверки честности экзамена и "
            "рассмотрения апелляции.",
            "Camera frames and violation records are stored during the exam. "
            "They are used only to verify exam integrity and to review "
            "appeals.",
        )[i],
        (
            "Ovoz yozib olinmaydi — mikrofondan faqat gapirish bor-yo'qligi "
            "aniqlanadi.",
            "Звук не записывается — с микрофона определяется только наличие "
            "речи.",
            "Audio is not recorded — only the presence of speech is detected.",
        )[i],
        (
            "Bu qoidalarga rozilik berganingiz, vaqti va qurilmangiz "
            "saqlanadi.",
            "Факт согласия с этими правилами, его время и ваше устройство "
            "сохраняются.",
            "Your acceptance of these rules, its time and your device are "
            "stored.",
        )[i],
    ]

    if _room or _webcam:
        data_rules.insert(1, (
            "Xona ko'rinishi va imtihon davomidagi kamera kadrlari faqat imtihon halolligini "
            "tekshirish va apellyatsiya uchun saqlanadi.",
            "Вид помещения и кадры камеры во время экзамена хранятся только для проверки "
            "честности экзамена и рассмотрения апелляции.",
            "The room view and camera frames taken during the exam are stored only to verify "
            "exam integrity and review appeals.",
        )[i])

    if _desktop:
        data_rules.insert(1, (
            "Ilova imtihon davomida ekran rasmlarini va kompyuterda ochiq taqiqlangan dasturlar "
            "nomini saqlaydi. Kompyuteringizdagi boshqa fayllar o'qilmaydi va yuborilmaydi.",
            "Во время экзамена приложение сохраняет снимки экрана и названия открытых "
            "запрещённых программ. Другие файлы на компьютере не читаются и не передаются.",
            "During the exam the app stores screenshots and the names of running forbidden "
            "apps. Other files on your computer are neither read nor sent.",
        )[i])

    if _screen:
        data_rules.insert(1, (
            "Imtihon davomida ekran rasmlari saqlanadi va faqat imtihon halolligini "
            "tekshirish hamda apellyatsiya uchun ishlatiladi. Imtihondan oldin ekranda "
            "shaxsiy ma'lumotlar ochiq qolmasin.",
            "Во время экзамена сохраняются снимки экрана; они используются только для "
            "проверки честности экзамена и рассмотрения апелляции. Перед экзаменом "
            "закройте на экране личные данные.",
            "Screenshots are stored during the exam and used only to verify exam "
            "integrity and review appeals. Close any personal information on your "
            "screen before the exam.",
        )[i])

    appeal_rules = [
        (
            "Imtihon to'xtatilsa, sababi ekranda ko'rsatiladi va tizimda "
            "qayd etiladi.",
            "Если экзамен прекращён, причина показывается на экране и "
            "фиксируется в системе.",
            "If the exam is stopped, the reason is shown on screen and "
            "recorded in the system.",
        )[i],
        (
            "Qaror bilan rozi bo'lmasangiz, tizim orqali apellyatsiya "
            "yuborishingiz mumkin. Uni komissiya ko'rib chiqadi.",
            "Если вы не согласны с решением, вы можете подать апелляцию через "
            "систему. Её рассматривает комиссия.",
            "If you disagree with the decision you may submit an appeal "
            "through the system. It is reviewed by a commission.",
        )[i],
        (
            "Ko'rib chiqishda kamera kadrlari va qoidabuzarlik yozuvlari "
            "dalil sifatida ishlatiladi.",
            "При рассмотрении кадры с камеры и записи нарушений используются "
            "как доказательства.",
            "Camera frames and violation records are used as evidence in the "
            "review.",
        )[i],
    ]

    doc = {
        "title": T["title"],
        "intro": T["intro"],
        "exam": {
            "questions": n_q,
            "duration_minutes": duration,
            "max_warnings": max_warn,
        },
        "sections": [
            {"title": T["watched_title"], "items": watched},
            {
                "title": T["instant_title"],
                "note": T["instant_note"],
                "items": _names(instant, lang),
            },
            {
                "title": T["warn_title"],
                "note": T["warn_note"],
                "items": _names(warn_like, lang),
            },
            {
                "title": T["free_title"],
                "note": T["free_note"],
                "items": _names(technical | ignored, lang),
            },
            {"title": T["retake_title"], "items": retake_rules},
            {"title": T["data_title"], "items": data_rules},
            {"title": T["appeal_title"], "items": appeal_rules},
        ],
        "consent_label": T["consent_label"],
    }

    # Barmoq izi — matnning O'ZIDAN. Qoidalar o'zgarsa versiya ham
    # o'zgaradi va eski rozilik yangi qoidalarga tegishli emasligi
    # ko'rinib turadi.
    canon = json.dumps(doc, ensure_ascii=False, sort_keys=True)
    doc["version"] = "%s:%s" % (
        lang, hashlib.sha256(canon.encode("utf-8")).hexdigest()[:16],
    )
    doc["no_retake_count"] = len(no_retake)
    doc["screen_share"] = bool(_screen)
    doc["desktop_app"] = bool(_desktop)
    doc["room_scan"] = bool(_room)
    doc["question_lock"] = bool(_qlock_on)
    return doc
