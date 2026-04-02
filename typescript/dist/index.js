"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Sentinel = exports.SentinelError = void 0;
class SentinelError extends Error {
    constructor(message, statusCode, detail) {
        super(message);
        this.name = "SentinelError";
        this.statusCode = statusCode;
        this.detail = detail;
    }
}
exports.SentinelError = SentinelError;
const SDK_VERSION = "0.3.0";
const SDK_LANGUAGE = "typescript";
class Sentinel {
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
    constructor({ apiKey, baseUrl = "http://localhost:8000", timeout = 300000, hmacSecret }) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.timeout = timeout;
        this.hmacSecret = hmacSecret;
    }
    async _signHeaders(method, path, body) {
        if (!this.hmacSecret)
            return {};
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
    async execute(tool, provider, payload, options = {}) {
        const body = {
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
        return this._request("POST", "/v1/executions/execute", body);
    }
    async listExecutions(options = {}) {
        const params = new URLSearchParams();
        if (options.agentId)
            params.set("agent_id", String(options.agentId));
        if (options.tool)
            params.set("tool", options.tool);
        if (options.provider)
            params.set("provider", options.provider);
        params.set("limit", String(options.limit ?? 20));
        params.set("offset", String(options.offset ?? 0));
        return this._request("GET", `/v1/executions/?${params}`);
    }
    async getExecution(executionId) {
        return this._request("GET", `/v1/executions/${executionId}`);
    }
    // ── OpenAI helpers ────────────────────────────────────────────────────────
    async openaiChat(messages, options = {}) {
        const { model = "gpt-4o", maxTokens = 1024, temperature = 0.7, providerCredentials, ...rest } = options;
        return this.execute("chat", "openai", { messages, model, max_tokens: maxTokens, temperature }, { providerCredentials, ...rest });
    }
    async openaiEmbedding(input, options = {}) {
        const { model = "text-embedding-ada-002", providerCredentials, ...rest } = options;
        return this.execute("embedding", "openai", { input, model }, { providerCredentials, ...rest });
    }
    async openaiImage(prompt, options = {}) {
        const { model = "dall-e-3", size = "1024x1024", quality = "standard", n = 1, providerCredentials, ...rest } = options;
        return this.execute("image_generation", "openai", { prompt, model, size, quality, n }, { providerCredentials, ...rest });
    }
    async openaiTranscribe(file, options = {}) {
        const { model = "whisper-1", language, providerCredentials, ...rest } = options;
        const payload = { file, model };
        if (language)
            payload.language = language;
        return this.execute("transcription", "openai", payload, { providerCredentials, ...rest });
    }
    // ── Anthropic helpers ─────────────────────────────────────────────────────
    async claudeChat(messages, options = {}) {
        const { model = "claude-3-5-sonnet-20241022", maxTokens = 1024, providerCredentials, ...rest } = options;
        return this.execute("chat", "anthropic", { messages, model, max_tokens: maxTokens }, { providerCredentials, ...rest });
    }
    async claudeStream(messages, options = {}) {
        const { model = "claude-3-5-sonnet-20241022", maxTokens = 1024, providerCredentials, ...rest } = options;
        return this.execute("stream", "anthropic", { messages, model, max_tokens: maxTokens }, { providerCredentials, ...rest });
    }
    async claudeVision(prompt, image, options = {}) {
        const { model = "claude-3-5-sonnet-20241022", providerCredentials, ...rest } = options;
        const payload = {
            prompt, model,
            media_type: image.mediaType ?? "image/jpeg",
        };
        if (image.url)
            payload.image_url = image.url;
        if (image.base64)
            payload.image_base64 = image.base64;
        return this.execute("vision", "anthropic", payload, { providerCredentials, ...rest });
    }
    async claudeToolUse(messages, tools, options = {}) {
        const { model = "claude-3-5-sonnet-20241022", maxTokens = 1024, providerCredentials, ...rest } = options;
        return this.execute("tool_use", "anthropic", { messages, tools, model, max_tokens: maxTokens }, { providerCredentials, ...rest });
    }
    async claudeCountTokens(messages, options = {}) {
        const { model = "claude-3-5-sonnet-20241022", providerCredentials, ...rest } = options;
        return this.execute("count_tokens", "anthropic", { messages, model }, { providerCredentials, ...rest });
    }
    // ── GitHub helpers ────────────────────────────────────────────────────────
    async githubCreateRepo(name, options = {}) {
        const { description = "", private: priv = false, files = [], providerCredentials, ...rest } = options;
        return this.execute("create_repo", "github", { name, description, private: priv, files }, { providerCredentials, ...rest });
    }
    async githubGetRepo(repo, options = {}) {
        return this.execute("get_repo", "github", { repo }, options);
    }
    async githubListRepos(options = {}) {
        const { visibility = "all", providerCredentials, ...rest } = options;
        return this.execute("list_repos", "github", { visibility }, { providerCredentials, ...rest });
    }
    async githubDeleteRepo(repo, options = {}) {
        return this.execute("delete_repo", "github", { repo }, options);
    }
    async githubPushFile(repo, path, content, options = {}) {
        const { message = "update file", branch = "main", sha, providerCredentials, ...rest } = options;
        const payload = { repo, path, content, message, branch };
        if (sha)
            payload.sha = sha;
        return this.execute("push_file", "github", payload, { providerCredentials, ...rest });
    }
    async githubGetFile(repo, path, options = {}) {
        const { ref, providerCredentials, ...rest } = options;
        const payload = { repo, path };
        if (ref)
            payload.ref = ref;
        return this.execute("get_file", "github", payload, { providerCredentials, ...rest });
    }
    async githubCreateBranch(repo, branch, options = {}) {
        const { fromBranch = "main", providerCredentials, ...rest } = options;
        return this.execute("create_branch", "github", { repo, branch, from_branch: fromBranch }, { providerCredentials, ...rest });
    }
    async githubCreateIssue(repo, title, options = {}) {
        const { body = "", labels = [], providerCredentials, ...rest } = options;
        return this.execute("create_issue", "github", { repo, title, body, labels }, { providerCredentials, ...rest });
    }
    async githubCreatePR(repo, title, head, base, options = {}) {
        const { body = "", providerCredentials, ...rest } = options;
        return this.execute("create_pull_request", "github", { repo, title, head, base, body }, { providerCredentials, ...rest });
    }
    async githubMergePR(repo, pullNumber, options = {}) {
        const { mergeMethod = "merge", providerCredentials, ...rest } = options;
        return this.execute("merge_pr", "github", { repo, pull_number: pullNumber, merge_method: mergeMethod }, { providerCredentials, ...rest });
    }
    // ── Stripe helpers ────────────────────────────────────────────────────────
    async stripeCreatePaymentIntent(amount, currency = "usd", options = {}) {
        const { providerCredentials, idempotencyKey, priority, timeoutSeconds, ...extra } = options;
        return this.execute("create_payment_intent", "stripe", { amount, currency, ...extra }, { providerCredentials, idempotencyKey, priority, timeoutSeconds });
    }
    async stripeConfirmPayment(paymentIntentId, options = {}) {
        const { paymentMethodId, providerCredentials, ...rest } = options;
        const payload = { payment_intent_id: paymentIntentId };
        if (paymentMethodId)
            payload.payment_method_id = paymentMethodId;
        return this.execute("confirm_payment_intent", "stripe", payload, { providerCredentials, ...rest });
    }
    async stripeCreateCustomer(email, options = {}) {
        const { name, providerCredentials, idempotencyKey, priority, timeoutSeconds, ...extra } = options;
        const payload = { email, ...extra };
        if (name)
            payload.name = name;
        return this.execute("create_customer", "stripe", payload, { providerCredentials, idempotencyKey, priority, timeoutSeconds });
    }
    async stripeCreateRefund(chargeId, options = {}) {
        const { amount, providerCredentials, ...rest } = options;
        const payload = { charge: chargeId };
        if (amount)
            payload.amount = amount;
        return this.execute("create_refund", "stripe", payload, { providerCredentials, ...rest });
    }
    async stripeGetBalance(options = {}) {
        return this.execute("get_balance", "stripe", {}, options);
    }
    async stripeCreateTransfer(amount, destination, currency = "usd", options = {}) {
        return this.execute("create_transfer", "stripe", { amount, destination, currency }, options);
    }
    // ── Vercel helpers ────────────────────────────────────────────────────────
    async vercelDeploy(name, files, options = {}) {
        const { target, providerCredentials, idempotencyKey, priority, timeoutSeconds, ...extra } = options;
        const payload = { name, files, ...extra };
        if (target)
            payload.target = target;
        return this.execute("deploy", "vercel", payload, { providerCredentials, idempotencyKey, priority, timeoutSeconds });
    }
    async vercelDeployFromGit(repo, ref = "main", options = {}) {
        const { providerCredentials, idempotencyKey, priority, timeoutSeconds, ...extra } = options;
        return this.execute("deploy_from_git", "vercel", { git_source: { repo, ref }, ...extra }, { providerCredentials, idempotencyKey, priority, timeoutSeconds });
    }
    async vercelGetDeployment(deploymentId, options = {}) {
        return this.execute("manage_deployment", "vercel", { action: "get", deployment_id: deploymentId }, options);
    }
    async vercelGetLogs(deploymentId, options = {}) {
        return this.execute("get_logs", "vercel", { deployment_id: deploymentId }, options);
    }
    async vercelCreateProject(name, options = {}) {
        const { framework, providerCredentials, ...rest } = options;
        const project = { name };
        if (framework)
            project.framework = framework;
        return this.execute("manage_project", "vercel", { action: "create", project }, { providerCredentials, ...rest });
    }
    async vercelSetEnv(projectId, key, value, options = {}) {
        const { target = ["production", "preview", "development"], providerCredentials, ...rest } = options;
        return this.execute("manage_environment", "vercel", { action: "create", project_id: projectId,
            env: { key, value, target } }, { providerCredentials, ...rest });
    }
    async vercelCreateAlias(deploymentId, alias, options = {}) {
        return this.execute("create_alias", "vercel", { deployment_id: deploymentId, alias }, options);
    }
    // ── Railway helpers ───────────────────────────────────────────────────────
    async railwayListProjects(options = {}) {
        return this.execute("list_projects", "railway", {}, options);
    }
    async railwayGetProject(projectId, options = {}) {
        return this.execute("get_project", "railway", { project_id: projectId }, options);
    }
    async railwayCreateProject(name, options = {}) {
        const { description, defaultEnvironmentName = "production", providerCredentials, ...rest } = options;
        const payload = { name, default_environment_name: defaultEnvironmentName };
        if (description)
            payload.description = description;
        return this.execute("create_project", "railway", payload, { providerCredentials, ...rest });
    }
    async railwayDeleteProject(projectId, options = {}) {
        return this.execute("delete_project", "railway", { project_id: projectId }, options);
    }
    async railwayCreateService(projectId, options = {}) {
        const { name, repo, image, providerCredentials, ...rest } = options;
        const payload = { project_id: projectId };
        if (name)
            payload.name = name;
        if (repo)
            payload.source = { repo };
        else if (image)
            payload.source = { image };
        return this.execute("create_service", "railway", payload, { providerCredentials, ...rest });
    }
    async railwayDeployService(serviceId, environmentId, options = {}) {
        return this.execute("deploy_service", "railway", { service_id: serviceId, environment_id: environmentId }, options);
    }
    async railwayListDeployments(serviceId, environmentId, options = {}) {
        const { limit = 10, providerCredentials, ...rest } = options;
        return this.execute("list_deployments", "railway", { service_id: serviceId, environment_id: environmentId, limit }, { providerCredentials, ...rest });
    }
    async railwayGetDeploymentLogs(deploymentId, options = {}) {
        return this.execute("get_deployment_logs", "railway", { deployment_id: deploymentId }, options);
    }
    async railwayRedeploy(deploymentId, options = {}) {
        return this.execute("redeploy", "railway", { deployment_id: deploymentId }, options);
    }
    async railwayRollback(deploymentId, options = {}) {
        return this.execute("rollback", "railway", { deployment_id: deploymentId }, options);
    }
    async railwayGetVariables(projectId, environmentId, options = {}) {
        const { serviceId, providerCredentials, ...rest } = options;
        const payload = { project_id: projectId, environment_id: environmentId };
        if (serviceId)
            payload.service_id = serviceId;
        return this.execute("get_variables", "railway", payload, { providerCredentials, ...rest });
    }
    async railwayUpsertVariable(projectId, environmentId, name, value, options = {}) {
        const { serviceId, providerCredentials, ...rest } = options;
        const payload = {
            project_id: projectId, environment_id: environmentId, name, value,
        };
        if (serviceId)
            payload.service_id = serviceId;
        return this.execute("upsert_variable", "railway", payload, { providerCredentials, ...rest });
    }
    async railwayUpsertVariables(projectId, environmentId, variables, options = {}) {
        const { serviceId, providerCredentials, ...rest } = options;
        const payload = {
            project_id: projectId, environment_id: environmentId, variables,
        };
        if (serviceId)
            payload.service_id = serviceId;
        return this.execute("upsert_variables", "railway", payload, { providerCredentials, ...rest });
    }
    async railwayListEnvironments(projectId, options = {}) {
        return this.execute("list_environments", "railway", { project_id: projectId }, options);
    }
    async railwayCreateEnvironment(projectId, name, options = {}) {
        return this.execute("create_environment", "railway", { project_id: projectId, name }, options);
    }
    async railwayCreateServiceDomain(serviceId, environmentId, options = {}) {
        return this.execute("create_service_domain", "railway", { service_id: serviceId, environment_id: environmentId }, options);
    }
    async railwayCreateCustomDomain(serviceId, environmentId, domain, options = {}) {
        return this.execute("create_custom_domain", "railway", { service_id: serviceId, environment_id: environmentId, domain }, options);
    }
    async railwayCreateVolume(projectId, environmentId, options = {}) {
        const { name, serviceId, providerCredentials, ...rest } = options;
        const payload = {
            project_id: projectId, environment_id: environmentId,
        };
        if (name)
            payload.name = name;
        if (serviceId)
            payload.service_id = serviceId;
        return this.execute("create_volume", "railway", payload, { providerCredentials, ...rest });
    }
    // ── Gemini helpers ────────────────────────────────────────────────────────
    async geminiChat(messages, options = {}) {
        const { model = "gemini-2.5-flash", maxTokens, temperature, systemInstruction, providerCredentials, ...rest } = options;
        const payload = { messages, model };
        if (maxTokens)
            payload.max_tokens = maxTokens;
        if (temperature != null)
            payload.temperature = temperature;
        if (systemInstruction)
            payload.system_instruction = systemInstruction;
        return this.execute("chat", "gemini", payload, { providerCredentials, ...rest });
    }
    async geminiEmbedding(input, options = {}) {
        const { model = "gemini-embedding-001", providerCredentials, ...rest } = options;
        return this.execute("embedding", "gemini", { input, model }, { providerCredentials, ...rest });
    }
    async geminiImage(prompt, options = {}) {
        const { model = "imagen-4.0-generate-001", n = 1, providerCredentials, ...rest } = options;
        return this.execute("image_generation", "gemini", { prompt, model, n }, { providerCredentials, ...rest });
    }
    async geminiCountTokens(contents, options = {}) {
        const { model = "gemini-2.5-flash", providerCredentials, ...rest } = options;
        return this.execute("count_tokens", "gemini", { contents, model }, { providerCredentials, ...rest });
    }
    // ── Perplexity helpers ────────────────────────────────────────────────────
    async perplexityChat(messages, options = {}) {
        const { model = "sonar", maxTokens, returnImages, returnRelatedQuestions, searchRecencyFilter, providerCredentials, ...rest } = options;
        const payload = { messages, model };
        if (maxTokens)
            payload.max_tokens = maxTokens;
        if (returnImages)
            payload.return_images = true;
        if (returnRelatedQuestions)
            payload.return_related_questions = true;
        if (searchRecencyFilter)
            payload.search_recency_filter = searchRecencyFilter;
        return this.execute("chat", "perplexity", payload, { providerCredentials, ...rest });
    }
    async perplexitySearch(query, options = {}) {
        return this.execute("search", "perplexity", { query }, options);
    }
    async perplexityEmbedding(input, options = {}) {
        const { model = "pplx-embed-v1-0.6b", dimensions, providerCredentials, ...rest } = options;
        const payload = { input, model };
        if (dimensions)
            payload.dimensions = dimensions;
        return this.execute("embedding", "perplexity", payload, { providerCredentials, ...rest });
    }
    async perplexityAgent(input, options = {}) {
        const { model, instructions, maxOutputTokens, preset, providerCredentials, ...rest } = options;
        const payload = { input };
        if (model)
            payload.model = model;
        if (instructions)
            payload.instructions = instructions;
        if (maxOutputTokens)
            payload.max_output_tokens = maxOutputTokens;
        if (preset)
            payload.preset = preset;
        return this.execute("agent", "perplexity", payload, { providerCredentials, ...rest });
    }
    // ── Mistral helpers ───────────────────────────────────────────────────────
    async mistralChat(messages, options = {}) {
        const { model = "mistral-small-latest", maxTokens, temperature, safePrompt, providerCredentials, ...rest } = options;
        const payload = { messages, model };
        if (maxTokens)
            payload.max_tokens = maxTokens;
        if (temperature != null)
            payload.temperature = temperature;
        if (safePrompt)
            payload.safe_prompt = true;
        return this.execute("chat", "mistral", payload, { providerCredentials, ...rest });
    }
    async mistralFim(prompt, options = {}) {
        const { suffix, model = "codestral-latest", maxTokens, providerCredentials, ...rest } = options;
        const payload = { prompt, model };
        if (suffix)
            payload.suffix = suffix;
        if (maxTokens)
            payload.max_tokens = maxTokens;
        return this.execute("fim", "mistral", payload, { providerCredentials, ...rest });
    }
    async mistralEmbedding(input, options = {}) {
        const { model = "mistral-embed", providerCredentials, ...rest } = options;
        return this.execute("embedding", "mistral", { input, model }, { providerCredentials, ...rest });
    }
    async mistralModeration(input, options = {}) {
        const { model = "mistral-moderation-latest", providerCredentials, ...rest } = options;
        return this.execute("moderation", "mistral", { input, model }, { providerCredentials, ...rest });
    }
    // ── Cohere helpers ────────────────────────────────────────────────────────
    async cohereChat(messages, options = {}) {
        const { model = "command-a-03-2025", maxTokens, temperature, providerCredentials, ...rest } = options;
        const payload = { messages, model };
        if (maxTokens)
            payload.max_tokens = maxTokens;
        if (temperature != null)
            payload.temperature = temperature;
        return this.execute("chat", "cohere", payload, { providerCredentials, ...rest });
    }
    async cohereEmbedding(input, options = {}) {
        const { model = "embed-v4.0", inputType = "search_document", providerCredentials, ...rest } = options;
        return this.execute("embedding", "cohere", { input, model, input_type: inputType }, { providerCredentials, ...rest });
    }
    async cohereRerank(query, documents, options = {}) {
        const { model = "rerank-v3.5", topN, providerCredentials, ...rest } = options;
        const payload = { query, documents, model };
        if (topN)
            payload.top_n = topN;
        return this.execute("rerank", "cohere", payload, { providerCredentials, ...rest });
    }
    async cohereClassify(inputs, options = {}) {
        const { model = "embed-english-v3.0", examples, providerCredentials, ...rest } = options;
        const payload = { inputs, model };
        if (examples)
            payload.examples = examples;
        return this.execute("classify", "cohere", payload, { providerCredentials, ...rest });
    }
    // ── DeepSeek helpers ──────────────────────────────────────────────────────
    async deepseekChat(messages, options = {}) {
        const { model = "deepseek-chat", maxTokens, temperature, providerCredentials, ...rest } = options;
        const payload = { messages, model };
        if (maxTokens)
            payload.max_tokens = maxTokens;
        if (temperature != null)
            payload.temperature = temperature;
        return this.execute("chat", "deepseek", payload, { providerCredentials, ...rest });
    }
    async deepseekReasoning(messages, options = {}) {
        const { model = "deepseek-reasoner", maxTokens, providerCredentials, ...rest } = options;
        const payload = { messages, model };
        if (maxTokens)
            payload.max_tokens = maxTokens;
        return this.execute("reasoning", "deepseek", payload, { providerCredentials, ...rest });
    }
    async deepseekFim(prompt, options = {}) {
        const { suffix, model = "deepseek-chat", maxTokens, providerCredentials, ...rest } = options;
        const payload = { prompt, model };
        if (suffix)
            payload.suffix = suffix;
        if (maxTokens)
            payload.max_tokens = maxTokens;
        return this.execute("fim", "deepseek", payload, { providerCredentials, ...rest });
    }
    // ── Pinecone helpers ──────────────────────────────────────────────────────
    async pineconeCreateIndex(name, dimension, options = {}) {
        const { metric = "cosine", cloud = "aws", region = "us-east-1", providerCredentials, ...rest } = options;
        return this.execute("create_index", "pinecone", { name, dimension, metric, cloud, region }, { providerCredentials, ...rest });
    }
    async pineconeListIndexes(options = {}) {
        return this.execute("list_indexes", "pinecone", {}, options);
    }
    async pineconeUpsert(host, vectors, options = {}) {
        const { namespace, providerCredentials, ...rest } = options;
        const payload = { host, vectors };
        if (namespace)
            payload.namespace = namespace;
        return this.execute("upsert", "pinecone", payload, { providerCredentials, ...rest });
    }
    async pineconeQuery(host, vector, options = {}) {
        const { topK = 10, namespace, includeMetadata = true, filter, providerCredentials, ...rest } = options;
        const payload = { host, vector, top_k: topK,
            include_metadata: includeMetadata };
        if (namespace)
            payload.namespace = namespace;
        if (filter)
            payload.filter = filter;
        return this.execute("query", "pinecone", payload, { providerCredentials, ...rest });
    }
    async pineconeDeleteIndex(name, options = {}) {
        return this.execute("delete_index", "pinecone", { name }, options);
    }
    // ── Supabase helpers ──────────────────────────────────────────────────────
    async supabaseQuery(table, options = {}) {
        const { select = "*", filters, limit = 100, providerCredentials, ...rest } = options;
        const payload = { table, select, limit };
        if (filters)
            payload.filters = filters;
        return this.execute("query", "supabase", payload, { providerCredentials, ...rest });
    }
    async supabaseInsert(table, rows, options = {}) {
        return this.execute("insert", "supabase", { table, rows }, options);
    }
    async supabaseUpdate(table, updates, options = {}) {
        const { filters, providerCredentials, ...rest } = options;
        const payload = { table, updates };
        if (filters)
            payload.filters = filters;
        return this.execute("update", "supabase", payload, { providerCredentials, ...rest });
    }
    async supabaseDelete(table, options = {}) {
        const { filters, providerCredentials, ...rest } = options;
        const payload = { table };
        if (filters)
            payload.filters = filters;
        return this.execute("delete", "supabase", payload, { providerCredentials, ...rest });
    }
    async supabaseRpc(fn, options = {}) {
        const { params, providerCredentials, ...rest } = options;
        const payload = { function: fn };
        if (params)
            payload.params = params;
        return this.execute("rpc", "supabase", payload, { providerCredentials, ...rest });
    }
    async supabaseUploadFile(bucket, path, content, options = {}) {
        const { contentType = "text/plain", providerCredentials, ...rest } = options;
        return this.execute("upload_file", "supabase", { bucket, path, content, content_type: contentType }, { providerCredentials, ...rest });
    }
    async supabaseListFiles(bucket, options = {}) {
        const { prefix = "", providerCredentials, ...rest } = options;
        return this.execute("list_files", "supabase", { bucket, prefix }, { providerCredentials, ...rest });
    }
    async supabaseInvokeFunction(fn, options = {}) {
        const { body, providerCredentials, ...rest } = options;
        const payload = { function: fn };
        if (body)
            payload.body = body;
        return this.execute("invoke_function", "supabase", payload, { providerCredentials, ...rest });
    }
    // ── Twilio helpers ────────────────────────────────────────────────────────
    async twilioSendSms(to, from_, body, options = {}) {
        const { mediaUrl, providerCredentials, ...rest } = options;
        const payload = { to, from: from_, body };
        if (mediaUrl)
            payload.media_url = mediaUrl;
        return this.execute("send_sms", "twilio", payload, { providerCredentials, ...rest });
    }
    async twilioMakeCall(to, from_, options = {}) {
        const { url, twiml, providerCredentials, ...rest } = options;
        const payload = { to, from: from_ };
        if (url)
            payload.url = url;
        if (twiml)
            payload.twiml = twiml;
        return this.execute("make_call", "twilio", payload, { providerCredentials, ...rest });
    }
    async twilioListMessages(options = {}) {
        const { to, from: from_, limit = 20, providerCredentials, ...rest } = options;
        const payload = { limit };
        if (to)
            payload.to = to;
        if (from_)
            payload.from = from_;
        return this.execute("list_messages", "twilio", payload, { providerCredentials, ...rest });
    }
    async twilioLookup(phoneNumber, options = {}) {
        const { fields = "line_type_intelligence", providerCredentials, ...rest } = options;
        return this.execute("lookup", "twilio", { phone_number: phoneNumber, fields }, { providerCredentials, ...rest });
    }
    // ── GoDaddy helpers ───────────────────────────────────────────────────────
    async godaddyCheckAvailability(domain, options = {}) {
        return this.execute("check_availability", "godaddy", { domain }, options);
    }
    async godaddySuggestDomains(query, options = {}) {
        const { limit = 10, providerCredentials, ...rest } = options;
        return this.execute("suggest_domains", "godaddy", { query, limit }, { providerCredentials, ...rest });
    }
    async godaddyListDomains(options = {}) {
        return this.execute("list_domains", "godaddy", {}, options);
    }
    async godaddyGetDnsRecords(domain, options = {}) {
        const { type, name, providerCredentials, ...rest } = options;
        const payload = { domain };
        if (type)
            payload.type = type;
        if (name)
            payload.name = name;
        return this.execute("get_dns_records", "godaddy", payload, { providerCredentials, ...rest });
    }
    async godaddySetDnsRecords(domain, records, options = {}) {
        return this.execute("set_dns_records", "godaddy", { domain, records }, options);
    }
    async godaddyPurchaseDomain(domain, contact, options = {}) {
        const { period = 1, privacy = true, providerCredentials, ...rest } = options;
        return this.execute("purchase_domain", "godaddy", { domain, contact, period, privacy }, { providerCredentials, ...rest });
    }
    // ── ElevenLabs helpers ────────────────────────────────────────────────────
    async elevenlabsTts(text, options = {}) {
        const { voiceId = "21m00Tcm4TlvDq8ikWAM", modelId = "eleven_multilingual_v2", outputFormat = "mp3_44100_128", providerCredentials, ...rest } = options;
        return this.execute("text_to_speech", "elevenlabs", { text, voice_id: voiceId, model_id: modelId, output_format: outputFormat }, { providerCredentials, ...rest });
    }
    async elevenlabsStt(audioBase64, options = {}) {
        const { modelId = "scribe_v1", language, providerCredentials, ...rest } = options;
        const payload = { audio_base64: audioBase64, model_id: modelId };
        if (language)
            payload.language = language;
        return this.execute("speech_to_text", "elevenlabs", payload, { providerCredentials, ...rest });
    }
    async elevenlabsListVoices(options = {}) {
        return this.execute("list_voices", "elevenlabs", {}, options);
    }
    async elevenlabsSoundEffects(text, options = {}) {
        const { durationSeconds, providerCredentials, ...rest } = options;
        const payload = { text };
        if (durationSeconds)
            payload.duration_seconds = durationSeconds;
        return this.execute("sound_effects", "elevenlabs", payload, { providerCredentials, ...rest });
    }
    // ── Cloudflare helpers ────────────────────────────────────────────────────
    async cloudflareListZones(options = {}) {
        const { name, providerCredentials, ...rest } = options;
        const payload = {};
        if (name)
            payload.name = name;
        return this.execute("list_zones", "cloudflare", payload, { providerCredentials, ...rest });
    }
    async cloudflareListDnsRecords(zoneId, options = {}) {
        const { type, providerCredentials, ...rest } = options;
        const payload = { zone_id: zoneId };
        if (type)
            payload.type = type;
        return this.execute("list_dns_records", "cloudflare", payload, { providerCredentials, ...rest });
    }
    async cloudflareCreateDnsRecord(zoneId, type, name, content, options = {}) {
        const { ttl = 1, proxied = false, providerCredentials, ...rest } = options;
        return this.execute("create_dns_record", "cloudflare", { zone_id: zoneId, type, name, content, ttl, proxied }, { providerCredentials, ...rest });
    }
    async cloudflareCreateR2Bucket(name, options = {}) {
        return this.execute("create_r2_bucket", "cloudflare", { name }, options);
    }
    async cloudflareListR2Buckets(options = {}) {
        return this.execute("list_r2_buckets", "cloudflare", {}, options);
    }
    async cloudflareDeployWorker(name, content, options = {}) {
        return this.execute("deploy_worker", "cloudflare", { name, content }, options);
    }
    async cloudflareListWorkers(options = {}) {
        return this.execute("list_workers", "cloudflare", {}, options);
    }
    // ── Neon helpers ──────────────────────────────────────────────────────────
    async neonCreateProject(options = {}) {
        const { name = "sentinel-project", regionId, providerCredentials, ...rest } = options;
        const payload = { name };
        if (regionId)
            payload.region_id = regionId;
        return this.execute("create_project", "neon", payload, { providerCredentials, ...rest });
    }
    async neonListProjects(options = {}) {
        return this.execute("list_projects", "neon", {}, options);
    }
    async neonDeleteProject(projectId, options = {}) {
        return this.execute("delete_project", "neon", { project_id: projectId }, options);
    }
    async neonCreateBranch(projectId, options = {}) {
        const { name, parentId, providerCredentials, ...rest } = options;
        const payload = { project_id: projectId };
        if (name)
            payload.name = name;
        if (parentId)
            payload.parent_id = parentId;
        return this.execute("create_branch", "neon", payload, { providerCredentials, ...rest });
    }
    async neonListBranches(projectId, options = {}) {
        return this.execute("list_branches", "neon", { project_id: projectId }, options);
    }
    async neonGetConnectionUri(projectId, options = {}) {
        const { branchId, databaseName, providerCredentials, ...rest } = options;
        const payload = { project_id: projectId };
        if (branchId)
            payload.branch_id = branchId;
        if (databaseName)
            payload.database_name = databaseName;
        return this.execute("get_connection_uri", "neon", payload, { providerCredentials, ...rest });
    }
    // ── Hugging Face helpers ──────────────────────────────────────────────────
    async huggingfaceInference(model, inputs, options = {}) {
        const { task = "text_generation", providerCredentials, ...rest } = options;
        return this.execute(task, "huggingface", { model, inputs }, { providerCredentials, ...rest });
    }
    async huggingfaceChat(messages, options = {}) {
        const { model = "meta-llama/Meta-Llama-3-8B-Instruct", maxNewTokens, providerCredentials, ...rest } = options;
        const payload = { messages, model };
        if (maxNewTokens)
            payload.max_new_tokens = maxNewTokens;
        return this.execute("chat", "huggingface", payload, { providerCredentials, ...rest });
    }
    async huggingfaceClassify(text, options = {}) {
        const { model = "distilbert-base-uncased-finetuned-sst-2-english", providerCredentials, ...rest } = options;
        return this.execute("text_classification", "huggingface", { inputs: text, model }, { providerCredentials, ...rest });
    }
    async huggingfaceNer(text, options = {}) {
        const { model = "dslim/bert-base-NER", providerCredentials, ...rest } = options;
        return this.execute("ner", "huggingface", { inputs: text, model }, { providerCredentials, ...rest });
    }
    async huggingfaceTranslate(text, options = {}) {
        const { model = "Helsinki-NLP/opus-mt-en-fr", providerCredentials, ...rest } = options;
        return this.execute("translation", "huggingface", { inputs: text, model }, { providerCredentials, ...rest });
    }
    async huggingfaceSummarize(text, options = {}) {
        const { model = "facebook/bart-large-cnn", providerCredentials, ...rest } = options;
        return this.execute("summarization", "huggingface", { inputs: text, model }, { providerCredentials, ...rest });
    }
    async huggingfaceTextToImage(prompt, options = {}) {
        const { model = "stabilityai/stable-diffusion-xl-base-1.0", providerCredentials, ...rest } = options;
        return this.execute("text_to_image", "huggingface", { prompt, model }, { providerCredentials, ...rest });
    }
    async huggingfaceEmbedding(text, options = {}) {
        const { model = "sentence-transformers/all-MiniLM-L6-v2", providerCredentials, ...rest } = options;
        return this.execute("embedding", "huggingface", { inputs: text, model }, { providerCredentials, ...rest });
    }
    // ── Marketplace — Discovery ───────────────────────────────────────────────
    async marketplaceSearch(options = {}) {
        const params = new URLSearchParams();
        if (options.query)
            params.set("query", options.query);
        if (options.category)
            params.set("category", options.category);
        if (options.provider)
            params.set("provider", options.provider);
        if (options.minRating != null)
            params.set("min_rating", String(options.minRating));
        if (options.maxPrice != null)
            params.set("max_price", String(options.maxPrice));
        params.set("sort_by", options.sortBy ?? "relevance");
        params.set("limit", String(options.limit ?? 20));
        params.set("offset", String(options.offset ?? 0));
        return this._request("GET", `/v1/marketplace/tools?${params}`);
    }
    async marketplaceFeatured(limit = 10) {
        return this._request("GET", `/v1/marketplace/featured?limit=${limit}`);
    }
    async marketplaceTrending(options = {}) {
        const params = new URLSearchParams({ limit: String(options.limit ?? 10), period: options.period ?? "week" });
        return this._request("GET", `/v1/marketplace/trending?${params}`);
    }
    async marketplaceCategories() {
        return this._request("GET", "/v1/marketplace/categories");
    }
    async marketplaceStats() {
        return this._request("GET", "/v1/marketplace/stats");
    }
    async marketplaceRecommendations(limit = 10) {
        return this._request("GET", `/v1/marketplace/recommendations?limit=${limit}`);
    }
    // ── Marketplace — Registry ────────────────────────────────────────────────
    async registryRegisterTool(toolData) {
        return this._request("POST", "/v1/marketplace/registry/tools", toolData);
    }
    async registryGetTool(toolId) {
        return this._request("GET", `/v1/marketplace/registry/tools/${toolId}`);
    }
    async registryUpdateTool(toolId, updates) {
        return this._request("PUT", `/v1/marketplace/registry/tools/${toolId}`, updates);
    }
    async registryVerifyTool(toolId, notes) {
        return this._request("POST", `/v1/marketplace/registry/tools/${toolId}/verify`, { notes });
    }
    async registryRegisterProvider(providerData) {
        return this._request("POST", "/v1/marketplace/registry/providers", providerData);
    }
    async registryGetProvider(providerId, includeTools = false) {
        return this._request("GET", `/v1/marketplace/registry/providers/${providerId}?include_tools=${includeTools}`);
    }
    async registryUpdateProvider(providerId, updates) {
        return this._request("PUT", `/v1/marketplace/registry/providers/${providerId}`, updates);
    }
    async registryCategoryTree() {
        return this._request("GET", "/v1/marketplace/registry/categories/tree");
    }
    // ── Marketplace — Execution ───────────────────────────────────────────────
    async marketplaceExecute(toolId, inputData, options = {}) {
        return this._request("POST", `/v1/marketplace/tools/${toolId}/execute`, {
            input_data: inputData,
            pricing_model: options.pricingModel ?? "per_request",
            ...(options.usageData ? { usage_data: options.usageData } : {}),
            ...(options.idempotencyKey ? { idempotency_key: options.idempotencyKey } : {}),
        });
    }
    async marketplaceEstimate(toolId, options = {}) {
        const params = new URLSearchParams({
            pricing_model: options.pricingModel ?? "per_request",
            requests: String(options.requests ?? 1),
        });
        if (options.tokens != null)
            params.set("tokens", String(options.tokens));
        return this._request("GET", `/v1/marketplace/tools/${toolId}/estimate?${params}`);
    }
    // ── Marketplace — Payments ────────────────────────────────────────────────
    async addPaymentRoute(routeData) {
        return this._request("POST", "/v1/marketplace/payment-routes", routeData);
    }
    async listPaymentRoutes() {
        return this._request("GET", "/v1/marketplace/payment-routes");
    }
    async deletePaymentRoute(routeId) {
        await this._request("DELETE", `/v1/marketplace/payment-routes/${routeId}`);
    }
    async getTransactions(options = {}) {
        const params = new URLSearchParams({ limit: String(options.limit ?? 50), offset: String(options.offset ?? 0) });
        return this._request("GET", `/v1/marketplace/transactions?${params}`);
    }
    async getTransaction(transactionId) {
        return this._request("GET", `/v1/marketplace/transactions/${transactionId}`);
    }
    // ── Marketplace — Social ──────────────────────────────────────────────────
    async rateTool(toolId, rating) {
        return this._request("POST", `/v1/marketplace/tools/${toolId}/rate?rating=${rating}`);
    }
    async favoriteTool(toolId) {
        return this._request("POST", `/v1/marketplace/tools/${toolId}/favorite`);
    }
    async unfavoriteTool(toolId) {
        return this._request("DELETE", `/v1/marketplace/tools/${toolId}/favorite`);
    }
    async getFavorites(options = {}) {
        const params = new URLSearchParams({ limit: String(options.limit ?? 20), offset: String(options.offset ?? 0) });
        return this._request("GET", `/v1/marketplace/favorites?${params}`);
    }
    // ── Internal ──────────────────────────────────────────────────────────────
    async _request(method, path, body) {
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
            return data;
        }
        finally {
            clearTimeout(timer);
        }
    }
}
exports.Sentinel = Sentinel;
