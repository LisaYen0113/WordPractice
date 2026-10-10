"""部署設定檔的護欄。放在後端測試是因為這裡是唯一會固定跑測試的地方,
不為了驗四個設定檔另建一套前端測試工具。"""
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
