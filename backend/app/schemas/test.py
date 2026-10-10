# app/schemas/test.py
import uuid
from typing import Annotated

from pydantic import BaseModel, StringConstraints

# 不接受的字元:控制字元(C0/DEL/C1)、零寬與 bidi 控制、Unicode 行分隔
# (U+2028/U+2029)與 BOM。用 codepoint 建構,避免原始碼裡藏看不見的字元。
_UNSAFE_CHARS = "".join(
    chr(c)
    for c in (
        *range(0x00, 0x20),  # C0(含換行)
        0x7F,  # DEL
        *range(0x80, 0xA0),  # C1(含 NEL 0x85)
        *range(0x200B, 0x2010),  # 零寬字元與 LRM/RLM
        0x2028,  # 行分隔
        0x2029,  # 段落分隔
        *range(0x202A, 0x202F),  # bidi 控制
        *range(0x2066, 0x206A),  # bidi isolate
        0xFEFF,  # BOM / 零寬不換行空格
    )
)

# 中文作答:長度上限 200,擋掉控制字元與行分隔字元(避免注入/偽造 log)
ChineseAnswer = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=200,
        pattern=rf"^[^{_UNSAFE_CHARS}]+$",
    ),
]


class DefinitionSubmission(BaseModel):
    word_id: uuid.UUID
    user_input_zh: ChineseAnswer

class GeminiOutput(BaseModel):
    score: float
    ai_mistake_type: str
    ai_feedback: str
