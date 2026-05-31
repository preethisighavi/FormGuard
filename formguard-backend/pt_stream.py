import asyncio
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter()

# In-memory subscriber queues
pt_subscribers: list[asyncio.Queue] = []


async def push_event(event_type: str, data: dict):
    dead = []
    for q in pt_subscribers:
        try:
            q.put_nowait({"type": event_type, "data": data})
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        try:
            pt_subscribers.remove(q)
        except ValueError:
            pass


async def _event_generator(queue: asyncio.Queue):
    try:
        while True:
            msg = await asyncio.wait_for(queue.get(), timeout=30)
            yield f"event: {msg['type']}\ndata: {json.dumps(msg['data'])}\n\n"
    except asyncio.TimeoutError:
        yield ": keepalive\n\n"


@router.get("/pt/stream")
async def pt_stream():
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    pt_subscribers.append(queue)

    async def generator():
        try:
            async for chunk in _event_generator(queue):
                yield chunk
        finally:
            try:
                pt_subscribers.remove(queue)
            except ValueError:
                pass

    return StreamingResponse(generator(), media_type="text/event-stream")
