// 資料夾相關端點。純薄包裝,錯誤處理全交給 client。
import { apiRequest } from "./client";

export function fetchFolders() {
  return apiRequest("/folders");
}

export function createFolder(name) {
  return apiRequest("/folders", { method: "POST", body: { name } });
}

export function renameFolder(folderId, name) {
  return apiRequest(`/folders/${folderId}`, { method: "PATCH", body: { name } });
}

export function deleteFolder(folderId) {
  return apiRequest(`/folders/${folderId}`, { method: "DELETE" });
}
