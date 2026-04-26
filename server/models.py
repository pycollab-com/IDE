import datetime as dt
import uuid
import random
import secrets
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, UniqueConstraint, Boolean, Index, LargeBinary, text
from sqlalchemy.orm import relationship
from .database import Base


PROJECT_PUBLIC_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
PROJECT_PUBLIC_ID_LETTERS = "abcdefghijklmnopqrstuvwxyz"
PROJECT_PUBLIC_ID_LENGTH = 20


def generate_project_public_id(length: int = PROJECT_PUBLIC_ID_LENGTH) -> str:
    if length < 2:
        raise ValueError("Project public ID length must be at least 2")
    return secrets.choice(PROJECT_PUBLIC_ID_LETTERS) + "".join(
        secrets.choice(PROJECT_PUBLIC_ID_ALPHABET) for _ in range(length - 1)
    )


class Follow(Base):
    __tablename__ = "follows"

    follower_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    followed_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("ix_follows_followed_id", "followed_id"),
    )


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=True)
    email_verified = Column(Boolean, default=False, nullable=False, server_default=text("false"))
    google_sub = Column(String, unique=True, index=True, nullable=True)
    password_hash = Column(String, nullable=False)
    # password_plain removed for security
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)
    display_name = Column(String, default="User", nullable=False, index=True)
    is_admin = Column(Boolean, default=False, nullable=False)
    
    # Profile fields
    bio = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    links = Column(Text, nullable=True)
    profile_picture_path = Column(String, nullable=True) # Path to local file

    projects = relationship("Project", back_populates="owner", cascade="all, delete-orphan")
    collaborations = relationship("ProjectCollaborator", back_populates="user", cascade="all, delete-orphan")
    
    # Social relationships
    followers = relationship(
        "User", 
        secondary="follows", 
        primaryjoin=id==Follow.followed_id,
        secondaryjoin=id==Follow.follower_id,
        backref="following"
    )


class UserCredential(Base):
    __tablename__ = "user_credentials"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    credential_id = Column(LargeBinary, nullable=False, unique=True)
    public_key = Column(LargeBinary, nullable=False)
    sign_count = Column(Integer, default=0, nullable=False)
    device_name = Column(String, default="Passkey", nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)

    user = relationship("User", backref="credentials")


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String, unique=True, nullable=False, index=True, default=generate_project_public_id)
    name = Column(String, nullable=False, index=True)
    project_type = Column(String, nullable=False, default="normal", server_default=text("'normal'"), index=True)
    editor_mode = Column(String, nullable=False, default="text", server_default=text("'text'"))
    entry_block_document_id = Column(
        Integer,
        ForeignKey("project_block_documents.id", use_alter=True, name="fk_projects_entry_block_document_id"),
        nullable=True,
        index=True,
    )
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow, nullable=False)
    is_public = Column(Boolean, default=False, nullable=False, index=True)
    description = Column(Text, nullable=True)
    share_pin = Column(String, unique=True, nullable=True, index=True)


    owner = relationship("User", back_populates="projects")
    files = relationship("ProjectFile", back_populates="project", cascade="all, delete-orphan")
    block_documents = relationship(
        "ProjectBlockDocument",
        back_populates="project",
        cascade="all, delete-orphan",
        foreign_keys="ProjectBlockDocument.project_id",
    )
    entry_block_document = relationship(
        "ProjectBlockDocument",
        foreign_keys=[entry_block_document_id],
        post_update=True,
    )
    collaborators = relationship("ProjectCollaborator", back_populates="project", cascade="all, delete-orphan")
    share_tokens = relationship("ProjectShareToken", back_populates="project", cascade="all, delete-orphan")
    tasks = relationship("ProjectTask", back_populates="project", cascade="all, delete-orphan")
    snapshots = relationship("ProjectSnapshot", back_populates="project", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_projects_public_name", "is_public", "name"),
        Index("ix_projects_owner_public", "owner_id", "is_public"),
    )


class ProjectFile(Base):
    __tablename__ = "project_files"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    content = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="files")

    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_project_file_name"),)


class ProjectBlockDocument(Base):
    __tablename__ = "project_block_documents"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    name = Column(String, nullable=False, default="Blocks")
    workspace_json = Column(Text, default="{}", nullable=False)
    workspace_version = Column(Integer, default=1, nullable=False)
    generated_entry_module = Column(String, default="main.py", nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="block_documents", foreign_keys=[project_id])

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_project_block_document_name"),
    )


class ProjectCollaborator(Base):
    __tablename__ = "project_collaborators"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String, default="editor", nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="collaborators")
    user = relationship("User", back_populates="collaborations")

    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_collaborator"),)


class ProjectShareToken(Base):
    __tablename__ = "project_share_tokens"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    token = Column(String, unique=True, nullable=False, default=lambda: f"{random.randint(0, 999999):06d}")
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="share_tokens")


class ProjectTask(Base):
    __tablename__ = "project_tasks"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    content = Column(String(240), nullable=False)
    is_done = Column(Boolean, default=False, nullable=False, index=True)
    created_by_user_id = Column(Integer, nullable=False, index=True)
    created_by_name = Column(String, nullable=False)
    assigned_to_user_id = Column(Integer, nullable=True, index=True)
    assigned_to_name = Column(String, nullable=True)
    completed_by_user_id = Column(Integer, nullable=True, index=True)
    completed_by_name = Column(String, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow, nullable=False)

    project = relationship("Project", back_populates="tasks")

    __table_args__ = (
        Index("ix_project_tasks_project_created", "project_id", "created_at"),
        Index("ix_project_tasks_project_done", "project_id", "is_done"),
    )


class ProjectSnapshot(Base):
    __tablename__ = "project_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    created_by_user_id = Column(Integer, nullable=False, index=True)
    created_by_name = Column(String, nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False, index=True)

    project = relationship("Project", back_populates="snapshots")
    files = relationship("ProjectSnapshotFile", back_populates="snapshot", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_project_snapshots_project_created", "project_id", "created_at"),
    )


class ProjectSnapshotFile(Base):
    __tablename__ = "project_snapshot_files"

    id = Column(Integer, primary_key=True, index=True)
    snapshot_id = Column(Integer, ForeignKey("project_snapshots.id"), nullable=False, index=True)
    file_name = Column(String, nullable=False)
    content = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)

    snapshot = relationship("ProjectSnapshot", back_populates="files")

    __table_args__ = (
        UniqueConstraint("snapshot_id", "file_name", name="uq_snapshot_file_name"),
        Index("ix_project_snapshot_files_snapshot_name", "snapshot_id", "file_name"),
    )


class Block(Base):
    __tablename__ = "blocks"

    blocker_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    blocked_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("ix_blocks_blocked_id", "blocked_id"),
    )


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_a_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    user_b_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    pair_key = Column(String, nullable=False, unique=True, index=True)
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String, nullable=False, default="pending")
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow, nullable=False)
    last_message_at = Column(DateTime, nullable=True)
    last_message_preview = Column(String, nullable=True)

    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_conversations_last_message_at", "last_message_at"),
    )


class Message(Base):
    __tablename__ = "messages"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String, ForeignKey("conversations.id"), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)
    delivered_at = Column(DateTime, nullable=True)
    read_at = Column(DateTime, nullable=True)
    client_message_id = Column(String, nullable=True)

    conversation = relationship("Conversation", back_populates="messages")

    __table_args__ = (
        Index("ix_messages_conversation_created_at", "conversation_id", "created_at"),
    )


class Presence(Base):
    __tablename__ = "presence"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    last_seen_at = Column(DateTime, default=dt.datetime.utcnow, nullable=False)
    status = Column(String, default="offline", nullable=False)
