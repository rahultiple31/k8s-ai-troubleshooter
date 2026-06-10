from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health, cluster, ai, kubectl

app = FastAPI(title="Kubernetes AI Troubleshooter", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(cluster.router, prefix="/api/cluster", tags=["cluster"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(kubectl.router, prefix="/api/kubectl", tags=["kubectl"])
