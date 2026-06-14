import os
import uuid


os.environ.setdefault(
    "SECRET_KEY",
    "test-secret-key-for-pycollab-security-regression-tests-0123456789",
)
os.environ.setdefault("AUTH_RATE_LIMIT_PER_MINUTE", "100000")
os.environ.setdefault("JOIN_CODE_RATE_LIMIT_PER_MINUTE", "100000")
os.environ["DATABASE_URL"] = f"sqlite:////tmp/pycollab_test_suite_{uuid.uuid4().hex}.db"

# Lock the application to one engine before test modules assign their
# file-specific DATABASE_URL values during collection.
import server.main  # noqa: E402,F401
