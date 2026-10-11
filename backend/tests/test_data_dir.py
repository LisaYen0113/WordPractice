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
import logging
from logging.handlers import RotatingFileHandler

from app.core.config import DATA_DIR
from app.core.logger import LOG_DIR
from app.utils.retry_failed_words import FAILED_LOG_FILE

handlers = logging.getLogger("app.core.logger").handlers

print(json.dumps({
    "data": str(DATA_DIR),
    "log": str(LOG_DIR),
    "queue": str(FAILED_LOG_FILE),
    "file_handlers": sum(isinstance(h, RotatingFileHandler) for h in handlers),
    "console_handlers": sum(
        isinstance(h, logging.StreamHandler) and not isinstance(h, RotatingFileHandler)
        for h in handlers
    ),
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
    probe = _probe_ok(tmp_path)

    assert (tmp_path / "logs").is_dir()
    assert probe["file_handlers"] == 1
    assert probe["console_handlers"] == 1


def test_unwritable_data_dir_warns_instead_of_crashing(tmp_path):
    """DATA_DIR 不可寫時,import 要成功,但**必須出聲**。

    原本這條測的是「當場失敗」,理由寫在 config.py:「不能靜默退回容器暫存區」。
    那個理由是對的,但只在 Fly 上成立 —— 那裡失敗發生在部署階段(健康檢查不過,
    部署被拒),而且有 SSH 可查。Vercel 上沒有 shell,同一個失敗會變成
    「部署成功、每個請求 500、traceback 埋在 dashboard 裡」,那不算大聲。

    所以原則(不能無聲)保留,機制換掉:降級到 console-only,並在 stderr
    留下指名 LOG_DIR 路徑的 WARNING。console 是 Vercel 唯一收得到的管道,
    正式環境的 log 因此一點都不會少。
    """
    result = _probe(tmp_path / "not-mounted")

    assert result.returncode == 0, result.stderr
    assert "WARNING" in result.stderr
    assert "not-mounted" in result.stderr


def test_unwritable_data_dir_drops_file_handler_but_keeps_console(tmp_path):
    """降級要降得乾淨:不能留一個每次都寫失敗的檔案 handler,
    但 console handler 必須還在 —— 少了它就是「降級成啞巴」,比原本的當場失敗更糟"""
    probe = _probe_ok(tmp_path / "not-mounted")

    assert probe["file_handlers"] == 0
    assert probe["console_handlers"] == 1
