import { apiRequest } from "./client";
import { createFolder, deleteFolder, fetchFolders, renameFolder } from "./folders";

jest.mock("./client", () => ({
  apiRequest: jest.fn(),
}));

beforeEach(() => {
  apiRequest.mockReset(); // CRA resetMocks:true → 每個 test 前都要重設實作
});

// 釘住:路徑打成 /folder(少 s)或方法不是預設 GET,清單永遠載不出來。
test("fetchFolders 打 GET /folders", async () => {
  apiRequest.mockResolvedValue([]);

  await expect(fetchFolders()).resolves.toEqual([]);
  expect(apiRequest).toHaveBeenCalledWith("/folders");
});

// 釘住:名稱沒包成 { name } 就往 body 塞(例如直接傳字串),後端收到缺欄位 → 422 建不出資料夾。
test("createFolder 把名稱放進 POST body", async () => {
  apiRequest.mockResolvedValue({ id: "f-1", name: "TOEIC" });

  await createFolder("TOEIC");

  expect(apiRequest).toHaveBeenCalledWith("/folders", {
    method: "POST",
    body: { name: "TOEIC" },
  });
});

// 釘住:改名用 POST 而非 PATCH(後端 405),或資料夾 id 沒進路徑 → 改到別的資料夾。
test("renameFolder 用 PATCH 送出 id 與新名稱", async () => {
  apiRequest.mockResolvedValue({ id: "f-1", name: "新名字" });

  await renameFolder("f-1", "新名字");

  expect(apiRequest).toHaveBeenCalledWith("/folders/f-1", {
    method: "PATCH",
    body: { name: "新名字" },
  });
});

// 釘住:id 沒進路徑就會打到 /folders(刪掉整個清單),或方法寫錯 → 刪不掉。
test("deleteFolder 用 DELETE 打到該資料夾的路徑", async () => {
  apiRequest.mockResolvedValue(null);

  await deleteFolder("f-1");

  expect(apiRequest).toHaveBeenCalledWith("/folders/f-1", { method: "DELETE" });
});
