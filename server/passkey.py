import os
import threading

from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    UserVerificationRequirement,
    ResidentKeyRequirement,
    PublicKeyCredentialDescriptor,
)

# Explicit overrides via environment variables.  When not set the values are
# derived at request time from the incoming ``Host`` / ``Origin`` headers so
# that passkeys work on *any* domain without extra configuration.
_ENV_RP_ID = os.getenv("WEBAUTHN_RP_ID")
_ENV_RP_ORIGIN = os.getenv("WEBAUTHN_RP_ORIGIN")
RP_NAME = os.getenv("WEBAUTHN_RP_NAME", "PyCollab")


def get_rp_id(request_host: str | None = None) -> str:
    """Return the effective Relying Party ID.

    If ``WEBAUTHN_RP_ID`` is set it is returned directly.  Otherwise the
    hostname is extracted from *request_host* (``Host`` header value, may
    include a port) so that passkeys work on any deployment domain.
    """
    if _ENV_RP_ID:
        return _ENV_RP_ID
    if request_host:
        # Strip port if present (e.g. "example.com:8000" -> "example.com")
        return request_host.split(":")[0]
    return "localhost"


def get_rp_origin(request_origin: str | None = None, request_host: str | None = None) -> str:
    """Return the effective Relying Party origin(s).

    If ``WEBAUTHN_RP_ORIGIN`` is set it is returned directly.  Otherwise the
    origin is derived from the request so that passkeys work on any deployment
    domain without extra configuration.
    """
    if _ENV_RP_ORIGIN:
        return _ENV_RP_ORIGIN
    if request_origin:
        return request_origin
    if request_host:
        # Best-effort: assume https unless it looks like localhost dev
        host_no_port = request_host.split(":")[0]
        scheme = "http" if host_no_port in ("localhost", "127.0.0.1") else "https"
        return f"{scheme}://{request_host}"
    return "http://localhost"

# Thread-safe in-memory challenge store (maps user_id -> challenge bytes).
# Suitable for single-process deployments. For multi-process deployments
# (e.g. gunicorn with multiple workers), use Redis or database-backed storage.
_challenges: dict[int | str, bytes] = {}
_challenges_lock = threading.Lock()


def store_challenge(key: int | str, challenge: bytes) -> None:
    with _challenges_lock:
        _challenges[key] = challenge


def get_challenge(key: int | str) -> bytes | None:
    with _challenges_lock:
        return _challenges.pop(key, None)


def create_registration_options(user_id: int, username: str, display_name: str, existing_credential_ids: list[bytes], request_host: str | None = None):
    """Generate WebAuthn registration options for an authenticated user."""
    rp_id = get_rp_id(request_host)
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=RP_NAME,
        user_name=username,
        user_id=user_id.to_bytes(8, "big"),
        user_display_name=display_name,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=cred_id)
            for cred_id in existing_credential_ids
        ],
    )
    store_challenge(user_id, options.challenge)
    return options


def verify_registration(user_id: int, credential_json: str, request_host: str | None = None, request_origin: str | None = None):
    """Verify the registration response from the browser."""
    expected_challenge = get_challenge(user_id)
    if expected_challenge is None:
        raise ValueError("No pending registration challenge")

    rp_id = get_rp_id(request_host)
    rp_origin = get_rp_origin(request_origin, request_host)
    origins = [o.strip() for o in rp_origin.split(",")]

    return verify_registration_response(
        credential=credential_json,
        expected_challenge=expected_challenge,
        expected_rp_id=rp_id,
        expected_origin=origins,
    )


def create_authentication_options(credential_ids: list[bytes], request_host: str | None = None):
    """Generate WebAuthn authentication options (login)."""
    rp_id = get_rp_id(request_host)
    options = generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=[
            PublicKeyCredentialDescriptor(id=cred_id)
            for cred_id in credential_ids
        ] if credential_ids else None,
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    # Store challenge keyed by "login" + base64 of challenge for retrieval
    store_challenge("login_" + options.challenge.hex(), options.challenge)
    return options


def verify_authentication(
    credential_json: str,
    challenge_hex: str,
    credential_public_key: bytes,
    credential_current_sign_count: int,
    request_host: str | None = None,
    request_origin: str | None = None,
):
    """Verify the authentication response from the browser."""
    expected_challenge = get_challenge("login_" + challenge_hex)
    if expected_challenge is None:
        raise ValueError("No pending authentication challenge")

    rp_id = get_rp_id(request_host)
    rp_origin = get_rp_origin(request_origin, request_host)
    origins = [o.strip() for o in rp_origin.split(",")]

    return verify_authentication_response(
        credential=credential_json,
        expected_challenge=expected_challenge,
        expected_rp_id=rp_id,
        expected_origin=origins,
        credential_public_key=credential_public_key,
        credential_current_sign_count=credential_current_sign_count,
    )
