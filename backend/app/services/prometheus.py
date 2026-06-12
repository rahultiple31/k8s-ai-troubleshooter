import os
import asyncio
from datetime import datetime, timedelta, timezone
import httpx

DEFAULT_PROMETHEUS_URLS = [
    "http://prometheus-server.monitoring.svc.cluster.local",
    "http://prometheus-server.monitoring.svc.cluster.local:80",
    "http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090",
    "http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090",
    "http://prometheus-operated.monitoring.svc.cluster.local:9090",
    "http://prometheus.monitoring.svc.cluster.local:9090",
]
PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", DEFAULT_PROMETHEUS_URLS[0])
PROMETHEUS_URLS = [
    item.strip().rstrip("/")
    for item in os.getenv("PROMETHEUS_URLS", ",".join([PROMETHEUS_URL, *DEFAULT_PROMETHEUS_URLS])).split(",")
    if item.strip()
]
COREDNS_SELECTOR = os.getenv("COREDNS_PROMETHEUS_SELECTOR", 'job=~"coredns|kube-dns"')

class PrometheusService:
    _active_url = None

    def prometheus_urls(self):
        seen = set()
        urls = []
        for url in [self._active_url, *PROMETHEUS_URLS]:
            if url and url not in seen:
                urls.append(url)
                seen.add(url)
        return urls

    async def request(self, path: str, params: dict):
        errors = []
        async with httpx.AsyncClient(timeout=10) as client:
            for base_url in self.prometheus_urls():
                try:
                    response = await client.get(f"{base_url}{path}", params=params)
                    response.raise_for_status()
                    self.__class__._active_url = base_url
                    return response.json()
                except Exception as exc:
                    errors.append(f"{base_url}: {exc}")
        raise RuntimeError("; ".join(errors) or "Prometheus request failed")

    async def query(self, promql: str):
        response = await self.request("/api/v1/query", {"query": promql})
        return self.strip_image_labels(response)

    async def query_range(self, promql: str, minutes: int = 60, step: str = "60s"):
        end = datetime.now(timezone.utc)
        start = end - timedelta(minutes=minutes)
        response = await self.request(
            "/api/v1/query_range",
            {
                "query": promql,
                "start": start.isoformat(),
                "end": end.isoformat(),
                "step": step,
            },
        )
        return self.strip_image_labels(response)

    def strip_image_labels(self, response):
        if not isinstance(response, dict):
            return response
        for item in response.get("data", {}).get("result", []):
            metric = item.get("metric") if isinstance(item, dict) else None
            if not isinstance(metric, dict):
                continue
            for label in ("image", "image_id", "container_id"):
                metric.pop(label, None)
        return response

    async def query_first(self, promql_options):
        last_response = None
        last_error = None
        for promql in promql_options:
            try:
                response = await self.query(promql)
                last_response = response
                if response.get("data", {}).get("result"):
                    return response
            except Exception as exc:
                last_error = exc
        if last_response is not None:
            return last_response
        if last_error:
            raise last_error
        return {"status": "success", "data": {"result": []}}

    async def node_cpu(self):
        return await self.query('100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)')

    async def node_memory(self):
        return await self.query('(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100')

    async def pod_restarts(self):
        return await self.query('increase(kube_pod_container_status_restarts_total[15m])')

    async def coredns_dashboard(self):
        selector = COREDNS_SELECTOR
        errors = {}

        queries = {
            "requests_by_instance": self.query(f"sum by(instance)(rate(coredns_dns_requests_total{{{selector}}}[5m]))"),
            "requests_by_type": self.query(f"sum by(type)(rate(coredns_dns_requests_total{{{selector}}}[5m]))"),
            "responses_by_code": self.query(f"sum by(rcode)(rate(coredns_dns_responses_total{{{selector}}}[5m]))"),
            "cache_hits": self.query(f"sum(rate(coredns_cache_hits_total{{{selector}}}[5m]))"),
            "cache_misses": self.query(f"sum(rate(coredns_cache_misses_total{{{selector}}}[5m]))"),
            "panics": self.query(f"sum(increase(coredns_panics_total{{{selector}}}[1h]))"),
            "failed_reloads": self.query(f"sum(increase(coredns_reload_failed_total{{{selector}}}[1h]))"),
            "requests_total_range": self.query_range(f"sum(rate(coredns_dns_requests_total{{{selector}}}[5m]))"),
            "responses_range": self.query_range(f"sum by(rcode)(rate(coredns_dns_responses_total{{{selector}}}[5m]))"),
            "cache_hits_range": self.query_range(f"sum(rate(coredns_cache_hits_total{{{selector}}}[5m]))"),
            "cache_misses_range": self.query_range(f"sum(rate(coredns_cache_misses_total{{{selector}}}[5m]))"),
            "memory": self.query(f"sum(process_resident_memory_bytes{{{selector}}})"),
            "cpu": self.query(f"sum(rate(process_cpu_seconds_total{{{selector}}}[5m]))"),
        }
        values = await asyncio.gather(*(safe_call(name, query, errors) for name, query in queries.items()))
        return {
            **dict(zip(queries.keys(), values)),
            "errors": errors,
        }

    async def cluster_dashboard(self):
        errors = {}
        node_cpu_by_instance = '100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'
        node_cpu_by_node = '100 - (avg by(node)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'
        pod_cpu_usage = 'sum by(namespace,pod)(rate(container_cpu_usage_seconds_total{container!="",container!="POD",pod!=""}[5m]))'
        pod_memory_usage = 'sum by(namespace,pod)(container_memory_working_set_bytes{container!="",container!="POD",pod!=""})'
        pod_storage_usage = 'sum by(namespace,pod)(container_fs_usage_bytes{container!="",container!="POD",pod!=""})'
        queries = {
            "cluster_cpu": self.query_first([
                f"avg({node_cpu_by_instance})",
                f"avg({node_cpu_by_node})",
            ]),
            "cluster_memory": self.query('100 * (1 - (sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)))'),
            "cluster_storage": self.query(
                '100 * (1 - (sum(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay",mountpoint!~"/run.*|/var/lib/kubelet/pods.*"}) / sum(node_filesystem_size_bytes{fstype!~"tmpfs|overlay",mountpoint!~"/run.*|/var/lib/kubelet/pods.*"})))'
            ),
            "node_cpu": self.query_first([node_cpu_by_instance, node_cpu_by_node]),
            "node_memory": self.query('(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100'),
            "node_storage": self.query(
                'max by(instance)(100 - ((node_filesystem_avail_bytes{fstype!~"tmpfs|overlay",mountpoint!~"/run.*|/var/lib/kubelet/pods.*"} * 100) / node_filesystem_size_bytes{fstype!~"tmpfs|overlay",mountpoint!~"/run.*|/var/lib/kubelet/pods.*"}))'
            ),
            "pod_cpu": self.query_first([
                f'100 * {pod_cpu_usage} / clamp_min(sum by(namespace,pod)(kube_pod_container_resource_limits{{resource="cpu",unit=~"core|cores"}}), 0.001)',
                f'100 * {pod_cpu_usage} / clamp_min(sum by(namespace,pod)(kube_pod_container_resource_requests{{resource="cpu",unit=~"core|cores"}}), 0.001)',
            ]),
            "pod_memory": self.query_first([
                f'100 * {pod_memory_usage} / clamp_min(sum by(namespace,pod)(kube_pod_container_resource_limits{{resource="memory",unit=~"byte|bytes"}}), 1)',
                f'100 * {pod_memory_usage} / clamp_min(sum by(namespace,pod)(kube_pod_container_resource_requests{{resource="memory",unit=~"byte|bytes"}}), 1)',
            ]),
            "pod_storage": self.query_first([
                '100 * sum by(namespace,pod)(container_fs_usage_bytes{container!="",container!="POD",pod!=""}) / '
                'clamp_min(sum by(namespace,pod)(container_fs_limit_bytes{container!="",container!="POD",pod!=""}), 1)',
            ]),
            "pod_cpu_usage": self.query(pod_cpu_usage),
            "pod_memory_usage": self.query(pod_memory_usage),
            "pod_storage_usage": self.query(pod_storage_usage),
            "pod_restarts": self.query('sum by(namespace,pod)(increase(kube_pod_container_status_restarts_total[15m]))'),
            "http_errors_code": self.query(
                '100 * sum by(namespace,service,code)(rate({__name__=~"http_requests_total|http_server_requests_seconds_count|nginx_ingress_controller_requests|traefik_service_requests_total|istio_requests_total",code=~"4..|5.."}[5m])) / ignoring(code) group_left clamp_min(sum by(namespace,service)(rate({__name__=~"http_requests_total|http_server_requests_seconds_count|nginx_ingress_controller_requests|traefik_service_requests_total|istio_requests_total"}[5m])), 1)'
            ),
            "http_errors_status": self.query(
                '100 * sum by(namespace,service,status)(rate({__name__=~"http_requests_total|http_server_requests_seconds_count|nginx_ingress_controller_requests|traefik_service_requests_total|istio_requests_total",status=~"4..|5.."}[5m])) / ignoring(status) group_left clamp_min(sum by(namespace,service)(rate({__name__=~"http_requests_total|http_server_requests_seconds_count|nginx_ingress_controller_requests|traefik_service_requests_total|istio_requests_total"}[5m])), 1)'
            ),
            "https_errors_code": self.query(
                '100 * sum by(namespace,service,code)(rate({__name__=~"http_requests_total|http_server_requests_seconds_count|nginx_ingress_controller_requests|traefik_service_requests_total|istio_requests_total",scheme="https",code=~"4..|5.."}[5m])) / ignoring(code) group_left clamp_min(sum by(namespace,service)(rate({__name__=~"http_requests_total|http_server_requests_seconds_count|nginx_ingress_controller_requests|traefik_service_requests_total|istio_requests_total",scheme="https"}[5m])), 1)'
            ),
            "https_errors_status": self.query(
                '100 * sum by(namespace,service,status)(rate({__name__=~"http_requests_total|http_server_requests_seconds_count|nginx_ingress_controller_requests|traefik_service_requests_total|istio_requests_total",scheme="https",status=~"4..|5.."}[5m])) / ignoring(status) group_left clamp_min(sum by(namespace,service)(rate({__name__=~"http_requests_total|http_server_requests_seconds_count|nginx_ingress_controller_requests|traefik_service_requests_total|istio_requests_total",scheme="https"}[5m])), 1)'
            ),
        }
        values = await asyncio.gather(*(safe_call(name, query, errors) for name, query in queries.items()))
        return {
            **dict(zip(queries.keys(), values)),
            "prometheus": {
                "active_url": self._active_url,
                "configured_urls": self.prometheus_urls(),
            },
            "errors": errors,
        }


async def safe_call(name, query, errors):
    try:
        return await query
    except Exception as exc:
        errors[name] = str(exc)
        return {"status": "error", "data": {"result": []}, "error": str(exc)}
