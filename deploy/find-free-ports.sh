#!/usr/bin/env bash
# Dropletda ishga tushirishdan oldin: band portlarni tekshirish.
# Ishlatish: bash deploy/find-free-ports.sh

set -euo pipefail
echo "=== LISTEN qilayotgan portlar (faqat ko‘rish) ==="
ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || true
echo ""
echo "=== Tavsiya etilgan ichki portlar (birinchi bo‘sh) ==="
for p in 9081 9082 9083 9084 18081 18082 28080; do
  if ss -tln 2>/dev/null | grep -qE ":${p}\\s"; then
    echo "$p  BAND"
  else
    echo "$p  BO‘SH (tavsiya)"
  fi
done
