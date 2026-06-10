from fastapi import APIRouter, HTTPException
from app.models.schemas import TroubleshootRequest
from app.services.k8s_client import KubernetesService
from app.agents.rules_engine import RulesEngine
from app.services.llm import LLMService

router = APIRouter()

@router.post("/troubleshoot")
def troubleshoot(req: TroubleshootRequest):
    if not req.namespace or not req.pod_name:
        namespace = req.namespace or "default"
        return {
            "reason": "Select a Kubernetes pod to get an exact fix for the issue.",
            "fix": "Use the commands below to find the failing pod, then select it from Resource Tree or enter its namespace and pod name in the chat box.",
            "commands": [
                f"kubectl get pods -n {namespace} -o wide",
                f"kubectl get events -n {namespace} --sort-by=.lastTimestamp",
                f"kubectl get pvc -n {namespace}",
                "kubectl get nodes -o wide",
            ],
            "confidence": 70,
        }

    try:
        k8s = KubernetesService()
        pod = k8s.get_pod(req.namespace, req.pod_name)
        events = k8s.get_pod_events(req.namespace, req.pod_name)
        container = pod.spec.containers[0].name if pod.spec.containers else None
        logs = k8s.get_pod_logs(req.namespace, req.pod_name, container=container)
        nodes = k8s.list_nodes()
        pvcs = k8s.list_pvcs(req.namespace)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    result = RulesEngine().analyze_pod(pod, events, logs, nodes, pvcs)
    return LLMService().explain(req.question, result)
