# app/daos/mistakes_dao.py
from app.core.supabase_client import supabase_request

def record_mistake(data: dict):
    return supabase_request(
        "POST",
        "mistakes",
        data=data
    )
