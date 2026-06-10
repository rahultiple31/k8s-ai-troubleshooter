class RulesEngine:
    def analyze_pod(self, pod, events, logs, nodes, pvcs):
        namespace = pod.metadata.namespace
        pod_name = pod.metadata.name
        node_name = pod.spec.node_name
        pvc_names = [
            volume.persistent_volume_claim.claim_name
            for volume in (pod.spec.volumes or [])
            if volume.persistent_volume_claim
        ]
        container_statuses = pod.status.container_statuses or []
        restart_count = sum(status.restart_count for status in container_statuses)
        all_containers_ready = bool(container_statuses) and all(status.ready for status in container_statuses)

        findings = {
            "namespace": namespace,
            "pod_name": pod_name,
            "pod_phase": pod.status.phase,
            "pod_reason": pod.status.reason,
            "node_name": node_name,
            "container_ready": all_containers_ready,
            "restart_count": restart_count,
            "pvc_names": pvc_names,
            "events": [f"{e.reason}: {e.message}" for e in events],
            "logs_tail": logs[-2000:] if logs else "",
            "node_count": len(nodes),
            "pvc_count": len(pvcs),
        }

        event_text = "\n".join(findings["events"]).lower()
        log_text = (logs or "").lower()
        warning_text = ["warning", "failed", "back-off", "unhealthy", "error", "imagepullbackoff", "errimagepull", "oomkilled"]

        base_commands = [
            f"kubectl get pod {pod_name} -n {namespace} -o wide",
            f"kubectl describe pod {pod_name} -n {namespace}",
            f"kubectl logs {pod_name} -n {namespace} --tail=200",
            f"kubectl get events -n {namespace} --field-selector involvedObject.name={pod_name} --sort-by=.lastTimestamp",
        ]

        if pod.status.phase == "Running" and all_containers_ready and not any(word in event_text for word in warning_text):
            return {
                "reason": f"Pod {namespace}/{pod_name} is running healthy and successfully.",
                "fix": "No fix is required right now. The pod is Running, containers are ready, and no matching warning events were found.",
                "commands": base_commands,
                "confidence": 98,
                "raw_findings": findings,
            }

        if pod.status.phase == "Pending":
            if "insufficient cpu" in event_text or "insufficient memory" in event_text:
                return {
                    "reason": "Pod is pending because cluster nodes do not have enough CPU or memory.",
                    "fix": "Increase node group capacity, reduce pod resource requests, or move workload to a larger node pool.",
                    "commands": [
                        f"kubectl describe pod {pod_name} -n {namespace}",
                        f"kubectl get pod {pod_name} -n {namespace} -o yaml",
                        "kubectl top nodes",
                        f"kubectl get events -n {namespace} --field-selector involvedObject.name={pod_name} --sort-by=.lastTimestamp",
                    ],
                    "confidence": 92,
                    "raw_findings": findings,
                }
            if "taint" in event_text:
                return {
                    "reason": "Pod is pending because available nodes have taints that the pod does not tolerate.",
                    "fix": "Add a matching toleration to the pod/deployment or remove the node taint if safe.",
                    "commands": [
                        f"kubectl describe pod {pod_name} -n {namespace}",
                        f"kubectl get pod {pod_name} -n {namespace} -o yaml",
                        "kubectl describe nodes",
                        f"kubectl get events -n {namespace} --field-selector involvedObject.name={pod_name} --sort-by=.lastTimestamp",
                    ],
                    "confidence": 88,
                    "raw_findings": findings,
                }
            if "persistentvolumeclaim" in event_text or "unbound" in event_text:
                pvc_commands = [f"kubectl describe pvc {pvc_name} -n {namespace}" for pvc_name in pvc_names]
                return {
                    "reason": "Pod is pending because its PersistentVolumeClaim is not bound.",
                    "fix": "Check PVC, StorageClass, CSI driver, and available PV capacity.",
                    "commands": [
                        f"kubectl describe pod {pod_name} -n {namespace}",
                        f"kubectl get pvc -n {namespace}",
                        *pvc_commands,
                        "kubectl get storageclass",
                        f"kubectl get events -n {namespace} --field-selector involvedObject.name={pod_name} --sort-by=.lastTimestamp",
                    ],
                    "confidence": 90,
                    "raw_findings": findings,
                }

        if "imagepullbackoff" in event_text or "errimagepull" in event_text or "pull image" in event_text:
            return {
                "reason": "Pod cannot pull its container image.",
                "fix": "Check the image name, tag, registry access, and any imagePullSecrets used by the workload.",
                "commands": [
                    f"kubectl describe pod {pod_name} -n {namespace}",
                    f"kubectl get pod {pod_name} -n {namespace} -o jsonpath='{{.spec.containers[*].image}}'",
                    f"kubectl get secret -n {namespace}",
                    f"kubectl get events -n {namespace} --field-selector involvedObject.name={pod_name} --sort-by=.lastTimestamp",
                ],
                "confidence": 92,
                "raw_findings": findings,
            }

        if "crashloopbackoff" in event_text or "back-off restarting" in event_text:
            return {
                "reason": "Pod is in CrashLoopBackOff because the container repeatedly exits after starting.",
                "fix": "Check application logs, environment variables, config maps, secrets, probes, and resource limits.",
                "commands": [
                    f"kubectl logs {pod_name} -n {namespace} --previous --tail=200",
                    f"kubectl logs {pod_name} -n {namespace} --tail=200",
                    f"kubectl describe pod {pod_name} -n {namespace}",
                    f"kubectl get configmap,secret -n {namespace}",
                    f"kubectl get events -n {namespace} --field-selector involvedObject.name={pod_name} --sort-by=.lastTimestamp",
                ],
                "confidence": 89,
                "raw_findings": findings,
            }

        if "oomkilled" in event_text or "out of memory" in log_text:
            return {
                "reason": "Container may be failing due to memory pressure or OOMKilled events.",
                "fix": "Increase memory limit/request or optimize application memory usage.",
                "commands": [
                    f"kubectl describe pod {pod_name} -n {namespace}",
                    f"kubectl top pod {pod_name} -n {namespace}",
                    f"kubectl logs {pod_name} -n {namespace} --previous --tail=200",
                    f"kubectl get events -n {namespace} --field-selector involvedObject.name={pod_name} --sort-by=.lastTimestamp",
                ],
                "confidence": 85,
                "raw_findings": findings,
            }

        return {
            "reason": "No exact rule matched. AI should review events, logs, metrics, and Kubernetes object status.",
            "fix": "Start with pod describe, recent events, container logs, node capacity, PVC status, and service endpoints.",
            "commands": base_commands,
            "confidence": 60,
            "raw_findings": findings,
        }
