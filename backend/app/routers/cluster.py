from fastapi import APIRouter, HTTPException
from app.services.k8s_client import KubernetesService
from app.services.prometheus import PrometheusService

router = APIRouter()

def get_kubernetes_service():
    try:
        return KubernetesService()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

@router.get("/overview")
def overview(namespace: str | None = None):
    k8s = get_kubernetes_service()
    try:
        nodes = k8s.list_nodes()
        pods = k8s.list_pods(namespace)
        deployments = k8s.list_deployments(namespace)
        services = k8s.list_services(namespace)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    unhealthy_pods = [p for p in pods if p.status.phase not in ["Running", "Succeeded"]]
    not_ready_nodes = []
    for n in nodes:
        ready = next((c.status for c in n.status.conditions if c.type == "Ready"), "Unknown")
        if ready != "True":
            not_ready_nodes.append(n.metadata.name)
    return {
        "nodes": len(nodes),
        "pods": len(pods),
        "deployments": len(deployments),
        "services": len(services),
        "unhealthy_pods": len(unhealthy_pods),
        "not_ready_nodes": not_ready_nodes,
    }

@router.get("/pods")
def pods(namespace: str | None = None):
    k8s = get_kubernetes_service()
    try:
        pod_list = k8s.list_pods(namespace)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return [{
        "namespace": p.metadata.namespace,
        "name": p.metadata.name,
        "phase": p.status.phase,
        "node": p.spec.node_name,
        "restarts": sum(cs.restart_count for cs in (p.status.container_statuses or [])),
    } for p in pod_list]

@router.get("/prometheus/node-memory")
async def node_memory():
    return await PrometheusService().node_memory()
