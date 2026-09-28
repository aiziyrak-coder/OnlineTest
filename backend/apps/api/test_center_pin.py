"""The common centre PIN is mounted as a secret, never included in the image."""
from pathlib import Path

PIN_PATH = Path('/run/secrets/test_center_pin')

def configured_center_pin():
    try:
        pin = PIN_PATH.read_text(encoding='utf-8').strip()
    except OSError:
        return None
    return pin if pin.isascii() and pin.isdigit() and 4 <= len(pin) <= 8 else None

def center_start_allowed(session):
    return bool(session and session.get('test_center_mode'))
