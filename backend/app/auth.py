from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import text
from sqlalchemy.orm import Session

from .db import get_db
from .security import decode_token, verify_password

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")


def authenticate_user(db: Session, username: str, password: str):
    query = text(
        "SELECT username, password_hash, role, is_active "
        "FROM geoportal.app_users WHERE username = :username"
    )
    row = db.execute(query, {"username": username}).mappings().first()
    if not row:
        return None
    if not row["is_active"]:
        return None
    if not verify_password(password, row["password_hash"]):
        return None
    return row


def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales invalidas",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        username = payload.get("sub")
        role = payload.get("role")
        if not username or not role:
            raise credentials_exception
        return {"username": username, "role": role}
    except Exception as exc:
        raise credentials_exception from exc


def require_admin(user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Se requiere rol admin")
    return user
