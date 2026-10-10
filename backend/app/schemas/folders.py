# app/schemas/folders.py
import uuid
from datetime import datetime
from typing import Annotated, Optional

from pydantic import BaseModel, StringConstraints

# 名稱會原樣回傳、顯示與寫進 log → 擋掉控制字元、零寬、bidi 與 BOM。
# 與前端 utils/validation.js 的 UNSAFE_CHAR_PATTERN 同一組碼位。
_UNSAFE_NAME_CHARS = (
    r"\x00-\x1f\x7f-\x9f"
    r"\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff"
)

# strip 後 1~50 字。strip_whitespace 會先去掉頭尾空白,
# 所以「 TOEIC 」與「TOEIC」在 DB 的 unique(user_id, name) 眼裡是同一個名字。
FolderName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=50,
        pattern=rf"^[^{_UNSAFE_NAME_CHARS}]+$",
    ),
]


class FolderCreateRequest(BaseModel):
    name: FolderName


class FolderRenameRequest(BaseModel):
    name: FolderName


class FolderResponse(BaseModel):
    id: uuid.UUID
    name: str
    created_at: datetime


class SetFolderRequest(BaseModel):
    # 沒有預設值 → pydantic v2 視為「必填但可為 null」:
    # {} 會 422(前端忘了帶),{"folder_id": null} 才是「移回未分類」
    folder_id: Optional[uuid.UUID]


class SetFolderResponse(BaseModel):
    word_id: uuid.UUID
    folder_id: Optional[uuid.UUID] = None
