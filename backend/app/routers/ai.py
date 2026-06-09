from fastapi import APIRouter, HTTPException
from app.models.schemas import TroubleshootRequest
from app.services.k8s_client import KubernetesService
from app.agents.rules_engine import RulesEngine
from app.services.llm import LLMService

router = APIRouter()

@router.post("/troubleshoot")
def troubleshoot(req: TroubleshootRequest):
    k8s = KubernetesService()

    if not req.namespace or not req.pod_name:
        return {
            "reason": "Please provide namespace and pod_name for deep pod troubleshooting.",
            "fix": "Select a pod from UI or call API with namespace and pod_name.",
            "commands": ["kubectl get pods -A"],
            "confidence": 50,
        }

    try:
        pod = k8s.get_pod(req.namespace, req.pod_name)
        events = k8s.get_pod_events(req.namespace, req.pod_name)
        container = pod.spec.containers[0].name if pod.spec.containers else None
        logs = k8s.get_pod_logs(req.namespace, req.pod_name, container=container)
        nodes = k8s.list_nodes()
        pvcs = k8s.list_pvcs(req.namespace)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    result = RulesEngine().analyze_pod(pod, events, logs, nodes, pvcs)
    return LLMService().explain(req.question, result)
