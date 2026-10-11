import logging
import re
from logging.handlers import RotatingFileHandler

from app.core.config import DATA_DIR

# 位置由 DATA_DIR 決定(本機 = backend/logs;Vercel = /tmp/logs)。
# 目錄不在這裡建 —— 建立失敗的唯一處理點是 _build_file_handler,
# 在那裡失敗可以降級,在這裡失敗就是 import 失敗。
LOG_DIR = DATA_DIR / "logs"

LOG_FILE = LOG_DIR / "words_api.log"
LOG_FORMAT = "%(asctime)s | %(levelname)s | %(message)s"
MAX_LOG_BYTES = 2_000_000
BACKUP_COUNT = 5

# 要 escape 的字元(用 codepoint 建構,避免原始碼裡藏看不見的字元):
# - C0 控制字元(含換行)、DEL、C1(含 NEL 0x85)
# - 零寬字元與 LRM/RLM(0x200B-0x200F)、bidi 控制(0x202A-0x202E、0x2066-0x2069)
# - Unicode 行分隔/段落分隔 U+2028/U+2029:部分 log 檢視器(JS 系、Splunk 等)視為換行,
#   只擋換行字元不夠,使用者輸入仍可偽造出假的 log 行
# - 殘缺代理對(0xD800-0xDFFF):UTF-8 編碼會失敗,整筆 log 會被 Handler 靜默丟棄
_UNSAFE_CODEPOINTS = [
    *range(0x00, 0x20),  # C0
    0x7F,  # DEL
    *range(0x80, 0xA0),  # C1
    *range(0x200B, 0x2010),  # 零寬 + LRM/RLM
    0x2028,  # 行分隔
    0x2029,  # 段落分隔
    *range(0x202A, 0x202F),  # bidi 控制
    *range(0x2066, 0x206A),  # bidi isolate
    *range(0xD800, 0xE000),  # 代理對
]

# traceback 是 server 自己產生的:保留 tab 與換行維持多行可讀,其餘一樣 escape
_KEEP_READABLE_IN_TRACEBACK = {0x09, 0x0A}


def _compile_char_class(codepoints) -> re.Pattern:
    return re.compile("[%s]" % "".join(chr(c) for c in codepoints))


_MESSAGE_UNSAFE = _compile_char_class(_UNSAFE_CODEPOINTS)
_EXC_UNSAFE = _compile_char_class(
    [c for c in _UNSAFE_CODEPOINTS if c not in _KEEP_READABLE_IN_TRACEBACK]
)

# 常見金鑰樣式:意外被寫進 log 時直接遮蔽
_SECRET_PATTERNS = [
    re.compile(r"eyJ[A-Za-z0-9_\-\.]{20,}"),  # JWT / Supabase key
    re.compile(r"AIza[A-Za-z0-9_\-]{20,}"),  # Google API key
    re.compile(r"sb_(?:secret|publishable)_[A-Za-z0-9_\-]{8,}"),  # 新式 Supabase API key
    re.compile(
        r"(?i)\b(apikey|api_key|authorization|bearer)\b[\"'=:\s]+[A-Za-z0-9_\-\.]{16,}"
    ),
]


def _escape_char(match: re.Match) -> str:
    return f"\\x{ord(match.group()):02x}"


def _redact(text: str) -> str:
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[REDACTED]", text)
    return text


class SanitizingFormatter(logging.Formatter):
    """控制字元 escape + 金鑰遮蔽;訊息保持單行,traceback 保留換行可讀"""

    def format(self, record: logging.LogRecord) -> str:
        record.msg = _redact(_MESSAGE_UNSAFE.sub(_escape_char, record.getMessage()))
        record.args = None
        if record.exc_info and not record.exc_text:
            record.exc_text = self.formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = _redact(_EXC_UNSAFE.sub(_escape_char, record.exc_text))
        return super().format(record)


def _sanitizing_formatter() -> SanitizingFormatter:
    return SanitizingFormatter(LOG_FORMAT)


def _build_file_handler() -> logging.Handler | None:
    """建目錄與開檔都在這裡 —— 這是唯一會因為 DATA_DIR 不可寫而失敗的地方。

    失敗時回 None,由 _attach_file_handler 降級並出聲。原本這裡讓 import
    當場失敗(tests/test_data_dir.py 記著當時的理由);換到 Vercel 後那等於
    「部署成功、每個請求 500」,所以改成降級。

    刻意不加 parents=True:上層目錄不存在就是設定錯了,不該順手生出一整棵樹。
    """
    try:
        LOG_DIR.mkdir(exist_ok=True)
        handler = RotatingFileHandler(
            LOG_FILE,
            maxBytes=MAX_LOG_BYTES,
            backupCount=BACKUP_COUNT,
            encoding="utf-8",
            errors="backslashreplace",  # 保險:漏網字元也不能讓整筆 log 消失
        )
    except OSError:
        # FileNotFoundError(上層不存在)與 PermissionError / OSError(唯讀)
        # 都是 OSError 的子類,兩者都代表這裡寫不了
        return None
    handler.setFormatter(_sanitizing_formatter())
    return handler


def _build_console_handler() -> logging.Handler:
    handler = logging.StreamHandler()
    handler.setFormatter(_sanitizing_formatter())
    return handler


def _is_console_handler(handler: logging.Handler) -> bool:
    # RotatingFileHandler 也是 StreamHandler 的子類,不能只用 isinstance 判斷
    return isinstance(handler, logging.StreamHandler) and not isinstance(
        handler, RotatingFileHandler
    )


def _attach_file_handler(app_logger: logging.Logger) -> None:
    """檔案 handler 建不起來時降級成 console-only,但一定要出聲。

    沉默地失去檔案 log 正是原本「當場失敗」要防的事;既然不能失敗,
    就至少要在 stderr 留下一行指名路徑與後果的警告。
    """
    file_handler = _build_file_handler()
    if file_handler is not None:
        app_logger.addHandler(file_handler)
        return
    app_logger.warning(
        "Log 目錄 %s 不可寫,這次執行只有 console log;檔案 log 與失敗佇列都不會留下。"
        "在 Vercel 上請確認環境變數 DATA_DIR=/tmp 已設定。",
        LOG_DIR,
    )


def _configure_logging() -> None:
    """明確把 handler 掛在 app logger 上。
    basicConfig 在 root 已有 handler 時是 no-op(pytest、部分部署工具),
    會讓安全相關的 log 靜默消失,所以不用 basicConfig。"""
    app_logger = logging.getLogger("app.core.logger")
    app_logger.setLevel(logging.INFO)

    # console 先掛:它不會失敗,而且是 Vercel 唯一收得到的管道。
    # 先有它,下面檔案 handler 失敗時的警告才有地方可以去。
    if not any(_is_console_handler(h) for h in app_logger.handlers):
        app_logger.addHandler(_build_console_handler())

    if not any(isinstance(h, RotatingFileHandler) for h in app_logger.handlers):
        _attach_file_handler(app_logger)


_configure_logging()

# SDK 的每筆 HTTP 流量會灌爆 log,只留警告以上
logging.getLogger("httpx").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)
