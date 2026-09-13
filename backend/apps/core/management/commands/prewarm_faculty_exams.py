"""Faculty imtihonlari uchun AI savollarni OLDINDAN yuklash (exam kuni qotmasin).

  python manage.py prewarm_faculty_exams
  python manage.py prewarm_faculty_exams --apply
  python manage.py prewarm_faculty_exams --apply --force
  python manage.py prewarm_faculty_exams --apply --limit 5
  python manage.py prewarm_faculty_exams --apply --workers 2
"""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from django.core.management.base import BaseCommand

from apps.api.faculty_ai_throttle import faculty_ai_generate_slot
from apps.api.imentor_client import IMentorApiError
from apps.api.imentor_service import fetch_faculty_ai_mcq_questions
from apps.api.services import exam_questions_add_translations, fill_missing_exam_translations
from apps.api.view_utils import safe_json_loads
from apps.core.models import Exam, Kafedra

logger = logging.getLogger(__name__)


def _prewarm_one(exam_id: int, *, force: bool) -> tuple[str, int, str]:
    """Returns (status, exam_id, detail). status: ok|fail|skip."""
    ex = Exam.objects.filter(pk=exam_id).first()
    if not ex:
        return "skip", exam_id, "missing"
    bank = safe_json_loads(ex.questions_json, [])
    if bank and not force:
        return "skip", exam_id, "already_filled"
    kaf = Kafedra.objects.filter(pk=ex.kafedra_id).first() if ex.kafedra_id else None
    if not kaf:
        return "skip", exam_id, "no_kafedra"
    subject = (ex.faculty_subject or "").strip() or ex.title
    n = max(5, min(30, int(ex.bank_question_count or 20)))
    t0 = time.monotonic()
    try:
        with faculty_ai_generate_slot(timeout_sec=600):
            picked, meta = fetch_faculty_ai_mcq_questions(
                department_name=kaf.name,
                department_code=getattr(kaf, "code", None) or None,
                subject=subject,
                count=n,
                language=(ex.language or "uz") if (ex.language or "uz") in ("uz", "ru", "en") else "uz",
            )
            picked = exam_questions_add_translations(picked, None)
            bank = [{**q, "id": idx + 1} for idx, q in enumerate(picked)]
            bank = fill_missing_exam_translations(bank)
            ex.questions_json = json.dumps(bank, ensure_ascii=False)
            ex.save(update_fields=["questions_json"])
        dt = time.monotonic() - t0
        return (
            "ok",
            exam_id,
            f"n={len(bank)} src={meta.get('source')} {dt:.1f}s | {kaf.name[:30]} | {subject[:40]}",
        )
    except (IMentorApiError, TimeoutError) as ex_err:
        return "fail", exam_id, str(ex_err)
    except Exception as ex_err:
        logger.exception("prewarm failed exam_id=%s", exam_id)
        return "fail", exam_id, str(ex_err)


def _prewarm_one_with_retry(exam_id: int, *, force: bool, retries: int = 1) -> tuple[str, int, str]:
    last = _prewarm_one(exam_id, force=force)
    if last[0] != "fail" or retries < 1:
        return last
    time.sleep(3)
    return _prewarm_one(exam_id, force=force)


class Command(BaseCommand):
    help = "faculty_ai_books imtihonlariga 20 ta USMLE MCQ ni oldindan yozadi"

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--force", action="store_true", help="Mavjud questions_json ustidan yozadi")
        parser.add_argument("--limit", type=int, default=0, help="Faqat N ta imtihon (0=hammasi)")
        parser.add_argument("--exam-id", type=int, default=0)
        parser.add_argument(
            "--workers",
            type=int,
            default=2,
            help="Parallel generate (FACULTY_AI_GENERATE_SLOTS bilan mos)",
        )

    def handle(self, *args, **opts):
        apply = bool(opts["apply"])
        force = bool(opts["force"])
        limit = int(opts["limit"] or 0)
        exam_id = int(opts["exam_id"] or 0)
        workers = max(1, min(4, int(opts["workers"] or 2)))

        qs = Exam.objects.filter(audience="faculty", exam_mode="faculty_ai_books").order_by("id")
        if exam_id:
            qs = qs.filter(pk=exam_id)

        todo_ids: list[int] = []
        for ex in qs:
            bank = safe_json_loads(ex.questions_json, [])
            if bank and not force:
                continue
            todo_ids.append(ex.id)
            if limit and len(todo_ids) >= limit:
                break

        self.stdout.write(
            f"Prewarm candidates={len(todo_ids)} apply={apply} force={force} workers={workers}"
        )
        if not apply:
            for i, eid in enumerate(todo_ids, 1):
                ex = Exam.objects.filter(pk=eid).only("id", "faculty_subject").first()
                self.stdout.write(
                    f"[{i}/{len(todo_ids)}] exam={eid} subj={(ex.faculty_subject or '')[:50]}"
                )
            return

        ok = fail = skip = 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futs = {pool.submit(_prewarm_one_with_retry, eid, force=force): eid for eid in todo_ids}
            done = 0
            for fut in as_completed(futs):
                done += 1
                status, eid, detail = fut.result()
                if status == "ok":
                    ok += 1
                    self.stdout.write(
                        self.style.SUCCESS(f"[{done}/{len(todo_ids)}] OK exam={eid} {detail}")
                    )
                elif status == "skip":
                    skip += 1
                    self.stdout.write(f"[{done}/{len(todo_ids)}] SKIP exam={eid} {detail}")
                else:
                    fail += 1
                    self.stderr.write(
                        self.style.ERROR(f"[{done}/{len(todo_ids)}] FAIL exam={eid} {detail}")
                    )

        self.stdout.write(self.style.SUCCESS(f"Done ok={ok} fail={fail} skip={skip}"))
