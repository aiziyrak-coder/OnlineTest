from django.db import models


class Level(models.Model):
    """Kurs/daraja (masalan "1-kurs", "2-kurs")."""

    name = models.CharField(max_length=200, unique=True)

    class Meta:
        app_label = "core"
        db_table = "levels"


class Kafedra(models.Model):
    """Kafedra (masalan "Ichki kasalliklar kafedrasi") — Direction'ning tashkiliy ota-bo'g'ini."""

    name = models.CharField(max_length=200, unique=True)
    code = models.CharField(max_length=50, unique=True, null=True, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    # Klinik (bemor bilan ishlaydigan) yoki noklinik kafedra. Vakansiya
    # sahifasida ro'yxat shu bo'yicha ikkiga bo'lib ko'rsatiladi — 45 ta
    # kafedra ichidan kerakligini topish uchun.
    is_clinical = models.BooleanField(default=False)

    class Meta:
        app_label = "core"
        db_table = "kafedralar"
        ordering = ["sort_order", "name"]

    def __str__(self) -> str:
        return self.name


class Direction(models.Model):
    """Yo'nalish/fakultet (masalan "Davolash ishi", "Stomatologiya").

    Kurs (Level) bilan mustaqil o'q: guruh ikkalasiga ham bog'lanadi
    (masalan "1-kurs / Davolash ishi / 101-guruh").
    """

    name = models.CharField(max_length=200, unique=True)
    # NULL = kafedra hali belgilanmagan (mavjud yo'nalishlar shu holatda import
    # qilingan) — admin panel orqali keyin to'ldiriladi, majburiy emas.
    kafedra = models.ForeignKey(
        Kafedra, null=True, blank=True, on_delete=models.SET_NULL,
        db_column="kafedra_id", related_name="directions",
    )
    # Excel katalog: bitta yo'nalish bir nechta kafedraga tegishli (DI 24 ta
    # kafedrada o'qitiladi). `kafedra` FK — asosiy/primary (eng ko'p fan).
    taught_kafedralar = models.ManyToManyField(
        Kafedra,
        blank=True,
        related_name="taught_directions",
        db_table="direction_kafedralar",
    )

    class Meta:
        app_label = "core"
        db_table = "directions"


class Group(models.Model):
    name = models.CharField(max_length=200)
    level = models.ForeignKey(Level, on_delete=models.CASCADE, db_column="level_id")
    # NULL = eski guruhlar (yo'nalish qo'shilishidan oldin yaratilgan) — majburiy emas.
    direction = models.ForeignKey(
        Direction, null=True, blank=True, on_delete=models.SET_NULL, db_column="direction_id"
    )
    program_track = models.CharField(max_length=20, default="bachelor")
    academic_year = models.PositiveSmallIntegerField(null=True, blank=True)
    # Guruh qabul qilingan o'quv yili (masalan 2025) — yillik kurs ko'tarilishini
    # (current_level = shu_yil - intake_year + 1) hisoblash uchun. NULL = eski
    # guruhlar (bu maydon qo'shilishidan oldin yaratilgan), qo'lda to'ldiriladi.
    intake_year = models.PositiveSmallIntegerField(null=True, blank=True)
    # False = guruh bitirgan (yoki boshqa sababga ko'ra arxivlangan) — `promote_groups`
    # yillik kurs ko'tarishda hisoblangan kurs raqami maksimal kursdan oshib ketsa, shu
    # bayroq o'chiriladi va `level` ga endi tegilmaydi. Talabalar/tarix saqlanib qoladi.
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "core"
        db_table = "groups"


class AppUser(models.Model):
    """Foydalanuvchi.

    Rollar:
      - admin / staff — boshqaruv / kuzatuvchi
      - student — bakalavr talaba (examinee)
      - faculty — o'qituvchi (examinee; eski deprecated `teacher` emas)
      - ordinator — ordinatura (examinee; keyingi bosqich)
    """

    id = models.CharField(max_length=64, primary_key=True)
    password = models.CharField(max_length=128)
    role = models.CharField(max_length=20)
    name = models.CharField(max_length=200)
    status = models.CharField(max_length=20, default="Active")
    group = models.ForeignKey(
        Group, null=True, blank=True, on_delete=models.SET_NULL, db_column="group_id"
    )
    # O'qituvchi / ordinator uchun asosiy kafedra (talaba uchun odatda NULL).
    kafedra = models.ForeignKey(
        Kafedra,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        db_column="kafedra_id",
        related_name="users",
    )
    position = models.CharField(max_length=200, blank=True, default="")
    # Vakansiya nomzodi ro'yxatdan o'tishda tanlagan fan (iMentor katalogidan).
    # Test aynan shu fanning sillabus mavzulari bo'yicha yaratiladi.
    vacancy_subject = models.CharField(max_length=200, blank=True, default="")
    vacancy_subject_code = models.CharField(max_length=120, blank=True, default="")
    stavka = models.CharField(max_length=64, blank=True, default="")
    # Ordinator / magistr kursi: 0 = belgilanmagan, 1 = 1-kurs, 2 = 2-kurs.
    # Kabinetda faqat shu kursning imtihonlari ko'rinadi.
    course = models.PositiveSmallIntegerField(default=0)
    profile_image = models.TextField(blank=True)
    # Oxirgi muvaffaqiyatli kirish. Konteyner loglari qayta yaratilganda
    # o'chadi — "u kirganmi, qachon, qayerdan" degan savolga javob bo'lsin.
    last_login_at = models.DateTimeField(null=True, blank=True)
    last_login_ip = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        app_label = "core"
        db_table = "users"


class AuditLog(models.Model):
    actor_id = models.CharField(max_length=64)
    actor_name = models.CharField(max_length=200, blank=True)
    action = models.CharField(max_length=64)
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.CharField(max_length=128, blank=True)
    target_name = models.CharField(max_length=200, blank=True)
    detail = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "core"
        db_table = "audit_logs"
        ordering = ["-created_at"]
        # Indeks nomlari ATAYLAB aniq yozilgan: 0018 migratsiyasi ularni shu
        # nomlar bilan yaratgan. `name=` ko'rsatilmasa Django xesh asosidagi
        # boshqa nom kutadi va har `makemigrations --check` da ortiqcha
        # RenameIndex chiqib, CI yiqilardi.
        indexes = [
            models.Index(fields=["-created_at"], name="audit_logs_created_idx"),
            models.Index(fields=["actor_id"], name="audit_logs_actor_idx"),
        ]
