"""Qoidabuzarlik turlari — talaba ko'rinishidagi sabab matnlari (uz/ru/en)."""
from __future__ import annotations


def _tri(uz: str, ru: str, en: str) -> dict[str, str]:
    return {"uz": uz, "ru": ru, "en": en}


VIOLATION_REASONS: dict[str, dict[str, str]] = {
    "SIDE_CONVERSATION_SUSPECTED": _tri(
        "Yon tomonga qarab davomli gapirish belgilari aniqlandi. Suhbatlashmang va boshqalarga yordam bermang.",
        "Обнаружены признаки продолжительного разговора в сторону. Не разговаривайте и не помогайте другим.",
        "Sustained sideways talking was detected. Do not converse with or assist others.",
    ),
    "SUSPICIOUS_AUDIO": _tri(
        "Shovqin aniqlandi! Jimlik saqlang, gapirmang.",
        "Обнаружен шум! Соблюдайте тишину, не разговаривайте.",
        "Noise detected! Stay silent and do not speak.",
    ),
    "FACE_NOT_VISIBLE": _tri(
        "Yuzingiz kamerada ko'rinmayapti! To'g'ri o'tiring va kameraga qarang.",
        "Лицо не видно в камере! Сядьте ровно и смотрите в камеру.",
        "Your face is not visible! Sit properly and face the camera.",
    ),
    "MULTIPLE_FACES": _tri(
        "Kadrda bir nechta shaxs aniqlandi! Boshqalar kameradan uzoqlashsin.",
        "В кадре несколько человек! Другие должны отойти от камеры.",
        "Multiple people detected! Others must leave the camera frame.",
    ),
    "FORBIDDEN_OBJECT_CELL_PHONE": _tri(
        "Telefon aniqlandi! Imtihon davomida telefon ishlatmang.",
        "Обнаружен телефон! Не используйте телефон во время экзамена.",
        "Phone detected! Do not use a phone during the exam.",
    ),
    "FORBIDDEN_OBJECT_LAPTOP": _tri(
        "Noutbuk aniqlandi! Ruxsatsiz qurilmani olib qo'ying.",
        "Обнаружен ноутбук! Уберите неразрешённое устройство.",
        "Laptop detected! Remove the unauthorized device.",
    ),
    "FORBIDDEN_OBJECT_BOOK": _tri(
        "Kitob aniqlandi! Ruxsatsiz materiallarni olib qo'ying.",
        "Обнаружена книга! Уберите неразрешённые материалы.",
        "Book detected! Remove unauthorized materials.",
    ),
    "TAB_SWITCH_SOFT": _tri(
        "Boshqa oynaga o'tildi! Imtihon oynasini yopmang.",
        "Переход в другое окно! Не закрывайте окно экзамена.",
        "Switched to another window! Do not leave the exam window.",
    ),
    "TAB_SWITCH_HARD": _tri(
        "Imtihon oynasidan chiqib ketildi! Qaytib keling.",
        "Вы покинули окно экзамена! Вернитесь.",
        "You left the exam window! Come back.",
    ),
    "CLIPBOARD_ATTEMPT": _tri(
        "Nusxa ko'chirish urinishi aniqlandi!",
        "Обнаружена попытка копирования!",
        "Copy/clipboard attempt detected!",
    ),
    "PRINT_SCREEN": _tri(
        "Ekran surati olish urinishi aniqlandi!",
        "Обнаружена попытка снимка экрана!",
        "Screenshot attempt detected!",
    ),
    "DEVTOOLS_OPEN": _tri(
        "Developer tools ochish urinishi aniqlandi!",
        "Обнаружена попытка открыть инструменты разработчика!",
        "Developer tools open attempt detected!",
    ),
    "FULLSCREEN_EXIT_HARD": _tri(
        "To'liq ekrandan chiqildi! Qaytib kirish uchun ekranga bosing.",
        "Выход из полноэкранного режима! Нажмите на экран, чтобы вернуться.",
        "Left fullscreen! Click the screen to re-enter.",
    ),
    "REMOTE_CONTROL_SUSPECTED": _tri(
        "Masofaviy boshqaruv aniqlandi!",
        "Обнаружено удалённое управление!",
        "Remote control detected!",
    ),
    "MULTI_MONITOR_DETECTED": _tri(
        "Bir nechta monitor aniqlandi! Faqat bitta displey qoldiring.",
        "Обнаружено несколько мониторов! Оставьте только один дисплей.",
        "Multiple monitors detected! Use only a single display.",
    ),
    "IDENTITY_SUBSTITUTION": _tri(
        "Boshqa shaxs aniqlandi! Imtihon xavfsizligi buzildi.",
        "Обнаружен другой человек! Нарушена безопасность экзамена.",
        "Another person detected! Exam security was breached.",
    ),
    "GAZE_AWAY_LEFT": _tri(
        "To'g'ri qarang! Chapga emas, ekranga qarang.",
        "Смотрите прямо! Не влево, а на экран.",
        "Look straight! At the screen, not to the left.",
    ),
    "GAZE_AWAY_RIGHT": _tri(
        "To'g'ri qarang! O'ngga emas, ekranga qarang.",
        "Смотрите прямо! Не вправо, а на экран.",
        "Look straight! At the screen, not to the right.",
    ),
    "GAZE_AWAY_UP": _tri(
        "To'g'ri qarang! Tepaga emas, ekranga qarang.",
        "Смотрите прямо! Не вверх, а на экран.",
        "Look straight! At the screen, not upward.",
    ),
    "GAZE_AWAY_DOWN": _tri(
        "To'g'ri qarang! Pastga emas, ekranga qarang.",
        "Смотрите прямо! Не вниз, а на экран.",
        "Look straight! At the screen, not downward.",
    ),
    "WHISPER_OR_CONVERSATION_SUSPECTED": _tri(
        "Gapirish aniqlandi! O'zingiz yoki atrofingizda ovoz chiqmasin, jimlik saqlang.",
        "Обнаружена речь! Не разговаривайте сами и не допускайте разговоров вокруг.",
        "Speech detected! Do not talk and keep the area quiet.",
    ),
    "MICROPHONE_MUTED": _tri(
        "Mikrofon o'chirilgan! Imtihon oldida u ishlayotgani tekshirilgan edi — "
        "tovushni qaytaring.",
        "Микрофон отключён! Перед экзаменом он работал — включите звук.",
        "Microphone was muted! It was verified before the exam — turn it back on.",
    ),
    "CAMERA_MIC_ACCESS_FAILED": _tri(
        "Kamera yoki mikrofon ishlamayapti! Ruxsat bering.",
        "Камера или микрофон не работают! Разрешите доступ.",
        "Camera or microphone is not working! Allow access.",
    ),
    "VIRTUAL_WEBCAM_SUSPECTED": _tri(
        "Virtual kamera aniqlandi! Haqiqiy kamerani ishlating.",
        "Обнаружена виртуальная камера! Используйте настоящую камеру.",
        "Virtual camera detected! Use a physical webcam.",
    ),
    "FACE_TURNED_AWAY": _tri(
        "To'g'ri qarang! Yuzingizni kameradan burmang.",
        "Смотрите прямо! Не отворачивайтесь от камеры.",
        "Look straight! Do not turn your face away from the camera.",
    ),
    "EXCESSIVE_MOVEMENT": _tri(
        "Haddan tashqari qimirlash aniqlandi! Tinchoq o'tiring.",
        "Обнаружены чрезмерные движения! Сидите спокойнее.",
        "Excessive movement detected! Sit still.",
    ),
    "HAND_GESTURE_SUSPECTED": _tri(
        "Qo'l ko'tarish aniqlandi! Qo'llaringizni stolda ushlab turing.",
        "Обнаружено поднятие руки! Держите руки на столе.",
        "Hand raise detected! Keep your hands on the desk.",
    ),
    "MOUTH_MOVEMENT_TALKING": _tri(
        "Gapirish aniqlandi! Ovoz chiqarmang.",
        "Обнаружена речь! Не разговаривайте.",
        "Talking detected! Do not speak.",
    ),
    "FACE_TOO_FAR": _tri(
        "Kameradan juda uzoqsiz! Yaqinroq o'tiring.",
        "Вы слишком далеко от камеры! Придвиньтесь ближе.",
        "You are too far from the camera! Move closer.",
    ),
    "FACE_TOO_CLOSE": _tri(
        "Kameraga juda yaqinsiz! Biroz uzoqroq o'tiring.",
        "Вы слишком близко к камере! Отодвиньтесь немного.",
        "You are too close to the camera! Move back a little.",
    ),
    "FACE_OFF_CENTER": _tri(
        "Yuzingiz kadr markazida emas! O'rtaga to'g'ri o'tiring.",
        "Лицо не в центре кадра! Сядьте по центру.",
        "Your face is off-center! Sit in the middle of the frame.",
    ),
    "PROCTOR_FEED_LOST": _tri(
        "Kamera oqimi to'xtab qoldi! Kamera ulanishini tekshiring.",
        "Поток камеры прерван! Проверьте подключение камеры.",
        "Camera feed lost! Check your camera connection.",
    ),
    "SCREEN_SHARE_STOPPED": _tri(
        "Ekranni ulashish to'xtatildi! Butun ekranni qayta ulashing.",
        "Демонстрация экрана остановлена! Снова откройте доступ ко всему экрану.",
        "Screen sharing stopped! Share your entire screen again.",
    ),
    "DESKTOP_FORBIDDEN_APP": _tri(
        "Taqiqlangan dastur ochildi (messenjer, AI yordamchi yoki ekran yozish)! Uni darhol yoping.",
        "Открыта запрещённая программа (мессенджер, AI-помощник или запись экрана)! Немедленно закройте её.",
        "A forbidden app is open (messenger, AI assistant or screen recorder)! Close it now.",
    ),
    "GAZE_DOWN_TOTAL": _tri(
        "Imtihon davomida juda ko'p pastga qaradingiz (telefon yoki qog'oz)! Faqat ekranga qarang.",
        "Вы слишком долго смотрите вниз (телефон или бумага)! Смотрите только на экран.",
        "You have been looking down too much (phone or paper)! Look only at the screen.",
    ),
    "BLUETOOTH_AUDIO_DEVICE": _tri(
        "Simsiz (Bluetooth) quloqchin ulangan! Uni darhol uzing — imtihonda taqiqlangan.",
        "Подключены беспроводные (Bluetooth) наушники! Немедленно отключите — на экзамене запрещено.",
        "Wireless (Bluetooth) earphones are connected! Disconnect them now — they are forbidden.",
    ),
    "HAND_NEAR_EAR": _tri(
        "Qo'lingiz uzoq vaqt quloq yonida (telefon yoki quloqchin)! Qo'llaringizni stolga qo'ying.",
        "Рука долго у уха (телефон или наушник)! Положите руки на стол.",
        "Your hand stayed near your ear (phone or earpiece)! Put your hands on the desk.",
    ),
    "GAZE_SIDE_TOTAL": _tri(
        "Imtihon davomida juda ko'p chetga (yonga) qaradingiz! Faqat ekranga qarang.",
        "Вы слишком часто смотрели в сторону! Смотрите только на экран.",
        "You looked to the side too much during the exam! Look only at the screen.",
    ),
    "GAZE_ANSWER_PATTERN": _tri(
        "Javobni belgilashdan oldin muntazam chetga qarayapsiz! Faqat ekranga qarang — tashqi yordam gumoni qayd etildi.",
        "Вы регулярно смотрите в сторону перед выбором ответа! Смотрите только на экран — зафиксировано подозрение на подсказку.",
        "You keep looking aside before choosing answers! Look only at the screen — suspected outside help has been logged.",
    ),
}

# Eski importlar uchun
VIOLATION_REASON_UZ = {k: v["uz"] for k, v in VIOLATION_REASONS.items()}


def _norm_lang(lang: str | None) -> str:
    l = (lang or "uz").strip().lower()
    if l.startswith("ru"):
        return "ru"
    if l.startswith("en"):
        return "en"
    return "uz"


def violation_reason_text(vtype: str, lang: str | None = None) -> str:
    key = str(vtype or "").strip()
    entry = VIOLATION_REASONS.get(key)
    if not entry:
        return key
    return entry.get(_norm_lang(lang)) or entry["uz"] or key
