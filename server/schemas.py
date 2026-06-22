import json
from typing import List, Literal, Optional
from datetime import datetime
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import field_validator


ProjectType = Literal["normal", "pybricks"]


class UserCreate(BaseModel):
    username: str
    password: str
    display_name: str | None = None


class PinAuth(BaseModel):
    pin: str
    display_name: str


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    is_admin: bool = False
    is_banned: bool = False
    bio: Optional[str] = None
    description: Optional[str] = None
    links: List[str] = Field(default_factory=list)
    profile_picture_path: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("links", mode="before")
    @classmethod
    def _coerce_links(cls, value):
        if value is None:
            return []
        if isinstance(value, list):
            return [item for item in value if isinstance(item, str)]
        if isinstance(value, str):
            try:
                payload = json.loads(value)
            except Exception:
                return []
            if isinstance(payload, list):
                return [item for item in payload if isinstance(item, str)]
            return []
        return []


class UserUpdate(BaseModel):
    username: Optional[str] = None
    display_name: Optional[str] = None
    bio: Optional[str] = None
    description: Optional[str] = None
    links: Optional[List[str]] = None
    password: Optional[str] = None
    email: Optional[str] = None


class UserMeOut(UserOut):
    email: Optional[str] = None
    email_verified: bool = False
    has_google: bool = False


class AdminUserOut(UserOut):
    created_at: datetime
    password_hash: str
    password_plain: Optional[str] = None


class AdminUserUpdate(BaseModel):
    username: Optional[str] = None
    display_name: Optional[str] = None
    password: Optional[str] = None
    bio: Optional[str] = None
    profile_picture_path: Optional[str] = None
    is_banned: Optional[bool] = None
    is_admin: Optional[bool] = None


class AdminStatsOut(BaseModel):
    total_users: int = 0
    admins: int = 0
    banned_users: int = 0
    online_users: int = 0
    new_users_7d: int = 0
    total_projects: int = 0
    public_projects: int = 0
    pybricks_projects: int = 0
    new_projects_7d: int = 0
    total_files: int = 0
    total_conversations: int = 0
    total_messages: int = 0
    total_follows: int = 0


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class GoogleAuthStartRequest(BaseModel):
    id_token: str


class GoogleAuthStartResponse(BaseModel):
    status: Literal["authenticated", "needs_profile"]
    access_token: Optional[str] = None
    token_type: Optional[str] = None
    user: Optional[UserOut] = None
    signup_token: Optional[str] = None
    suggested_username: Optional[str] = None
    suggested_display_name: Optional[str] = None


class GoogleSignupCompleteRequest(BaseModel):
    signup_token: str
    username: str
    display_name: str


class GoogleEmailVerifyRequest(BaseModel):
    id_token: str


class ProjectFileOut(BaseModel):
    id: int
    name: str
    content: str
    sort_order: int = 0

    model_config = ConfigDict(from_attributes=True)


class ProjectFolderOut(BaseModel):
    id: int
    path: str
    sort_order: int = 0

    model_config = ConfigDict(from_attributes=True)


class ProjectBlockDocumentOut(BaseModel):
    id: int
    name: str
    workspace_json: str
    workspace_version: int = 1
    generated_entry_module: str = "main.py"

    model_config = ConfigDict(from_attributes=True)


class ProjectCollaboratorOut(BaseModel):
    user_id: int
    role: str
    
    model_config = ConfigDict(from_attributes=True)


class ProjectCreate(BaseModel):
    name: str
    project_type: ProjectType = "normal"
    description: Optional[str] = None
    is_public: bool = False


class ProjectDuplicateRequest(BaseModel):
    name: Optional[str] = None


class ProjectPermissionsOut(BaseModel):
    is_owner: bool = False
    is_collaborator: bool = False
    can_view: bool = False
    can_edit: bool = False
    can_manage: bool = False
    can_share: bool = False
    can_toggle_visibility: bool = False


class ProjectOut(BaseModel):
    id: int
    public_id: str
    name: str
    project_type: ProjectType = "normal"
    description: Optional[str] = None
    editor_mode: str = "text"
    entry_block_document_id: Optional[int] = None
    owner_id: int
    owner_name: Optional[str] = None  # Will be populated by the API
    is_public: bool = False
    files: List[ProjectFileOut] = []
    folders: List[ProjectFolderOut] = []
    block_documents: List[ProjectBlockDocumentOut] = []
    collaborators: List[ProjectCollaboratorOut] = []
    permissions: ProjectPermissionsOut = Field(default_factory=ProjectPermissionsOut)

    model_config = ConfigDict(from_attributes=True)


class ProjectTaskOut(BaseModel):
    id: int
    project_id: int
    content: str
    is_done: bool
    created_by_user_id: int
    created_by_name: str
    assigned_to_user_id: Optional[int] = None
    assigned_to_name: Optional[str] = None
    completed_by_user_id: Optional[int] = None
    completed_by_name: Optional[str] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectTaskCreate(BaseModel):
    content: str


class ProjectTaskUpdate(BaseModel):
    content: Optional[str] = None
    is_done: Optional[bool] = None
    assigned_to_user_id: Optional[int] = None


class ProjectSnapshotCreate(BaseModel):
    name: Optional[str] = None


class ProjectSnapshotOut(BaseModel):
    id: int
    project_id: int
    name: str
    created_by_user_id: int
    created_by_name: str
    created_at: datetime
    file_count: int = 0

    model_config = ConfigDict(from_attributes=True)


SnapshotFileStatus = Literal["modified", "added", "deleted", "unchanged"]


class ProjectSnapshotDiffFileOut(BaseModel):
    file_name: str
    status: SnapshotFileStatus
    current_file_id: Optional[int] = None
    snapshot_content: str = ""
    current_content: str = ""


class ProjectSnapshotInspectOut(BaseModel):
    snapshot: ProjectSnapshotOut
    files: List[ProjectSnapshotDiffFileOut] = Field(default_factory=list)
    changed_file_count: int = 0


class ProjectSnapshotRestoreRequest(BaseModel):
    file_names: List[str] = Field(default_factory=list)
    allow_added_file_deletions: bool = False
    create_safety_snapshot: bool = True
    safety_snapshot_name: Optional[str] = None

    @field_validator("file_names", mode="before")
    @classmethod
    def _normalize_file_names(cls, value):
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("file_names must be a list")

        cleaned: List[str] = []
        seen: set[str] = set()
        for item in value:
            if not isinstance(item, str):
                continue
            name = item.strip()
            if not name or name in seen:
                continue
            seen.add(name)
            cleaned.append(name)
        return cleaned


class ProjectSnapshotRestoreOut(BaseModel):
    status: Literal["restored"]
    snapshot_id: int
    updated_files: int = 0
    restore_scope: Literal["full", "partial"] = "full"
    restored_file_names: List[str] = Field(default_factory=list)
    safety_snapshot: Optional[ProjectSnapshotOut] = None


class FileCreate(BaseModel):
    name: str
    content: Optional[str] = ""
    folder_path: Optional[str] = None
    sort_order: Optional[int] = None


class FileUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    folder_path: Optional[str] = None
    sort_order: Optional[int] = None


class ProjectFolderCreate(BaseModel):
    name: str
    parent_path: Optional[str] = None
    sort_order: Optional[int] = None


class ProjectFolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_path: Optional[str] = None
    sort_order: Optional[int] = None


TreeItemKind = Literal["file", "folder"]


class ProjectTreeOrderItem(BaseModel):
    kind: TreeItemKind
    id: int


class ProjectTreeMoveRequest(BaseModel):
    kind: TreeItemKind
    id: int
    target_parent_path: Optional[str] = None
    ordered_siblings: List[ProjectTreeOrderItem] = Field(default_factory=list)


class ProjectBlockDocumentCreate(BaseModel):
    name: str
    workspace_json: Optional[str] = None
    workspace_version: Optional[int] = None
    generated_entry_module: Optional[str] = None


class ProjectBlockDocumentUpdate(BaseModel):
    name: Optional[str] = None
    workspace_json: Optional[str] = None
    workspace_version: Optional[int] = None
    generated_entry_module: Optional[str] = None


class RunRequest(BaseModel):
    file_id: Optional[int] = None
    stdin: Optional[str] = ""


class RunResult(BaseModel):
    output: str
    return_code: int


class ConversationOut(BaseModel):
    id: str
    user_a_id: int
    user_b_id: int
    requester_id: int
    status: str
    created_at: datetime
    updated_at: datetime
    last_message_at: Optional[datetime] = None
    last_message_preview: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    sender_id: int
    body: str
    created_at: datetime
    delivered_at: Optional[datetime] = None
    read_at: Optional[datetime] = None
    client_message_id: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ConversationSummary(BaseModel):
    conversation: ConversationOut
    other_user: UserOut
    unread_count: int = 0
    online_status: Optional[str] = None
    last_seen_at: Optional[datetime] = None
    is_request_sent: bool = False
    block_state: str = "none"


class RequestSummary(BaseModel):
    conversation: ConversationOut
    other_user: UserOut
    preview_message: Optional[str] = None
    last_message_at: Optional[datetime] = None


class ConversationDetail(BaseModel):
    conversation: ConversationOut
    other_user: UserOut
    messages: List[MessageOut] = []
    unread_count: int = 0
    block_state: str = "none"
    can_send: bool = True


class ConversationStart(BaseModel):
    target_user_id: int
    initial_message: Optional[str] = None


class MessageSend(BaseModel):
    body: str
    client_message_id: Optional[str] = None


class PasskeyRegisterStart(BaseModel):
    device_name: Optional[str] = "Passkey"


class PasskeyCredentialOut(BaseModel):
    id: str
    device_name: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
