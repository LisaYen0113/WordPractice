# app/routes/folders_route.py
import uuid

from fastapi import APIRouter, Depends, Response

from app.core.rate_limit import rate_limited
from app.schemas.folders import (
    FolderCreateRequest,
    FolderRenameRequest,
    FolderResponse,
)
from app.services.folders_service import (
    add_folder,
    get_folders,
    remove_folder,
    update_folder,
)

router = APIRouter()

# 只讀自己的列,與 /deck 同級
FOLDERS_READ_REQUESTS_PER_MINUTE = 60
# 建立/改名/刪除會改動分類結構,給較緊的每使用者上限
FOLDERS_WRITE_REQUESTS_PER_MINUTE = 20

# 三個寫入端點「共用同一個依賴實例」。
# 注意:rate_limited() 每次呼叫都會建一個新的 FixedWindowLimiter(各自的計數 dict),
# 寫成 Depends(rate_limited("folders_write", N)) 的話三個端點會各自 20/min,
# 而不是合計 20/min → 一定要在模組層建一次。
_folders_write_limit = rate_limited(
    "folders_write", FOLDERS_WRITE_REQUESTS_PER_MINUTE
)


# 路徑用 "" 不是 "/":main.py 關了 redirect_slashes,寫 "/" 會變成 /folders/ 而 /folders 404
@router.get("", response_model=list[FolderResponse])
def api_list_folders(
    user_id: uuid.UUID = Depends(
        rate_limited("folders_read", FOLDERS_READ_REQUESTS_PER_MINUTE)
    ),
):
    """呼叫者的全部資料夾(created_at 升冪)"""
    return get_folders(user_id)


@router.post("", response_model=FolderResponse)
def api_create_folder(
    request: FolderCreateRequest,
    user_id: uuid.UUID = Depends(_folders_write_limit),
):
    """新增資料夾;同名 → 409"""
    return add_folder(user_id, request.name)


@router.patch("/{folder_id}", response_model=FolderResponse)
def api_rename_folder(
    folder_id: uuid.UUID,
    request: FolderRenameRequest,
    user_id: uuid.UUID = Depends(_folders_write_limit),
):
    """改名;同名 → 409,不是自己的資料夾 → 404"""
    return update_folder(user_id, folder_id, request.name)


@router.delete("/{folder_id}", status_code=204)
def api_delete_folder(
    folder_id: uuid.UUID,
    user_id: uuid.UUID = Depends(_folders_write_limit),
):
    """刪除資料夾;裡面的字自動退回「未分類」,複習進度不動"""
    remove_folder(user_id, folder_id)
    return Response(status_code=204)
