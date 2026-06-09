from fastapi import APIRouter
from app.services.k8s_client import KubernetesService
from app.services.prometheus import PrometheusService

router = APIRouter()

@router.get("/overview")
def overview(namespace: str | None = None):
    k8s = KubernetesService()
    nodes = k8s.list_nodes()
    pods = k8s.list_pods(namespace)
    deployments = k8s.list_deployments(namespace)
    services = k8s.list_services(namespace)
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
    k8s = KubernetesService()
    return [{
        "namespace": p.metadata.namespace,
        "name": p.metadata.name,
        "phase": p.status.phase,
        "node": p.spec.node_name,
        "restarts": sum(cs.restart_count for cs in (p.status.container_statuses or [])),
    } for p in k8s.list_pods(namespace)]

@router.get("/prometheus/node-memory")
async def node_memory():
    return await PrometheusService().node_memory()
