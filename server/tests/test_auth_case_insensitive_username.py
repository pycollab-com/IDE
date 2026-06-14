import os
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = f"sqlite:////tmp/test_auth_case_insensitive_{uuid.uuid4().hex}.db"

import server.main as main_module  # noqa: E402
from server.main import app  # noqa: E402
from server.database import Base, engine  # noqa: E402


Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

def _reset_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_secret_key_rejects_default_values(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "change-me")
    with pytest.raises(RuntimeError):
        main_module.auth._load_secret_key()


def test_register_rejects_duplicate_username_different_case():
    _reset_db()
    client = TestClient(app)

    first = client.post(
        "/auth/register",
        json={"username": "tom", "password": "testpass123", "display_name": "Tom"},
    )
    assert first.status_code == 200

    second = client.post(
        "/auth/register",
        json={"username": "Tom", "password": "testpass123", "display_name": "Tom 2"},
    )
    assert second.status_code == 400
    assert "already registered" in second.json()["detail"]

    client.close()


def test_login_accepts_username_regardless_of_case():
    _reset_db()
    client = TestClient(app)

    register = client.post(
        "/auth/register",
        json={"username": "tom", "password": "testpass123", "display_name": "Tom"},
    )
    assert register.status_code == 200

    login = client.post(
        "/auth/login",
        data={"username": "Tom", "password": "testpass123"},
    )
    assert login.status_code == 200
    assert login.json()["user"]["username"] == "tom"

    client.close()


def test_login_attempts_are_rate_limited(monkeypatch):
    _reset_db()
    main_module._clear_rate_limit_buckets()
    monkeypatch.setattr(main_module, "AUTH_RATE_LIMIT_PER_MINUTE", 2)
    client = TestClient(app)

    first = client.post(
        "/auth/login",
        data={"username": "missing", "password": "wrong"},
    )
    second = client.post(
        "/auth/login",
        data={"username": "missing", "password": "wrong"},
    )
    third = client.post(
        "/auth/login",
        data={"username": "missing", "password": "wrong"},
    )

    assert first.status_code == 400
    assert second.status_code == 400
    assert third.status_code == 429
    assert third.json()["detail"] == "Rate limit exceeded"

    client.close()
    main_module._clear_rate_limit_buckets()


def test_auth_identity_rate_limit_cannot_be_reset_by_changing_ip(monkeypatch):
    main_module._clear_rate_limit_buckets()
    monkeypatch.setattr(main_module, "AUTH_RATE_LIMIT_PER_MINUTE", 1)
    first_request = SimpleNamespace(headers={}, client=SimpleNamespace(host="198.51.100.10"))
    second_request = SimpleNamespace(headers={}, client=SimpleNamespace(host="198.51.100.11"))

    main_module._enforce_auth_rate_limit(first_request, "login", "TargetUser")

    with pytest.raises(main_module.HTTPException) as exc_info:
        main_module._enforce_auth_rate_limit(second_request, "login", "targetuser")

    assert exc_info.value.status_code == 429
    main_module._clear_rate_limit_buckets()


def test_client_host_uses_forwarded_for_from_trusted_proxy():
    trusted_proxies = main_module._parse_trusted_proxy_networks("10.0.0.0/8")
    request = SimpleNamespace(
        headers={
            "x-forwarded-for": "198.51.100.20, 10.1.2.3",
            "x-real-ip": "203.0.113.5",
        },
        client=SimpleNamespace(host="10.9.8.7"),
    )

    assert main_module._client_host(request, trusted_proxies) == "198.51.100.20"


def test_client_host_ignores_forwarded_headers_from_untrusted_peer():
    trusted_proxies = main_module._parse_trusted_proxy_networks("10.0.0.0/8")
    request = SimpleNamespace(
        headers={
            "x-forwarded-for": "198.51.100.20, 10.1.2.3",
            "x-real-ip": "203.0.113.5",
        },
        client=SimpleNamespace(host="198.51.100.99"),
    )

    assert main_module._client_host(request, trusted_proxies) == "198.51.100.99"


def test_client_host_falls_back_to_real_ip_when_forwarded_for_has_only_trusted_proxies():
    trusted_proxies = main_module._parse_trusted_proxy_networks("10.0.0.0/8")
    request = SimpleNamespace(
        headers={
            "x-forwarded-for": "10.1.2.3, 10.2.3.4",
            "x-real-ip": "203.0.113.5",
        },
        client=SimpleNamespace(host="10.9.8.7"),
    )

    assert main_module._client_host(request, trusted_proxies) == "203.0.113.5"


def test_socket_remote_addr_uses_same_trusted_proxy_resolution(monkeypatch):
    trusted_proxies = main_module._parse_trusted_proxy_networks("10.0.0.0/8")
    monkeypatch.setattr(main_module, "TRUSTED_PROXY_NETWORKS", trusted_proxies)

    remote_addr = main_module._socket_remote_addr(
        {
            "REMOTE_ADDR": "10.9.8.7",
            "HTTP_X_FORWARDED_FOR": "198.51.100.20, 10.1.2.3",
            "HTTP_X_REAL_IP": "203.0.113.5",
        }
    )

    assert remote_addr == "198.51.100.20"


def test_rate_limit_buckets_evict_stale_entries(monkeypatch):
    main_module._clear_rate_limit_buckets()
    monkeypatch.setattr(main_module, "RATE_LIMIT_BUCKET_TTL_SECONDS", 10.0)

    assert main_module._rate_limit_allowed("stale-key", 1, now=0.0) is True
    assert "stale-key" in main_module._RATE_LIMIT_BUCKETS
    assert main_module._rate_limit_allowed("fresh-key", 1, now=11.0) is True

    assert "stale-key" not in main_module._RATE_LIMIT_BUCKETS
    assert "fresh-key" in main_module._RATE_LIMIT_BUCKETS
    main_module._clear_rate_limit_buckets()


def test_rate_limit_buckets_enforce_max_size(monkeypatch):
    main_module._clear_rate_limit_buckets()
    monkeypatch.setattr(main_module, "RATE_LIMIT_BUCKET_TTL_SECONDS", 100.0)
    monkeypatch.setattr(main_module, "RATE_LIMIT_MAX_BUCKETS", 2)

    assert main_module._rate_limit_allowed("oldest-key", 1, now=0.0) is True
    assert main_module._rate_limit_allowed("middle-key", 1, now=1.0) is True
    assert main_module._rate_limit_allowed("newest-key", 1, now=2.0) is True

    assert len(main_module._RATE_LIMIT_BUCKETS) == 2
    assert "oldest-key" not in main_module._RATE_LIMIT_BUCKETS
    assert "newest-key" in main_module._RATE_LIMIT_BUCKETS
    main_module._clear_rate_limit_buckets()


def test_register_normalizes_username_to_lowercase():
    _reset_db()
    client = TestClient(app)

    res = client.post(
        "/auth/register",
        json={"username": "ToM", "password": "testpass123", "display_name": "Tom"},
    )
    assert res.status_code == 200
    assert res.json()["user"]["username"] == "tom"

    client.close()


def test_update_me_rejects_existing_username_with_different_case():
    _reset_db()
    client = TestClient(app)

    res_a = client.post(
        "/auth/register",
        json={"username": "tom", "password": "testpass123", "display_name": "Tom"},
    )
    assert res_a.status_code == 200

    res_b = client.post(
        "/auth/register",
        json={"username": "jerry", "password": "testpass123", "display_name": "Jerry"},
    )
    assert res_b.status_code == 200

    token = res_b.json()["access_token"]
    update = client.patch(
        "/users/me",
        json={"username": "Tom"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert update.status_code == 400
    assert "already taken" in update.json()["detail"]

    client.close()
