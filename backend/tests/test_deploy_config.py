"""部署設定檔的護欄。放在後端測試是因為這裡是唯一會固定跑測試的地方,
不為了驗幾個設定檔另建一套前端測試工具。

2026-10-11 從 Fly 換到 Vercel:原本 5 條盯 fly.toml 的測試已無對象,
改寫成盯 Vercel 的兩份設定(前端 rewrite + 後端函式設定)。"""
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_VERCEL_JSON = REPO_ROOT / "frontend" / "my-app" / "vercel.json"
BACKEND_VERCEL_JSON = BACKEND_DIR / "vercel.json"
BACKEND_ENTRYPOINT = BACKEND_DIR / "api" / "index.py"
DOCKERFILE = BACKEND_DIR / "Dockerfile"

# 會被人手動填值的設定檔。CHANGEME 殘留一律紅燈。
DEPLOY_CONFIGS = [FRONTEND_VERCEL_JSON, BACKEND_VERCEL_JSON, DOCKERFILE]


# --- Dockerfile / .dockerignore:Vercel 用不到,但仍是逃生口,留著釘 ---


def _dockerignore_lines() -> set:
    text = (BACKEND_DIR / ".dockerignore").read_text(encoding="utf-8")
    return {ln.strip() for ln in text.splitlines() if ln.strip()}


def test_dockerignore_excludes_env():
    """少了這行,backend/.env 的 service_role key 會被打進 image"""
    assert ".env" in _dockerignore_lines()


def test_dockerignore_excludes_venv():
    assert "venv/" in _dockerignore_lines()


def test_dockerfile_listens_on_8080_with_single_worker():
    dockerfile = DOCKERFILE.read_text(encoding="utf-8")

    assert '"--port", "8080"' in dockerfile
    assert '"--workers", "1"' in dockerfile


def test_dockerfile_uses_python_312():
    assert DOCKERFILE.read_text(encoding="utf-8").splitlines()[0].strip() == (
        "FROM python:3.12-slim"
    )


def test_fly_cleanup_removed_toml_but_kept_dockerfile():
    """使用者裁定「刪 fly.toml,留 Dockerfile」。留下的理由跟 Fly 無關:
    Vercel 的 Python runtime 若跑不動這個 app,Dockerfile 是改投 Render 的現成逃生口
    (裡面本來就是 uvicorn app.main:app,不需要為了換平台改一個字)"""
    assert not (BACKEND_DIR / "fly.toml").exists()
    assert DOCKERFILE.exists()


# --- 前端:rewrite 代理 ---


def _frontend_config() -> dict:
    return json.loads(FRONTEND_VERCEL_JSON.read_text(encoding="utf-8"))


def _api_rewrite() -> dict:
    matches = [
        r for r in _frontend_config()["rewrites"] if r["source"] == "/api/:path*"
    ]

    assert len(matches) == 1, f"應該恰好一條 /api/:path* rewrite,實際 {len(matches)} 條"
    return matches[0]


def test_vercel_rewrites_api_prefix_to_the_backend_project():
    """:path* 會吃掉 /api 前綴,所以後端路由維持 /words、/tests 不動"""
    assert _api_rewrite()["destination"].endswith("/:path*")


def test_vercel_rewrite_destination_has_no_placeholder():
    """手動填值時最容易漏的一格:沒填就整個網站的 /api 打到不存在的位址"""
    destination = _api_rewrite()["destination"]

    assert "CHANGEME" not in destination
    assert urlparse(destination).hostname


def test_vercel_rewrite_destination_is_a_vercel_app():
    """指回 *.fly.dev 或 localhost 都是舊設定殘留"""
    host = urlparse(_api_rewrite()["destination"]).hostname

    assert host.endswith(".vercel.app")


def test_vercel_rewrite_does_not_leak_api_prefix_to_backend():
    """destination 若變成 .../api/:path*,後端會收到 /api/words/deck → 全部 404。
    換目的地時最容易犯的錯,而其他護欄不會發現。"""
    destination = _api_rewrite()["destination"]

    assert "/api/" not in destination
    assert not destination.endswith("/api")


def test_vercel_disables_rewrite_caching_for_api():
    """Vercel 對新專案預設採信外部來源的 cache 標頭 —— /words/deck 是
    每個使用者自己的單字,被 CDN 快取就是跨使用者外洩"""
    headers = _frontend_config()["headers"]
    api_headers = [h for h in headers if h["source"] == "/api/:path*"]

    assert len(api_headers) == 1
    keys = {h["key"]: h["value"] for h in api_headers[0]["headers"]}
    assert keys["x-vercel-enable-rewrite-caching"] == "0"


def test_vercel_caching_optout_covers_every_rewrite():
    """改 rewrite 的 source 卻忘了改 headers 的 source,就會無聲漏掉快取防護"""
    config = _frontend_config()
    header_sources = {h["source"] for h in config["headers"]}

    for rewrite in config["rewrites"]:
        assert rewrite["source"] in header_sources


# --- 後端:Vercel 函式設定 ---


def _backend_config() -> dict:
    return json.loads(BACKEND_VERCEL_JSON.read_text(encoding="utf-8"))


def test_backend_routes_every_path_to_the_entrypoint():
    """api/index.py 這個單一檔名不會自動吃掉 /words/deck。
    少了 catch-all rewrite,除了 /api/index 以外的路徑全部 404"""
    rewrites = _backend_config()["rewrites"]

    assert rewrites == [{"source": "/(.*)", "destination": "/api/index"}]


def test_backend_entrypoint_exposes_an_asgi_app():
    """Vercel 的 Python runtime 靠偵測名為 app 的 ASGI 物件接手。
    這個檔案沒有 app,整個後端就不存在。

    用子行程驗(與 test_data_dir.py 同手法):要一個乾淨的 import 環境。
    `sys.path.insert(0, 'api')` 模擬 Vercel 從 api/ 底下載入這個檔案的處境,
    而 `from app.main import app` 要能在 cwd = backend/ 時走得通。
    """
    assert BACKEND_ENTRYPOINT.exists(), "backend/api/index.py 不存在,Vercel 找不到函式"

    probe = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; sys.path.insert(0, 'api');"
            " from index import app;"
            " print(type(app).__name__)",
        ],
        cwd=BACKEND_DIR,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
    )

    assert probe.returncode == 0, probe.stderr
    assert probe.stdout.strip().splitlines()[-1] == "FastAPI"


def test_no_changeme_left_in_deploy_configs():
    """佔位符沒填就紅燈 —— 這是舊護欄最核心的價值,換平台不能弄丟。
    逐檔檢查才能指名是哪一份還沒填。"""
    still_placeholder = [
        str(path.relative_to(REPO_ROOT))
        for path in DEPLOY_CONFIGS
        if "CHANGEME" in path.read_text(encoding="utf-8")
    ]

    assert still_placeholder == []
