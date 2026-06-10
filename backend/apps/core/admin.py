from django.contrib import admin
from django.utils.html import format_html

from .models import (
    AppUser,
    BanAppeal,
    BanAppealEvent,
    Exam,
    ExamGroup,
    ExamRetakeWindow,
    ExamStudentException,
    Group,
    Level,
    ResultIdCounter,
    StudentExam,
    TestBankCategory,
    TestBankQuestion,
    UnbanEvidence,
    ViolationLog,
)

# O‘zbekcha nomlar (admin va Jazzmin menyusida)
_MODEL_LABELS = {
    AppUser: ("Foydalanuvchi", "Foydalanuvchilar"),
    Level: ("Daraja", "Darajalar"),
    Group: ("Guruh", "Guruhlar"),
    Exam: ("Imtihon", "Imtihonlar"),
    ExamGroup: ("Imtihon–guruh", "Imtihon–guruh bog‘lanishlari"),
    ExamStudentException: ("Imtihon istisnosi", "Imtihon istisnolari"),
    ExamRetakeWindow: ("Qayta topshirish oynasi", "Qayta topshirish oynalari"),
    StudentExam: ("Talaba imtihoni", "Talaba imtihonlari"),
    ViolationLog: ("Qoidabuzarlik", "Qoidabuzarliklar"),
    UnbanEvidence: ("Ban olib tashlash dalili", "Ban olib tashlash dalillari"),
    BanAppeal: ("Ban shikoyati", "Ban shikoyatlari"),
    BanAppealEvent: ("Shikoyat voqeasi", "Shikoyat voqealari"),
    TestBankCategory: ("Test kategoriyasi", "Test kategoriyalari"),
    TestBankQuestion: ("Test savoli", "Test savollari"),
    ResultIdCounter: ("Natija ID hisoblagichi", "Natija ID hisoblagichlari"),
}
for _model, (_vn, _vpn) in _MODEL_LABELS.items():
    _model._meta.verbose_name = _vn
    _model._meta.verbose_name_plural = _vpn


class ReadOnlyTimestampsMixin:
    readonly_fields: tuple[str, ...] = ()


@admin.register(Level)
class LevelAdmin(admin.ModelAdmin):
    list_display = ("id", "name")
    search_fields = ("name",)
    ordering = ("name",)


@admin.register(Group)
class GroupAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "level", "program_track", "academic_year")
    list_filter = ("level", "program_track", "academic_year")
    search_fields = ("name",)
    list_select_related = ("level",)
    fieldsets = (
        (None, {"fields": ("name", "level")}),
        (
            "Ta’lim yo‘nalishi",
            {
                "fields": ("program_track", "academic_year"),
                "description": "Test bazasi va talaba filtri uchun (bakalavr kursi, magistratura va h.k.).",
            },
        ),
    )


@admin.register(AppUser)
class AppUserAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "role_badge", "status_badge", "group")
    list_filter = ("role", "status", "group")
    search_fields = ("id", "name")
    list_select_related = ("group",)
    ordering = ("role", "id")
    readonly_fields = ("password",)
    fieldsets = (
        (
            "Kirish ma’lumotlari",
            {
                "fields": ("id", "password", "role", "status"),
                "description": (
                    "SPA kirish: /api/auth/login. Parol bcrypt xesh — yangilash uchun "
                    "manage.py reset_platform_admin yoki ensure_superadmin ishlating."
                ),
            },
        ),
        ("Shaxsiy", {"fields": ("name", "group", "profile_image")}),
    )

    @admin.display(description="Rol")
    def role_badge(self, obj: AppUser) -> str:
        colors = {
            "admin": "#1e5f9a",
            "student": "#198754",
            "teacher": "#6c757d",
            "staff": "#0d6efd",
        }
        color = colors.get((obj.role or "").lower(), "#6c757d")
        return format_html(
            '<span style="background:{};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">{}</span>',
            color,
            obj.role,
        )

    @admin.display(description="Holat")
    def status_badge(self, obj: AppUser) -> str:
        color = "#dc3545" if obj.status == "Banned" else "#198754"
        return format_html(
            '<span style="color:{};font-weight:600;">{}</span>',
            color,
            obj.status,
        )


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "teacher", "exam_mode", "start_time", "end_time", "duration_minutes")
    list_filter = ("exam_mode", "language")
    search_fields = ("title", "teacher__id", "pin")
    raw_id_fields = ("teacher",)
    date_hierarchy = "start_time"
    fieldsets = (
        (None, {"fields": ("title", "teacher", "exam_mode", "language", "pin")}),
        ("Vaqt", {"fields": ("start_time", "end_time", "duration_minutes")}),
        (
            "Savollar",
            {
                "fields": ("questions_json", "bank_category_ids", "bank_question_count"),
                "classes": ("collapse",),
            },
        ),
        ("Qoidalar", {"fields": ("custom_rules",), "classes": ("collapse",)}),
    )


@admin.register(ExamGroup)
class ExamGroupAdmin(admin.ModelAdmin):
    list_display = ("id", "exam", "group")
    list_select_related = ("exam", "group")
    raw_id_fields = ("exam", "group")
    search_fields = ("exam__title", "group__name")


@admin.register(ExamStudentException)
class ExamStudentExceptionAdmin(admin.ModelAdmin):
    list_display = ("id", "exam", "student", "reason_short")
    list_select_related = ("exam", "student")
    raw_id_fields = ("exam", "student")
    search_fields = ("student__id", "exam__title", "reason")

    @admin.display(description="Sabab")
    def reason_short(self, obj: ExamStudentException) -> str:
        text = (obj.reason or "").strip()
        return text[:80] + ("…" if len(text) > 80 else "")


@admin.register(ExamRetakeWindow)
class ExamRetakeWindowAdmin(admin.ModelAdmin):
    list_display = ("id", "exam", "student", "window_start", "window_end")
    list_select_related = ("exam", "student")
    raw_id_fields = ("exam", "student")
    date_hierarchy = "window_start"


@admin.register(StudentExam)
class StudentExamAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "student",
        "exam",
        "status",
        "score",
        "result_public_id",
        "draft_updated_at",
    )
    list_filter = ("status",)
    search_fields = ("student__id", "exam__title", "result_public_id")
    raw_id_fields = ("student", "exam")
    readonly_fields = (
        "draft_answers_json",
        "draft_flagged_json",
        "draft_updated_at",
        "device_fingerprint",
        "device_bound_at",
        "session_signing_key",
        "session_request_seq",
        "session_challenge",
        "proctor_official_warnings",
        "proctor_last_warning_at",
    )
    fieldsets = (
        (None, {"fields": ("student", "exam", "status", "score")}),
        (
            "Natija",
            {
                "fields": (
                    "result_public_id",
                    "result_verify_secret",
                    "answers_json",
                    "flagged_questions_json",
                    "session_questions_json",
                    "ai_summary_json",
                ),
            },
        ),
        (
            "Vaqt",
            {"fields": ("started_at", "completed_at", "draft_updated_at")},
        ),
        (
            "Qoralama (avtosaqlash)",
            {
                "fields": ("draft_answers_json", "draft_flagged_json"),
                "classes": ("collapse",),
            },
        ),
        (
            "VAC / proktorlik",
            {
                "fields": (
                    "device_fingerprint",
                    "device_bound_at",
                    "session_signing_key",
                    "session_request_seq",
                    "session_challenge",
                    "proctor_official_warnings",
                    "proctor_last_warning_at",
                ),
                "classes": ("collapse",),
            },
        ),
    )


@admin.register(ViolationLog)
class ViolationLogAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "exam", "violation_type", "timestamp")
    list_filter = ("violation_type",)
    raw_id_fields = ("student", "exam")
    date_hierarchy = "timestamp"
    search_fields = ("student__id", "exam__title", "violation_type")


@admin.register(TestBankCategory)
class TestBankCategoryAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "program_track", "academic_year", "sort_order", "source_language")
    list_filter = ("program_track", "source_language")
    search_fields = ("name",)
    ordering = ("sort_order", "name")


@admin.register(TestBankQuestion)
class TestBankQuestionAdmin(admin.ModelAdmin):
    list_display = ("id", "category", "text_short", "language", "created_at")
    list_filter = ("language", "category")
    search_fields = ("text", "text_uz", "text_ru")
    raw_id_fields = ("category",)
    readonly_fields = ("created_at",)
    fieldsets = (
        (None, {"fields": ("category", "language", "created_at")}),
        ("Inglizcha (asosiy)", {"fields": ("text", "options_json", "correct_answer")}),
        (
            "O‘zbekcha",
            {
                "fields": ("text_uz", "options_uz_json", "correct_answer_uz"),
                "classes": ("collapse",),
            },
        ),
        (
            "Ruscha",
            {
                "fields": ("text_ru", "options_ru_json", "correct_answer_ru"),
                "classes": ("collapse",),
            },
        ),
    )

    @admin.display(description="Savol matni")
    def text_short(self, obj: TestBankQuestion) -> str:
        text = (obj.text_uz or obj.text or "").strip()
        return text[:100] + ("…" if len(text) > 100 else "")


@admin.register(ResultIdCounter)
class ResultIdCounterAdmin(admin.ModelAdmin):
    list_display = ("id", "next_num")
    readonly_fields = ("id",)


@admin.register(UnbanEvidence)
class UnbanEvidenceAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "admin", "file_name", "file_mime", "created_at")
    search_fields = ("student__id", "admin__id", "reason", "file_name")
    raw_id_fields = ("student", "admin")
    readonly_fields = ("created_at", "file_base64")
    fieldsets = (
        (None, {"fields": ("student", "admin", "reason", "created_at")}),
        ("Fayl", {"fields": ("file_name", "file_mime", "file_base64")}),
    )


@admin.register(BanAppeal)
class BanAppealAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "exam", "status", "created_at", "reviewed_at")
    list_filter = ("status",)
    search_fields = ("student__id", "reason", "review_note")
    raw_id_fields = ("student", "exam", "reviewed_by")
    readonly_fields = ("created_at", "reviewed_at", "evidence_sha256")
    date_hierarchy = "created_at"


@admin.register(BanAppealEvent)
class BanAppealEventAdmin(admin.ModelAdmin):
    list_display = ("id", "appeal", "actor", "action", "created_at")
    list_filter = ("action",)
    raw_id_fields = ("appeal", "actor")
    readonly_fields = ("created_at",)
    search_fields = ("action", "note")
