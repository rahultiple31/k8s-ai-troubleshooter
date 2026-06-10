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

@router.get("/services")
def services(namespace: str | None = None):
    k8s = get_kubernetes_service()
    try:
        service_list = k8s.list_services(namespace)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return [{
        "namespace": s.metadata.namespace,
        "name": s.metadata.name,
        "type": s.spec.type,
        "cluster_ip": s.spec.cluster_ip,
        "ports": [
            {
                "name": port.name,
                "port": port.port,
                "target_port": str(port.target_port) if port.target_port is not None else "",
                "protocol": port.protocol,
            }
            for port in (s.spec.ports or [])
        ],
    } for s in service_list]

@router.get("/deployments")
def deployments(namespace: str | None = None):
    k8s = get_kubernetes_service()
    try:
        deployment_list = k8s.list_deployments(namespace)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return [{
        "namespace": d.metadata.namespace,
        "name": d.metadata.name,
        "replicas": d.spec.replicas or 0,
        "ready_replicas": d.status.ready_replicas or 0,
        "available_replicas": d.status.available_replicas or 0,
    } for d in deployment_list]

@router.get("/prometheus/node-memory")
async def node_memory():
    return await PrometheusService().node_memory()
