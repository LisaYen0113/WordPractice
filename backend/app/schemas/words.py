# app/schemas/word.py
import uuid
from datetime import date
from typing import Annotated, List, Optional

from pydantic import BaseModel, Field, StringConstraints

class WordCard(BaseModel):
    word_id: uuid.UUID
    word: str
    pos: str
    definition: str
    kk_pronunciation: str
    etymology: Optional[str] = None
    synonyms: Optional[List[str]] = None
    toeic_examples: Optional[List[str]] = None
    familiarity_score: int

# 新增: 用於前端提交單字填充
# 限制:英文單字/片語(字母含重音、數字、空白、連字號、撇號/彎引號),長度 1-64
EnglishWord = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ][A-Za-zÀ-ÖØ-öø-ÿĀ-ɏ0-9 '\-’]*$",
    ),
]


class NewWordRequest(BaseModel):
    word: EnglishWord


class MarkFamiliarRequest(BaseModel):
    word_id: uuid.UUID
    familiar: bool


class MarkFamiliarResponse(BaseModel):
    word_id: uuid.UUID
    familiarity_score: int
    next_review_date: date
    familiar: bool

class WordDetailResponse(BaseModel):
    id: Optional[str] = None
    word: str
    pos: str
    definition: str
    kk_pronunciation: str
    etymology: Optional[str] = None
    
    synonyms: List[str] = Field(default_factory=list)
    antonyms: List[str] = Field(default_factory=list)
    inflections: List[str] = Field(default_factory=list)
    phrases: List[str] = Field(default_factory=list)
    toeic_examples: List[str] = Field(default_factory=list)