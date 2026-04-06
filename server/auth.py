import os
from datetime import datetime, timedelta
from typing import Optional
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .database import SessionLocal
from . import models

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7
_raw_google_signup_expire_minutes = os.getenv("GOOGLE_SIGNUP_TOKEN_EXPIRE_MINUTES", "15").strip()
try:
    GOOGLE_SIGNUP_TOKEN_EXPIRE_MINUTES = max(1, int(_raw_google_signup_expire_minutes))
except ValueError:
    GOOGLE_SIGNUP_TOKEN_EXPIRE_MINUTES = 15

pwd_context = CryptContext(
    schemes=["pbkdf2_sha256"],
    deprecated="auto",
)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    # JWT subject must be a string for python-jose
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_google_signup_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=GOOGLE_SIGNUP_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "google_signup"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_google_signup_token(token: str) -> dict:
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    if payload.get("type") != "google_signup":
        raise JWTError("Invalid signup token type")
    return payload


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        try:
            user_id = int(user_id)
        except (TypeError, ValueError):
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise credentials_exception
    
    # Check for impersonation
    impersonator_id = payload.get("impersonator_id")
    if impersonator_id:
        user.impersonator_id = impersonator_id
        # Log access (simplified logging here, or rely on specific action logging)
        print(f"[AUDIT] Admin {impersonator_id} is impersonating {user.username} ({user.id})")
        
    return user


def get_optional_user(token: Optional[str] = Depends(oauth2_scheme_optional), db: Session = Depends(get_db)) -> Optional[models.User]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            return None
        try:
            user_id = int(user_id)
        except (TypeError, ValueError):
            return None
    except JWTError:
        return None
    return db.query(models.User).filter(models.User.id == user_id).first()
