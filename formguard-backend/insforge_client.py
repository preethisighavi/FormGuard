import os
import httpx
from typing import Any

INSFORGE_API_URL = os.getenv("INSFORGE_API_URL", "https://api.insforge.dev")
INSFORGE_API_KEY = os.getenv("INSFORGE_API_KEY", "")


def _headers() -> dict:
    return {"Authorization": f"Bearer {INSFORGE_API_KEY}", "Content-Type": "application/json"}


async def write_record(collection: str, doc_id: str, data: dict) -> dict:
    if not INSFORGE_API_KEY:
        return {"ok": True, "mock": True, "id": doc_id}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.put(
                f"{INSFORGE_API_URL}/v1/collections/{collection}/documents/{doc_id}",
                headers=_headers(),
                json=data,
            )
            r.raise_for_status()
            return r.json()
    except Exception:
        return {"ok": True, "mock": True, "id": doc_id}


async def get_collection(collection: str, filters: dict = None) -> list[dict]:
    if not INSFORGE_API_KEY:
        return []
    try:
        params: dict[str, Any] = {}
        if filters:
            params.update(filters)
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{INSFORGE_API_URL}/v1/collections/{collection}/documents",
                headers=_headers(),
                params=params,
            )
            r.raise_for_status()
            return r.json().get("documents", [])
    except Exception:
        return []
