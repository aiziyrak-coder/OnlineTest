"""views/ package — API endpoint handlerlari, mantiqiy modullarga bo'lingan.

  _helpers.py        — umumiy importlar va yordamchi funksiyalar
  health.py          — health, live, ready
  auth.py            — auth_login
  student.py         — imtihon oqimi (start/submit/draft/violations/proctor)
  student_results.py — natijalar, sertifikat, ban report, appeals
  admin.py           — admin boshqaruvi
  staff.py           — staff endpointlari
  public.py          — ochiq verify + internal realtime
"""
from apps.api.views._helpers import *  # noqa: F401,F403
from apps.api.views.health import *  # noqa: F401,F403
from apps.api.views.auth import *  # noqa: F401,F403
from apps.api.views.student import *  # noqa: F401,F403
from apps.api.views.student_results import *  # noqa: F401,F403
from apps.api.views.admin import *  # noqa: F401,F403
from apps.api.views.admin_reports import *  # noqa: F401,F403
from apps.api.views.audience_reports import *  # noqa: F401,F403
from apps.api.views.profile_photo import *  # noqa: F401,F403
from apps.api.views.vacancy import *  # noqa: F401,F403
from apps.api.views.ordinator import *  # noqa: F401,F403
from apps.api.views.ordinator_admin import *  # noqa: F401,F403
from apps.api.views.staff import *  # noqa: F401,F403
from apps.api.views.public import *  # noqa: F401,F403
