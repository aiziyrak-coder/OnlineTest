from django.contrib import admin

from .models import (
    AppUser,
    Exam,
    ExamGroup,
    Group,
    Level,
    ResultIdCounter,
    StudentExam,
    TestBankCategory,
    TestBankQuestion,
    UnbanEvidence,
    ViolationLog,
)

admin.site.site_header = "Online Exam"
admin.site.site_title = "Admin"


@admin.register(Level)
class LevelAdmin(admin.ModelAdmin):
    list_display = ("id", "name")
    search_fields = ("name",)


@admin.register(Group)
class GroupAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "level")
    list_filter = ("level",)
    search_fields = ("name",)


@admin.register(AppUser)
class AppUserAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "role", "status", "group")
    list_filter = ("role", "status")
    search_fields = ("id", "name")
    readonly_fields = ("password",)


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "teacher", "start_time", "end_time", "exam_mode")
    list_filter = ("exam_mode", "language")
    search_fields = ("title", "teacher__id")
    raw_id_fields = ("teacher",)


@admin.register(ExamGroup)
class ExamGroupAdmin(admin.ModelAdmin):
    list_display = ("id", "exam", "group")
    raw_id_fields = ("exam", "group")


@admin.register(StudentExam)
class StudentExamAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "exam", "status", "score", "draft_updated_at")
    list_filter = ("status",)
    search_fields = ("student__id", "exam__title", "result_public_id")
    raw_id_fields = ("student", "exam")
    readonly_fields = ("draft_answers_json", "draft_flagged_json", "draft_updated_at")


@admin.register(ViolationLog)
class ViolationLogAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "exam", "violation_type", "timestamp")
    list_filter = ("violation_type",)
    raw_id_fields = ("student", "exam")


@admin.register(TestBankCategory)
class TestBankCategoryAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "sort_order")
    search_fields = ("name",)


@admin.register(TestBankQuestion)
class TestBankQuestionAdmin(admin.ModelAdmin):
    list_display = ("id", "category", "text", "language", "created_at")
    list_filter = ("language",)
    search_fields = ("text",)
    raw_id_fields = ("category",)


@admin.register(ResultIdCounter)
class ResultIdCounterAdmin(admin.ModelAdmin):
    list_display = ("id", "next_num")


@admin.register(UnbanEvidence)
class UnbanEvidenceAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "admin", "file_name", "file_mime", "created_at")
    search_fields = ("student__id", "admin__id", "reason", "file_name")
    raw_id_fields = ("student", "admin")
