export class SentinelError extends Error {
  statusCode: number;
  detail: unknown;

  constructor(message: string, statusCode: number, detail?: unknown) {
    super(message);
    this.name = "SentinelError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export interface ExecuteOptions {
  providerCredentials?: Record<string, string>;
  idempotencyKey?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  timeoutSeconds?: number;
}

export interface ExecutionResult {
  execution_id: string;
  success: boolean;
  agent_id: number;
  user_id: number;
  result: Record<string, unknown>;
  cost: number;
  execution_time_ms: number;
}

export interface ListExecutionsOptions {
  agentId?: number;
  tool?: string;
  provider?: string;
  limit?: number;
  offset?: number;
}

export interface SentinelOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  hmacSecret?: string;
}

const SDK_VERSION = "0.3.0";
const SDK_LANGUAGE = "typescript";

export class Sentinel {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private hmacSecret?: string;

  /**
   * Sentinel SDK — route any tool call through Sentinel with full observability,
   * policy enforcement, and budget control.
   *
   * @example
   * const client = new Sentinel({ apiKey: "sk_agent_..." });
   * const result = await client.execute("create_payment_intent", "stripe", {
   *   amount: 2000,
   *   currency: "usd",
   * });
   */
  constructor({ apiKey, baseUrl = "http://localhost:8000", timeout = 300000, hmacSecret }: SentinelOptions) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeout = timeout;
    this.hmacSecret = hmacSecret;
  }

  private async _signHeaders(method: string, path: string, body: string): Promise<Record<string, string>> {
    if (!this.hmacSecret) return {};
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `${timestamp}${method}${path}${body}`;
    // Use Web Crypto API (works in Node 18+ and browsers)
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.hmacSecret);
    const msgData = encoder.encode(message);
    const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
    const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    return { "X-Sentinel-Signature": signature, "X-Sentinel-Timestamp": timestamp };
  }

  // ── Core execute ──────────────────────────────────────────────────────────

  async execute(
    tool: string,
    provider: string,
    payload: Record<string, unknown>,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const body: Record<string, unknown> = {
      tool,
      provider,
      payload: options.providerCredentials
        ? { ...payload, provider_credentials: options.providerCredentials }
        : payload,
      priority: options.priority ?? "normal",
      timeout_seconds: options.timeoutSeconds ?? 300,
    };
    if (options.idempotencyKey) {
      body.idempotency_key = options.idempotencyKey;
    }
    return this._request<ExecutionResult>("POST", "/v1/executions/execute", body);
  }

  async listExecutions(options: ListExecutionsOptions = {}): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    if (options.agentId) params.set("agent_id", String(options.agentId));
    if (options.tool) params.set("tool", options.tool);
    if (options.provider) params.set("provider", options.provider);
    params.set("limit", String(options.limit ?? 20));
    params.set("offset", String(options.offset ?? 0));
    return this._request("GET", `/v1/executions/?${params}`);
  }

  async getExecution(executionId: string): Promise<Record<string, unknown>> {
    return this._request("GET", `/v1/executions/${executionId}`);
  }

  // ── OpenAI helpers ────────────────────────────────────────────────────────

  async openaiChat(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string; maxTokens?: number; temperature?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "gpt-4o", maxTokens = 1024, temperature = 0.7,
            providerCredentials, ...rest } = options;
    return this.execute("chat", "openai",
      { messages, model, max_tokens: maxTokens, temperature },
      { providerCredentials, ...rest });
  }

  async openaiEmbedding(
    input: string | string[],
    options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "text-embedding-ada-002", providerCredentials, ...rest } = options;
    return this.execute("embedding", "openai", { input, model },
      { providerCredentials, ...rest });
  }

  async openaiImage(
    prompt: string,
    options: { model?: string; size?: string; quality?: string; n?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "dall-e-3", size = "1024x1024", quality = "standard",
            n = 1, providerCredentials, ...rest } = options;
    return this.execute("image_generation", "openai",
      { prompt, model, size, quality, n },
      { providerCredentials, ...rest });
  }

  async openaiTranscribe(
    file: string,
    options: { model?: string; language?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "whisper-1", language, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { file, model };
    if (language) payload.language = language;
    return this.execute("transcription", "openai", payload, { providerCredentials, ...rest });
  }

  // ── Anthropic helpers ─────────────────────────────────────────────────────

  async claudeChat(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string; maxTokens?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "claude-3-5-sonnet-20241022", maxTokens = 1024,
            providerCredentials, ...rest } = options;
    return this.execute("chat", "anthropic",
      { messages, model, max_tokens: maxTokens },
      { providerCredentials, ...rest });
  }

  async claudeStream(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string; maxTokens?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "claude-3-5-sonnet-20241022", maxTokens = 1024,
            providerCredentials, ...rest } = options;
    return this.execute("stream", "anthropic",
      { messages, model, max_tokens: maxTokens },
      { providerCredentials, ...rest });
  }

  async claudeVision(
    prompt: string,
    image: { url?: string; base64?: string; mediaType?: string },
    options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "claude-3-5-sonnet-20241022", providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = {
      prompt, model,
      media_type: image.mediaType ?? "image/jpeg",
    };
    if (image.url) payload.image_url = image.url;
    if (image.base64) payload.image_base64 = image.base64;
    return this.execute("vision", "anthropic", payload, { providerCredentials, ...rest });
  }

  async claudeToolUse(
    messages: Array<Record<string, unknown>>,
    tools: Array<Record<string, unknown>>,
    options: { model?: string; maxTokens?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "claude-3-5-sonnet-20241022", maxTokens = 1024,
            providerCredentials, ...rest } = options;
    return this.execute("tool_use", "anthropic",
      { messages, tools, model, max_tokens: maxTokens },
      { providerCredentials, ...rest });
  }

  async claudeCountTokens(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "claude-3-5-sonnet-20241022", providerCredentials, ...rest } = options;
    return this.execute("count_tokens", "anthropic",
      { messages, model },
      { providerCredentials, ...rest });
  }

  // ── GitHub helpers ────────────────────────────────────────────────────────

  async githubCreateRepo(
    name: string,
    options: { description?: string; private?: boolean; files?: unknown[] } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { description = "", private: priv = false, files = [],
            providerCredentials, ...rest } = options;
    return this.execute("create_repo", "github",
      { name, description, private: priv, files },
      { providerCredentials, ...rest });
  }

  async githubGetRepo(repo: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("get_repo", "github", { repo }, options);
  }

  async githubListRepos(options: { visibility?: string } & ExecuteOptions = {}): Promise<ExecutionResult> {
    const { visibility = "all", providerCredentials, ...rest } = options;
    return this.execute("list_repos", "github", { visibility }, { providerCredentials, ...rest });
  }

  async githubDeleteRepo(repo: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("delete_repo", "github", { repo }, options);
  }

  async githubPushFile(
    repo: string, path: string, content: string,
    options: { message?: string; branch?: string; sha?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { message = "update file", branch = "main", sha,
            providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { repo, path, content, message, branch };
    if (sha) payload.sha = sha;
    return this.execute("push_file", "github", payload, { providerCredentials, ...rest });
  }

  async githubGetFile(
    repo: string, path: string,
    options: { ref?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { ref, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { repo, path };
    if (ref) payload.ref = ref;
    return this.execute("get_file", "github", payload, { providerCredentials, ...rest });
  }

  async githubCreateBranch(
    repo: string, branch: string,
    options: { fromBranch?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { fromBranch = "main", providerCredentials, ...rest } = options;
    return this.execute("create_branch", "github",
      { repo, branch, from_branch: fromBranch },
      { providerCredentials, ...rest });
  }

  async githubCreateIssue(
    repo: string, title: string,
    options: { body?: string; labels?: string[] } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { body = "", labels = [], providerCredentials, ...rest } = options;
    return this.execute("create_issue", "github",
      { repo, title, body, labels },
      { providerCredentials, ...rest });
  }

  async githubCreatePR(
    repo: string, title: string, head: string, base: string,
    options: { body?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { body = "", providerCredentials, ...rest } = options;
    return this.execute("create_pull_request", "github",
      { repo, title, head, base, body },
      { providerCredentials, ...rest });
  }

  async githubMergePR(
    repo: string, pullNumber: number,
    options: { mergeMethod?: "merge" | "squash" | "rebase" } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { mergeMethod = "merge", providerCredentials, ...rest } = options;
    return this.execute("merge_pr", "github",
      { repo, pull_number: pullNumber, merge_method: mergeMethod },
      { providerCredentials, ...rest });
  }

  // ── Stripe helpers ────────────────────────────────────────────────────────

  async stripeCreatePaymentIntent(
    amount: number, currency = "usd",
    options: ExecuteOptions & Record<string, unknown> = {}
  ): Promise<ExecutionResult> {
    const { providerCredentials, idempotencyKey, priority, timeoutSeconds, ...extra } = options;
    return this.execute("create_payment_intent", "stripe",
      { amount, currency, ...extra },
      { providerCredentials, idempotencyKey, priority, timeoutSeconds });
  }

  async stripeConfirmPayment(
    paymentIntentId: string,
    options: { paymentMethodId?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { paymentMethodId, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { payment_intent_id: paymentIntentId };
    if (paymentMethodId) payload.payment_method_id = paymentMethodId;
    return this.execute("confirm_payment_intent", "stripe", payload,
      { providerCredentials, ...rest });
  }

  async stripeCreateCustomer(
    email: string,
    options: { name?: string } & ExecuteOptions & Record<string, unknown> = {}
  ): Promise<ExecutionResult> {
    const { name, providerCredentials, idempotencyKey, priority, timeoutSeconds, ...extra } = options;
    const payload: Record<string, unknown> = { email, ...extra };
    if (name) payload.name = name;
    return this.execute("create_customer", "stripe", payload,
      { providerCredentials, idempotencyKey, priority, timeoutSeconds });
  }

  async stripeCreateRefund(
    chargeId: string,
    options: { amount?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { amount, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { charge: chargeId };
    if (amount) payload.amount = amount;
    return this.execute("create_refund", "stripe", payload, { providerCredentials, ...rest });
  }

  async stripeGetBalance(options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("get_balance", "stripe", {}, options);
  }

  async stripeCreateTransfer(
    amount: number, destination: string, currency = "usd",
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    return this.execute("create_transfer", "stripe",
      { amount, destination, currency }, options);
  }

  // ── Vercel helpers ────────────────────────────────────────────────────────

  async vercelDeploy(
    name: string,
    files: Array<{ file: string; data: string }>,
    options: { target?: string } & ExecuteOptions & Record<string, unknown> = {}
  ): Promise<ExecutionResult> {
    const { target, providerCredentials, idempotencyKey, priority, timeoutSeconds, ...extra } = options;
    const payload: Record<string, unknown> = { name, files, ...extra };
    if (target) payload.target = target;
    return this.execute("deploy", "vercel", payload,
      { providerCredentials, idempotencyKey, priority, timeoutSeconds });
  }

  async vercelDeployFromGit(
    repo: string, ref = "main",
    options: ExecuteOptions & Record<string, unknown> = {}
  ): Promise<ExecutionResult> {
    const { providerCredentials, idempotencyKey, priority, timeoutSeconds, ...extra } = options;
    return this.execute("deploy_from_git", "vercel",
      { git_source: { repo, ref }, ...extra },
      { providerCredentials, idempotencyKey, priority, timeoutSeconds });
  }

  async vercelGetDeployment(deploymentId: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("manage_deployment", "vercel",
      { action: "get", deployment_id: deploymentId }, options);
  }

  async vercelGetLogs(deploymentId: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("get_logs", "vercel", { deployment_id: deploymentId }, options);
  }

  async vercelCreateProject(
    name: string,
    options: { framework?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { framework, providerCredentials, ...rest } = options;
    const project: Record<string, unknown> = { name };
    if (framework) project.framework = framework;
    return this.execute("manage_project", "vercel",
      { action: "create", project },
      { providerCredentials, ...rest });
  }

  async vercelSetEnv(
    projectId: string, key: string, value: string,
    options: { target?: string[] } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { target = ["production", "preview", "development"],
            providerCredentials, ...rest } = options;
    return this.execute("manage_environment", "vercel",
      { action: "create", project_id: projectId,
        env: { key, value, target } },
      { providerCredentials, ...rest });
  }

  async vercelCreateAlias(
    deploymentId: string, alias: string,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    return this.execute("create_alias", "vercel",
      { deployment_id: deploymentId, alias }, options);
  }

  // ── Railway helpers ───────────────────────────────────────────────────────

  async railwayListProjects(options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("list_projects", "railway", {}, options);
  }

  async railwayGetProject(projectId: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("get_project", "railway", { project_id: projectId }, options);
  }

  async railwayCreateProject(
    name: string,
    options: { description?: string; defaultEnvironmentName?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { description, defaultEnvironmentName = "production",
            providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { name, default_environment_name: defaultEnvironmentName };
    if (description) payload.description = description;
    return this.execute("create_project", "railway", payload, { providerCredentials, ...rest });
  }

  async railwayDeleteProject(projectId: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("delete_project", "railway", { project_id: projectId }, options);
  }

  async railwayCreateService(
    projectId: string,
    options: { name?: string; repo?: string; image?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { name, repo, image, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { project_id: projectId };
    if (name) payload.name = name;
    if (repo) payload.source = { repo };
    else if (image) payload.source = { image };
    return this.execute("create_service", "railway", payload, { providerCredentials, ...rest });
  }

  async railwayDeployService(
    serviceId: string, environmentId: string,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    return this.execute("deploy_service", "railway",
      { service_id: serviceId, environment_id: environmentId }, options);
  }

  async railwayListDeployments(
    serviceId: string, environmentId: string,
    options: { limit?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { limit = 10, providerCredentials, ...rest } = options;
    return this.execute("list_deployments", "railway",
      { service_id: serviceId, environment_id: environmentId, limit },
      { providerCredentials, ...rest });
  }

  async railwayGetDeploymentLogs(deploymentId: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("get_deployment_logs", "railway",
      { deployment_id: deploymentId }, options);
  }

  async railwayRedeploy(deploymentId: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("redeploy", "railway", { deployment_id: deploymentId }, options);
  }

  async railwayRollback(deploymentId: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("rollback", "railway", { deployment_id: deploymentId }, options);
  }

  async railwayGetVariables(
    projectId: string, environmentId: string,
    options: { serviceId?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { serviceId, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { project_id: projectId, environment_id: environmentId };
    if (serviceId) payload.service_id = serviceId;
    return this.execute("get_variables", "railway", payload, { providerCredentials, ...rest });
  }

  async railwayUpsertVariable(
    projectId: string, environmentId: string, name: string, value: string,
    options: { serviceId?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { serviceId, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = {
      project_id: projectId, environment_id: environmentId, name, value,
    };
    if (serviceId) payload.service_id = serviceId;
    return this.execute("upsert_variable", "railway", payload, { providerCredentials, ...rest });
  }

  async railwayUpsertVariables(
    projectId: string, environmentId: string, variables: Record<string, string>,
    options: { serviceId?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { serviceId, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = {
      project_id: projectId, environment_id: environmentId, variables,
    };
    if (serviceId) payload.service_id = serviceId;
    return this.execute("upsert_variables", "railway", payload, { providerCredentials, ...rest });
  }

  async railwayListEnvironments(projectId: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("list_environments", "railway", { project_id: projectId }, options);
  }

  async railwayCreateEnvironment(
    projectId: string, name: string,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    return this.execute("create_environment", "railway",
      { project_id: projectId, name }, options);
  }

  async railwayCreateServiceDomain(
    serviceId: string, environmentId: string,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    return this.execute("create_service_domain", "railway",
      { service_id: serviceId, environment_id: environmentId }, options);
  }

  async railwayCreateCustomDomain(
    serviceId: string, environmentId: string, domain: string,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    return this.execute("create_custom_domain", "railway",
      { service_id: serviceId, environment_id: environmentId, domain }, options);
  }

  async railwayCreateVolume(
    projectId: string, environmentId: string,
    options: { name?: string; serviceId?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { name, serviceId, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = {
      project_id: projectId, environment_id: environmentId,
    };
    if (name) payload.name = name;
    if (serviceId) payload.service_id = serviceId;
    return this.execute("create_volume", "railway", payload, { providerCredentials, ...rest });
  }

  // ── Gemini helpers ────────────────────────────────────────────────────────

  async geminiChat(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string; maxTokens?: number; temperature?: number; systemInstruction?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "gemini-2.5-flash", maxTokens, temperature, systemInstruction,
            providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { messages, model };
    if (maxTokens) payload.max_tokens = maxTokens;
    if (temperature != null) payload.temperature = temperature;
    if (systemInstruction) payload.system_instruction = systemInstruction;
    return this.execute("chat", "gemini", payload, { providerCredentials, ...rest });
  }

  async geminiEmbedding(
    input: string | string[],
    options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "gemini-embedding-001", providerCredentials, ...rest } = options;
    return this.execute("embedding", "gemini", { input, model }, { providerCredentials, ...rest });
  }

  async geminiImage(
    prompt: string,
    options: { model?: string; n?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "imagen-4.0-generate-001", n = 1, providerCredentials, ...rest } = options;
    return this.execute("image_generation", "gemini", { prompt, model, n }, { providerCredentials, ...rest });
  }

  async geminiCountTokens(
    contents: string,
    options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "gemini-2.5-flash", providerCredentials, ...rest } = options;
    return this.execute("count_tokens", "gemini", { contents, model }, { providerCredentials, ...rest });
  }

  // ── Perplexity helpers ────────────────────────────────────────────────────

  async perplexityChat(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string; maxTokens?: number; returnImages?: boolean;
               returnRelatedQuestions?: boolean; searchRecencyFilter?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "sonar", maxTokens, returnImages, returnRelatedQuestions,
            searchRecencyFilter, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { messages, model };
    if (maxTokens) payload.max_tokens = maxTokens;
    if (returnImages) payload.return_images = true;
    if (returnRelatedQuestions) payload.return_related_questions = true;
    if (searchRecencyFilter) payload.search_recency_filter = searchRecencyFilter;
    return this.execute("chat", "perplexity", payload, { providerCredentials, ...rest });
  }

  async perplexitySearch(
    query: string, options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    return this.execute("search", "perplexity", { query }, options);
  }

  async perplexityEmbedding(
    input: string | string[],
    options: { model?: string; dimensions?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "pplx-embed-v1-0.6b", dimensions, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { input, model };
    if (dimensions) payload.dimensions = dimensions;
    return this.execute("embedding", "perplexity", payload, { providerCredentials, ...rest });
  }

  async perplexityAgent(
    input: string,
    options: { model?: string; instructions?: string; maxOutputTokens?: number;
               preset?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model, instructions, maxOutputTokens, preset, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { input };
    if (model) payload.model = model;
    if (instructions) payload.instructions = instructions;
    if (maxOutputTokens) payload.max_output_tokens = maxOutputTokens;
    if (preset) payload.preset = preset;
    return this.execute("agent", "perplexity", payload, { providerCredentials, ...rest });
  }

  // ── Mistral helpers ───────────────────────────────────────────────────────

  async mistralChat(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string; maxTokens?: number; temperature?: number; safePrompt?: boolean } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "mistral-small-latest", maxTokens, temperature, safePrompt,
            providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { messages, model };
    if (maxTokens) payload.max_tokens = maxTokens;
    if (temperature != null) payload.temperature = temperature;
    if (safePrompt) payload.safe_prompt = true;
    return this.execute("chat", "mistral", payload, { providerCredentials, ...rest });
  }

  async mistralFim(
    prompt: string,
    options: { suffix?: string; model?: string; maxTokens?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { suffix, model = "codestral-latest", maxTokens, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { prompt, model };
    if (suffix) payload.suffix = suffix;
    if (maxTokens) payload.max_tokens = maxTokens;
    return this.execute("fim", "mistral", payload, { providerCredentials, ...rest });
  }

  async mistralEmbedding(
    input: string | string[],
    options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "mistral-embed", providerCredentials, ...rest } = options;
    return this.execute("embedding", "mistral", { input, model }, { providerCredentials, ...rest });
  }

  async mistralModeration(
    input: string | string[],
    options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "mistral-moderation-latest", providerCredentials, ...rest } = options;
    return this.execute("moderation", "mistral", { input, model }, { providerCredentials, ...rest });
  }

  // ── Cohere helpers ────────────────────────────────────────────────────────

  async cohereChat(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string; maxTokens?: number; temperature?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "command-a-03-2025", maxTokens, temperature,
            providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { messages, model };
    if (maxTokens) payload.max_tokens = maxTokens;
    if (temperature != null) payload.temperature = temperature;
    return this.execute("chat", "cohere", payload, { providerCredentials, ...rest });
  }

  async cohereEmbedding(
    input: string | string[],
    options: { model?: string; inputType?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "embed-v4.0", inputType = "search_document",
            providerCredentials, ...rest } = options;
    return this.execute("embedding", "cohere", { input, model, input_type: inputType },
      { providerCredentials, ...rest });
  }

  async cohereRerank(
    query: string, documents: string[],
    options: { model?: string; topN?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "rerank-v3.5", topN, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { query, documents, model };
    if (topN) payload.top_n = topN;
    return this.execute("rerank", "cohere", payload, { providerCredentials, ...rest });
  }

  async cohereClassify(
    inputs: string[],
    options: { model?: string; examples?: Array<Record<string, unknown>> } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "embed-english-v3.0", examples, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { inputs, model };
    if (examples) payload.examples = examples;
    return this.execute("classify", "cohere", payload, { providerCredentials, ...rest });
  }

  // ── DeepSeek helpers ──────────────────────────────────────────────────────

  async deepseekChat(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string; maxTokens?: number; temperature?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "deepseek-chat", maxTokens, temperature,
            providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { messages, model };
    if (maxTokens) payload.max_tokens = maxTokens;
    if (temperature != null) payload.temperature = temperature;
    return this.execute("chat", "deepseek", payload, { providerCredentials, ...rest });
  }

  async deepseekReasoning(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string; maxTokens?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "deepseek-reasoner", maxTokens, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { messages, model };
    if (maxTokens) payload.max_tokens = maxTokens;
    return this.execute("reasoning", "deepseek", payload, { providerCredentials, ...rest });
  }

  async deepseekFim(
    prompt: string,
    options: { suffix?: string; model?: string; maxTokens?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { suffix, model = "deepseek-chat", maxTokens, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { prompt, model };
    if (suffix) payload.suffix = suffix;
    if (maxTokens) payload.max_tokens = maxTokens;
    return this.execute("fim", "deepseek", payload, { providerCredentials, ...rest });
  }

  // ── Pinecone helpers ──────────────────────────────────────────────────────

  async pineconeCreateIndex(
    name: string, dimension: number,
    options: { metric?: string; cloud?: string; region?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { metric = "cosine", cloud = "aws", region = "us-east-1",
            providerCredentials, ...rest } = options;
    return this.execute("create_index", "pinecone",
      { name, dimension, metric, cloud, region }, { providerCredentials, ...rest });
  }

  async pineconeListIndexes(options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("list_indexes", "pinecone", {}, options);
  }

  async pineconeUpsert(
    host: string, vectors: Array<Record<string, unknown>>,
    options: { namespace?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { namespace, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { host, vectors };
    if (namespace) payload.namespace = namespace;
    return this.execute("upsert", "pinecone", payload, { providerCredentials, ...rest });
  }

  async pineconeQuery(
    host: string, vector: number[],
    options: { topK?: number; namespace?: string; includeMetadata?: boolean;
               filter?: Record<string, unknown> } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { topK = 10, namespace, includeMetadata = true, filter,
            providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { host, vector, top_k: topK,
                                                include_metadata: includeMetadata };
    if (namespace) payload.namespace = namespace;
    if (filter) payload.filter = filter;
    return this.execute("query", "pinecone", payload, { providerCredentials, ...rest });
  }

  async pineconeDeleteIndex(name: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("delete_index", "pinecone", { name }, options);
  }

  // ── Supabase helpers ──────────────────────────────────────────────────────

  async supabaseQuery(
    table: string,
    options: { select?: string; filters?: Record<string, string>; limit?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { select = "*", filters, limit = 100, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { table, select, limit };
    if (filters) payload.filters = filters;
    return this.execute("query", "supabase", payload, { providerCredentials, ...rest });
  }

  async supabaseInsert(
    table: string, rows: unknown,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    return this.execute("insert", "supabase", { table, rows }, options);
  }

  async supabaseUpdate(
    table: string, updates: Record<string, unknown>,
    options: { filters?: Record<string, string> } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { filters, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { table, updates };
    if (filters) payload.filters = filters;
    return this.execute("update", "supabase", payload, { providerCredentials, ...rest });
  }

  async supabaseDelete(
    table: string,
    options: { filters?: Record<string, string> } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { filters, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { table };
    if (filters) payload.filters = filters;
    return this.execute("delete", "supabase", payload, { providerCredentials, ...rest });
  }

  async supabaseRpc(
    fn: string,
    options: { params?: Record<string, unknown> } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { params, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { function: fn };
    if (params) payload.params = params;
    return this.execute("rpc", "supabase", payload, { providerCredentials, ...rest });
  }

  async supabaseUploadFile(
    bucket: string, path: string, content: string,
    options: { contentType?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { contentType = "text/plain", providerCredentials, ...rest } = options;
    return this.execute("upload_file", "supabase",
      { bucket, path, content, content_type: contentType },
      { providerCredentials, ...rest });
  }

  async supabaseListFiles(
    bucket: string,
    options: { prefix?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { prefix = "", providerCredentials, ...rest } = options;
    return this.execute("list_files", "supabase", { bucket, prefix },
      { providerCredentials, ...rest });
  }

  async supabaseInvokeFunction(
    fn: string,
    options: { body?: Record<string, unknown> } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { body, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { function: fn };
    if (body) payload.body = body;
    return this.execute("invoke_function", "supabase", payload, { providerCredentials, ...rest });
  }

  // ── Twilio helpers ────────────────────────────────────────────────────────

  async twilioSendSms(
    to: string, from_: string, body: string,
    options: { mediaUrl?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { mediaUrl, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { to, from: from_, body };
    if (mediaUrl) payload.media_url = mediaUrl;
    return this.execute("send_sms", "twilio", payload, { providerCredentials, ...rest });
  }

  async twilioMakeCall(
    to: string, from_: string,
    options: { url?: string; twiml?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { url, twiml, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { to, from: from_ };
    if (url) payload.url = url;
    if (twiml) payload.twiml = twiml;
    return this.execute("make_call", "twilio", payload, { providerCredentials, ...rest });
  }

  async twilioListMessages(
    options: { to?: string; from?: string; limit?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { to, from: from_, limit = 20, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { limit };
    if (to) payload.to = to;
    if (from_) payload.from = from_;
    return this.execute("list_messages", "twilio", payload, { providerCredentials, ...rest });
  }

  async twilioLookup(
    phoneNumber: string,
    options: { fields?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { fields = "line_type_intelligence", providerCredentials, ...rest } = options;
    return this.execute("lookup", "twilio", { phone_number: phoneNumber, fields },
      { providerCredentials, ...rest });
  }

  // ── GoDaddy helpers ───────────────────────────────────────────────────────

  async godaddyCheckAvailability(domain: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("check_availability", "godaddy", { domain }, options);
  }

  async godaddySuggestDomains(
    query: string, options: { limit?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { limit = 10, providerCredentials, ...rest } = options;
    return this.execute("suggest_domains", "godaddy", { query, limit },
      { providerCredentials, ...rest });
  }

  async godaddyListDomains(options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("list_domains", "godaddy", {}, options);
  }

  async godaddyGetDnsRecords(
    domain: string, options: { type?: string; name?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { type, name, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { domain };
    if (type) payload.type = type;
    if (name) payload.name = name;
    return this.execute("get_dns_records", "godaddy", payload, { providerCredentials, ...rest });
  }

  async godaddySetDnsRecords(
    domain: string, records: Array<Record<string, unknown>>,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    return this.execute("set_dns_records", "godaddy", { domain, records }, options);
  }

  async godaddyPurchaseDomain(
    domain: string, contact: Record<string, string>,
    options: { period?: number; privacy?: boolean } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { period = 1, privacy = true, providerCredentials, ...rest } = options;
    return this.execute("purchase_domain", "godaddy",
      { domain, contact, period, privacy }, { providerCredentials, ...rest });
  }

  // ── ElevenLabs helpers ────────────────────────────────────────────────────

  async elevenlabsTts(
    text: string,
    options: { voiceId?: string; modelId?: string; outputFormat?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { voiceId = "21m00Tcm4TlvDq8ikWAM", modelId = "eleven_multilingual_v2",
            outputFormat = "mp3_44100_128", providerCredentials, ...rest } = options;
    return this.execute("text_to_speech", "elevenlabs",
      { text, voice_id: voiceId, model_id: modelId, output_format: outputFormat },
      { providerCredentials, ...rest });
  }

  async elevenlabsStt(
    audioBase64: string,
    options: { modelId?: string; language?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { modelId = "scribe_v1", language, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { audio_base64: audioBase64, model_id: modelId };
    if (language) payload.language = language;
    return this.execute("speech_to_text", "elevenlabs", payload, { providerCredentials, ...rest });
  }

  async elevenlabsListVoices(options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("list_voices", "elevenlabs", {}, options);
  }

  async elevenlabsSoundEffects(
    text: string,
    options: { durationSeconds?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { durationSeconds, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { text };
    if (durationSeconds) payload.duration_seconds = durationSeconds;
    return this.execute("sound_effects", "elevenlabs", payload, { providerCredentials, ...rest });
  }

  // ── Cloudflare helpers ────────────────────────────────────────────────────

  async cloudflareListZones(options: { name?: string } & ExecuteOptions = {}): Promise<ExecutionResult> {
    const { name, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = {};
    if (name) payload.name = name;
    return this.execute("list_zones", "cloudflare", payload, { providerCredentials, ...rest });
  }

  async cloudflareListDnsRecords(
    zoneId: string, options: { type?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { type, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { zone_id: zoneId };
    if (type) payload.type = type;
    return this.execute("list_dns_records", "cloudflare", payload, { providerCredentials, ...rest });
  }

  async cloudflareCreateDnsRecord(
    zoneId: string, type: string, name: string, content: string,
    options: { ttl?: number; proxied?: boolean } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { ttl = 1, proxied = false, providerCredentials, ...rest } = options;
    return this.execute("create_dns_record", "cloudflare",
      { zone_id: zoneId, type, name, content, ttl, proxied },
      { providerCredentials, ...rest });
  }

  async cloudflareCreateR2Bucket(name: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("create_r2_bucket", "cloudflare", { name }, options);
  }

  async cloudflareListR2Buckets(options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("list_r2_buckets", "cloudflare", {}, options);
  }

  async cloudflareDeployWorker(
    name: string, content: string, options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    return this.execute("deploy_worker", "cloudflare", { name, content }, options);
  }

  async cloudflareListWorkers(options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("list_workers", "cloudflare", {}, options);
  }

  // ── Neon helpers ──────────────────────────────────────────────────────────

  async neonCreateProject(
    options: { name?: string; regionId?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { name = "sentinel-project", regionId, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { name };
    if (regionId) payload.region_id = regionId;
    return this.execute("create_project", "neon", payload, { providerCredentials, ...rest });
  }

  async neonListProjects(options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("list_projects", "neon", {}, options);
  }

  async neonDeleteProject(projectId: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("delete_project", "neon", { project_id: projectId }, options);
  }

  async neonCreateBranch(
    projectId: string,
    options: { name?: string; parentId?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { name, parentId, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { project_id: projectId };
    if (name) payload.name = name;
    if (parentId) payload.parent_id = parentId;
    return this.execute("create_branch", "neon", payload, { providerCredentials, ...rest });
  }

  async neonListBranches(projectId: string, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    return this.execute("list_branches", "neon", { project_id: projectId }, options);
  }

  async neonGetConnectionUri(
    projectId: string,
    options: { branchId?: string; databaseName?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { branchId, databaseName, providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { project_id: projectId };
    if (branchId) payload.branch_id = branchId;
    if (databaseName) payload.database_name = databaseName;
    return this.execute("get_connection_uri", "neon", payload, { providerCredentials, ...rest });
  }

  // ── Hugging Face helpers ──────────────────────────────────────────────────

  async huggingfaceInference(
    model: string, inputs: unknown,
    options: { task?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { task = "text_generation", providerCredentials, ...rest } = options;
    return this.execute(task, "huggingface", { model, inputs }, { providerCredentials, ...rest });
  }

  async huggingfaceChat(
    messages: Array<{ role: string; content: string }>,
    options: { model?: string; maxNewTokens?: number } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "meta-llama/Meta-Llama-3-8B-Instruct", maxNewTokens,
            providerCredentials, ...rest } = options;
    const payload: Record<string, unknown> = { messages, model };
    if (maxNewTokens) payload.max_new_tokens = maxNewTokens;
    return this.execute("chat", "huggingface", payload, { providerCredentials, ...rest });
  }

  async huggingfaceClassify(
    text: string, options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "distilbert-base-uncased-finetuned-sst-2-english",
            providerCredentials, ...rest } = options;
    return this.execute("text_classification", "huggingface",
      { inputs: text, model }, { providerCredentials, ...rest });
  }

  async huggingfaceNer(
    text: string, options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "dslim/bert-base-NER", providerCredentials, ...rest } = options;
    return this.execute("ner", "huggingface", { inputs: text, model },
      { providerCredentials, ...rest });
  }

  async huggingfaceTranslate(
    text: string, options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "Helsinki-NLP/opus-mt-en-fr", providerCredentials, ...rest } = options;
    return this.execute("translation", "huggingface", { inputs: text, model },
      { providerCredentials, ...rest });
  }

  async huggingfaceSummarize(
    text: string, options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "facebook/bart-large-cnn", providerCredentials, ...rest } = options;
    return this.execute("summarization", "huggingface", { inputs: text, model },
      { providerCredentials, ...rest });
  }

  async huggingfaceTextToImage(
    prompt: string, options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "stabilityai/stable-diffusion-xl-base-1.0",
            providerCredentials, ...rest } = options;
    return this.execute("text_to_image", "huggingface", { prompt, model },
      { providerCredentials, ...rest });
  }

  async huggingfaceEmbedding(
    text: string, options: { model?: string } & ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const { model = "sentence-transformers/all-MiniLM-L6-v2",
            providerCredentials, ...rest } = options;
    return this.execute("embedding", "huggingface", { inputs: text, model },
      { providerCredentials, ...rest });
  }

  // ── Marketplace — Discovery ───────────────────────────────────────────────

  async marketplaceSearch(options: {
    query?: string;
    category?: string;
    provider?: string;
    minRating?: number;
    maxPrice?: number;
    sortBy?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    if (options.query) params.set("query", options.query);
    if (options.category) params.set("category", options.category);
    if (options.provider) params.set("provider", options.provider);
    if (options.minRating != null) params.set("min_rating", String(options.minRating));
    if (options.maxPrice != null) params.set("max_price", String(options.maxPrice));
    params.set("sort_by", options.sortBy ?? "relevance");
    params.set("limit", String(options.limit ?? 20));
    params.set("offset", String(options.offset ?? 0));
    return this._request("GET", `/v1/marketplace/tools?${params}`);
  }

  async marketplaceFeatured(limit = 10): Promise<Record<string, unknown>> {
    return this._request("GET", `/v1/marketplace/featured?limit=${limit}`);
  }

  async marketplaceTrending(options: { limit?: number; period?: string } = {}): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ limit: String(options.limit ?? 10), period: options.period ?? "week" });
    return this._request("GET", `/v1/marketplace/trending?${params}`);
  }

  async marketplaceCategories(): Promise<Record<string, unknown>> {
    return this._request("GET", "/v1/marketplace/categories");
  }

  async marketplaceStats(): Promise<Record<string, unknown>> {
    return this._request("GET", "/v1/marketplace/stats");
  }

  async marketplaceRecommendations(limit = 10): Promise<Record<string, unknown>> {
    return this._request("GET", `/v1/marketplace/recommendations?limit=${limit}`);
  }

  // ── Marketplace — Registry ────────────────────────────────────────────────

  async registryRegisterTool(toolData: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this._request("POST", "/v1/marketplace/registry/tools", toolData);
  }

  async registryGetTool(toolId: string): Promise<Record<string, unknown>> {
    return this._request("GET", `/v1/marketplace/registry/tools/${toolId}`);
  }

  async registryUpdateTool(toolId: string, updates: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this._request("PUT", `/v1/marketplace/registry/tools/${toolId}`, updates);
  }

  async registryVerifyTool(toolId: string, notes?: string): Promise<Record<string, unknown>> {
    return this._request("POST", `/v1/marketplace/registry/tools/${toolId}/verify`, { notes });
  }

  async registryRegisterProvider(providerData: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this._request("POST", "/v1/marketplace/registry/providers", providerData);
  }

  async registryGetProvider(providerId: string, includeTools = false): Promise<Record<string, unknown>> {
    return this._request("GET", `/v1/marketplace/registry/providers/${providerId}?include_tools=${includeTools}`);
  }

  async registryUpdateProvider(providerId: string, updates: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this._request("PUT", `/v1/marketplace/registry/providers/${providerId}`, updates);
  }

  async registryCategoryTree(): Promise<Record<string, unknown>> {
    return this._request("GET", "/v1/marketplace/registry/categories/tree");
  }

  // ── Marketplace — Execution ───────────────────────────────────────────────

  async marketplaceExecute(
    toolId: string,
    inputData: Record<string, unknown>,
    options: { pricingModel?: string; usageData?: Record<string, unknown>; idempotencyKey?: string } = {}
  ): Promise<Record<string, unknown>> {
    return this._request("POST", `/v1/marketplace/tools/${toolId}/execute`, {
      input_data: inputData,
      pricing_model: options.pricingModel ?? "per_request",
      ...(options.usageData ? { usage_data: options.usageData } : {}),
      ...(options.idempotencyKey ? { idempotency_key: options.idempotencyKey } : {}),
    });
  }

  async marketplaceEstimate(
    toolId: string,
    options: { pricingModel?: string; requests?: number; tokens?: number } = {}
  ): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({
      pricing_model: options.pricingModel ?? "per_request",
      requests: String(options.requests ?? 1),
    });
    if (options.tokens != null) params.set("tokens", String(options.tokens));
    return this._request("GET", `/v1/marketplace/tools/${toolId}/estimate?${params}`);
  }

  // ── Marketplace — Payments ────────────────────────────────────────────────

  async addPaymentRoute(routeData: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this._request("POST", "/v1/marketplace/payment-routes", routeData);
  }

  async listPaymentRoutes(): Promise<Record<string, unknown>> {
    return this._request("GET", "/v1/marketplace/payment-routes");
  }

  async deletePaymentRoute(routeId: string): Promise<void> {
    await this._request("DELETE", `/v1/marketplace/payment-routes/${routeId}`);
  }

  async getTransactions(options: { limit?: number; offset?: number } = {}): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ limit: String(options.limit ?? 50), offset: String(options.offset ?? 0) });
    return this._request("GET", `/v1/marketplace/transactions?${params}`);
  }

  async getTransaction(transactionId: string): Promise<Record<string, unknown>> {
    return this._request("GET", `/v1/marketplace/transactions/${transactionId}`);
  }

  // ── Marketplace — Social ──────────────────────────────────────────────────

  async rateTool(toolId: string, rating: number): Promise<Record<string, unknown>> {
    return this._request("POST", `/v1/marketplace/tools/${toolId}/rate?rating=${rating}`);
  }

  async favoriteTool(toolId: string): Promise<Record<string, unknown>> {
    return this._request("POST", `/v1/marketplace/tools/${toolId}/favorite`);
  }

  async unfavoriteTool(toolId: string): Promise<Record<string, unknown>> {
    return this._request("DELETE", `/v1/marketplace/tools/${toolId}/favorite`);
  }

  async getFavorites(options: { limit?: number; offset?: number } = {}): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ limit: String(options.limit ?? 20), offset: String(options.offset ?? 0) });
    return this._request("GET", `/v1/marketplace/favorites?${params}`);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async _request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const bodyStr = body ? JSON.stringify(body) : "";
      const hmacHeaders = await this._signHeaders(method.toUpperCase(), path, bodyStr);

      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
          "X-Sentinel-SDK-Version": `${SDK_LANGUAGE}/${SDK_VERSION}`,
          ...hmacHeaders,
        },
        body: bodyStr || undefined,
        signal: controller.signal,
      });

      // Check for deprecation warning
      const deprecation = res.headers.get("x-sentinel-deprecation-warning");
      if (deprecation) {
        console.warn(`[sentinel] WARNING: ${deprecation}`);
      }

      const data = await res.json().catch(() => res.text());

      if (!res.ok) {
        throw new SentinelError(`Sentinel API error ${res.status}`, res.status, data);
      }

      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
