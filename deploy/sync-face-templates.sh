#!/usr/bin/env bash
# cam.fermi.uz -> iMentor yuz shablonlarini onlinetest'ga ko'chirish (cron: har soatda).
# Faqat O'QIYDI: iMentor bazasiga yozmaydi.
set -euo pipefail
cd /home/onlinetest
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
OUT=/tmp/face_templates.json
U=$(docker exec imentor-postgres-1 printenv POSTGRES_USER)
docker exec imentor-postgres-1 psql -U "$U" -d imentorfer -Atc "
  select coalesce(json_agg(t), '[]') from (
    select distinct on (f.id)
      f.source_person_id as source_id,
      case when f.owner_key like 'ot\_%' then substr(f.owner_key, 4) else coalesce(s.pinfl, '') end as pinfl,
      f.full_name,
      f.embedding
    from core_facetemplate f
    left join core_staffpinfl s
      on f.owner_key <> '' and s.owner_key = f.owner_key and s.is_active
    where f.is_active
    order by f.id, s.pinfl
  ) t" > "$OUT"
$DC cp "$OUT" app:/tmp/face_templates.json </dev/null >/dev/null
$DC exec -T app sh -c "cd /app/backend && python manage.py import_face_templates /tmp/face_templates.json" </dev/null
rm -f "$OUT"
echo "$(date '+%F %T') sync tugadi"
