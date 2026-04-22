#!/usr/bin/env bash
# Faqat serverda ishga tushiring. Kalitni GitHubga/patchga yozmang.
#
# Ishlatish (SSH orqasi, loyiha ildizidan yoki deploy/ yo‘li bilan):
#   export GEMINI_API_KEY='AIza...'   # AI Studio
#   export GEMINI_MODEL=gemini-2.5-flash
#   export GEMINI_MODEL_FALLBACKS='gemini-2.5-pro,gemini-1.5-flash'
#   sudo -E bash deploy/apply-gemini-to-api-env.sh
#   sudo systemctl restart onlinetest-api
#
# Bir qatorda:
#   GEMINI_API_KEY='AIza...' GEMINI_MODEL=gemini-2.5-flash GEMINI_MODEL_FALLBACKS='gemini-2.5-pro,gemini-1.5-flash' sudo -E bash deploy/apply-gemini-to-api-env.sh && sudo systemctl restart onlinetest-api
set -euo pipefail

API_ENV="${API_ENV:-/etc/onlinetest/api.env}"

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "Xato: GEMINI_API_KEY bo‘sh. AI Studio kalitini export qiling (yoki bir qatorda berib sudo -E ishlating)." >&2
  exit 1
fi

GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"
GEMINI_MODEL_FALLBACKS="${GEMINI_MODEL_FALLBACKS:-gemini-2.5-pro,gemini-1.5-flash}"

sudo install -d -m 700 "$(dirname "$API_ENV")"

export API_ENV GEMINI_API_KEY GEMINI_MODEL GEMINI_MODEL_FALLBACKS
sudo -E python3 <<'PY'
import os
import re
from pathlib import Path

path = Path(os.environ["API_ENV"])
keys = {
    "GEMINI_API_KEY": os.environ["GEMINI_API_KEY"],
    "GEMINI_MODEL": os.environ["GEMINI_MODEL"],
    "GEMINI_MODEL_FALLBACKS": os.environ["GEMINI_MODEL_FALLBACKS"],
}

text = path.read_text(encoding="utf-8") if path.exists() else ""
for key, val in keys.items():
    pat = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
    line = f"{key}={val}\n"
    if pat.search(text):
        text = pat.sub(line.rstrip("\n"), text, count=1)
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        text += line
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(text, encoding="utf-8")
print(f"OK: {path} — GEMINI_* yangilandi.")
PY

sudo chmod 600 "$API_ENV"
sudo chown root:root "$API_ENV" 2>/dev/null || true
echo "Keyingi qadam: sudo systemctl restart onlinetest-api onlinetest-realtime"
