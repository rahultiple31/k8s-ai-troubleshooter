from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class TroubleshootRequest(BaseModel):
    question: str
    namespace: Optional[str] = None
    pod_name: Optional[str] = None
    deployment_name: Optional[str] = None

class KubectlRequest(BaseModel):
    command: str
    stdin: Optional[str] = None

class Recommendation(BaseModel):
    reason: str
    fix: str
    commands: List[str]
    confidence: int
    raw_findings: Dict[str, Any]
