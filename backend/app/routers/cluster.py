import asyncio

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
    unhealthy_pods = [p for p in pods if pod_phase(p) not in ["Running", "Succeeded"]]
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
    return [pod_payload(p) for p in pod_list]

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

@router.get("/ingresses")
def ingresses(namespace: str | None = None):
    k8s = get_kubernetes_service()
    try:
        ingress_list = k8s.list_ingresses(namespace)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return [{
        "namespace": ingress.metadata.namespace,
        "name": ingress.metadata.name,
        "class_name": ingress.spec.ingress_class_name if ingress.spec else "",
        "hosts": [
            rule.host
            for rule in (ingress.spec.rules or [])
            if rule.host
        ] if ingress.spec else [],
        "addresses": [
            item.ip or item.hostname
            for item in ((ingress.status.load_balancer.ingress or []) if ingress.status and ingress.status.load_balancer else [])
        ],
    } for ingress in ingress_list]

@router.get("/events")
def events(namespace: str | None = None):
    k8s = get_kubernetes_service()
    try:
        event_list = k8s.list_events(namespace)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    def event_time(event):
        return (
            getattr(event, "last_timestamp", None)
            or getattr(event, "event_time", None)
            or getattr(event, "first_timestamp", None)
        )

    sorted_events = sorted(
        event_list,
        key=lambda event: event_time(event) or event.metadata.creation_timestamp,
        reverse=True,
    )
    return [{
        "namespace": event.metadata.namespace,
        "name": event.metadata.name,
        "type": event.type or "Normal",
        "reason": event.reason or "Unknown",
        "message": event.message or "",
        "count": event.count or 1,
        "object_kind": event.involved_object.kind if event.involved_object else "",
        "object_name": event.involved_object.name if event.involved_object else "",
        "last_timestamp": str(event_time(event) or event.metadata.creation_timestamp or ""),
    } for event in sorted_events[:100]]

@router.get("/log-alerts")
def log_alerts(namespace: str | None = None):
    k8s = get_kubernetes_service()
    try:
        pod_list = k8s.list_pods(namespace)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    alert_words = (
        "error",
        "exception",
        "failed",
        "fatal",
        "panic",
        "traceback",
        "oom",
        "timeout",
        "connection refused",
    )
    alerts = []
    for pod in pod_list:
        status = getattr(pod, "status", None)
        spec = getattr(pod, "spec", None)
        metadata = getattr(pod, "metadata", None)
        pod_name = getattr(metadata, "name", "")
        pod_namespace = getattr(metadata, "namespace", "default")
        statuses = getattr(status, "container_statuses", None) or []
        restart_count = pod_restart_count(pod)
        if pod_phase(pod) in ["Running", "Succeeded"] and restart_count == 0:
            continue

        container_names = [status.name for status in statuses] or [
            container.name for container in (getattr(spec, "containers", None) or [])
        ]
        if not pod_name or not container_names:
            continue
        for container_name in container_names[:2]:
            log_text = k8s.get_pod_logs(
                pod_namespace,
                pod_name,
                container=container_name,
                previous=restart_count > 0,
                tail_lines=80,
            )
            lowered = (log_text or "").lower()
            matched = next((word for word in alert_words if word in lowered), "")
            if matched:
                lines = [line.strip() for line in log_text.splitlines() if line.strip()]
                snippet = next(
                    (line for line in reversed(lines) if matched in line.lower()),
                    lines[-1] if lines else "",
                )
                alerts.append({
                    "namespace": pod_namespace,
                    "pod": pod_name,
                    "container": container_name,
                    "reason": matched,
                    "snippet": snippet[-240:],
                })
                break

        if len(alerts) >= 20:
            break

    return alerts

@router.get("/prometheus/node-memory")
async def node_memory():
    return await PrometheusService().node_memory()

@router.get("/prometheus/node-cpu")
async def node_cpu():
    return await PrometheusService().node_cpu()

@router.get("/prometheus/pod-restarts")
async def pod_restarts():
    return await PrometheusService().pod_restarts()

@router.get("/prometheus/coredns")
async def coredns_dashboard():
    return await PrometheusService().coredns_dashboard()

@router.get("/prometheus/cluster-dashboard")
async def cluster_dashboard():
    fallback = {}
    fallback_error = None
    try:
        fallback = get_kubernetes_service().get_metrics_summary()
    except Exception as exc:
        fallback_error = str(exc)

    try:
        dashboard = await asyncio.wait_for(PrometheusService().cluster_dashboard(), timeout=8)
    except Exception as exc:
        dashboard = {key: value for key, value in fallback.items() if has_metric_rows(value)}
        dashboard["errors"] = {"prometheus": str(exc)}
        if fallback_error:
            dashboard["errors"]["kubernetes_metrics"] = fallback_error
        dashboard["fallback"] = fallback_summary(fallback, dashboard)
        return dashboard

    if fallback_error:
        dashboard.setdefault("errors", {})["kubernetes_metrics"] = fallback_error

    for key, value in fallback.items():
        if not has_metric_rows(dashboard.get(key)) and has_metric_rows(value):
            dashboard[key] = value

    dashboard["fallback"] = fallback_summary(fallback, dashboard)
    return dashboard


def has_metric_rows(response):
    if not isinstance(response, dict):
        return False
    return bool(response.get("data", {}).get("result"))


def pod_payload(pod):
    metadata = getattr(pod, "metadata", None)
    status = getattr(pod, "status", None)
    spec = getattr(pod, "spec", None)
    return {
        "namespace": getattr(metadata, "namespace", "default"),
        "name": getattr(metadata, "name", ""),
        "phase": pod_phase(pod),
        "node": getattr(spec, "node_name", None) or "",
        "pod_ip": getattr(status, "pod_ip", None) or "",
        "host_ip": getattr(status, "host_ip", None) or "",
        "restarts": pod_restart_count(pod),
    }


def pod_phase(pod):
    status = getattr(pod, "status", None)
    return getattr(status, "phase", None) or "Unknown"


def pod_restart_count(pod):
    status = getattr(pod, "status", None)
    statuses = getattr(status, "container_statuses", None) or []
    return sum(getattr(container_status, "restart_count", 0) or 0 for container_status in statuses)


def fallback_summary(fallback, dashboard):
    used = [
        key
        for key, value in fallback.items()
        if dashboard.get(key) is value
    ]
    sources = set()
    for key in used:
        rows = fallback.get(key, {}).get("data", {}).get("result", [])
        for row in rows:
            metric = row.get("metric", {}) if isinstance(row, dict) else {}
            source = metric.get("source") if isinstance(metric, dict) else None
            if source:
                sources.add(source)
    return {
        "source": ", ".join(sorted(sources)) if sources else "none",
        "used": used,
    }
