import os
from openai import OpenAI

KUBERNETES_DOC_SOURCES = [
    {
        "title": "Kubernetes: Debug Pods",
        "url": "https://kubernetes.io/docs/tasks/debug/debug-application/debug-pods/",
        "keywords": ["pod", "pending", "crashloopbackoff", "imagepullbackoff", "logs", "events"],
    },
    {
        "title": "Kubernetes: Debug Services",
        "url": "https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/",
        "keywords": ["service", "endpoint", "dns", "network", "nodeport", "clusterip"],
    },
    {
        "title": "Kubernetes: Persistent Volumes",
        "url": "https://kubernetes.io/docs/concepts/storage/persistent-volumes/",
        "keywords": ["pvc", "pv", "persistentvolume", "storageclass", "volume", "unbound"],
    },
    {
        "title": "Kubernetes: Configure Resources",
        "url": "https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/",
        "keywords": ["oom", "memory", "cpu", "resource", "limit", "request"],
    },
    {
        "title": "Kubernetes: Pull an Image from a Private Registry",
        "url": "https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/",
        "keywords": ["imagepullbackoff", "errimagepull", "registry", "secret", "dockerhub", "ghcr"],
    },
]

class LLMService:
    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.client = OpenAI(api_key=self.api_key) if self.api_key else None

    def explain(self, question: str, rule_result: dict):
        sources = self._select_sources(question, rule_result)
        enhanced = dict(rule_result)
        enhanced["sources"] = sources
        enhanced["ai_explanation"] = self._fallback_answer(question, enhanced, sources)

        if "healthy" in enhanced.get("reason", "").lower() and enhanced.get("confidence", 0) >= 95:
            return enhanced

        if not self.client:
            return enhanced

        try:
            response = self.client.chat.completions.create(
                model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a senior Kubernetes SRE inside a cluster support chat. "
                            "Answer like ChatGPT: direct, calm, structured, and specific. "
                            "Use the provided live Kubernetes findings first. Use the Kubernetes "
                            "documentation links as grounding references. Do not claim that you "
                            "browsed ChatGPT or any private website. Never invent cluster data. "
                            "Warn before destructive commands."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"User question:\n{question}\n\n"
                            f"Live Kubernetes findings:\n{rule_result}\n\n"
                            f"Relevant Kubernetes docs:\n{sources}\n\n"
                            "Important command rules:\n"
                            "- Use only the exact kubectl commands from Live Kubernetes findings.commands.\n"
                            "- Do not output placeholder commands such as <pod>, <namespace>, <node>, or <pvc>.\n"
                            "- If the pod is healthy, say directly that it is running healthy and successfully.\n\n"
                            "Return a concise answer with these sections:\n"
                            "1. What is happening\n"
                            "2. Most likely root cause\n"
                            "3. Fix steps\n"
                            "4. Commands to verify\n"
                            "5. Risk / caution\n"
                            "6. Sources"
                        ),
                    },
                ],
                temperature=0.2,
            )
            enhanced["ai_explanation"] = response.choices[0].message.content
        except Exception as exc:
            enhanced["ai_error"] = f"Unable to get AI explanation: {exc}"
        return enhanced

    def _select_sources(self, question: str, rule_result: dict):
        text = f"{question} {rule_result}".lower()
        matches = [
            {"title": source["title"], "url": source["url"]}
            for source in KUBERNETES_DOC_SOURCES
            if any(keyword in text for keyword in source["keywords"])
        ]
        if not matches:
            matches = [
                {
                    "title": KUBERNETES_DOC_SOURCES[0]["title"],
                    "url": KUBERNETES_DOC_SOURCES[0]["url"],
                }
            ]
        return matches[:3]

    def _fallback_answer(self, question: str, result: dict, sources: list):
        commands = "\n".join(f"- `{command}`" for command in result.get("commands", []))
        source_lines = "\n".join(f"- {source['title']}: {source['url']}" for source in sources)
        is_healthy = "healthy" in result.get("reason", "").lower() and result.get("confidence", 0) >= 95
        fix_steps = (
            "No fix is required. Keep these commands only for verification or future troubleshooting."
            if is_healthy
            else "Start with the commands below, then update the workload or cluster resource that matches the failing event."
        )
        caution = (
            "No action is needed for this pod right now."
            if is_healthy
            else "Do not delete pods, PVCs, secrets, or nodes until you confirm the owner workload and data impact."
        )
        return (
            f"### What is happening\n"
            f"{result.get('reason', 'The cluster returned findings for this request.')}\n\n"
            f"### Most likely root cause\n"
            f"{result.get('fix', 'Review pod events, logs, node status, and storage status to narrow the issue.')}\n\n"
            f"### Fix steps\n"
            f"{fix_steps}\n\n"
            f"### Commands to verify\n"
            f"{commands or '- `kubectl get events -A --sort-by=.lastTimestamp`'}\n\n"
            f"### Risk / caution\n"
            f"{caution}\n\n"
            f"### Sources\n"
            f"{source_lines}"
        )
