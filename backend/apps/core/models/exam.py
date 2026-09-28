from django.db import models

from .user import AppUser, Direction, Group, Kafedra


class Exam(models.Model):
    teacher = models.ForeignKey(
        AppUser, on_delete=models.CASCADE, db_column="teacher_id", to_field="id"
    )
    title = models.CharField(max_length=500)
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    duration_minutes = models.IntegerField()
    questions_json = models.TextField(default="[]")
    language = models.CharField(max_length=10, default="uz")
    pin = models.CharField(max_length=50, blank=True)
    custom_rules = models.TextField(blank=True)
    exam_mode = models.CharField(max_length=20, default="static")
    # Kimlar uchun: student | faculty | ordinator
    audience = models.CharField(max_length=20, default="student")
    bank_category_ids = models.TextField(default="[]")
    bank_question_count = models.IntegerField(default=0)
    imentor_subject_codes = models.TextField(default="[]", blank=True)
    # iMentor'dan tanlangan "variant_label" shu Direction.name ga tekshiriladi
    # (validatsiya) va saqlanadi — endi erkin matn emas, haqiqiy yo'nalishga
    # bog'lanadi. NULL = eski imtihonlar (bu maydon qo'shilishidan oldin
    # yaratilgan) yoki variant tanlanmagan holat.
    direction = models.ForeignKey(
        Direction, null=True, blank=True, on_delete=models.SET_NULL, db_column="direction_id"
    )
    # O'qituvchi baholash: faqat shu kafedra xodimlari ko'radi / topshiradi.
    kafedra = models.ForeignKey(
        Kafedra,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        db_column="kafedra_id",
        related_name="exams",
    )
    # Fan nomi — AI generate-mcq topic (faculty_ai_books).
    faculty_subject = models.CharField(max_length=300, blank=True, default="")
    # Ordinatura/magistratura KURSI: 0 = belgilanmagan (hammaga), 1, 2, ...
    # 1-kurs va 2-kurs (DAK) imtihonlari aralashib ketmasligi uchun.
    course = models.PositiveSmallIntegerField(default=0)
    # Shu imtihondagi savollarning nechtasi AI tomonidan AYNI PAYTDA
    # yaratilsin. Qolgani admin yuklagan bankdan olinadi. 0 = faqat bank.
    ai_question_count = models.PositiveSmallIntegerField(default=0)
    # Shu imtihonning O'Z o'tish chegarasi (%). 0 = umumiy sozlama
    # (EXAM_PASS_PERCENT) ishlatiladi.
    pass_percent = models.PositiveSmallIntegerField(default=0)
    # Ko'p fanli imtihon tarkibi: [{"exam_id": 406, "count": 10}, ...]
    # Har bir manba imtihonning bankidan shuncha savol olinadi. Bo'sh
    # bo'lsa — odatdagidek shu imtihonning o'z bankidan olinadi.
    question_plan = models.TextField(blank=True, default="")
    technical_retakes_allowed = models.PositiveSmallIntegerField(default=3)
    identity_retakes_allowed = models.PositiveSmallIntegerField(default=1)
    proctor_profile = models.CharField(max_length=16, blank=True, default="standard")
    #: TASHQI shovqin (musiqa, TV, koridor ovozi) nazorati yoqilganmi.
    #: Institut binosida imtihon o'tkazilganda atrofdagi tabiiy shovqin soxta
    #: ogohlantirish beradi — shunda admin buni o'chiradi. Uyda topshirilsa
    #: yoqib qo'yiladi. DIQQAT: bu FAQAT tashqi shovqinga tegishli. Talabaning
    #: o'zi gapirishi (og'iz harakati + nutq) HAR DOIM aniqlanadi va bu
    #: sozlama unga ta'sir qilmaydi.
    ambient_audio_enabled = models.BooleanField(default=True)
    #: Test markazi PIN'i (4 raqam). Bo'sh bo'lsa — test markazi rejimi yo'q.
    #: Tekshiruvchi test markazidagi kompyuterda kiritadi: shu sessiyada
    #: mikrofonga oid nazorat o'chadi (xonada ovoz ko'p, mikrofon yo'q),
    #: kamera nazorati to'liq qoladi. Uydan topshiruvchi PIN'ni bilmaydi.
    test_center_pin = models.CharField(max_length=8, blank=True, default="")

    class Meta:
        app_label = "core"
        db_table = "exams"


class ExamGroup(models.Model):
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    group = models.ForeignKey(Group, on_delete=models.CASCADE, db_column="group_id")

    class Meta:
        app_label = "core"
        db_table = "exam_groups"
        unique_together = [("exam", "group")]


class ExamStudentException(models.Model):
    """Tanlangan talaba ushbu imtihonni boshlay olmaydi (sabab ko'rsatiladi)."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    student = models.ForeignKey(
        AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id"
    )
    reason = models.TextField()

    class Meta:
        app_label = "core"
        db_table = "exam_student_exceptions"
        unique_together = [("exam", "student")]


class ExamRetakeWindow(models.Model):
    """Imtihon yopilgandan keyin ma'lum talaba uchun qayta kirish vaqti."""

    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, db_column="exam_id")
    student = models.ForeignKey(
        AppUser, on_delete=models.CASCADE, db_column="student_id", to_field="id"
    )
    window_start = models.DateTimeField()
    window_end = models.DateTimeField()
    note = models.TextField(blank=True)

    class Meta:
        app_label = "core"
        db_table = "exam_retake_windows"
        indexes = [
            models.Index(fields=["exam", "student"]),
        ]
