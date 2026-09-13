"""Hujjatdagi kafedra/fanlar bo'yicha o'qituvchi baholash imtihonlarini yaratish.

Har FAN = alohida Exam (faculty_ai_books, 20 savol, 20 daqiqa).
Sana: 1–13 kafedra = 4.09.2026, 14–25 = 5.09.2026 (Asia/Tashkent 08:00–20:00).

  python manage.py seed_faculty_assessment_exams
  python manage.py seed_faculty_assessment_exams --apply
  python manage.py seed_faculty_assessment_exams --apply --purge-old
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand
from django.db.models import Count
from django.utils import timezone as dj_tz

from apps.core.faculty_assessment_catalog import ASSESSMENT, norm_kafedra_name
from apps.core.models import AppUser, Exam, Kafedra, StudentExam, ViolationLog

TZ = ZoneInfo("Asia/Tashkent")
FACULTY_ASSESSMENT_DURATION_MINUTES = 20
FACULTY_ASSESSMENT_QUESTION_COUNT = 20


def _day_bounds(date_str: str) -> tuple[datetime, datetime]:
    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    start = datetime(d.year, d.month, d.day, 8, 0, 0, tzinfo=TZ)
    end = datetime(d.year, d.month, d.day, 20, 0, 0, tzinfo=TZ)
    return start, end


def _pick_kafedra(aliases: list[str], ranked: list[tuple[Kafedra, int]], prefer_names: list[str] | None = None) -> Kafedra | None:
    prefer_norms = [norm_kafedra_name(a) for a in (prefer_names or []) if a]
    for pref in prefer_norms:
        hits = [(k, c) for k, c in ranked if norm_kafedra_name(k.name) == pref and c > 0]
        if hits:
            hits.sort(key=lambda x: -x[1])
            return hits[0][0]
        hits = [
            (k, c)
            for k, c in ranked
            if pref
            and pref in norm_kafedra_name(k.name)
            and c > 0
            and not any(t in norm_kafedra_name(k.name) for t in ("fakultet", "bolim", "bo lim", "rektorat", "turar"))
        ]
        if hits:
            hits.sort(key=lambda x: -x[1])
            return hits[0][0]

    norms = [norm_kafedra_name(a) for a in aliases if a]
    adminish = ("fakultet", "bolim", "bo lim", "rektorat", "turar", "markaz", "sektor")

    def is_adminish(kn: str) -> bool:
        return any(t in kn for t in adminish)

    exact_hits: list[tuple[Kafedra, int]] = []
    fuzzy_hits: list[tuple[Kafedra, int, int]] = []
    for kaf, cnt in ranked:
        kn = norm_kafedra_name(kaf.name)
        if is_adminish(kn):
            continue
        for a in norms:
            if not a:
                continue
            if kn == a:
                exact_hits.append((kaf, cnt))
                break
            if a in kn or kn in a:
                fuzzy_hits.append((kaf, cnt, min(len(a), len(kn))))
                break
            at, kt = set(a.split()), set(kn.split())
            if len(at) >= 2 and len(at & kt) >= max(2, len(at) - 1):
                fuzzy_hits.append((kaf, cnt, len(at & kt) * 10))
                break
    if exact_hits:
        exact_hits.sort(key=lambda x: -x[1])
        if exact_hits[0][1] > 0:
            return exact_hits[0][0]
    if fuzzy_hits:
        fuzzy_hits.sort(key=lambda x: (-x[1], -x[2]))
        with_fac = [h for h in fuzzy_hits if h[1] > 0]
        if with_fac:
            return with_fac[0][0]
        if exact_hits:
            return exact_hits[0][0]
        return fuzzy_hits[0][0]
    if exact_hits:
        return exact_hits[0][0]
    return None


def _merge_kafedra_into(canonical: Kafedra, duplicate: Kafedra) -> None:
    if canonical.id == duplicate.id:
        return
    AppUser.objects.filter(kafedra_id=duplicate.id).update(kafedra_id=canonical.id)
    Exam.objects.filter(kafedra_id=duplicate.id).update(kafedra_id=canonical.id)
    duplicate.delete()


def sync_assessment_kafedra(block: dict, ranked: list[tuple[Kafedra, int]], apply: bool) -> Kafedra | None:
    doc_name = str(block["doc_name"]).strip()
    aliases = [doc_name, *block.get("aliases", []), *(block.get("prefer_names") or [])]

    canonical = Kafedra.objects.filter(name__iexact=doc_name).first()
    matched = _pick_kafedra(aliases, ranked, block.get("prefer_names"))

    if not apply:
        return canonical or matched

    if canonical and matched and canonical.id != matched.id:
        _merge_kafedra_into(canonical, matched)
        return canonical

    if canonical:
        return canonical

    if matched:
        if matched.name != doc_name:
            matched.name = doc_name
            matched.save(update_fields=["name"])
        return matched

    return Kafedra.objects.create(name=doc_name, is_active=True)


def build_faculty_assessment_schedule() -> list[dict]:
    fac_counts = {
        row["kafedra_id"]: int(row["c"])
        for row in AppUser.objects.filter(role="faculty", kafedra_id__isnull=False)
        .values("kafedra_id")
        .annotate(c=Count("id"))
    }
    ranked = [(k, fac_counts.get(k.id, 0)) for k in Kafedra.objects.filter(is_active=True).order_by("id")]
    ranked.sort(key=lambda x: -x[1])

    out: list[dict] = []
    for block in ASSESSMENT:
        kaf = sync_assessment_kafedra(block, ranked, apply=False)
        if not kaf:
            continue
        out.append(
            {
                "kafedra_id": kaf.id,
                "name": block["doc_name"],
                "date": block["date"],
                "subjects": list(block["subjects"]),
            }
        )
    return out


class Command(BaseCommand):
    help = "O'qituvchi baholash: kafedra fanlari bo'yicha faculty_ai_books imtihonlari"

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Haqiqatan yozadi")
        parser.add_argument(
            "--purge-old",
            action="store_true",
            help="Eski faculty_ai_books imtihonlarni o'chiradi",
        )

    def handle(self, *args, **opts):
        apply = bool(opts["apply"])
        purge = bool(opts["purge_old"])

        admin = (
            AppUser.objects.filter(role="admin").order_by("id").first()
            or AppUser.objects.order_by("id").first()
        )
        if not admin:
            self.stderr.write("Admin user topilmadi")
            return

        fac_counts = {
            row["kafedra_id"]: int(row["c"])
            for row in AppUser.objects.filter(role="faculty", kafedra_id__isnull=False)
            .values("kafedra_id")
            .annotate(c=Count("id"))
        }
        ranked = [(k, fac_counts.get(k.id, 0)) for k in Kafedra.objects.filter(is_active=True).order_by("id")]
        ranked.sort(key=lambda x: -x[1])

        if apply:
            renamed = 0
            for block in ASSESSMENT:
                before = Kafedra.objects.filter(name__iexact=block["doc_name"]).exists()
                sync_assessment_kafedra(block, ranked, apply=True)
                if not before:
                    renamed += 1
            ranked = [(k, fac_counts.get(k.id, 0)) for k in Kafedra.objects.filter(is_active=True).order_by("id")]
            ranked.sort(key=lambda x: -x[1])
            self.stdout.write(f"Synced kafedra names to DOCX: {renamed} created/merged")

        if purge and apply:
            old_qs = Exam.objects.filter(audience="faculty", exam_mode="faculty_ai_books")
            n_old = old_qs.count()
            for ex in old_qs:
                StudentExam.objects.filter(exam_id=ex.id).delete()
                ViolationLog.objects.filter(exam_id=ex.id).delete()
            old_qs.delete()
            self.stdout.write(f"Purged {n_old} old faculty_ai_books exams")
        elif purge:
            self.stdout.write(f"[dry-run] would purge {Exam.objects.filter(audience='faculty', exam_mode='faculty_ai_books').count()} exams")

        created = 0
        skipped = 0
        unmatched: list[str] = []

        for block in ASSESSMENT:
            kaf = sync_assessment_kafedra(block, ranked, apply=apply) if apply else _pick_kafedra(
                [block["doc_name"], *block.get("aliases", [])],
                ranked,
                block.get("prefer_names"),
            )
            if not kaf:
                unmatched.append(block["doc_name"])
                self.stderr.write(self.style.WARNING(f"NO MATCH: {block['doc_name']}"))
                continue
            st, et = _day_bounds(block["date"])
            if dj_tz.is_naive(st):
                st = dj_tz.make_aware(st, TZ)
            if dj_tz.is_naive(et):
                et = dj_tz.make_aware(et, TZ)

            for subject in block["subjects"]:
                title = f"{subject} — o'qituvchi baholash"
                exists = Exam.objects.filter(
                    audience="faculty",
                    exam_mode="faculty_ai_books",
                    kafedra_id=kaf.id,
                    faculty_subject=subject,
                ).first()
                if not exists:
                    subj_norm = norm_kafedra_name(subject)
                    for ex in Exam.objects.filter(
                        audience="faculty",
                        exam_mode="faculty_ai_books",
                        kafedra_id=kaf.id,
                    ):
                        if norm_kafedra_name(ex.faculty_subject or "") == subj_norm:
                            exists = ex
                            break
                fac_n = AppUser.objects.filter(role="faculty", kafedra_id=kaf.id).count()
                self.stdout.write(
                    f"{'UPDATE' if exists else 'CREATE'} kaf={kaf.id}({fac_n} fac) "
                    f"date={block['date']} | {subject[:60]}"
                )
                if exists:
                    skipped += 1
                    if apply:
                        exists.title = title
                        exists.faculty_subject = subject
                        exists.start_time = st
                        exists.end_time = et
                        exists.duration_minutes = FACULTY_ASSESSMENT_DURATION_MINUTES
                        exists.bank_question_count = FACULTY_ASSESSMENT_QUESTION_COUNT
                        exists.language = "uz"
                        exists.save(
                            update_fields=[
                                "title",
                                "faculty_subject",
                                "start_time",
                                "end_time",
                                "duration_minutes",
                                "bank_question_count",
                                "language",
                            ]
                        )
                    continue
                if not apply:
                    created += 1
                    continue
                Exam.objects.create(
                    teacher_id=admin.id,
                    title=title,
                    start_time=st,
                    end_time=et,
                    duration_minutes=FACULTY_ASSESSMENT_DURATION_MINUTES,
                    questions_json="[]",
                    language="uz",
                    pin="",
                    custom_rules=(
                        "Professor-o'qituvchilar bilimini baholash. "
                        "USMLE/KROK darajasidagi 20 ta qiyin MCQ. "
                        f"Fan: {subject}."
                    ),
                    exam_mode="faculty_ai_books",
                    audience="faculty",
                    bank_category_ids="[]",
                    bank_question_count=FACULTY_ASSESSMENT_QUESTION_COUNT,
                    imentor_subject_codes="[]",
                    kafedra_id=kaf.id,
                    faculty_subject=subject,
                    technical_retakes_allowed=3,
                    identity_retakes_allowed=1,
                    proctor_profile="standard",
                    ambient_audio_enabled=True,
                )
                created += 1

        expected_n = sum(len(b["subjects"]) for b in ASSESSMENT)
        actual_n = Exam.objects.filter(audience="faculty", exam_mode="faculty_ai_books").count()
        self.stdout.write(
            self.style.SUCCESS(
                f"Done apply={apply} created/would={created} updated_or_skip={skipped} "
                f"unmatched={len(unmatched)} exams_in_db={actual_n} expected={expected_n}"
            )
        )
        if unmatched:
            self.stderr.write("Unmatched kafedralar:\n  - " + "\n  - ".join(unmatched))
