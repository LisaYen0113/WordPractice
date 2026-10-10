"""log 淨化:控制字元/行分隔字元 escape、金鑰遮蔽、traceback 可讀、handler 真的掛上"""
import logging
import sys
from logging.handlers import RotatingFileHandler

from app.core.logger import SanitizingFormatter, _build_file_handler


def _make_record(message: str) -> logging.LogRecord:
    return logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=(),
        exc_info=None,
    )


def _make_exc_record(message: str) -> logging.LogRecord:
    try:
        raise RuntimeError("boom " + chr(0x2028) + " forged")
    except RuntimeError:
        return logging.LogRecord(
            name="test",
            level=logging.ERROR,
            pathname=__file__,
            lineno=1,
            msg=message,
            args=(),
            exc_info=sys.exc_info(),
        )


def test_newlines_are_escaped():
    formatter = SanitizingFormatter("%(message)s")
    output = formatter.format(
        _make_record("word=bad\n2026-01-01 | ERROR | forged line")
    )

    assert "\n" not in output
    assert "\\x0a" in output


def test_tabs_and_control_chars_escaped():
    formatter = SanitizingFormatter("%(message)s")
    output = formatter.format(_make_record("a\tb\x00c"))

    assert "\t" not in output
    assert "\x00" not in output


def test_unicode_line_separators_and_bidi_escaped():
    # U+2028/U+2029 在部分 log 檢視器裡等於換行,只擋換行字元不夠
    formatter = SanitizingFormatter("%(message)s")
    unsafe = [0x85, 0x2028, 0x2029, 0x202E, 0x200B, 0x2066]
    output = formatter.format(
        _make_record("a" + "".join(chr(c) for c in unsafe) + "b")
    )

    for codepoint in unsafe:
        assert chr(codepoint) not in output


def test_surrogates_escaped_so_record_is_not_dropped():
    # 殘缺代理對會讓整筆 log 寫入失敗(被 Handler 靜默丟棄),必須 escape
    formatter = SanitizingFormatter("%(message)s")
    output = formatter.format(_make_record("x" + chr(0xD800) + "y"))

    assert chr(0xD800) not in output
    output.encode("utf-8")  # 不再拋 UnicodeEncodeError


def test_traceback_keeps_newlines_but_escapes_separators():
    formatter = SanitizingFormatter("%(message)s")
    output = formatter.format(_make_exc_record("explode"))

    assert "Traceback" in output  # traceback 有寫進 log
    assert "\n" in output  # 保留真正的換行,維持多行可讀
    assert chr(0x2028) not in output  # 但異常訊息裡的行分隔一樣要被 escape


def test_secret_like_strings_are_redacted():
    formatter = SanitizingFormatter("%(message)s")
    output = formatter.format(
        _make_record("call failed, key=AIzaSyDummy1234567890abcdefghijklmno")
    )

    assert "AIzaSyDummy1234567890" not in output
    assert "[REDACTED]" in output


def test_new_style_supabase_secret_redacted():
    # sb_secret_... 不是 JWT,不會被 eyJ... 樣式攔到;requests 的例外訊息會原樣帶出金鑰
    formatter = SanitizingFormatter("%(message)s")
    output = formatter.format(
        _make_record("Invalid header value b'sb_secret_AbCdEfGhIjKlMnOpQrStUvWx\n'")
    )

    assert "sb_secret_AbCdEfGhIjKlMnOpQrStUvWx" not in output
    assert "[REDACTED]" in output


def test_file_handler_rotates_and_sanitizes():
    handler = _build_file_handler()
    try:
        assert isinstance(handler, RotatingFileHandler)
        assert handler.maxBytes > 0
        assert handler.backupCount >= 1
        assert isinstance(handler.formatter, SanitizingFormatter)
    finally:
        handler.close()


def test_file_handler_attached_to_app_logger():
    # basicConfig 在 root 已有 handler 時是 no-op(pytest 就是),
    # 檔案 handler 必須直接掛在 app logger 上,不然安全 log 會靜默消失
    app_logger = logging.getLogger("app.core.logger")
    file_handlers = [h for h in app_logger.handlers if isinstance(h, RotatingFileHandler)]

    assert file_handlers
    assert isinstance(file_handlers[0].formatter, SanitizingFormatter)
