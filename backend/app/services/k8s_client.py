import time

from kubernetes import client, config
from kubernetes.client.rest import ApiException
from kubernetes.config.config_exception import ConfigException

class KubernetesService:
    def __init__(self):
        try:
            config.load_incluster_config()
        except ConfigException:
            try:
                config.load_kube_config()
            except ConfigException as exc:
                raise RuntimeError(
                    "Kubernetes configuration was not found. Run inside a cluster "
                    "with a service account or provide a valid kubeconfig."
                ) from exc
        self.core = client.CoreV1Api()
        self.apps = client.AppsV1Api()
        self.networking = client.NetworkingV1Api()
        self.custom = client.CustomObjectsApi()

    def list_nodes(self):
        return self.core.list_node().items

    def list_pods(self, namespace=None):
        if namespace:
            return self.core.list_namespaced_pod(namespace).items
        return self.core.list_pod_for_all_namespaces().items

    def get_pod(self, namespace, pod_name):
        return self.core.read_namespaced_pod(pod_name, namespace)

    def get_pod_events(self, namespace, pod_name):
        field_selector = f"involvedObject.name={pod_name}"
        return self.core.list_namespaced_event(namespace, field_selector=field_selector).items

    def list_events(self, namespace=None):
        if namespace:
            return self.core.list_namespaced_event(namespace).items
        return self.core.list_event_for_all_namespaces().items

    def get_pod_logs(self, namespace, pod_name, container=None, previous=False, tail_lines=200):
        try:
            return self.core.read_namespaced_pod_log(
                name=pod_name,
                namespace=namespace,
                container=container,
                previous=previous,
                tail_lines=tail_lines,
            )
        except ApiException as exc:
            return f"Unable to fetch logs: {exc.reason}"

    def list_pvcs(self, namespace):
        return self.core.list_namespaced_persistent_volume_claim(namespace).items

    def list_services(self, namespace=None):
        if namespace:
            return self.core.list_namespaced_service(namespace).items
        return self.core.list_service_for_all_namespaces().items

    def list_deployments(self, namespace=None):
        if namespace:
            return self.apps.list_namespaced_deployment(namespace).items
        return self.apps.list_deployment_for_all_namespaces().items

    def list_ingresses(self, namespace=None):
        if namespace:
            return self.networking.list_namespaced_ingress(namespace).items
        return self.networking.list_ingress_for_all_namespaces().items

    def get_metrics_summary(self):
        nodes = self.list_nodes()
        pods = self.list_pods()
        node_metrics = safe_metrics_call(
            self.custom.list_cluster_custom_object,
            "metrics.k8s.io",
            "v1beta1",
            "nodes",
        )
        pod_metrics = safe_metrics_call(
            self.custom.list_cluster_custom_object,
            "metrics.k8s.io",
            "v1beta1",
            "pods",
        )
        timestamp = int(time.time())

        node_capacity = {}
        pod_node = {}
        pod_resources = {}

        for node in nodes:
            allocatable = node.status.allocatable or {}
            node_capacity[node.metadata.name] = {
                "cpu": parse_cpu(allocatable.get("cpu")),
                "memory": parse_memory(allocatable.get("memory")),
            }

        for pod in pods:
            key = f"{pod.metadata.namespace}/{pod.metadata.name}"
            pod_node[key] = pod.spec.node_name
            resources = {"cpu": 0, "memory": 0}
            for container in pod.spec.containers or []:
                limits = (container.resources.limits or {}) if container.resources else {}
                requests = (container.resources.requests or {}) if container.resources else {}
                resources["cpu"] += parse_cpu(requests.get("cpu") or limits.get("cpu"))
                resources["memory"] += parse_memory(requests.get("memory") or limits.get("memory"))
            pod_resources[key] = resources

        node_cpu_rows = []
        node_memory_rows = []
        total_node_cpu = 0
        used_node_cpu = 0
        total_node_memory = 0
        used_node_memory = 0

        for item in node_metrics.get("items", []):
            name = item.get("metadata", {}).get("name", "")
            usage = item.get("usage", {})
            used_cpu = parse_cpu(usage.get("cpu"))
            used_memory = parse_memory(usage.get("memory"))
            capacity = node_capacity.get(name, {})
            cpu_capacity = capacity.get("cpu") or 0
            memory_capacity = capacity.get("memory") or 0

            if cpu_capacity:
                percent = (used_cpu / cpu_capacity) * 100
                node_cpu_rows.append(prom_row({"node": name, "source": "kubernetes-metrics-api"}, percent, timestamp))
                total_node_cpu += cpu_capacity
                used_node_cpu += used_cpu

            if memory_capacity:
                percent = (used_memory / memory_capacity) * 100
                node_memory_rows.append(prom_row({"node": name, "source": "kubernetes-metrics-api"}, percent, timestamp))
                total_node_memory += memory_capacity
                used_node_memory += used_memory

        pod_cpu_rows = []
        pod_memory_rows = []
        pod_cpu_usage_rows = []
        pod_memory_usage_rows = []
        requested_node_cpu = {}
        requested_node_memory = {}

        for item in pod_metrics.get("items", []):
            metadata = item.get("metadata", {})
            namespace = metadata.get("namespace", "")
            pod_name = metadata.get("name", "")
            key = f"{namespace}/{pod_name}"
            used_cpu = 0
            used_memory = 0
            for container in item.get("containers", []):
                usage = container.get("usage", {})
                used_cpu += parse_cpu(usage.get("cpu"))
                used_memory += parse_memory(usage.get("memory"))

            metric = {"namespace": namespace, "pod": pod_name, "source": "kubernetes-metrics-api"}
            pod_cpu_usage_rows.append(prom_row(metric, used_cpu, timestamp))
            pod_memory_usage_rows.append(prom_row(metric, used_memory, timestamp))

            resources = pod_resources.get(key, {})
            requested_cpu = resources.get("cpu") or 0
            requested_memory = resources.get("memory") or 0
            node = pod_node.get(key)
            node_cpu = (node_capacity.get(node, {}) or {}).get("cpu") or 0
            node_memory = (node_capacity.get(node, {}) or {}).get("memory") or 0

            cpu_base = requested_cpu or node_cpu
            memory_base = requested_memory or node_memory
            if cpu_base:
                pod_cpu_rows.append(prom_row(metric, (used_cpu / cpu_base) * 100, timestamp))
            if memory_base:
                pod_memory_rows.append(prom_row(metric, (used_memory / memory_base) * 100, timestamp))

        has_pod_cpu_metrics = bool(pod_cpu_rows)
        has_pod_memory_metrics = bool(pod_memory_rows)
        has_pod_cpu_usage_metrics = bool(pod_cpu_usage_rows)
        has_pod_memory_usage_metrics = bool(pod_memory_usage_rows)

        for key, resources in pod_resources.items():
            node = pod_node.get(key)
            if not node:
                continue
            requested_node_cpu[node] = requested_node_cpu.get(node, 0) + (resources.get("cpu") or 0)
            requested_node_memory[node] = requested_node_memory.get(node, 0) + (resources.get("memory") or 0)

            namespace, pod_name = key.split("/", 1)
            metric = {"namespace": namespace, "pod": pod_name, "source": "kubernetes-resource-requests"}
            node_cpu = (node_capacity.get(node, {}) or {}).get("cpu") or 0
            node_memory = (node_capacity.get(node, {}) or {}).get("memory") or 0
            requested_cpu = resources.get("cpu") or 0
            requested_memory = resources.get("memory") or 0

            if not has_pod_cpu_metrics and node_cpu:
                pod_cpu_rows.append(prom_row(metric, (requested_cpu / node_cpu) * 100, timestamp))
            if not has_pod_memory_metrics and node_memory:
                pod_memory_rows.append(prom_row(metric, (requested_memory / node_memory) * 100, timestamp))
            if not has_pod_cpu_usage_metrics:
                pod_cpu_usage_rows.append(prom_row(metric, requested_cpu, timestamp))
            if not has_pod_memory_usage_metrics:
                pod_memory_usage_rows.append(prom_row(metric, requested_memory, timestamp))

        if not node_cpu_rows:
            for name in node_capacity:
                requested_cpu = requested_node_cpu.get(name, 0)
                capacity = (node_capacity.get(name, {}) or {}).get("cpu") or 0
                if capacity:
                    node_cpu_rows.append(prom_row({"node": name, "source": "kubernetes-resource-requests"}, (requested_cpu / capacity) * 100, timestamp))
                    total_node_cpu += capacity
                    used_node_cpu += requested_cpu

        if not node_memory_rows:
            for name in node_capacity:
                requested_memory = requested_node_memory.get(name, 0)
                capacity = (node_capacity.get(name, {}) or {}).get("memory") or 0
                if capacity:
                    node_memory_rows.append(prom_row({"node": name, "source": "kubernetes-resource-requests"}, (requested_memory / capacity) * 100, timestamp))
                    total_node_memory += capacity
                    used_node_memory += requested_memory

        cluster_source = "kubernetes-metrics-api" if node_metrics.get("items") else "kubernetes-resource-requests"
        return {
            "cluster_cpu": prom_response([prom_row({"source": cluster_source}, (used_node_cpu / total_node_cpu) * 100, timestamp)] if total_node_cpu else []),
            "cluster_memory": prom_response([prom_row({"source": cluster_source}, (used_node_memory / total_node_memory) * 100, timestamp)] if total_node_memory else []),
            "node_cpu": prom_response(node_cpu_rows),
            "node_memory": prom_response(node_memory_rows),
            "pod_cpu": prom_response(pod_cpu_rows),
            "pod_memory": prom_response(pod_memory_rows),
            "pod_cpu_usage": prom_response(pod_cpu_usage_rows),
            "pod_memory_usage": prom_response(pod_memory_usage_rows),
        }


def parse_cpu(value):
    if value is None:
        return 0
    text = str(value).strip()
    if not text:
        return 0
    try:
        if text.endswith("n"):
            return float(text[:-1]) / 1_000_000_000
        if text.endswith("u"):
            return float(text[:-1]) / 1_000_000
        if text.endswith("m"):
            return float(text[:-1]) / 1_000
        return float(text)
    except ValueError:
        return 0


def parse_memory(value):
    if value is None:
        return 0
    text = str(value).strip()
    if not text:
        return 0
    units = {
        "Ki": 1024,
        "Mi": 1024 ** 2,
        "Gi": 1024 ** 3,
        "Ti": 1024 ** 4,
        "K": 1000,
        "M": 1000 ** 2,
        "G": 1000 ** 3,
        "T": 1000 ** 4,
    }
    try:
        for suffix, multiplier in units.items():
            if text.endswith(suffix):
                return float(text[:-len(suffix)]) * multiplier
        return float(text)
    except ValueError:
        return 0


def prom_row(metric, value, timestamp):
    return {
        "metric": metric,
        "value": [timestamp, str(round(value, 4))],
    }


def prom_response(rows):
    return {
        "status": "success",
        "data": {
            "resultType": "vector",
            "result": rows,
        },
    }


def safe_metrics_call(func, *args):
    try:
        return func(*args)
    except Exception:
        return {"items": []}
