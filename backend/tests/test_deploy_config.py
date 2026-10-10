"""部署設定檔的護欄。放在後端測試是因為這裡是唯一會固定跑測試的地方,
不為了驗四個設定檔另建一套前端測試工具。"""
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"


def _dockerignore_lines() -> set:
    text = (BACKEND_DIR / ".dockerignore").read_text(encoding="utf-8")
    return {ln.strip() for ln in text.splitlines() if ln.strip()}


def test_dockerignore_excludes_env():
    """少了這行,backend/.env 的 service_role key 會被打進 image"""
    assert ".env" in _dockerignore_lines()


def test_dockerignore_excludes_venv():
    assert "venv/" in _dockerignore_lines()


def test_dockerfile_listens_on_8080_with_single_worker():
    dockerfile = (BACKEND_DIR / "Dockerfile").read_text(encoding="utf-8")

    assert '"--port", "8080"' in dockerfile
    assert '"--workers", "1"' in dockerfile


def test_dockerfile_uses_python_312():
    dockerfile = (BACKEND_DIR / "Dockerfile").read_text(encoding="utf-8")

    assert dockerfile.splitlines()[0].strip() == "FROM python:3.12-slim"


def _fly_toml() -> str:
    return (BACKEND_DIR / "fly.toml").read_text(encoding="utf-8")


def test_fly_internal_port_matches_dockerfile():
    """兩邊不一致 = 部署後永遠不會健康"""
    dockerfile = (BACKEND_DIR / "Dockerfile").read_text(encoding="utf-8")
    docker_port = re.search(r'"--port",\s*"(\d+)"', dockerfile).group(1)
    fly_port = re.search(r"internal_port\s*=\s*(\d+)", _fly_toml()).group(1)

    assert docker_port == fly_port


def test_fly_data_dir_matches_volume_mount():
    """DATA_DIR 沒對上掛載點 = log 寫進容器暫存區,重新部署即消失"""
    data_dir = re.search(r'DATA_DIR\s*=\s*"([^"]+)"', _fly_toml()).group(1)
    mount = re.search(r'destination\s*=\s*"([^"]+)"', _fly_toml()).group(1)

    assert data_dir == mount


def test_fly_keeps_the_machine_always_running():
    """限流計數器在記憶體,停機再啟會歸零"""
    fly_toml = _fly_toml()

    assert "auto_stop_machines = false" in fly_toml
    assert "min_machines_running = 1" in fly_toml


def test_fly_health_check_hits_health_endpoint():
    fly_toml = _fly_toml()

    assert 'path = "/health"' in fly_toml


def test_fly_primary_region_is_tokyo():
    assert 'primary_region = "nrt"' in _fly_toml()


VERCEL_JSON = REPO_ROOT / "frontend" / "my-app" / "vercel.json"


def _vercel_config() -> dict:
    return json.loads(VERCEL_JSON.read_text(encoding="utf-8"))


def test_vercel_rewrites_api_prefix_to_fly():
    """:path* 會吃掉 /api 前綴,所以後端路由維持 /words、/tests 不動"""
    rewrites = _vercel_config()["rewrites"]

    assert len(rewrites) == 1
    assert rewrites[0]["source"] == "/api/:path*"
    assert rewrites[0]["destination"].endswith(".fly.dev/:path*")


def test_vercel_disables_rewrite_caching_for_api():
    """Vercel 對新專案預設採信外部來源的 cache 標頭 —— /words/deck 是
    每個使用者自己的單字,被 CDN 快取就是跨使用者外洩"""
    headers = _vercel_config()["headers"]
    api_headers = [h for h in headers if h["source"] == "/api/:path*"]

    assert len(api_headers) == 1
    keys = {h["key"]: h["value"] for h in api_headers[0]["headers"]}
    assert keys["x-vercel-enable-rewrite-caching"] == "0"


def test_vercel_caching_optout_covers_every_rewrite():
    """改 rewrite 的 source 卻忘了改 headers 的 source,就會無聲漏掉快取防護"""
    config = _vercel_config()
    header_sources = {h["source"] for h in config["headers"]}

    for rewrite in config["rewrites"]:
        assert rewrite["source"] in header_sources


def test_vercel_destination_matches_fly_app_name():
    """Task 7 手動填兩個 CHANGEME- 時最容易漏的一組:名字不一致 = 整個網站的
    /api 全打到不存在的位址,而其他護欄還是全綠"""
    app = re.search(r'^app\s*=\s*"([^"]+)"', _fly_toml(), re.M).group(1)
    destination = _vercel_config()["rewrites"][0]["destination"]

    assert destination == f"https://{app}.fly.dev/:path*"
