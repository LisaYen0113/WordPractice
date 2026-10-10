# app/daos/words_dao.py
from app.core.supabase_client import supabase_request

# WordCard(app/schemas/words.py)實際用到的欄位;別多抓 —— /deck 會乘上 200 筆
_WORD_CARD_COLUMNS = "id,word,pos,definition,kk_pronunciation,etymology,synonyms,toeic_examples"

# 一批最多幾個 id:50 × 37 字元 ≈ 1.9KB,遠離 8KB 的 URL 上限
# (200 個 UUID 一次串進 in.(...) 約 7.9KB,逼近上限 → 一律分批)
_ID_BATCH_SIZE = 50

def get_words_by_ids(word_ids: list[str]):
    """依 id 清單取字;分批查,避免 URL 過長"""
    rows = []
    for start in range(0, len(word_ids), _ID_BATCH_SIZE):
        batch = word_ids[start:start + _ID_BATCH_SIZE]
        ids_str = ",".join(batch)
        rows.extend(supabase_request(
            "GET",
            "words",
            params={"id": f"in.({ids_str})", "select": _WORD_CARD_COLUMNS}
        ))
    return rows

def get_word_basic(word_id: str):
    return supabase_request(
        "GET",
        "words",
        params={"id": f"eq.{word_id}", "select": "word,definition"}
    )

def get_word_by_text(word: str):
    """以不分大小寫的正規化欄位(word_lower)查單字;回傳單筆或 None"""
    result = supabase_request(
        "GET",
        "words",
        params={"word_lower": f"eq.{word.strip().lower()}", "select": "*"}
    )
    if isinstance(result, list):
        return result[0] if result else None
    return result

# 新增: 插入單字到 words 表
def insert_word(word_data: dict):
    result = supabase_request(
        "POST",
        "words",
        data=word_data
    )
    # Supabase 設了 Prefer: return=representation,回傳的是 list,取出插入的那一筆
    if isinstance(result, list):
        return result[0] if result else None
    return result
