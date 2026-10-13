import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(router)
