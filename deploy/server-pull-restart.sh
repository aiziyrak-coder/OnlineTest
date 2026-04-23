#!/usr/bin/env bash
# Ustunlik: deploy/remote-update.sh
# exec to'g'ridan-to'g'ri .sh fayl uchun +x talab qiladi; bash orqali repoda 100644 bo'lsa ham ishlaydi.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/remote-update.sh" "$@"
