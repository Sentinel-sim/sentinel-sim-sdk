import httpx
import hmac
import hashlib
import time as _time
import sys
from typing import Any, Dict, List, Optional

# SDK version — sent to backend for version pinning + deprecation checks
__sdk_version__ = "0.3.0"
__sdk_language__ = "python"


class SentinelError(Exception):
    def __init__(self, message: str, status_code: int = None, detail: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail


class Sentinel:
    """
    Sentinel SDK — route any tool call through Sentinel with full observability,
    policy enforcement, and budget control.

    Usage:
        from sentinel import Sentinel

        client = Sentinel(api_key="sk_agent_...")
        result = client.execute(
            tool="create_payment_intent",
            provider="stripe",
            payload={"amount": 2000, "currency": "usd"}
        )
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:8000",
        timeout: int = 300,
        hmac_secret: Optional[str] = None,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._hmac_secret = hmac_secret
        self._client = httpx.Client(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "X-API-Key": api_key,
                "Content-Type": "application/json",
                "X-Sentinel-SDK-Version": f"{__sdk_language__}/{__sdk_version__}",
            },
            timeout=timeout,
            event_hooks={"response": [self._check_deprecation_warning]},
        )

    @staticmethod
    def _check_deprecation_warning(response: httpx.Response):
        """Print deprecation warning if backend says SDK is outdated."""
        warning = response.headers.get("x-sentinel-deprecation-warning")
        if warning:
            print(f"[sentinel] WARNING: {warning}", file=sys.stderr)

    def _sign_request(self, method: str, path: str, body: str) -> Dict[str, str]:
        """Compute HMAC-SHA256 signature for request signing."""
        if not self._hmac_secret:
            return {}
        timestamp = str(int(_time.time()))
        message = f"{timestamp}{method}{path}{body}"
        signature = hmac.new(
            self._hmac_secret.encode(), message.encode(), hashlib.sha256
        ).hexdigest()
        return {
            "X-Sentinel-Signature": signature,
            "X-Sentinel-Timestamp": timestamp,
        }

    # ── Core execute ─────────────────────────────────────────────────────────

    def execute(
        self,
        tool: str,
        provider: str,
        payload: Dict[str, Any],
        *,
        provider_credentials: Optional[Dict[str, str]] = None,
        idempotency_key: Optional[str] = None,
        priority: str = "normal",
        timeout_seconds: int = 300,
    ) -> Dict[str, Any]:
        """
        Execute a tool via Sentinel.

        Args:
            tool: Tool name (e.g. "chat", "create_payment_intent")
            provider: Provider name (e.g. "openai", "stripe")
            payload: Tool-specific parameters
            provider_credentials: Optional per-request provider API keys (never stored).
                e.g. {"openai": "sk-..."}
            idempotency_key: Optional key to prevent duplicate executions
            priority: "low" | "normal" | "high" | "urgent"
            timeout_seconds: Max execution time
        """
        body: Dict[str, Any] = {
            "tool": tool,
            "provider": provider,
            "payload": {**payload, **({"provider_credentials": provider_credentials} if provider_credentials else {})},
            "priority": priority,
            "timeout_seconds": timeout_seconds,
        }
        if idempotency_key:
            body["idempotency_key"] = idempotency_key

        response = self._client.post("/v1/executions/execute", json=body)
        self._raise_for_status(response)
        return response.json()

    def list_executions(
        self,
        *,
        agent_id: Optional[int] = None,
        tool: Optional[str] = None,
        provider: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """List past executions with optional filters."""
        params = {"limit": limit, "offset": offset}
        if agent_id:
            params["agent_id"] = agent_id
        if tool:
            params["tool"] = tool
        if provider:
            params["provider"] = provider

        response = self._client.get("/v1/executions/", params=params)
        self._raise_for_status(response)
        return response.json()

    def get_execution(self, execution_id: str) -> Dict[str, Any]:
        """Get a specific execution by ID."""
        response = self._client.get(f"/v1/executions/{execution_id}")
        self._raise_for_status(response)
        return response.json()

    # ── OpenAI helpers ───────────────────────────────────────────────────────

    def openai_chat(
        self,
        messages: List[Dict[str, str]],
        model: str = "gpt-4o",
        *,
        max_tokens: int = 1024,
        temperature: float = 0.7,
        provider_credentials: Optional[Dict[str, str]] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Chat completion via OpenAI."""
        return self.execute(
            "chat", "openai",
            {"messages": messages, "model": model, "max_tokens": max_tokens,
             "temperature": temperature, **kwargs},
            provider_credentials=provider_credentials,
        )

    def openai_embedding(
        self,
        input: Any,
        model: str = "text-embedding-ada-002",
        *,
        provider_credentials: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Generate embeddings via OpenAI."""
        return self.execute(
            "embedding", "openai",
            {"input": input, "model": model},
            provider_credentials=provider_credentials,
        )

    def openai_image(
        self,
        prompt: str,
        model: str = "dall-e-3",
        *,
        size: str = "1024x1024",
        quality: str = "standard",
        n: int = 1,
        provider_credentials: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Generate images via OpenAI DALL-E."""
        return self.execute(
            "image_generation", "openai",
            {"prompt": prompt, "model": model, "size": size, "quality": quality, "n": n},
            provider_credentials=provider_credentials,
        )

    def openai_transcribe(
        self,
        file: str,
        model: str = "whisper-1",
        *,
        language: Optional[str] = None,
        provider_credentials: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Transcribe audio via OpenAI Whisper."""
        payload: Dict[str, Any] = {"file": file, "model": model}
        if language:
            payload["language"] = language
        return self.execute("transcription", "openai", payload,
                            provider_credentials=provider_credentials)

    def openai_moderation(
        self,
        input: str,
        *,
        model: str = "omni-moderation-latest",
        provider_credentials: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Run content moderation via OpenAI."""
        return self.execute("moderation", "openai",
                            {"input": input, "model": model},
                            provider_credentials=provider_credentials)

    def openai_tts(
        self,
        input: str,
        *,
        model: str = "tts-1",
        voice: str = "alloy",
        response_format: str = "mp3",
        speed: float = 1.0,
        provider_credentials: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Generate speech audio via OpenAI TTS. Returns base64 audio."""
        return self.execute("text_to_speech", "openai",
                            {"input": input, "model": model, "voice": voice,
                             "response_format": response_format, "speed": speed},
                            provider_credentials=provider_credentials)

    # ── Anthropic helpers ────────────────────────────────────────────────────

    def claude_chat(
        self,
        messages: List[Dict[str, str]],
        model: str = "claude-3-5-sonnet-20241022",
        *,
        max_tokens: int = 1024,
        provider_credentials: Optional[Dict[str, str]] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Chat via Anthropic Claude."""
        return self.execute(
            "chat", "anthropic",
            {"messages": messages, "model": model, "max_tokens": max_tokens, **kwargs},
            provider_credentials=provider_credentials,
        )

    def claude_stream(
        self,
        messages: List[Dict[str, str]],
        model: str = "claude-3-5-sonnet-20241022",
        *,
        max_tokens: int = 1024,
        provider_credentials: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Streaming chat via Anthropic Claude (returns full collected response)."""
        return self.execute(
            "stream", "anthropic",
            {"messages": messages, "model": model, "max_tokens": max_tokens},
            provider_credentials=provider_credentials,
        )

    def claude_vision(
        self,
        prompt: str,
        *,
        image_url: Optional[str] = None,
        image_base64: Optional[str] = None,
        media_type: str = "image/jpeg",
        model: str = "claude-3-5-sonnet-20241022",
        provider_credentials: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Vision (image understanding) via Anthropic Claude."""
        payload: Dict[str, Any] = {"prompt": prompt, "model": model, "media_type": media_type}
        if image_url:
            payload["image_url"] = image_url
        if image_base64:
            payload["image_base64"] = image_base64
        return self.execute("vision", "anthropic", payload,
                            provider_credentials=provider_credentials)

    def claude_tool_use(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        model: str = "claude-3-5-sonnet-20241022",
        *,
        max_tokens: int = 1024,
        provider_credentials: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Tool use / function calling via Anthropic Claude."""
        return self.execute(
            "tool_use", "anthropic",
            {"messages": messages, "tools": tools, "model": model, "max_tokens": max_tokens},
            provider_credentials=provider_credentials,
        )

    def claude_count_tokens(
        self,
        messages: List[Dict[str, str]],
        model: str = "claude-3-5-sonnet-20241022",
        *,
        provider_credentials: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Count tokens for a message set without executing."""
        return self.execute(
            "count_tokens", "anthropic",
            {"messages": messages, "model": model},
            provider_credentials=provider_credentials,
        )

    # ── GitHub helpers ───────────────────────────────────────────────────────

    def github_create_repo(self, name: str, *, description: str = "", private: bool = False,
                           files: Optional[List[Dict]] = None,
                           provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("create_repo", "github",
                            {"name": name, "description": description, "private": private,
                             "files": files or []},
                            provider_credentials=provider_credentials)

    def github_get_repo(self, repo: str, *,
                        provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("get_repo", "github", {"repo": repo},
                            provider_credentials=provider_credentials)

    def github_list_repos(self, visibility: str = "all", *,
                          provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("list_repos", "github", {"visibility": visibility},
                            provider_credentials=provider_credentials)

    def github_delete_repo(self, repo: str, *,
                           provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("delete_repo", "github", {"repo": repo},
                            provider_credentials=provider_credentials)

    def github_push_file(self, repo: str, path: str, content: str, *,
                         message: str = "update file", branch: str = "main",
                         sha: Optional[str] = None,
                         provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"repo": repo, "path": path, "content": content,
                                   "message": message, "branch": branch}
        if sha:
            payload["sha"] = sha
        return self.execute("push_file", "github", payload,
                            provider_credentials=provider_credentials)

    def github_get_file(self, repo: str, path: str, *,
                        ref: Optional[str] = None,
                        provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"repo": repo, "path": path}
        if ref:
            payload["ref"] = ref
        return self.execute("get_file", "github", payload,
                            provider_credentials=provider_credentials)

    def github_create_branch(self, repo: str, branch: str, *,
                             from_branch: str = "main",
                             provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("create_branch", "github",
                            {"repo": repo, "branch": branch, "from_branch": from_branch},
                            provider_credentials=provider_credentials)

    def github_create_issue(self, repo: str, title: str, *,
                            body: str = "", labels: Optional[List[str]] = None,
                            provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("create_issue", "github",
                            {"repo": repo, "title": title, "body": body,
                             "labels": labels or []},
                            provider_credentials=provider_credentials)

    def github_create_pr(self, repo: str, title: str, head: str, base: str, *,
                         body: str = "",
                         provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("create_pull_request", "github",
                            {"repo": repo, "title": title, "head": head,
                             "base": base, "body": body},
                            provider_credentials=provider_credentials)

    def github_merge_pr(self, repo: str, pull_number: int, *,
                        merge_method: str = "merge",
                        provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("merge_pr", "github",
                            {"repo": repo, "pull_number": pull_number,
                             "merge_method": merge_method},
                            provider_credentials=provider_credentials)

    # ── Stripe helpers ───────────────────────────────────────────────────────

    def stripe_create_payment_intent(self, amount: int, currency: str = "usd", *,
                                     provider_credentials: Optional[Dict[str, str]] = None,
                                     **kwargs) -> Dict[str, Any]:
        return self.execute("create_payment_intent", "stripe",
                            {"amount": amount, "currency": currency, **kwargs},
                            provider_credentials=provider_credentials)

    def stripe_confirm_payment(self, payment_intent_id: str, *,
                               payment_method_id: Optional[str] = None,
                               provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"payment_intent_id": payment_intent_id}
        if payment_method_id:
            payload["payment_method_id"] = payment_method_id
        return self.execute("confirm_payment_intent", "stripe", payload,
                            provider_credentials=provider_credentials)

    def stripe_create_customer(self, email: str, *,
                               name: Optional[str] = None,
                               provider_credentials: Optional[Dict[str, str]] = None,
                               **kwargs) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"email": email, **kwargs}
        if name:
            payload["name"] = name
        return self.execute("create_customer", "stripe", payload,
                            provider_credentials=provider_credentials)

    def stripe_create_refund(self, charge_id: str, *,
                             amount: Optional[int] = None,
                             provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"charge": charge_id}
        if amount:
            payload["amount"] = amount
        return self.execute("create_refund", "stripe", payload,
                            provider_credentials=provider_credentials)

    def stripe_get_balance(self, *,
                           provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("get_balance", "stripe", {},
                            provider_credentials=provider_credentials)

    def stripe_create_transfer(self, amount: int, destination: str, currency: str = "usd", *,
                               provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("create_transfer", "stripe",
                            {"amount": amount, "destination": destination, "currency": currency},
                            provider_credentials=provider_credentials)

    # ── Vercel helpers ───────────────────────────────────────────────────────

    def vercel_deploy(self, name: str, files: List[Dict[str, Any]], *,
                      target: Optional[str] = None,
                      provider_credentials: Optional[Dict[str, str]] = None,
                      **kwargs) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"name": name, "files": files, **kwargs}
        if target:
            payload["target"] = target
        return self.execute("deploy", "vercel", payload,
                            provider_credentials=provider_credentials)

    def vercel_deploy_from_git(self, repo: str, ref: str = "main", *,
                               provider_credentials: Optional[Dict[str, str]] = None,
                               **kwargs) -> Dict[str, Any]:
        return self.execute("deploy_from_git", "vercel",
                            {"git_source": {"repo": repo, "ref": ref}, **kwargs},
                            provider_credentials=provider_credentials)

    def vercel_get_deployment(self, deployment_id: str, *,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("manage_deployment", "vercel",
                            {"action": "get", "deployment_id": deployment_id},
                            provider_credentials=provider_credentials)

    def vercel_list_deployments(self, project_id: Optional[str] = None, *,
                                limit: int = 20,
                                provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"action": "list", "deployment_id": "_", "limit": limit}
        if project_id:
            payload["project_id"] = project_id
        return self.execute("manage_deployment", "vercel", payload,
                            provider_credentials=provider_credentials)

    def vercel_get_logs(self, deployment_id: str, *,
                        provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("get_logs", "vercel",
                            {"deployment_id": deployment_id},
                            provider_credentials=provider_credentials)

    def vercel_create_project(self, name: str, *,
                              framework: Optional[str] = None,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        project: Dict[str, Any] = {"name": name}
        if framework:
            project["framework"] = framework
        return self.execute("manage_project", "vercel",
                            {"action": "create", "project": project},
                            provider_credentials=provider_credentials)

    def vercel_set_env(self, project_id: str, key: str, value: str, *,
                       target: List[str] = None,
                       provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return self.execute("manage_environment", "vercel",
                            {"action": "create", "project_id": project_id,
                             "env": {"key": key, "value": value,
                                     "target": target or ["production", "preview", "development"]}},
                            provider_credentials=provider_credentials)

    # ── Railway helpers ───────────────────────────────────────────────────────

    def railway_list_projects(self, *,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List all Railway projects in the account."""
        return self.execute("list_projects", "railway", {},
                            provider_credentials=provider_credentials)

    def railway_get_project(self, project_id: str, *,
                            provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Get a Railway project by ID."""
        return self.execute("get_project", "railway", {"project_id": project_id},
                            provider_credentials=provider_credentials)

    def railway_create_project(self, name: str, *,
                               description: Optional[str] = None,
                               default_environment_name: str = "production",
                               provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Create a new Railway project."""
        payload: Dict[str, Any] = {"name": name,
                                   "default_environment_name": default_environment_name}
        if description:
            payload["description"] = description
        return self.execute("create_project", "railway", payload,
                            provider_credentials=provider_credentials)

    def railway_delete_project(self, project_id: str, *,
                               provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Delete a Railway project."""
        return self.execute("delete_project", "railway", {"project_id": project_id},
                            provider_credentials=provider_credentials)

    def railway_create_service(self, project_id: str, *,
                               name: Optional[str] = None,
                               repo: Optional[str] = None,
                               image: Optional[str] = None,
                               provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Create a Railway service from a GitHub repo or Docker image."""
        payload: Dict[str, Any] = {"project_id": project_id}
        if name:
            payload["name"] = name
        if repo:
            payload["source"] = {"repo": repo}
        elif image:
            payload["source"] = {"image": image}
        return self.execute("create_service", "railway", payload,
                            provider_credentials=provider_credentials)

    def railway_deploy_service(self, service_id: str, environment_id: str, *,
                               provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Trigger a new deployment for a Railway service."""
        return self.execute("deploy_service", "railway",
                            {"service_id": service_id, "environment_id": environment_id},
                            provider_credentials=provider_credentials)

    def railway_list_deployments(self, service_id: str, environment_id: str, *,
                                 limit: int = 10,
                                 provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List recent deployments for a service."""
        return self.execute("list_deployments", "railway",
                            {"service_id": service_id, "environment_id": environment_id,
                             "limit": limit},
                            provider_credentials=provider_credentials)

    def railway_get_deployment_logs(self, deployment_id: str, *,
                                    provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Fetch build/runtime logs for a deployment."""
        return self.execute("get_deployment_logs", "railway",
                            {"deployment_id": deployment_id},
                            provider_credentials=provider_credentials)

    def railway_redeploy(self, deployment_id: str, *,
                         provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Redeploy an existing deployment."""
        return self.execute("redeploy", "railway", {"deployment_id": deployment_id},
                            provider_credentials=provider_credentials)

    def railway_rollback(self, deployment_id: str, *,
                         provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Rollback to a previous deployment."""
        return self.execute("rollback", "railway", {"deployment_id": deployment_id},
                            provider_credentials=provider_credentials)

    def railway_get_variables(self, project_id: str, environment_id: str, *,
                              service_id: Optional[str] = None,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Get environment variables for a service/environment."""
        payload: Dict[str, Any] = {"project_id": project_id, "environment_id": environment_id}
        if service_id:
            payload["service_id"] = service_id
        return self.execute("get_variables", "railway", payload,
                            provider_credentials=provider_credentials)

    def railway_upsert_variable(self, project_id: str, environment_id: str,
                                name: str, value: str, *,
                                service_id: Optional[str] = None,
                                provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Create or update a single environment variable."""
        payload: Dict[str, Any] = {"project_id": project_id, "environment_id": environment_id,
                                   "name": name, "value": value}
        if service_id:
            payload["service_id"] = service_id
        return self.execute("upsert_variable", "railway", payload,
                            provider_credentials=provider_credentials)

    def railway_upsert_variables(self, project_id: str, environment_id: str,
                                 variables: Dict[str, str], *,
                                 service_id: Optional[str] = None,
                                 provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Bulk upsert environment variables."""
        payload: Dict[str, Any] = {"project_id": project_id, "environment_id": environment_id,
                                   "variables": variables}
        if service_id:
            payload["service_id"] = service_id
        return self.execute("upsert_variables", "railway", payload,
                            provider_credentials=provider_credentials)

    def railway_list_environments(self, project_id: str, *,
                                  provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List environments in a Railway project."""
        return self.execute("list_environments", "railway", {"project_id": project_id},
                            provider_credentials=provider_credentials)

    def railway_create_environment(self, project_id: str, name: str, *,
                                   provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Create a new environment in a Railway project."""
        return self.execute("create_environment", "railway",
                            {"project_id": project_id, "name": name},
                            provider_credentials=provider_credentials)

    def railway_create_service_domain(self, service_id: str, environment_id: str, *,
                                      provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Generate a *.railway.app domain for a service."""
        return self.execute("create_service_domain", "railway",
                            {"service_id": service_id, "environment_id": environment_id},
                            provider_credentials=provider_credentials)

    def railway_create_custom_domain(self, service_id: str, environment_id: str, domain: str, *,
                                     provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Add a custom domain to a Railway service."""
        return self.execute("create_custom_domain", "railway",
                            {"service_id": service_id, "environment_id": environment_id,
                             "domain": domain},
                            provider_credentials=provider_credentials)

    def railway_create_volume(self, project_id: str, environment_id: str, *,
                              name: Optional[str] = None,
                              service_id: Optional[str] = None,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Create a persistent volume in a Railway project."""
        payload: Dict[str, Any] = {"project_id": project_id, "environment_id": environment_id}
        if name:
            payload["name"] = name
        if service_id:
            payload["service_id"] = service_id
        return self.execute("create_volume", "railway", payload,
                            provider_credentials=provider_credentials)

    # ── Gemini helpers ────────────────────────────────────────────────────────

    def gemini_chat(self, messages: List[Dict[str, str]], *,
                    model: str = "gemini-2.5-flash",
                    max_tokens: Optional[int] = None,
                    temperature: Optional[float] = None,
                    system_instruction: Optional[str] = None,
                    provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Chat via Google Gemini."""
        payload: Dict[str, Any] = {"messages": messages, "model": model}
        if max_tokens: payload["max_tokens"] = max_tokens
        if temperature is not None: payload["temperature"] = temperature
        if system_instruction: payload["system_instruction"] = system_instruction
        return self.execute("chat", "gemini", payload, provider_credentials=provider_credentials)

    def gemini_embedding(self, input: Any, *, model: str = "gemini-embedding-001",
                         provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Generate embeddings via Gemini."""
        return self.execute("embedding", "gemini", {"input": input, "model": model},
                            provider_credentials=provider_credentials)

    def gemini_image(self, prompt: str, *, model: str = "imagen-4.0-generate-001",
                     n: int = 1,
                     provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Generate images via Gemini Imagen."""
        return self.execute("image_generation", "gemini",
                            {"prompt": prompt, "model": model, "n": n},
                            provider_credentials=provider_credentials)

    def gemini_count_tokens(self, contents: str, *, model: str = "gemini-2.5-flash",
                            provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Count tokens via Gemini."""
        return self.execute("count_tokens", "gemini",
                            {"contents": contents, "model": model},
                            provider_credentials=provider_credentials)

    # ── Perplexity helpers ────────────────────────────────────────────────────

    def perplexity_chat(self, messages: List[Dict[str, str]], *,
                        model: str = "sonar",
                        max_tokens: Optional[int] = None,
                        return_images: bool = False,
                        return_related_questions: bool = False,
                        search_recency_filter: Optional[str] = None,
                        provider_credentials: Optional[Dict[str, str]] = None,
                        **kwargs) -> Dict[str, Any]:
        """Chat via Perplexity Sonar with web search."""
        payload: Dict[str, Any] = {"messages": messages, "model": model, **kwargs}
        if max_tokens: payload["max_tokens"] = max_tokens
        if return_images: payload["return_images"] = True
        if return_related_questions: payload["return_related_questions"] = True
        if search_recency_filter: payload["search_recency_filter"] = search_recency_filter
        return self.execute("chat", "perplexity", payload, provider_credentials=provider_credentials)

    def perplexity_search(self, query: str, *,
                          provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Web search via Perplexity."""
        return self.execute("search", "perplexity", {"query": query},
                            provider_credentials=provider_credentials)

    def perplexity_embedding(self, input: Any, *, model: str = "pplx-embed-v1-0.6b",
                             dimensions: Optional[int] = None,
                             provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Generate embeddings via Perplexity."""
        payload: Dict[str, Any] = {"input": input, "model": model}
        if dimensions: payload["dimensions"] = dimensions
        return self.execute("embedding", "perplexity", payload,
                            provider_credentials=provider_credentials)

    def perplexity_agent(self, input: str, *,
                         model: Optional[str] = None,
                         instructions: Optional[str] = None,
                         max_output_tokens: Optional[int] = None,
                         preset: Optional[str] = None,
                         provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Agentic response via Perplexity Agent API."""
        payload: Dict[str, Any] = {"input": input}
        if model: payload["model"] = model
        if instructions: payload["instructions"] = instructions
        if max_output_tokens: payload["max_output_tokens"] = max_output_tokens
        if preset: payload["preset"] = preset
        return self.execute("agent", "perplexity", payload,
                            provider_credentials=provider_credentials)

    # ── Mistral helpers ───────────────────────────────────────────────────────

    def mistral_chat(self, messages: List[Dict[str, str]], *,
                     model: str = "mistral-small-latest",
                     max_tokens: Optional[int] = None,
                     temperature: Optional[float] = None,
                     safe_prompt: bool = False,
                     provider_credentials: Optional[Dict[str, str]] = None,
                     **kwargs) -> Dict[str, Any]:
        """Chat via Mistral AI."""
        payload: Dict[str, Any] = {"messages": messages, "model": model, **kwargs}
        if max_tokens: payload["max_tokens"] = max_tokens
        if temperature is not None: payload["temperature"] = temperature
        if safe_prompt: payload["safe_prompt"] = True
        return self.execute("chat", "mistral", payload, provider_credentials=provider_credentials)

    def mistral_fim(self, prompt: str, *, suffix: Optional[str] = None,
                    model: str = "codestral-latest",
                    max_tokens: Optional[int] = None,
                    provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Fill-in-the-middle code completion via Mistral Codestral."""
        payload: Dict[str, Any] = {"prompt": prompt, "model": model}
        if suffix: payload["suffix"] = suffix
        if max_tokens: payload["max_tokens"] = max_tokens
        return self.execute("fim", "mistral", payload, provider_credentials=provider_credentials)

    def mistral_embedding(self, input: Any, *, model: str = "mistral-embed",
                          provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Generate embeddings via Mistral."""
        return self.execute("embedding", "mistral", {"input": input, "model": model},
                            provider_credentials=provider_credentials)

    def mistral_moderation(self, input: Any, *, model: str = "mistral-moderation-latest",
                           provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Content moderation via Mistral."""
        return self.execute("moderation", "mistral", {"input": input, "model": model},
                            provider_credentials=provider_credentials)

    # ── Cohere helpers ────────────────────────────────────────────────────────

    def cohere_chat(self, messages: List[Dict[str, str]], *,
                    model: str = "command-a-03-2025",
                    max_tokens: Optional[int] = None,
                    temperature: Optional[float] = None,
                    provider_credentials: Optional[Dict[str, str]] = None,
                    **kwargs) -> Dict[str, Any]:
        """Chat via Cohere Command."""
        payload: Dict[str, Any] = {"messages": messages, "model": model, **kwargs}
        if max_tokens: payload["max_tokens"] = max_tokens
        if temperature is not None: payload["temperature"] = temperature
        return self.execute("chat", "cohere", payload, provider_credentials=provider_credentials)

    def cohere_embedding(self, input: Any, *, model: str = "embed-v4.0",
                         input_type: str = "search_document",
                         provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Generate embeddings via Cohere."""
        return self.execute("embedding", "cohere",
                            {"input": input, "model": model, "input_type": input_type},
                            provider_credentials=provider_credentials)

    def cohere_rerank(self, query: str, documents: List[str], *,
                      model: str = "rerank-v3.5", top_n: Optional[int] = None,
                      provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Rerank documents by relevance via Cohere."""
        payload: Dict[str, Any] = {"query": query, "documents": documents, "model": model}
        if top_n: payload["top_n"] = top_n
        return self.execute("rerank", "cohere", payload, provider_credentials=provider_credentials)

    def cohere_classify(self, inputs: List[str], *,
                        model: str = "embed-english-v3.0",
                        examples: Optional[List[Dict]] = None,
                        provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Classify text via Cohere."""
        payload: Dict[str, Any] = {"inputs": inputs, "model": model}
        if examples: payload["examples"] = examples
        return self.execute("classify", "cohere", payload, provider_credentials=provider_credentials)

    # ── DeepSeek helpers ──────────────────────────────────────────────────────

    def deepseek_chat(self, messages: List[Dict[str, str]], *,
                      model: str = "deepseek-chat",
                      max_tokens: Optional[int] = None,
                      temperature: Optional[float] = None,
                      provider_credentials: Optional[Dict[str, str]] = None,
                      **kwargs) -> Dict[str, Any]:
        """Chat via DeepSeek V3.2 (non-thinking mode)."""
        payload: Dict[str, Any] = {"messages": messages, "model": model, **kwargs}
        if max_tokens: payload["max_tokens"] = max_tokens
        if temperature is not None: payload["temperature"] = temperature
        return self.execute("chat", "deepseek", payload, provider_credentials=provider_credentials)

    def deepseek_reasoning(self, messages: List[Dict[str, str]], *,
                           model: str = "deepseek-reasoner",
                           max_tokens: Optional[int] = None,
                           provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Reasoning via DeepSeek V3.2 (thinking mode with chain-of-thought)."""
        payload: Dict[str, Any] = {"messages": messages, "model": model}
        if max_tokens: payload["max_tokens"] = max_tokens
        return self.execute("reasoning", "deepseek", payload, provider_credentials=provider_credentials)

    def deepseek_fim(self, prompt: str, *, suffix: Optional[str] = None,
                     model: str = "deepseek-chat",
                     max_tokens: Optional[int] = None,
                     provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Fill-in-the-middle code completion via DeepSeek (beta)."""
        payload: Dict[str, Any] = {"prompt": prompt, "model": model}
        if suffix: payload["suffix"] = suffix
        if max_tokens: payload["max_tokens"] = max_tokens
        return self.execute("fim", "deepseek", payload, provider_credentials=provider_credentials)

    # ── Pinecone helpers ──────────────────────────────────────────────────────

    def pinecone_create_index(self, name: str, dimension: int, *,
                              metric: str = "cosine", cloud: str = "aws",
                              region: str = "us-east-1",
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Create a Pinecone serverless index."""
        return self.execute("create_index", "pinecone",
                            {"name": name, "dimension": dimension, "metric": metric,
                             "cloud": cloud, "region": region},
                            provider_credentials=provider_credentials)

    def pinecone_list_indexes(self, *,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List all Pinecone indexes."""
        return self.execute("list_indexes", "pinecone", {},
                            provider_credentials=provider_credentials)

    def pinecone_upsert(self, host: str, vectors: List[Dict], *,
                        namespace: str = "",
                        provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Upsert vectors into a Pinecone index."""
        payload: Dict[str, Any] = {"host": host, "vectors": vectors}
        if namespace: payload["namespace"] = namespace
        return self.execute("upsert", "pinecone", payload,
                            provider_credentials=provider_credentials)

    def pinecone_query(self, host: str, vector: List[float], *,
                       top_k: int = 10, namespace: str = "",
                       include_metadata: bool = True, filter: Optional[Dict] = None,
                       provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Query a Pinecone index for similar vectors."""
        payload: Dict[str, Any] = {"host": host, "vector": vector, "top_k": top_k,
                                   "include_metadata": include_metadata}
        if namespace: payload["namespace"] = namespace
        if filter: payload["filter"] = filter
        return self.execute("query", "pinecone", payload,
                            provider_credentials=provider_credentials)

    def pinecone_delete_index(self, name: str, *,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Delete a Pinecone index."""
        return self.execute("delete_index", "pinecone", {"name": name},
                            provider_credentials=provider_credentials)

    def pinecone_fetch(self, host: str, ids: List[str], *,
                       namespace: str = "",
                       provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Fetch vectors by ID from a Pinecone index."""
        payload: Dict[str, Any] = {"host": host, "ids": ids}
        if namespace: payload["namespace"] = namespace
        return self.execute("fetch", "pinecone", payload,
                            provider_credentials=provider_credentials)

    def pinecone_update(self, host: str, id: str, *,
                        values: Optional[List[float]] = None,
                        set_metadata: Optional[Dict] = None,
                        namespace: str = "",
                        provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Update a vector's values or metadata."""
        payload: Dict[str, Any] = {"host": host, "id": id}
        if values: payload["values"] = values
        if set_metadata: payload["set_metadata"] = set_metadata
        if namespace: payload["namespace"] = namespace
        return self.execute("update", "pinecone", payload,
                            provider_credentials=provider_credentials)

    def pinecone_describe_index_stats(self, host: str, *,
                                      provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Get index statistics (vector count, namespace breakdown)."""
        return self.execute("describe_index_stats", "pinecone", {"host": host},
                            provider_credentials=provider_credentials)

    def pinecone_list_vectors(self, host: str, *,
                              namespace: str = "", prefix: str = "", limit: int = 100,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List vector IDs in a namespace."""
        payload: Dict[str, Any] = {"host": host, "limit": limit}
        if namespace: payload["namespace"] = namespace
        if prefix: payload["prefix"] = prefix
        return self.execute("list_vectors", "pinecone", payload,
                            provider_credentials=provider_credentials)

    # ── Supabase helpers ──────────────────────────────────────────────────────

    def supabase_query(self, table: str, *, select: str = "*",
                       filters: Optional[Dict[str, str]] = None, limit: int = 100,
                       provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Query rows from a Supabase table."""
        payload: Dict[str, Any] = {"table": table, "select": select, "limit": limit}
        if filters: payload["filters"] = filters
        return self.execute("query", "supabase", payload, provider_credentials=provider_credentials)

    def supabase_insert(self, table: str, rows: Any, *,
                        provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Insert rows into a Supabase table."""
        return self.execute("insert", "supabase", {"table": table, "rows": rows},
                            provider_credentials=provider_credentials)

    def supabase_update(self, table: str, updates: Dict[str, Any], *,
                        filters: Optional[Dict[str, str]] = None,
                        provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Update rows in a Supabase table."""
        payload: Dict[str, Any] = {"table": table, "updates": updates}
        if filters: payload["filters"] = filters
        return self.execute("update", "supabase", payload, provider_credentials=provider_credentials)

    def supabase_delete(self, table: str, *, filters: Optional[Dict[str, str]] = None,
                        provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Delete rows from a Supabase table."""
        payload: Dict[str, Any] = {"table": table}
        if filters: payload["filters"] = filters
        return self.execute("delete", "supabase", payload, provider_credentials=provider_credentials)

    def supabase_rpc(self, function: str, *, params: Optional[Dict] = None,
                     provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Call a Postgres function via Supabase RPC."""
        payload: Dict[str, Any] = {"function": function}
        if params: payload["params"] = params
        return self.execute("rpc", "supabase", payload, provider_credentials=provider_credentials)

    def supabase_upload_file(self, bucket: str, path: str, content: str, *,
                             content_type: str = "text/plain",
                             provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Upload a file to Supabase Storage."""
        return self.execute("upload_file", "supabase",
                            {"bucket": bucket, "path": path, "content": content,
                             "content_type": content_type},
                            provider_credentials=provider_credentials)

    def supabase_list_files(self, bucket: str, *, prefix: str = "",
                            provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List files in a Supabase Storage bucket."""
        return self.execute("list_files", "supabase",
                            {"bucket": bucket, "prefix": prefix},
                            provider_credentials=provider_credentials)

    def supabase_invoke_function(self, function: str, *, body: Optional[Dict] = None,
                                 provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Invoke a Supabase Edge Function."""
        payload: Dict[str, Any] = {"function": function}
        if body: payload["body"] = body
        return self.execute("invoke_function", "supabase", payload,
                            provider_credentials=provider_credentials)

    # ── Twilio helpers ────────────────────────────────────────────────────────

    def twilio_send_sms(self, to: str, from_number: str, body: str, *,
                        media_url: Optional[str] = None,
                        provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Send an SMS/MMS via Twilio."""
        payload: Dict[str, Any] = {"to": to, "from": from_number, "body": body}
        if media_url: payload["media_url"] = media_url
        return self.execute("send_sms", "twilio", payload, provider_credentials=provider_credentials)

    def twilio_make_call(self, to: str, from_number: str, *,
                         url: Optional[str] = None, twiml: Optional[str] = None,
                         provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Initiate an outbound voice call via Twilio."""
        payload: Dict[str, Any] = {"to": to, "from": from_number}
        if url: payload["url"] = url
        if twiml: payload["twiml"] = twiml
        return self.execute("make_call", "twilio", payload, provider_credentials=provider_credentials)

    def twilio_list_messages(self, *, to: Optional[str] = None, from_number: Optional[str] = None,
                             limit: int = 20,
                             provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List SMS message history."""
        payload: Dict[str, Any] = {"limit": limit}
        if to: payload["to"] = to
        if from_number: payload["from"] = from_number
        return self.execute("list_messages", "twilio", payload, provider_credentials=provider_credentials)

    def twilio_lookup(self, phone_number: str, *,
                      fields: str = "line_type_intelligence",
                      provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Look up phone number info (carrier, type, validation)."""
        return self.execute("lookup", "twilio",
                            {"phone_number": phone_number, "fields": fields},
                            provider_credentials=provider_credentials)

    # ── GoDaddy helpers ───────────────────────────────────────────────────────

    def godaddy_check_availability(self, domain: str, *,
                                    provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Check if a domain is available for purchase."""
        return self.execute("check_availability", "godaddy", {"domain": domain},
                            provider_credentials=provider_credentials)

    def godaddy_suggest_domains(self, query: str, *, limit: int = 10,
                                provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Get domain name suggestions."""
        return self.execute("suggest_domains", "godaddy", {"query": query, "limit": limit},
                            provider_credentials=provider_credentials)

    def godaddy_list_domains(self, *, provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List all domains in the account."""
        return self.execute("list_domains", "godaddy", {},
                            provider_credentials=provider_credentials)

    def godaddy_get_dns_records(self, domain: str, *, record_type: Optional[str] = None,
                                name: Optional[str] = None,
                                provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Get DNS records for a domain."""
        payload: Dict[str, Any] = {"domain": domain}
        if record_type: payload["type"] = record_type
        if name: payload["name"] = name
        return self.execute("get_dns_records", "godaddy", payload,
                            provider_credentials=provider_credentials)

    def godaddy_set_dns_records(self, domain: str, records: List[Dict], *,
                                provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Replace DNS records for a domain."""
        return self.execute("set_dns_records", "godaddy",
                            {"domain": domain, "records": records},
                            provider_credentials=provider_credentials)

    def godaddy_purchase_domain(self, domain: str, contact: Dict[str, str], *,
                                period: int = 1, privacy: bool = True,
                                provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Purchase/register a domain."""
        return self.execute("purchase_domain", "godaddy",
                            {"domain": domain, "contact": contact, "period": period, "privacy": privacy},
                            provider_credentials=provider_credentials)

    # ── ElevenLabs helpers ────────────────────────────────────────────────────

    def elevenlabs_tts(self, text: str, *, voice_id: str = "21m00Tcm4TlvDq8ikWAM",
                       model_id: str = "eleven_multilingual_v2",
                       output_format: str = "mp3_44100_128",
                       provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Convert text to speech via ElevenLabs."""
        return self.execute("text_to_speech", "elevenlabs",
                            {"text": text, "voice_id": voice_id, "model_id": model_id,
                             "output_format": output_format},
                            provider_credentials=provider_credentials)

    def elevenlabs_stt(self, audio_base64: str, *, model_id: str = "scribe_v1",
                       language: Optional[str] = None,
                       provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Transcribe audio to text via ElevenLabs."""
        payload: Dict[str, Any] = {"audio_base64": audio_base64, "model_id": model_id}
        if language: payload["language"] = language
        return self.execute("speech_to_text", "elevenlabs", payload,
                            provider_credentials=provider_credentials)

    def elevenlabs_list_voices(self, *,
                               provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List available ElevenLabs voices."""
        return self.execute("list_voices", "elevenlabs", {},
                            provider_credentials=provider_credentials)

    def elevenlabs_sound_effects(self, text: str, *, duration_seconds: Optional[float] = None,
                                 provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Generate sound effects from a text description."""
        payload: Dict[str, Any] = {"text": text}
        if duration_seconds: payload["duration_seconds"] = duration_seconds
        return self.execute("sound_effects", "elevenlabs", payload,
                            provider_credentials=provider_credentials)

    # ── Cloudflare helpers ────────────────────────────────────────────────────

    def cloudflare_list_zones(self, *, name: Optional[str] = None,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List DNS zones (domains) in Cloudflare."""
        payload: Dict[str, Any] = {}
        if name: payload["name"] = name
        return self.execute("list_zones", "cloudflare", payload, provider_credentials=provider_credentials)

    def cloudflare_list_dns_records(self, zone_id: str, *, record_type: Optional[str] = None,
                                    provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List DNS records for a zone."""
        payload: Dict[str, Any] = {"zone_id": zone_id}
        if record_type: payload["type"] = record_type
        return self.execute("list_dns_records", "cloudflare", payload, provider_credentials=provider_credentials)

    def cloudflare_create_dns_record(self, zone_id: str, record_type: str, name: str, content: str, *,
                                     ttl: int = 1, proxied: bool = False,
                                     provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Create a DNS record."""
        return self.execute("create_dns_record", "cloudflare",
                            {"zone_id": zone_id, "type": record_type, "name": name,
                             "content": content, "ttl": ttl, "proxied": proxied},
                            provider_credentials=provider_credentials)

    def cloudflare_create_r2_bucket(self, name: str, *,
                                    provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Create a Cloudflare R2 storage bucket."""
        return self.execute("create_r2_bucket", "cloudflare", {"name": name},
                            provider_credentials=provider_credentials)

    def cloudflare_list_r2_buckets(self, *, provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List R2 storage buckets."""
        return self.execute("list_r2_buckets", "cloudflare", {},
                            provider_credentials=provider_credentials)

    def cloudflare_deploy_worker(self, name: str, content: str, *,
                                 provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Deploy a Cloudflare Worker script."""
        return self.execute("deploy_worker", "cloudflare", {"name": name, "content": content},
                            provider_credentials=provider_credentials)

    def cloudflare_list_workers(self, *, provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List Cloudflare Worker scripts."""
        return self.execute("list_workers", "cloudflare", {},
                            provider_credentials=provider_credentials)

    # ── Neon helpers ──────────────────────────────────────────────────────────

    def neon_create_project(self, name: str = "sentinel-project", *,
                            region_id: Optional[str] = None,
                            provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Create a Neon serverless Postgres project. Returns project + connection URI."""
        payload: Dict[str, Any] = {"name": name}
        if region_id: payload["region_id"] = region_id
        return self.execute("create_project", "neon", payload, provider_credentials=provider_credentials)

    def neon_list_projects(self, *, provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List all Neon projects."""
        return self.execute("list_projects", "neon", {}, provider_credentials=provider_credentials)

    def neon_delete_project(self, project_id: str, *,
                            provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Delete a Neon project."""
        return self.execute("delete_project", "neon", {"project_id": project_id},
                            provider_credentials=provider_credentials)

    def neon_create_branch(self, project_id: str, *, name: Optional[str] = None,
                           parent_id: Optional[str] = None,
                           provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Create a branch (instant DB copy). Returns branch + connection URI."""
        payload: Dict[str, Any] = {"project_id": project_id}
        if name: payload["name"] = name
        if parent_id: payload["parent_id"] = parent_id
        return self.execute("create_branch", "neon", payload, provider_credentials=provider_credentials)

    def neon_list_branches(self, project_id: str, *,
                           provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """List branches in a project."""
        return self.execute("list_branches", "neon", {"project_id": project_id},
                            provider_credentials=provider_credentials)

    def neon_get_connection_uri(self, project_id: str, *,
                                branch_id: Optional[str] = None,
                                database_name: Optional[str] = None,
                                provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Get a Postgres connection string for a project/branch."""
        payload: Dict[str, Any] = {"project_id": project_id}
        if branch_id: payload["branch_id"] = branch_id
        if database_name: payload["database_name"] = database_name
        return self.execute("get_connection_uri", "neon", payload, provider_credentials=provider_credentials)

    # ── Hugging Face helpers ──────────────────────────────────────────────────

    def huggingface_inference(self, model: str, inputs: Any, *,
                              task: str = "text_generation",
                              parameters: Optional[Dict] = None,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Run any Hugging Face model. Specify the task and model ID."""
        payload: Dict[str, Any] = {"model": model, "inputs": inputs}
        if parameters: payload.update(parameters)
        return self.execute(task, "huggingface", payload, provider_credentials=provider_credentials)

    def huggingface_chat(self, messages: List[Dict[str, str]], *,
                         model: str = "meta-llama/Meta-Llama-3-8B-Instruct",
                         max_new_tokens: Optional[int] = None,
                         provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Chat via any HF text generation model."""
        payload: Dict[str, Any] = {"messages": messages, "model": model}
        if max_new_tokens: payload["max_new_tokens"] = max_new_tokens
        return self.execute("chat", "huggingface", payload, provider_credentials=provider_credentials)

    def huggingface_classify(self, text: str, *, model: str = "distilbert-base-uncased-finetuned-sst-2-english",
                             provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Text classification (sentiment, topic, etc.)."""
        return self.execute("text_classification", "huggingface",
                            {"inputs": text, "model": model}, provider_credentials=provider_credentials)

    def huggingface_ner(self, text: str, *, model: str = "dslim/bert-base-NER",
                        provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Named entity recognition."""
        return self.execute("ner", "huggingface",
                            {"inputs": text, "model": model}, provider_credentials=provider_credentials)

    def huggingface_translate(self, text: str, *, model: str = "Helsinki-NLP/opus-mt-en-fr",
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Translate text."""
        return self.execute("translation", "huggingface",
                            {"inputs": text, "model": model}, provider_credentials=provider_credentials)

    def huggingface_summarize(self, text: str, *, model: str = "facebook/bart-large-cnn",
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Summarize text."""
        return self.execute("summarization", "huggingface",
                            {"inputs": text, "model": model}, provider_credentials=provider_credentials)

    def huggingface_text_to_image(self, prompt: str, *, model: str = "stabilityai/stable-diffusion-xl-base-1.0",
                                  provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Generate images from text."""
        return self.execute("text_to_image", "huggingface",
                            {"prompt": prompt, "model": model}, provider_credentials=provider_credentials)

    def huggingface_embedding(self, text: str, *, model: str = "sentence-transformers/all-MiniLM-L6-v2",
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Generate embeddings."""
        return self.execute("embedding", "huggingface",
                            {"inputs": text, "model": model}, provider_credentials=provider_credentials)

    # ── Marketplace — Discovery ───────────────────────────────────────────────

    def marketplace_search(
        self,
        query: Optional[str] = None,
        *,
        category: Optional[str] = None,
        provider: Optional[str] = None,
        min_rating: Optional[float] = None,
        max_price: Optional[float] = None,
        sort_by: str = "relevance",
        limit: int = 20,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """Search tools in the marketplace."""
        params: Dict[str, Any] = {"sort_by": sort_by, "limit": limit, "offset": offset}
        if query:
            params["query"] = query
        if category:
            params["category"] = category
        if provider:
            params["provider"] = provider
        if min_rating is not None:
            params["min_rating"] = min_rating
        if max_price is not None:
            params["max_price"] = max_price
        response = self._client.get("/v1/marketplace/tools", params=params)
        self._raise_for_status(response)
        return response.json()

    def marketplace_featured(self, *, limit: int = 10) -> Dict[str, Any]:
        """Get featured marketplace tools."""
        response = self._client.get("/v1/marketplace/featured", params={"limit": limit})
        self._raise_for_status(response)
        return response.json()

    def marketplace_trending(self, *, limit: int = 10, period: str = "week") -> Dict[str, Any]:
        """Get trending marketplace tools."""
        response = self._client.get("/v1/marketplace/trending", params={"limit": limit, "period": period})
        self._raise_for_status(response)
        return response.json()

    def marketplace_categories(self) -> Dict[str, Any]:
        """Get all marketplace categories."""
        response = self._client.get("/v1/marketplace/categories")
        self._raise_for_status(response)
        return response.json()

    def marketplace_stats(self) -> Dict[str, Any]:
        """Get marketplace statistics."""
        response = self._client.get("/v1/marketplace/stats")
        self._raise_for_status(response)
        return response.json()

    def marketplace_recommendations(self, *, limit: int = 10) -> Dict[str, Any]:
        """Get personalized tool recommendations."""
        response = self._client.get("/v1/marketplace/recommendations", params={"limit": limit})
        self._raise_for_status(response)
        return response.json()

    # ── Marketplace — Registry ────────────────────────────────────────────────

    def registry_register_tool(self, tool_data: Dict[str, Any]) -> Dict[str, Any]:
        """Register a new tool in the marketplace registry."""
        response = self._client.post("/v1/marketplace/registry/tools", json=tool_data)
        self._raise_for_status(response)
        return response.json()

    def registry_get_tool(self, tool_id: str) -> Dict[str, Any]:
        """Get full registry details for a tool."""
        response = self._client.get(f"/v1/marketplace/registry/tools/{tool_id}")
        self._raise_for_status(response)
        return response.json()

    def registry_update_tool(self, tool_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        """Update a tool listing."""
        response = self._client.put(f"/v1/marketplace/registry/tools/{tool_id}", json=updates)
        self._raise_for_status(response)
        return response.json()

    def registry_verify_tool(self, tool_id: str, *, notes: Optional[str] = None) -> Dict[str, Any]:
        """Mark a tool as verified."""
        response = self._client.post(f"/v1/marketplace/registry/tools/{tool_id}/verify",
                                     json={"notes": notes})
        self._raise_for_status(response)
        return response.json()

    def registry_register_provider(self, provider_data: Dict[str, Any]) -> Dict[str, Any]:
        """Register a new provider in the marketplace."""
        response = self._client.post("/v1/marketplace/registry/providers", json=provider_data)
        self._raise_for_status(response)
        return response.json()

    def registry_get_provider(self, provider_id: str, *, include_tools: bool = False) -> Dict[str, Any]:
        """Get full registry details for a provider."""
        response = self._client.get(f"/v1/marketplace/registry/providers/{provider_id}",
                                    params={"include_tools": include_tools})
        self._raise_for_status(response)
        return response.json()

    def registry_update_provider(self, provider_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        """Update a provider listing."""
        response = self._client.put(f"/v1/marketplace/registry/providers/{provider_id}", json=updates)
        self._raise_for_status(response)
        return response.json()

    def registry_category_tree(self) -> Dict[str, Any]:
        """Get the full hierarchical category tree."""
        response = self._client.get("/v1/marketplace/registry/categories/tree")
        self._raise_for_status(response)
        return response.json()

    # ── Marketplace — Execution ───────────────────────────────────────────────

    def marketplace_execute(
        self,
        tool_id: str,
        input_data: Dict[str, Any],
        *,
        pricing_model: str = "per_request",
        usage_data: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Execute a marketplace tool (discover → pay → proxy)."""
        body: Dict[str, Any] = {
            "input_data": input_data,
            "pricing_model": pricing_model,
        }
        if usage_data:
            body["usage_data"] = usage_data
        if idempotency_key:
            body["idempotency_key"] = idempotency_key
        response = self._client.post(f"/v1/marketplace/tools/{tool_id}/execute", json=body)
        self._raise_for_status(response)
        return response.json()

    def marketplace_estimate(
        self,
        tool_id: str,
        *,
        pricing_model: str = "per_request",
        requests: int = 1,
        tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Estimate cost for a marketplace tool before executing."""
        params: Dict[str, Any] = {"pricing_model": pricing_model, "requests": requests}
        if tokens is not None:
            params["tokens"] = tokens
        response = self._client.get(f"/v1/marketplace/tools/{tool_id}/estimate", params=params)
        self._raise_for_status(response)
        return response.json()

    # ── Marketplace — Payments ────────────────────────────────────────────────

    def add_payment_route(self, route_data: Dict[str, Any]) -> Dict[str, Any]:
        """Add a payment route (Stripe credentials) for the authenticated user."""
        response = self._client.post("/v1/marketplace/payment-routes", json=route_data)
        self._raise_for_status(response)
        return response.json()

    def list_payment_routes(self) -> Dict[str, Any]:
        """List all payment routes for the authenticated user."""
        response = self._client.get("/v1/marketplace/payment-routes")
        self._raise_for_status(response)
        return response.json()

    def delete_payment_route(self, route_id: str) -> None:
        """Remove a payment route."""
        response = self._client.delete(f"/v1/marketplace/payment-routes/{route_id}")
        self._raise_for_status(response)

    def get_transactions(self, *, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        """Get marketplace transaction history."""
        response = self._client.get("/v1/marketplace/transactions",
                                    params={"limit": limit, "offset": offset})
        self._raise_for_status(response)
        return response.json()

    def get_transaction(self, transaction_id: str) -> Dict[str, Any]:
        """Get a specific marketplace transaction."""
        response = self._client.get(f"/v1/marketplace/transactions/{transaction_id}")
        self._raise_for_status(response)
        return response.json()

    # ── Marketplace — Social ──────────────────────────────────────────────────

    def rate_tool(self, tool_id: str, rating: int) -> Dict[str, Any]:
        """Rate a marketplace tool (1-5 stars)."""
        response = self._client.post(f"/v1/marketplace/tools/{tool_id}/rate",
                                     params={"rating": rating})
        self._raise_for_status(response)
        return response.json()

    def favorite_tool(self, tool_id: str) -> Dict[str, Any]:
        """Add a tool to favorites."""
        response = self._client.post(f"/v1/marketplace/tools/{tool_id}/favorite")
        self._raise_for_status(response)
        return response.json()

    def unfavorite_tool(self, tool_id: str) -> Dict[str, Any]:
        """Remove a tool from favorites."""
        response = self._client.delete(f"/v1/marketplace/tools/{tool_id}/favorite")
        self._raise_for_status(response)
        return response.json()

    def get_favorites(self, *, limit: int = 20, offset: int = 0) -> Dict[str, Any]:
        """Get the authenticated user's favorited tools."""
        response = self._client.get("/v1/marketplace/favorites",
                                    params={"limit": limit, "offset": offset})
        self._raise_for_status(response)
        return response.json()

    # ── Chain Orchestration (Agent-on-Agent) ────────────────────────────────

    def run(
        self,
        agent_id: int,
        payload: Dict[str, Any],
        *,
        provider_credentials: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """
        Run an agent's chain. This is the primary entry point for agent-on-agent
        execution. Triggers the chain in the background and returns an execution ID
        that you can poll with get_chain_execution().

        Usage:
            result = client.run(agent_id=42, payload={"task": "build a page about bread"})
            exec_id = result["execution_id"]
            # Poll for status:
            status = client.get_chain_execution(exec_id)
        """
        body: Dict[str, Any] = {"payload": payload}
        if provider_credentials:
            body["provider_credentials"] = provider_credentials
        response = self._client.post(f"/v1/agents/{agent_id}/run", json=body)
        self._raise_for_status(response)
        return response.json()

    def create_chain(
        self,
        agent_id: int,
        name: str,
        steps: List[Dict[str, Any]],
        *,
        description: Optional[str] = None,
        max_budget_cents: Optional[float] = None,
        max_runtime_ms: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Create a chain template for an agent."""
        body: Dict[str, Any] = {
            "agent_id": agent_id, "name": name, "steps": steps,
        }
        if description:
            body["description"] = description
        if max_budget_cents is not None:
            body["max_budget_cents"] = max_budget_cents
        if max_runtime_ms is not None:
            body["max_runtime_ms"] = max_runtime_ms
        response = self._client.post("/v1/chains", json=body)
        self._raise_for_status(response)
        return response.json()

    def get_chain(self, chain_id: int) -> Dict[str, Any]:
        """Get a chain by ID."""
        response = self._client.get(f"/v1/chains/{chain_id}")
        self._raise_for_status(response)
        return response.json()

    def list_chains(self, agent_id: int) -> List[Dict[str, Any]]:
        """List all chains for an agent."""
        response = self._client.get(f"/v1/agents/{agent_id}/chains")
        self._raise_for_status(response)
        return response.json()

    def run_chain(
        self,
        chain_id: int,
        payload: Dict[str, Any],
        *,
        provider_credentials: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Run a specific chain by ID. Returns execution_id for polling."""
        body: Dict[str, Any] = {"payload": payload}
        if provider_credentials:
            body["provider_credentials"] = provider_credentials
        response = self._client.post(f"/v1/chains/{chain_id}/run", json=body)
        self._raise_for_status(response)
        return response.json()

    def get_chain_execution(self, execution_id: str) -> Dict[str, Any]:
        """Poll a chain execution for status, step progress, cost, and output."""
        response = self._client.get(f"/v1/chains/executions/{execution_id}")
        self._raise_for_status(response)
        return response.json()

    def cancel_chain_execution(self, execution_id: str) -> Dict[str, Any]:
        """Cancel a running chain execution."""
        response = self._client.post(f"/v1/chains/executions/{execution_id}/cancel")
        self._raise_for_status(response)
        return response.json()

    def list_chain_executions(self, agent_id: int, *, limit: int = 20) -> List[Dict[str, Any]]:
        """List chain execution history for an agent."""
        response = self._client.get(
            f"/v1/agents/{agent_id}/chain-executions",
            params={"limit": limit},
        )
        self._raise_for_status(response)
        return response.json()

    # ── Internal ─────────────────────────────────────────────────────────────

    def _raise_for_status(self, response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        try:
            detail = response.json()
        except Exception:
            detail = response.text
        raise SentinelError(
            message=f"Sentinel API error {response.status_code}",
            status_code=response.status_code,
            detail=detail,
        )

    def close(self):
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class AsyncSentinel:
    """
    Async Sentinel SDK — identical surface to Sentinel but fully async.
    Uses httpx.AsyncClient for concurrent requests.

    Usage:
        async with AsyncSentinel(api_key="sk_agent_...") as client:
            result = await client.execute("chat", "openai", {"messages": [...]})

        # Or run multiple calls concurrently:
        import asyncio
        results = await asyncio.gather(
            client.openai_chat([{"role": "user", "content": "Hello"}]),
            client.claude_chat([{"role": "user", "content": "Hi"}]),
        )
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:8000",
        timeout: int = 300,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {api_key}", "X-API-Key": api_key, "Content-Type": "application/json"},
            timeout=timeout,
        )

    # ── Internal ─────────────────────────────────────────────────────────────

    async def _raise_for_status(self, response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        try:
            detail = response.json()
        except Exception:
            detail = response.text
        raise SentinelError(
            message=f"Sentinel API error {response.status_code}",
            status_code=response.status_code,
            detail=detail,
        )

    async def _get(self, path: str, params: Optional[Dict] = None) -> Dict[str, Any]:
        response = await self._client.get(path, params=params)
        await self._raise_for_status(response)
        return response.json()

    async def _post(self, path: str, body: Any = None, params: Optional[Dict] = None) -> Dict[str, Any]:
        response = await self._client.post(path, json=body, params=params)
        await self._raise_for_status(response)
        return response.json()

    async def _put(self, path: str, body: Any = None) -> Dict[str, Any]:
        response = await self._client.put(path, json=body)
        await self._raise_for_status(response)
        return response.json()

    async def _delete(self, path: str) -> Optional[Dict[str, Any]]:
        response = await self._client.delete(path)
        await self._raise_for_status(response)
        if response.status_code == 204:
            return None
        return response.json()

    # ── Core execute ─────────────────────────────────────────────────────────

    async def execute(
        self,
        tool: str,
        provider: str,
        payload: Dict[str, Any],
        *,
        provider_credentials: Optional[Dict[str, str]] = None,
        idempotency_key: Optional[str] = None,
        priority: str = "normal",
        timeout_seconds: int = 300,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "tool": tool,
            "provider": provider,
            "payload": {**payload, **({"provider_credentials": provider_credentials} if provider_credentials else {})},
            "priority": priority,
            "timeout_seconds": timeout_seconds,
        }
        if idempotency_key:
            body["idempotency_key"] = idempotency_key
        return await self._post("/v1/executions/execute", body)

    async def list_executions(
        self,
        *,
        agent_id: Optional[int] = None,
        tool: Optional[str] = None,
        provider: Optional[str] = None,
        limit: int = 20,
        offset: int = 0,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {"limit": limit, "offset": offset}
        if agent_id:
            params["agent_id"] = agent_id
        if tool:
            params["tool"] = tool
        if provider:
            params["provider"] = provider
        return await self._get("/v1/executions/", params)

    async def get_execution(self, execution_id: str) -> Dict[str, Any]:
        return await self._get(f"/v1/executions/{execution_id}")

    # ── OpenAI helpers ───────────────────────────────────────────────────────

    async def openai_chat(self, messages: List[Dict[str, str]], model: str = "gpt-4o", *,
                          max_tokens: int = 1024, temperature: float = 0.7,
                          provider_credentials: Optional[Dict[str, str]] = None, **kwargs) -> Dict[str, Any]:
        return await self.execute("chat", "openai",
            {"messages": messages, "model": model, "max_tokens": max_tokens, "temperature": temperature, **kwargs},
            provider_credentials=provider_credentials)

    async def openai_embedding(self, input: Any, model: str = "text-embedding-ada-002", *,
                               provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("embedding", "openai", {"input": input, "model": model},
                                  provider_credentials=provider_credentials)

    async def openai_image(self, prompt: str, model: str = "dall-e-3", *, size: str = "1024x1024",
                           quality: str = "standard", n: int = 1,
                           provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("image_generation", "openai",
            {"prompt": prompt, "model": model, "size": size, "quality": quality, "n": n},
            provider_credentials=provider_credentials)

    async def openai_transcribe(self, file: str, model: str = "whisper-1", *,
                                language: Optional[str] = None,
                                provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"file": file, "model": model}
        if language:
            payload["language"] = language
        return await self.execute("transcription", "openai", payload,
                                  provider_credentials=provider_credentials)

    # ── Anthropic helpers ────────────────────────────────────────────────────

    async def claude_chat(self, messages: List[Dict[str, str]], model: str = "claude-3-5-sonnet-20241022", *,
                          max_tokens: int = 1024,
                          provider_credentials: Optional[Dict[str, str]] = None, **kwargs) -> Dict[str, Any]:
        return await self.execute("chat", "anthropic",
            {"messages": messages, "model": model, "max_tokens": max_tokens, **kwargs},
            provider_credentials=provider_credentials)

    async def claude_stream(self, messages: List[Dict[str, str]], model: str = "claude-3-5-sonnet-20241022", *,
                            max_tokens: int = 1024,
                            provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("stream", "anthropic",
            {"messages": messages, "model": model, "max_tokens": max_tokens},
            provider_credentials=provider_credentials)

    async def claude_vision(self, prompt: str, *, image_url: Optional[str] = None,
                            image_base64: Optional[str] = None, media_type: str = "image/jpeg",
                            model: str = "claude-3-5-sonnet-20241022",
                            provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"prompt": prompt, "model": model, "media_type": media_type}
        if image_url:
            payload["image_url"] = image_url
        if image_base64:
            payload["image_base64"] = image_base64
        return await self.execute("vision", "anthropic", payload,
                                  provider_credentials=provider_credentials)

    async def claude_tool_use(self, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]],
                              model: str = "claude-3-5-sonnet-20241022", *, max_tokens: int = 1024,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("tool_use", "anthropic",
            {"messages": messages, "tools": tools, "model": model, "max_tokens": max_tokens},
            provider_credentials=provider_credentials)

    async def claude_count_tokens(self, messages: List[Dict[str, str]],
                                  model: str = "claude-3-5-sonnet-20241022", *,
                                  provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("count_tokens", "anthropic",
            {"messages": messages, "model": model},
            provider_credentials=provider_credentials)

    # ── GitHub helpers ───────────────────────────────────────────────────────

    async def github_create_repo(self, name: str, *, description: str = "", private: bool = False,
                                 files: Optional[List[Dict]] = None,
                                 provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("create_repo", "github",
            {"name": name, "description": description, "private": private, "files": files or []},
            provider_credentials=provider_credentials)

    async def github_get_repo(self, repo: str, *,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("get_repo", "github", {"repo": repo},
                                  provider_credentials=provider_credentials)

    async def github_list_repos(self, visibility: str = "all", *,
                                provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("list_repos", "github", {"visibility": visibility},
                                  provider_credentials=provider_credentials)

    async def github_delete_repo(self, repo: str, *,
                                 provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("delete_repo", "github", {"repo": repo},
                                  provider_credentials=provider_credentials)

    async def github_push_file(self, repo: str, path: str, content: str, *,
                               message: str = "update file", branch: str = "main",
                               sha: Optional[str] = None,
                               provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"repo": repo, "path": path, "content": content,
                                   "message": message, "branch": branch}
        if sha:
            payload["sha"] = sha
        return await self.execute("push_file", "github", payload,
                                  provider_credentials=provider_credentials)

    async def github_get_file(self, repo: str, path: str, *, ref: Optional[str] = None,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"repo": repo, "path": path}
        if ref:
            payload["ref"] = ref
        return await self.execute("get_file", "github", payload,
                                  provider_credentials=provider_credentials)

    async def github_create_branch(self, repo: str, branch: str, *, from_branch: str = "main",
                                   provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("create_branch", "github",
            {"repo": repo, "branch": branch, "from_branch": from_branch},
            provider_credentials=provider_credentials)

    async def github_create_issue(self, repo: str, title: str, *, body: str = "",
                                  labels: Optional[List[str]] = None,
                                  provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("create_issue", "github",
            {"repo": repo, "title": title, "body": body, "labels": labels or []},
            provider_credentials=provider_credentials)

    async def github_create_pr(self, repo: str, title: str, head: str, base: str, *,
                               body: str = "",
                               provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("create_pull_request", "github",
            {"repo": repo, "title": title, "head": head, "base": base, "body": body},
            provider_credentials=provider_credentials)

    async def github_merge_pr(self, repo: str, pull_number: int, *, merge_method: str = "merge",
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("merge_pr", "github",
            {"repo": repo, "pull_number": pull_number, "merge_method": merge_method},
            provider_credentials=provider_credentials)

    # ── Stripe helpers ───────────────────────────────────────────────────────

    async def stripe_create_payment_intent(self, amount: int, currency: str = "usd", *,
                                           provider_credentials: Optional[Dict[str, str]] = None,
                                           **kwargs) -> Dict[str, Any]:
        return await self.execute("create_payment_intent", "stripe",
            {"amount": amount, "currency": currency, **kwargs},
            provider_credentials=provider_credentials)

    async def stripe_confirm_payment(self, payment_intent_id: str, *,
                                     payment_method_id: Optional[str] = None,
                                     provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"payment_intent_id": payment_intent_id}
        if payment_method_id:
            payload["payment_method_id"] = payment_method_id
        return await self.execute("confirm_payment_intent", "stripe", payload,
                                  provider_credentials=provider_credentials)

    async def stripe_create_customer(self, email: str, *, name: Optional[str] = None,
                                     provider_credentials: Optional[Dict[str, str]] = None,
                                     **kwargs) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"email": email, **kwargs}
        if name:
            payload["name"] = name
        return await self.execute("create_customer", "stripe", payload,
                                  provider_credentials=provider_credentials)

    async def stripe_create_refund(self, charge_id: str, *, amount: Optional[int] = None,
                                   provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"charge": charge_id}
        if amount:
            payload["amount"] = amount
        return await self.execute("create_refund", "stripe", payload,
                                  provider_credentials=provider_credentials)

    async def stripe_get_balance(self, *,
                                 provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("get_balance", "stripe", {},
                                  provider_credentials=provider_credentials)

    async def stripe_create_transfer(self, amount: int, destination: str, currency: str = "usd", *,
                                     provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("create_transfer", "stripe",
            {"amount": amount, "destination": destination, "currency": currency},
            provider_credentials=provider_credentials)

    # ── Vercel helpers ───────────────────────────────────────────────────────

    async def vercel_deploy(self, name: str, files: List[Dict[str, Any]], *,
                            target: Optional[str] = None,
                            provider_credentials: Optional[Dict[str, str]] = None,
                            **kwargs) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"name": name, "files": files, **kwargs}
        if target:
            payload["target"] = target
        return await self.execute("deploy", "vercel", payload,
                                  provider_credentials=provider_credentials)

    async def vercel_deploy_from_git(self, repo: str, ref: str = "main", *,
                                     provider_credentials: Optional[Dict[str, str]] = None,
                                     **kwargs) -> Dict[str, Any]:
        return await self.execute("deploy_from_git", "vercel",
            {"git_source": {"repo": repo, "ref": ref}, **kwargs},
            provider_credentials=provider_credentials)

    async def vercel_get_deployment(self, deployment_id: str, *,
                                    provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("manage_deployment", "vercel",
            {"action": "get", "deployment_id": deployment_id},
            provider_credentials=provider_credentials)

    async def vercel_list_deployments(self, project_id: Optional[str] = None, *, limit: int = 20,
                                      provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"action": "list", "deployment_id": "_", "limit": limit}
        if project_id:
            payload["project_id"] = project_id
        return await self.execute("manage_deployment", "vercel", payload,
                                  provider_credentials=provider_credentials)

    async def vercel_get_logs(self, deployment_id: str, *,
                              provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("get_logs", "vercel", {"deployment_id": deployment_id},
                                  provider_credentials=provider_credentials)

    async def vercel_create_project(self, name: str, *, framework: Optional[str] = None,
                                    provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        project: Dict[str, Any] = {"name": name}
        if framework:
            project["framework"] = framework
        return await self.execute("manage_project", "vercel",
            {"action": "create", "project": project},
            provider_credentials=provider_credentials)

    async def vercel_set_env(self, project_id: str, key: str, value: str, *,
                             target: List[str] = None,
                             provider_credentials: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        return await self.execute("manage_environment", "vercel",
            {"action": "create", "project_id": project_id,
             "env": {"key": key, "value": value,
                     "target": target or ["production", "preview", "development"]}},
            provider_credentials=provider_credentials)

    # ── Marketplace — Discovery ───────────────────────────────────────────────

    async def marketplace_search(self, query: Optional[str] = None, *, category: Optional[str] = None,
                                 provider: Optional[str] = None, min_rating: Optional[float] = None,
                                 max_price: Optional[float] = None, sort_by: str = "relevance",
                                 limit: int = 20, offset: int = 0) -> Dict[str, Any]:
        params: Dict[str, Any] = {"sort_by": sort_by, "limit": limit, "offset": offset}
        if query:
            params["query"] = query
        if category:
            params["category"] = category
        if provider:
            params["provider"] = provider
        if min_rating is not None:
            params["min_rating"] = min_rating
        if max_price is not None:
            params["max_price"] = max_price
        return await self._get("/v1/marketplace/tools", params)

    async def marketplace_featured(self, *, limit: int = 10) -> Dict[str, Any]:
        return await self._get("/v1/marketplace/featured", {"limit": limit})

    async def marketplace_trending(self, *, limit: int = 10, period: str = "week") -> Dict[str, Any]:
        return await self._get("/v1/marketplace/trending", {"limit": limit, "period": period})

    async def marketplace_categories(self) -> Dict[str, Any]:
        return await self._get("/v1/marketplace/categories")

    async def marketplace_stats(self) -> Dict[str, Any]:
        return await self._get("/v1/marketplace/stats")

    async def marketplace_recommendations(self, *, limit: int = 10) -> Dict[str, Any]:
        return await self._get("/v1/marketplace/recommendations", {"limit": limit})

    # ── Marketplace — Registry ────────────────────────────────────────────────

    async def registry_register_tool(self, tool_data: Dict[str, Any]) -> Dict[str, Any]:
        return await self._post("/v1/marketplace/registry/tools", tool_data)

    async def registry_get_tool(self, tool_id: str) -> Dict[str, Any]:
        return await self._get(f"/v1/marketplace/registry/tools/{tool_id}")

    async def registry_update_tool(self, tool_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        return await self._put(f"/v1/marketplace/registry/tools/{tool_id}", updates)

    async def registry_verify_tool(self, tool_id: str, *, notes: Optional[str] = None) -> Dict[str, Any]:
        return await self._post(f"/v1/marketplace/registry/tools/{tool_id}/verify", {"notes": notes})

    async def registry_register_provider(self, provider_data: Dict[str, Any]) -> Dict[str, Any]:
        return await self._post("/v1/marketplace/registry/providers", provider_data)

    async def registry_get_provider(self, provider_id: str, *, include_tools: bool = False) -> Dict[str, Any]:
        return await self._get(f"/v1/marketplace/registry/providers/{provider_id}",
                               {"include_tools": include_tools})

    async def registry_update_provider(self, provider_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        return await self._put(f"/v1/marketplace/registry/providers/{provider_id}", updates)

    async def registry_category_tree(self) -> Dict[str, Any]:
        return await self._get("/v1/marketplace/registry/categories/tree")

    # ── Marketplace — Execution ───────────────────────────────────────────────

    async def marketplace_execute(self, tool_id: str, input_data: Dict[str, Any], *,
                                  pricing_model: str = "per_request",
                                  usage_data: Optional[Dict[str, Any]] = None,
                                  idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        body: Dict[str, Any] = {"input_data": input_data, "pricing_model": pricing_model}
        if usage_data:
            body["usage_data"] = usage_data
        if idempotency_key:
            body["idempotency_key"] = idempotency_key
        return await self._post(f"/v1/marketplace/tools/{tool_id}/execute", body)

    async def marketplace_estimate(self, tool_id: str, *, pricing_model: str = "per_request",
                                   requests: int = 1, tokens: Optional[int] = None) -> Dict[str, Any]:
        params: Dict[str, Any] = {"pricing_model": pricing_model, "requests": requests}
        if tokens is not None:
            params["tokens"] = tokens
        return await self._get(f"/v1/marketplace/tools/{tool_id}/estimate", params)

    # ── Marketplace — Payments ────────────────────────────────────────────────

    async def add_payment_route(self, route_data: Dict[str, Any]) -> Dict[str, Any]:
        return await self._post("/v1/marketplace/payment-routes", route_data)

    async def list_payment_routes(self) -> Dict[str, Any]:
        return await self._get("/v1/marketplace/payment-routes")

    async def delete_payment_route(self, route_id: str) -> None:
        await self._delete(f"/v1/marketplace/payment-routes/{route_id}")

    async def get_transactions(self, *, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        return await self._get("/v1/marketplace/transactions", {"limit": limit, "offset": offset})

    async def get_transaction(self, transaction_id: str) -> Dict[str, Any]:
        return await self._get(f"/v1/marketplace/transactions/{transaction_id}")

    # ── Marketplace — Social ──────────────────────────────────────────────────

    async def rate_tool(self, tool_id: str, rating: int) -> Dict[str, Any]:
        return await self._post(f"/v1/marketplace/tools/{tool_id}/rate", params={"rating": rating})

    async def favorite_tool(self, tool_id: str) -> Dict[str, Any]:
        return await self._post(f"/v1/marketplace/tools/{tool_id}/favorite")

    async def unfavorite_tool(self, tool_id: str) -> Dict[str, Any]:
        return await self._delete(f"/v1/marketplace/tools/{tool_id}/favorite")

    async def get_favorites(self, *, limit: int = 20, offset: int = 0) -> Dict[str, Any]:
        return await self._get("/v1/marketplace/favorites", {"limit": limit, "offset": offset})

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def close(self):
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.close()
