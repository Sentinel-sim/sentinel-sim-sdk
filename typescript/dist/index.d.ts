export declare class SentinelError extends Error {
    statusCode: number;
    detail: unknown;
    constructor(message: string, statusCode: number, detail?: unknown);
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
export declare class Sentinel {
    private apiKey;
    private baseUrl;
    private timeout;
    private hmacSecret?;
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
    constructor({ apiKey, baseUrl, timeout, hmacSecret }: SentinelOptions);
    private _signHeaders;
    execute(tool: string, provider: string, payload: Record<string, unknown>, options?: ExecuteOptions): Promise<ExecutionResult>;
    listExecutions(options?: ListExecutionsOptions): Promise<Record<string, unknown>>;
    getExecution(executionId: string): Promise<Record<string, unknown>>;
    openaiChat(messages: Array<{
        role: string;
        content: string;
    }>, options?: {
        model?: string;
        maxTokens?: number;
        temperature?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    openaiEmbedding(input: string | string[], options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    openaiImage(prompt: string, options?: {
        model?: string;
        size?: string;
        quality?: string;
        n?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    openaiTranscribe(file: string, options?: {
        model?: string;
        language?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    claudeChat(messages: Array<{
        role: string;
        content: string;
    }>, options?: {
        model?: string;
        maxTokens?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    claudeStream(messages: Array<{
        role: string;
        content: string;
    }>, options?: {
        model?: string;
        maxTokens?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    claudeVision(prompt: string, image: {
        url?: string;
        base64?: string;
        mediaType?: string;
    }, options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    claudeToolUse(messages: Array<Record<string, unknown>>, tools: Array<Record<string, unknown>>, options?: {
        model?: string;
        maxTokens?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    claudeCountTokens(messages: Array<{
        role: string;
        content: string;
    }>, options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    githubCreateRepo(name: string, options?: {
        description?: string;
        private?: boolean;
        files?: unknown[];
    } & ExecuteOptions): Promise<ExecutionResult>;
    githubGetRepo(repo: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    githubListRepos(options?: {
        visibility?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    githubDeleteRepo(repo: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    githubPushFile(repo: string, path: string, content: string, options?: {
        message?: string;
        branch?: string;
        sha?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    githubGetFile(repo: string, path: string, options?: {
        ref?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    githubCreateBranch(repo: string, branch: string, options?: {
        fromBranch?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    githubCreateIssue(repo: string, title: string, options?: {
        body?: string;
        labels?: string[];
    } & ExecuteOptions): Promise<ExecutionResult>;
    githubCreatePR(repo: string, title: string, head: string, base: string, options?: {
        body?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    githubMergePR(repo: string, pullNumber: number, options?: {
        mergeMethod?: "merge" | "squash" | "rebase";
    } & ExecuteOptions): Promise<ExecutionResult>;
    stripeCreatePaymentIntent(amount: number, currency?: string, options?: ExecuteOptions & Record<string, unknown>): Promise<ExecutionResult>;
    stripeConfirmPayment(paymentIntentId: string, options?: {
        paymentMethodId?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    stripeCreateCustomer(email: string, options?: {
        name?: string;
    } & ExecuteOptions & Record<string, unknown>): Promise<ExecutionResult>;
    stripeCreateRefund(chargeId: string, options?: {
        amount?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    stripeGetBalance(options?: ExecuteOptions): Promise<ExecutionResult>;
    stripeCreateTransfer(amount: number, destination: string, currency?: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    vercelDeploy(name: string, files: Array<{
        file: string;
        data: string;
    }>, options?: {
        target?: string;
    } & ExecuteOptions & Record<string, unknown>): Promise<ExecutionResult>;
    vercelDeployFromGit(repo: string, ref?: string, options?: ExecuteOptions & Record<string, unknown>): Promise<ExecutionResult>;
    vercelGetDeployment(deploymentId: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    vercelGetLogs(deploymentId: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    vercelCreateProject(name: string, options?: {
        framework?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    vercelSetEnv(projectId: string, key: string, value: string, options?: {
        target?: string[];
    } & ExecuteOptions): Promise<ExecutionResult>;
    vercelCreateAlias(deploymentId: string, alias: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    railwayListProjects(options?: ExecuteOptions): Promise<ExecutionResult>;
    railwayGetProject(projectId: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    railwayCreateProject(name: string, options?: {
        description?: string;
        defaultEnvironmentName?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    railwayDeleteProject(projectId: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    railwayCreateService(projectId: string, options?: {
        name?: string;
        repo?: string;
        image?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    railwayDeployService(serviceId: string, environmentId: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    railwayListDeployments(serviceId: string, environmentId: string, options?: {
        limit?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    railwayGetDeploymentLogs(deploymentId: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    railwayRedeploy(deploymentId: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    railwayRollback(deploymentId: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    railwayGetVariables(projectId: string, environmentId: string, options?: {
        serviceId?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    railwayUpsertVariable(projectId: string, environmentId: string, name: string, value: string, options?: {
        serviceId?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    railwayUpsertVariables(projectId: string, environmentId: string, variables: Record<string, string>, options?: {
        serviceId?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    railwayListEnvironments(projectId: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    railwayCreateEnvironment(projectId: string, name: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    railwayCreateServiceDomain(serviceId: string, environmentId: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    railwayCreateCustomDomain(serviceId: string, environmentId: string, domain: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    railwayCreateVolume(projectId: string, environmentId: string, options?: {
        name?: string;
        serviceId?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    geminiChat(messages: Array<{
        role: string;
        content: string;
    }>, options?: {
        model?: string;
        maxTokens?: number;
        temperature?: number;
        systemInstruction?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    geminiEmbedding(input: string | string[], options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    geminiImage(prompt: string, options?: {
        model?: string;
        n?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    geminiCountTokens(contents: string, options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    perplexityChat(messages: Array<{
        role: string;
        content: string;
    }>, options?: {
        model?: string;
        maxTokens?: number;
        returnImages?: boolean;
        returnRelatedQuestions?: boolean;
        searchRecencyFilter?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    perplexitySearch(query: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    perplexityEmbedding(input: string | string[], options?: {
        model?: string;
        dimensions?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    perplexityAgent(input: string, options?: {
        model?: string;
        instructions?: string;
        maxOutputTokens?: number;
        preset?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    mistralChat(messages: Array<{
        role: string;
        content: string;
    }>, options?: {
        model?: string;
        maxTokens?: number;
        temperature?: number;
        safePrompt?: boolean;
    } & ExecuteOptions): Promise<ExecutionResult>;
    mistralFim(prompt: string, options?: {
        suffix?: string;
        model?: string;
        maxTokens?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    mistralEmbedding(input: string | string[], options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    mistralModeration(input: string | string[], options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    cohereChat(messages: Array<{
        role: string;
        content: string;
    }>, options?: {
        model?: string;
        maxTokens?: number;
        temperature?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    cohereEmbedding(input: string | string[], options?: {
        model?: string;
        inputType?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    cohereRerank(query: string, documents: string[], options?: {
        model?: string;
        topN?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    cohereClassify(inputs: string[], options?: {
        model?: string;
        examples?: Array<Record<string, unknown>>;
    } & ExecuteOptions): Promise<ExecutionResult>;
    deepseekChat(messages: Array<{
        role: string;
        content: string;
    }>, options?: {
        model?: string;
        maxTokens?: number;
        temperature?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    deepseekReasoning(messages: Array<{
        role: string;
        content: string;
    }>, options?: {
        model?: string;
        maxTokens?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    deepseekFim(prompt: string, options?: {
        suffix?: string;
        model?: string;
        maxTokens?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    pineconeCreateIndex(name: string, dimension: number, options?: {
        metric?: string;
        cloud?: string;
        region?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    pineconeListIndexes(options?: ExecuteOptions): Promise<ExecutionResult>;
    pineconeUpsert(host: string, vectors: Array<Record<string, unknown>>, options?: {
        namespace?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    pineconeQuery(host: string, vector: number[], options?: {
        topK?: number;
        namespace?: string;
        includeMetadata?: boolean;
        filter?: Record<string, unknown>;
    } & ExecuteOptions): Promise<ExecutionResult>;
    pineconeDeleteIndex(name: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    supabaseQuery(table: string, options?: {
        select?: string;
        filters?: Record<string, string>;
        limit?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    supabaseInsert(table: string, rows: unknown, options?: ExecuteOptions): Promise<ExecutionResult>;
    supabaseUpdate(table: string, updates: Record<string, unknown>, options?: {
        filters?: Record<string, string>;
    } & ExecuteOptions): Promise<ExecutionResult>;
    supabaseDelete(table: string, options?: {
        filters?: Record<string, string>;
    } & ExecuteOptions): Promise<ExecutionResult>;
    supabaseRpc(fn: string, options?: {
        params?: Record<string, unknown>;
    } & ExecuteOptions): Promise<ExecutionResult>;
    supabaseUploadFile(bucket: string, path: string, content: string, options?: {
        contentType?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    supabaseListFiles(bucket: string, options?: {
        prefix?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    supabaseInvokeFunction(fn: string, options?: {
        body?: Record<string, unknown>;
    } & ExecuteOptions): Promise<ExecutionResult>;
    twilioSendSms(to: string, from_: string, body: string, options?: {
        mediaUrl?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    twilioMakeCall(to: string, from_: string, options?: {
        url?: string;
        twiml?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    twilioListMessages(options?: {
        to?: string;
        from?: string;
        limit?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    twilioLookup(phoneNumber: string, options?: {
        fields?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    godaddyCheckAvailability(domain: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    godaddySuggestDomains(query: string, options?: {
        limit?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    godaddyListDomains(options?: ExecuteOptions): Promise<ExecutionResult>;
    godaddyGetDnsRecords(domain: string, options?: {
        type?: string;
        name?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    godaddySetDnsRecords(domain: string, records: Array<Record<string, unknown>>, options?: ExecuteOptions): Promise<ExecutionResult>;
    godaddyPurchaseDomain(domain: string, contact: Record<string, string>, options?: {
        period?: number;
        privacy?: boolean;
    } & ExecuteOptions): Promise<ExecutionResult>;
    elevenlabsTts(text: string, options?: {
        voiceId?: string;
        modelId?: string;
        outputFormat?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    elevenlabsStt(audioBase64: string, options?: {
        modelId?: string;
        language?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    elevenlabsListVoices(options?: ExecuteOptions): Promise<ExecutionResult>;
    elevenlabsSoundEffects(text: string, options?: {
        durationSeconds?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    cloudflareListZones(options?: {
        name?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    cloudflareListDnsRecords(zoneId: string, options?: {
        type?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    cloudflareCreateDnsRecord(zoneId: string, type: string, name: string, content: string, options?: {
        ttl?: number;
        proxied?: boolean;
    } & ExecuteOptions): Promise<ExecutionResult>;
    cloudflareCreateR2Bucket(name: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    cloudflareListR2Buckets(options?: ExecuteOptions): Promise<ExecutionResult>;
    cloudflareDeployWorker(name: string, content: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    cloudflareListWorkers(options?: ExecuteOptions): Promise<ExecutionResult>;
    neonCreateProject(options?: {
        name?: string;
        regionId?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    neonListProjects(options?: ExecuteOptions): Promise<ExecutionResult>;
    neonDeleteProject(projectId: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    neonCreateBranch(projectId: string, options?: {
        name?: string;
        parentId?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    neonListBranches(projectId: string, options?: ExecuteOptions): Promise<ExecutionResult>;
    neonGetConnectionUri(projectId: string, options?: {
        branchId?: string;
        databaseName?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    huggingfaceInference(model: string, inputs: unknown, options?: {
        task?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    huggingfaceChat(messages: Array<{
        role: string;
        content: string;
    }>, options?: {
        model?: string;
        maxNewTokens?: number;
    } & ExecuteOptions): Promise<ExecutionResult>;
    huggingfaceClassify(text: string, options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    huggingfaceNer(text: string, options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    huggingfaceTranslate(text: string, options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    huggingfaceSummarize(text: string, options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    huggingfaceTextToImage(prompt: string, options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    huggingfaceEmbedding(text: string, options?: {
        model?: string;
    } & ExecuteOptions): Promise<ExecutionResult>;
    marketplaceSearch(options?: {
        query?: string;
        category?: string;
        provider?: string;
        minRating?: number;
        maxPrice?: number;
        sortBy?: string;
        limit?: number;
        offset?: number;
    }): Promise<Record<string, unknown>>;
    marketplaceFeatured(limit?: number): Promise<Record<string, unknown>>;
    marketplaceTrending(options?: {
        limit?: number;
        period?: string;
    }): Promise<Record<string, unknown>>;
    marketplaceCategories(): Promise<Record<string, unknown>>;
    marketplaceStats(): Promise<Record<string, unknown>>;
    marketplaceRecommendations(limit?: number): Promise<Record<string, unknown>>;
    registryRegisterTool(toolData: Record<string, unknown>): Promise<Record<string, unknown>>;
    registryGetTool(toolId: string): Promise<Record<string, unknown>>;
    registryUpdateTool(toolId: string, updates: Record<string, unknown>): Promise<Record<string, unknown>>;
    registryVerifyTool(toolId: string, notes?: string): Promise<Record<string, unknown>>;
    registryRegisterProvider(providerData: Record<string, unknown>): Promise<Record<string, unknown>>;
    registryGetProvider(providerId: string, includeTools?: boolean): Promise<Record<string, unknown>>;
    registryUpdateProvider(providerId: string, updates: Record<string, unknown>): Promise<Record<string, unknown>>;
    registryCategoryTree(): Promise<Record<string, unknown>>;
    marketplaceExecute(toolId: string, inputData: Record<string, unknown>, options?: {
        pricingModel?: string;
        usageData?: Record<string, unknown>;
        idempotencyKey?: string;
    }): Promise<Record<string, unknown>>;
    marketplaceEstimate(toolId: string, options?: {
        pricingModel?: string;
        requests?: number;
        tokens?: number;
    }): Promise<Record<string, unknown>>;
    addPaymentRoute(routeData: Record<string, unknown>): Promise<Record<string, unknown>>;
    listPaymentRoutes(): Promise<Record<string, unknown>>;
    deletePaymentRoute(routeId: string): Promise<void>;
    getTransactions(options?: {
        limit?: number;
        offset?: number;
    }): Promise<Record<string, unknown>>;
    getTransaction(transactionId: string): Promise<Record<string, unknown>>;
    rateTool(toolId: string, rating: number): Promise<Record<string, unknown>>;
    favoriteTool(toolId: string): Promise<Record<string, unknown>>;
    unfavoriteTool(toolId: string): Promise<Record<string, unknown>>;
    getFavorites(options?: {
        limit?: number;
        offset?: number;
    }): Promise<Record<string, unknown>>;
    private _request;
}
