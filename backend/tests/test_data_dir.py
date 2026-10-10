"""DATA_DIR:log 與失敗佇列的位置可設定;本機不設時行為與改動前相同"""
import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]

# 這些都是 import-time 常數,只有在乾淨的子行程裡重新 import 才驗得到
_PROBE = """
import json

from app.core.config import DATA_DIR
from app.core.logger import LOG_DIR
from app.utils.retry_failed_words import FAILED_LOG_FILE

print(json.dumps({
    "data": str(DATA_DIR),
    "log": str(LOG_DIR),
    "queue": str(FAILED_LOG_FILE),
}))
"""


def _probe(data_dir=None):
    """在子行程 import 一次。回傳 CompletedProcess,失敗案例要看 stderr。"""
    env = os.environ.copy()
    env.pop("DATA_DIR", None)  # 繼承來的值不能影響斷言
    if data_dir is not None:
        env["DATA_DIR"] = str(data_dir)
    return subprocess.run(
        [sys.executable, "-c", _PROBE],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


def _probe_ok(data_dir=None) -> dict:
    result = _probe(data_dir)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


def test_defaults_to_backend_dir_when_data_dir_unset():
    probe = _probe_ok()

    assert Path(probe["data"]) == BACKEND_DIR
    assert Path(probe["log"]) == BACKEND_DIR / "logs"
    assert Path(probe["queue"]) == BACKEND_DIR / "logs" / "failed_words.jsonl"


def test_data_dir_env_moves_log_and_queue(tmp_path):
    probe = _probe_ok(tmp_path)

    assert Path(probe["data"]) == tmp_path
    assert Path(probe["log"]) == tmp_path / "logs"
    assert Path(probe["queue"]) == tmp_path / "logs" / "failed_words.jsonl"


def test_data_dir_creates_log_dir_on_import(tmp_path):
    _probe_ok(tmp_path)

    assert (tmp_path / "logs").is_dir()


def test_missing_data_dir_parent_fails_loudly(tmp_path):
    """volume 沒掛上時要大聲失敗:靜默退回容器暫存區 = 下次部署無聲遺失 log 與待重試單字"""
    result = _probe(tmp_path / "not-mounted")

    assert result.returncode != 0
    assert "FileNotFoundError" in result.stderr
