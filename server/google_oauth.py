import re
from typing import Any, Dict

from google.auth.transport import requests
from google.oauth2 import id_token

_VALID_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


def _normalize_email_verified(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() == "true"
    return False


def _suggest_username(email: str) -> str:
    local_part = (email.split("@", 1)[0] if email else "").lower()
    candidate = re.sub(r"[^a-z0-9]", "", local_part)
    return candidate or "user"


def verify_google_id_token(raw_id_token: str, client_id: str) -> Dict[str, Any]:
    if not raw_id_token:
        raise ValueError("Missing Google ID token")
    if not client_id:
        raise ValueError("Google OAuth client ID is not configured")

    try:
        claims = id_token.verify_oauth2_token(raw_id_token, requests.Request(), client_id)
    except Exception as exc:
        raise ValueError("Invalid Google token") from exc

    issuer = claims.get("iss")
    if issuer not in _VALID_ISSUERS:
        raise ValueError("Invalid Google token issuer")

    google_sub = claims.get("sub")
    email = (claims.get("email") or "").strip().lower()
    email_verified = _normalize_email_verified(claims.get("email_verified"))
    if not google_sub or not email:
        raise ValueError("Google token missing required identity fields")

    name = (claims.get("name") or "").strip()
    suggested_username = _suggest_username(email)
    suggested_display_name = name or suggested_username

    return {
        "google_sub": google_sub,
        "email": email,
        "email_verified": email_verified,
        "display_name": name,
        "suggested_username": suggested_username,
        "suggested_display_name": suggested_display_name,
    }
