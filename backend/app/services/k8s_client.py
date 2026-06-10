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

    def get_metrics_summary(self):
        # Metrics API may not exist in all clusters. Prometheus service handles deep metrics.
        return {"message": "Use Prometheus endpoint /api/cluster/prometheus for detailed metrics."}
