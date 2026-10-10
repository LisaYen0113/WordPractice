import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createFolder, deleteFolder, fetchFolders, renameFolder } from "../api/folders";
import { apiErrorMessage } from "../utils/errors";
import { validateFolderName } from "../utils/validation";

/**
 * 資料夾清單資料層:
 * - 初次 mount 抓 GET /folders
 * - 舊請求晚回來時丟棄(React 19 StrictMode 會雙跑 effect,也用同一機制防護)
 * - 寫入以伺服器回傳值為準;失敗保留原狀 + actionError,並回 false 讓呼叫端決定後續
 */
export default function useFolders() {
  const [status, setStatus] = useState("loading");
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [pending, setPending] = useState(false);

  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setStatus("loading");
    setError(null);
    try {
      const rows = await fetchFolders();
      if (requestIdRef.current !== requestId) {
        return;
      }
      setFolders(rows.map((row) => ({ id: row.id, name: row.name })));
      setStatus("ready");
    } catch (err) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setError(apiErrorMessage(err, "載入資料夾失敗,請稍後再試"));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      // 作廢所有進行中的請求(unmount 或 StrictMode 的第一次 effect)
      requestIdRef.current += 1;
    };
  }, [load]);

  // 三個寫入共用同一段流程:驗證 → 打 API → 更新清單 → 回報成功與否
  const runWrite = useCallback(async (action) => {
    setPending(true);
    setActionError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setActionError(apiErrorMessage(err));
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  const addFolder = useCallback(
    (name) => {
      const checked = validateFolderName(name);
      if (!checked.ok) {
        // 前端預檢擋掉明顯無效的輸入,免得白打一趟 422
        setActionError(checked.error);
        return Promise.resolve(false);
      }
      return runWrite(async () => {
        const row = await createFolder(checked.value);
        setFolders((prev) => [...prev, { id: row.id, name: row.name }]);
      });
    },
    [runWrite]
  );

  const renameFolderById = useCallback(
    (folderId, name) => {
      const checked = validateFolderName(name);
      if (!checked.ok) {
        setActionError(checked.error);
        return Promise.resolve(false);
      }
      return runWrite(async () => {
        const row = await renameFolder(folderId, checked.value);
        setFolders((prev) =>
          prev.map((folder) =>
            folder.id === folderId ? { ...folder, name: row.name } : folder
          )
        );
      });
    },
    [runWrite]
  );

  const removeFolder = useCallback(
    (folderId) =>
      runWrite(async () => {
        await deleteFolder(folderId);
        setFolders((prev) => prev.filter((folder) => folder.id !== folderId));
      }),
    [runWrite]
  );

  return useMemo(
    () => ({
      status,
      folders,
      error,
      reload: load,
      pending,
      actionError,
      addFolder,
      renameFolderById,
      removeFolder,
    }),
    [
      status,
      folders,
      error,
      load,
      pending,
      actionError,
      addFolder,
      renameFolderById,
      removeFolder,
    ]
  );
}
