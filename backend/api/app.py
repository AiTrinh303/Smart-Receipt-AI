import math
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api import routes
from api.routes import router

CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Forces the repository (and therefore the SQLite schema) to be created
    # at startup, rather than lazily on the first request.
    routes.get_repository()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    # FastAPI's default handler echoes the rejected value back in each
    # error's "input" field. If a client sends a non-finite float (e.g.
    # `"total": NaN`), that raw float survives validation up to here and
    # Starlette's default JSON encoder refuses to serialize it (NaN/Infinity
    # aren't valid JSON), crashing the error response itself with a 500.
    # Stringify only the non-finite case so the response is always valid
    # JSON; everything else keeps FastAPI's standard validation detail shape.
    errors = []
    for error in exc.errors():
        error = dict(error)
        value = error.get("input")
        if isinstance(value, float) and not math.isfinite(value):
            error["input"] = str(value)
        errors.append(error)

    return JSONResponse(status_code=422, content=jsonable_encoder({"detail": errors}))


app.include_router(router)
