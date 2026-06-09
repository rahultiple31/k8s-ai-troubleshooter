class RulesEngine:
    def analyze_pod(self, pod, events, logs, nodes, pvcs):
        findings = {
            "pod_phase": pod.status.phase,
            "pod_reason": pod.status.reason,
            "events": [f"{e.reason}: {e.message}" for e in events],
            "logs_tail": logs[-2000:] if logs else "",
            "node_count": len(nodes),
            "pvc_count": len(pvcs),
        }

        event_text = "\n".join(findings["events"]).lower()
        log_text = (logs or "").lower()

        if pod.status.phase == "Pending":
            if "insufficient cpu" in event_text or "insufficient memory" in event_text:
                return {
                    "reason": "Pod is pending because cluster nodes do not have enough CPU or memory.",
                    "fix": "Increase node group capacity, reduce pod resource requests, or move workload to a larger node pool.",
                    "commands": [
                        "kubectl describe pod <pod> -n <namespace>",
                        "kubectl top nodes",
                        "kubectl get events -n <namespace> --sort-by=.lastTimestamp",
                        "aws eks update-nodegroup-config --cluster-name <cluster> --nodegroup-name <nodegroup> --scaling-config desiredSize=<new-size>",
                    ],
                    "confidence": 92,
                    "raw_findings": findings,
                }
            if "taint" in event_text:
                return {
                    "reason": "Pod is pending because available nodes have taints that the pod does not tolerate.",
                    "fix": "Add a matching toleration to the pod/deployment or remove the node taint if safe.",
                    "commands": [
                        "kubectl describe node <node>",
                        "kubectl taint nodes <node> <key>:<effect>-",
                    ],
                    "confidence": 88,
                    "raw_findings": findings,
                }
            if "persistentvolumeclaim" in event_text or "unbound" in event_text:
                return {
                    "reason": "Pod is pending because its PersistentVolumeClaim is not bound.",
                    "fix": "Check PVC, StorageClass, CSI driver, and available PV capacity.",
                    "commands": [
                        "kubectl get pvc -n <namespace>",
                        "kubectl describe pvc <pvc> -n <namespace>",
                        "kubectl get storageclass",
                    ],
                    "confidence": 90,
                    "raw_findings": findings,
                }

        if "crashloopbackoff" in event_text or "back-off restarting" in event_text:
            return {
                "reason": "Pod is in CrashLoopBackOff because the container repeatedly exits after starting.",
                "fix": "Check application logs, environment variables, config maps, secrets, probes, and resource limits.",
                "commands": [
                    "kubectl logs <pod> -n <namespace> --previous",
                    "kubectl describe pod <pod> -n <namespace>",
                    "kubectl get configmap,secret -n <namespace>",
                ],
                "confidence": 89,
                "raw_findings": findings,
            }

        if "oomkilled" in event_text or "out of memory" in log_text:
            return {
                "reason": "Container may be failing due to memory pressure or OOMKilled events.",
                "fix": "Increase memory limit/request or optimize application memory usage.",
                "commands": [
                    "kubectl describe pod <pod> -n <namespace> | grep -i oom -A5",
                    "kubectl top pod <pod> -n <namespace>",
                ],
                "confidence": 85,
                "raw_findings": findings,
            }

        return {
            "reason": "No exact rule matched. AI should review events, logs, metrics, and Kubernetes object status.",
            "fix": "Start with pod describe, recent events, container logs, node capacity, PVC status, and service endpoints.",
            "commands": [
                "kubectl describe pod <pod> -n <namespace>",
                "kubectl logs <pod> -n <namespace> --tail=200",
                "kubectl get events -n <namespace> --sort-by=.lastTimestamp",
            ],
            "confidence": 60,
            "raw_findings": findings,
        }
