#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import FirecrawlApp from '@mendable/firecrawl-js';
import express from 'express';
import dotenv from 'dotenv';
dotenv.config();
// Tool definitions
const SCRAPE_TOOL = {
    name: 'firecrawl_scrape',
    description: 'Scrape a single webpage with advanced options for content extraction. ' +
        'Supports various formats including markdown, HTML, and screenshots. ' +
        'Can execute custom actions like clicking or scrolling before scraping.',
    inputSchema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL to scrape',
            },
            formats: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: [
                        'markdown',
                        'html',
                        'rawHtml',
                        'screenshot',
                        'links',
                        'screenshot@fullPage',
                        'extract',
                    ],
                },
                default: ['markdown'],
                description: "Content formats to extract (default: ['markdown'])",
            },
            onlyMainContent: {
                type: 'boolean',
                description: 'Extract only the main content, filtering out navigation, footers, etc.',
            },
            includeTags: {
                type: 'array',
                items: { type: 'string' },
                description: 'HTML tags to specifically include in extraction',
            },
            excludeTags: {
                type: 'array',
                items: { type: 'string' },
                description: 'HTML tags to exclude from extraction',
            },
            waitFor: {
                type: 'number',
                description: 'Time in milliseconds to wait for dynamic content to load',
            },
            timeout: {
                type: 'number',
                description: 'Maximum time in milliseconds to wait for the page to load',
            },
            actions: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        type: {
                            type: 'string',
                            enum: [
                                'wait',
                                'click',
                                'screenshot',
                                'write',
                                'press',
                                'scroll',
                                'scrape',
                                'executeJavascript',
                            ],
                            description: 'Type of action to perform',
                        },
                        selector: {
                            type: 'string',
                            description: 'CSS selector for the target element',
                        },
                        milliseconds: {
                            type: 'number',
                            description: 'Time to wait in milliseconds (for wait action)',
                        },
                        text: {
                            type: 'string',
                            description: 'Text to write (for write action)',
                        },
                        key: {
                            type: 'string',
                            description: 'Key to press (for press action)',
                        },
                        direction: {
                            type: 'string',
                            enum: ['up', 'down'],
                            description: 'Scroll direction',
                        },
                        script: {
                            type: 'string',
                            description: 'JavaScript code to execute',
                        },
                        fullPage: {
                            type: 'boolean',
                            description: 'Take full page screenshot',
                        },
                    },
                    required: ['type'],
                },
                description: 'List of actions to perform before scraping',
            },
            extract: {
                type: 'object',
                properties: {
                    schema: {
                        type: 'object',
                        description: 'Schema for structured data extraction',
                    },
                    systemPrompt: {
                        type: 'string',
                        description: 'System prompt for LLM extraction',
                    },
                    prompt: {
                        type: 'string',
                        description: 'User prompt for LLM extraction',
                    },
                },
                description: 'Configuration for structured data extraction',
            },
            mobile: {
                type: 'boolean',
                description: 'Use mobile viewport',
            },
            skipTlsVerification: {
                type: 'boolean',
                description: 'Skip TLS certificate verification',
            },
            removeBase64Images: {
                type: 'boolean',
                description: 'Remove base64 encoded images from output',
            },
            location: {
                type: 'object',
                properties: {
                    country: {
                        type: 'string',
                        description: 'Country code for geolocation',
                    },
                    languages: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Language codes for content',
                    },
                },
                description: 'Location settings for scraping',
            },
        },
        required: ['url'],
    },
};
const MAP_TOOL = {
    name: 'firecrawl_map',
    description: 'Discover URLs from a starting point. Can use both sitemap.xml and HTML link discovery.',
    inputSchema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'Starting URL for URL discovery',
            },
            search: {
                type: 'string',
                description: 'Optional search term to filter URLs',
            },
            ignoreSitemap: {
                type: 'boolean',
                description: 'Skip sitemap.xml discovery and only use HTML links',
            },
            sitemapOnly: {
                type: 'boolean',
                description: 'Only use sitemap.xml for discovery, ignore HTML links',
            },
            includeSubdomains: {
                type: 'boolean',
                description: 'Include URLs from subdomains in results',
            },
            limit: {
                type: 'number',
                description: 'Maximum number of URLs to return',
            },
        },
        required: ['url'],
    },
};
const CRAWL_TOOL = {
    name: 'firecrawl_crawl',
    description: 'Start an asynchronous crawl of multiple pages from a starting URL. ' +
        'Supports depth control, path filtering, and webhook notifications.',
    inputSchema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'Starting URL for the crawl',
            },
            excludePaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'URL paths to exclude from crawling',
            },
            includePaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'Only crawl these URL paths',
            },
            maxDepth: {
                type: 'number',
                description: 'Maximum link depth to crawl',
            },
            ignoreSitemap: {
                type: 'boolean',
                description: 'Skip sitemap.xml discovery',
            },
            limit: {
                type: 'number',
                description: 'Maximum number of pages to crawl',
            },
            allowBackwardLinks: {
                type: 'boolean',
                description: 'Allow crawling links that point to parent directories',
            },
            allowExternalLinks: {
                type: 'boolean',
                description: 'Allow crawling links to external domains',
            },
            webhook: {
                oneOf: [
                    {
                        type: 'string',
                        description: 'Webhook URL to notify when crawl is complete',
                    },
                    {
                        type: 'object',
                        properties: {
                            url: {
                                type: 'string',
                                description: 'Webhook URL',
                            },
                            headers: {
                                type: 'object',
                                description: 'Custom headers for webhook requests',
                            },
                        },
                        required: ['url'],
                    },
                ],
            },
            deduplicateSimilarURLs: {
                type: 'boolean',
                description: 'Remove similar URLs during crawl',
            },
            ignoreQueryParameters: {
                type: 'boolean',
                description: 'Ignore query parameters when comparing URLs',
            },
            scrapeOptions: {
                type: 'object',
                properties: {
                    formats: {
                        type: 'array',
                        items: {
                            type: 'string',
                            enum: [
                                'markdown',
                                'html',
                                'rawHtml',
                                'screenshot',
                                'links',
                                'screenshot@fullPage',
                                'extract',
                            ],
                        },
                    },
                    onlyMainContent: {
                        type: 'boolean',
                    },
                    includeTags: {
                        type: 'array',
                        items: { type: 'string' },
                    },
                    excludeTags: {
                        type: 'array',
                        items: { type: 'string' },
                    },
                    waitFor: {
                        type: 'number',
                    },
                },
                description: 'Options for scraping each page',
            },
        },
        required: ['url'],
    },
};
const CHECK_CRAWL_STATUS_TOOL = {
    name: 'firecrawl_check_crawl_status',
    description: 'Check the status of a crawl job.',
    inputSchema: {
        type: 'object',
        properties: {
            id: {
                type: 'string',
                description: 'Crawl job ID to check',
            },
        },
        required: ['id'],
    },
};
const SEARCH_TOOL = {
    name: 'firecrawl_search',
    description: 'Search and retrieve content from web pages with optional scraping. ' +
        'Returns SERP results by default (url, title, description) or full page content when scrapeOptions are provided.',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Search query string',
            },
            limit: {
                type: 'number',
                description: 'Maximum number of results to return (default: 5)',
            },
            lang: {
                type: 'string',
                description: 'Language code for search results (default: en)',
            },
            country: {
                type: 'string',
                description: 'Country code for search results (default: us)',
            },
            tbs: {
                type: 'string',
                description: 'Time-based search filter',
            },
            filter: {
                type: 'string',
                description: 'Search filter',
            },
            location: {
                type: 'object',
                properties: {
                    country: {
                        type: 'string',
                        description: 'Country code for geolocation',
                    },
                    languages: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Language codes for content',
                    },
                },
                description: 'Location settings for search',
            },
            scrapeOptions: {
                type: 'object',
                properties: {
                    formats: {
                        type: 'array',
                        items: {
                            type: 'string',
                            enum: ['markdown', 'html', 'rawHtml'],
                        },
                        description: 'Content formats to extract from search results',
                    },
                    onlyMainContent: {
                        type: 'boolean',
                        description: 'Extract only the main content from results',
                    },
                    waitFor: {
                        type: 'number',
                        description: 'Time in milliseconds to wait for dynamic content',
                    },
                },
                description: 'Options for scraping search results',
            },
        },
        required: ['query'],
    },
};
const EXTRACT_TOOL = {
    name: 'firecrawl_extract',
    description: 'Extract structured information from web pages using LLM. ' +
        'Supports both cloud AI and self-hosted LLM extraction.',
    inputSchema: {
        type: 'object',
        properties: {
            urls: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of URLs to extract information from',
            },
            prompt: {
                type: 'string',
                description: 'Prompt for the LLM extraction',
            },
            systemPrompt: {
                type: 'string',
                description: 'System prompt for LLM extraction',
            },
            schema: {
                type: 'object',
                description: 'JSON schema for structured data extraction',
            },
            allowExternalLinks: {
                type: 'boolean',
                description: 'Allow extraction from external links',
            },
            enableWebSearch: {
                type: 'boolean',
                description: 'Enable web search for additional context',
            },
            includeSubdomains: {
                type: 'boolean',
                description: 'Include subdomains in extraction',
            },
        },
        required: ['urls'],
    },
};
const DEEP_RESEARCH_TOOL = {
    name: 'firecrawl_deep_research',
    description: 'Conduct deep research on a query using web crawling, search, and AI analysis.',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'The query to research',
            },
            maxDepth: {
                type: 'number',
                description: 'Maximum depth of research iterations (1-10)',
            },
            timeLimit: {
                type: 'number',
                description: 'Time limit in seconds (30-300)',
            },
            maxUrls: {
                type: 'number',
                description: 'Maximum number of URLs to analyze (1-1000)',
            },
        },
        required: ['query'],
    },
};
const GENERATE_LLMSTXT_TOOL = {
    name: 'firecrawl_generate_llmstxt',
    description: 'Generate standardized LLMs.txt file for a given URL, which provides context about how LLMs should interact with the website.',
    inputSchema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL to generate LLMs.txt from',
            },
            maxUrls: {
                type: 'number',
                description: 'Maximum number of URLs to process (1-100, default: 10)',
            },
            showFullText: {
                type: 'boolean',
                description: 'Whether to show the full LLMs-full.txt in the response',
            },
        },
        required: ['url'],
    },
};
// Type guards
function isScrapeOptions(args) {
    return (typeof args === 'object' &&
        args !== null &&
        'url' in args &&
        typeof args.url === 'string');
}
function isMapOptions(args) {
    return (typeof args === 'object' &&
        args !== null &&
        'url' in args &&
        typeof args.url === 'string');
}
function isCrawlOptions(args) {
    return (typeof args === 'object' &&
        args !== null &&
        'url' in args &&
        typeof args.url === 'string');
}
function isStatusCheckOptions(args) {
    return (typeof args === 'object' &&
        args !== null &&
        'id' in args &&
        typeof args.id === 'string');
}
function isSearchOptions(args) {
    return (typeof args === 'object' &&
        args !== null &&
        'query' in args &&
        typeof args.query === 'string');
}
function isExtractOptions(args) {
    if (typeof args !== 'object' || args === null)
        return false;
    const { urls } = args;
    return (Array.isArray(urls) &&
        urls.every((url) => typeof url === 'string'));
}
function isGenerateLLMsTextOptions(args) {
    return (typeof args === 'object' &&
        args !== null &&
        'url' in args &&
        typeof args.url === 'string');
}
// Server implementation
const server = new Server({
    name: 'firecrawl-mcp',
    version: '1.7.0',
}, {
    capabilities: {
        tools: {},
        logging: {},
    },
});
// Get optional API URL
const FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
// Check if API key is required (only for cloud service)
if (process.env.CLOUD_SERVICE !== 'true' &&
    !FIRECRAWL_API_URL &&
    !FIRECRAWL_API_KEY) {
    console.error('Error: FIRECRAWL_API_KEY environment variable is required when using the cloud service');
    process.exit(1);
}
// Initialize Firecrawl client with optional API URL
// Configuration for retries and monitoring
const CONFIG = {
    retry: {
        maxAttempts: Number(process.env.FIRECRAWL_RETRY_MAX_ATTEMPTS) || 3,
        initialDelay: Number(process.env.FIRECRAWL_RETRY_INITIAL_DELAY) || 1000,
        maxDelay: Number(process.env.FIRECRAWL_RETRY_MAX_DELAY) || 10000,
        backoffFactor: Number(process.env.FIRECRAWL_RETRY_BACKOFF_FACTOR) || 2,
    },
    credit: {
        warningThreshold: Number(process.env.FIRECRAWL_CREDIT_WARNING_THRESHOLD) || 1000,
        criticalThreshold: Number(process.env.FIRECRAWL_CREDIT_CRITICAL_THRESHOLD) || 100,
    },
};
// Add utility function for delay
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
let isStdioTransport = false;
function safeLog(level, data) {
    if (isStdioTransport) {
        // For stdio transport, log to stderr to avoid protocol interference
        console.error(`[${level}] ${typeof data === 'object' ? JSON.stringify(data) : data}`);
    }
    else {
        // For other transport types, use the normal logging mechanism
        server.sendLoggingMessage({ level, data });
    }
}
// Add retry logic with exponential backoff
async function withRetry(operation, context, attempt = 1) {
    try {
        return await operation();
    }
    catch (error) {
        const isRateLimit = error instanceof Error &&
            (error.message.includes('rate limit') || error.message.includes('429'));
        if (isRateLimit && attempt < CONFIG.retry.maxAttempts) {
            const delayMs = Math.min(CONFIG.retry.initialDelay *
                Math.pow(CONFIG.retry.backoffFactor, attempt - 1), CONFIG.retry.maxDelay);
            safeLog('warning', `Rate limit hit for ${context}. Attempt ${attempt}/${CONFIG.retry.maxAttempts}. Retrying in ${delayMs}ms`);
            await delay(delayMs);
            return withRetry(operation, context, attempt + 1);
        }
        throw error;
    }
}
// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        SCRAPE_TOOL,
        MAP_TOOL,
        CRAWL_TOOL,
        CHECK_CRAWL_STATUS_TOOL,
        SEARCH_TOOL,
        EXTRACT_TOOL,
        DEEP_RESEARCH_TOOL,
        GENERATE_LLMSTXT_TOOL,
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const startTime = Date.now();
    try {
        const { name, arguments: args } = request.params;
        const apiKey = process.env.CLOUD_SERVICE
            ? request.params._meta?.apiKey
            : FIRECRAWL_API_KEY;
        if (process.env.CLOUD_SERVICE && !apiKey) {
            throw new Error('No API key provided');
        }
        const client = new FirecrawlApp({
            apiKey,
            ...(FIRECRAWL_API_URL ? { apiUrl: FIRECRAWL_API_URL } : {}),
        });
        // Log incoming request with timestamp
        safeLog('info', `[${new Date().toISOString()}] Received request for tool: ${name}`);
        if (!args) {
            throw new Error('No arguments provided');
        }
        switch (name) {
            case 'firecrawl_scrape': {
                if (!isScrapeOptions(args)) {
                    throw new Error('Invalid arguments for firecrawl_scrape');
                }
                const { url, ...options } = args;
                try {
                    const scrapeStartTime = Date.now();
                    safeLog('info', `Starting scrape for URL: ${url} with options: ${JSON.stringify(options)}`);
                    const response = await client.scrapeUrl(url, {
                        ...options,
                        // @ts-expect-error Extended API options including origin
                        origin: 'mcp-server',
                    });
                    // Log performance metrics
                    safeLog('info', `Scrape completed in ${Date.now() - scrapeStartTime}ms`);
                    if ('success' in response && !response.success) {
                        throw new Error(response.error || 'Scraping failed');
                    }
                    // Format content based on requested formats
                    const contentParts = [];
                    if (options.formats?.includes('markdown') && response.markdown) {
                        contentParts.push(response.markdown);
                    }
                    if (options.formats?.includes('html') && response.html) {
                        contentParts.push(response.html);
                    }
                    if (options.formats?.includes('rawHtml') && response.rawHtml) {
                        contentParts.push(response.rawHtml);
                    }
                    if (options.formats?.includes('links') && response.links) {
                        contentParts.push(response.links.join('\n'));
                    }
                    if (options.formats?.includes('screenshot') && response.screenshot) {
                        contentParts.push(response.screenshot);
                    }
                    if (options.formats?.includes('extract') && response.extract) {
                        contentParts.push(JSON.stringify(response.extract, null, 2));
                    }
                    // If options.formats is empty, default to markdown
                    if (!options.formats || options.formats.length === 0) {
                        options.formats = ['markdown'];
                    }
                    // Add warning to response if present
                    if (response.warning) {
                        safeLog('warning', response.warning);
                    }
                    return {
                        content: [
                            {
                                type: 'text',
                                text: trimResponseText(contentParts.join('\n\n') || 'No content available'),
                            },
                        ],
                        isError: false,
                    };
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: 'text', text: trimResponseText(errorMessage) }],
                        isError: true,
                    };
                }
            }
            case 'firecrawl_map': {
                if (!isMapOptions(args)) {
                    throw new Error('Invalid arguments for firecrawl_map');
                }
                const { url, ...options } = args;
                const response = await client.mapUrl(url, {
                    ...options,
                    // @ts-expect-error Extended API options including origin
                    origin: 'mcp-server',
                });
                if ('error' in response) {
                    throw new Error(response.error);
                }
                if (!response.links) {
                    throw new Error('No links received from Firecrawl API');
                }
                return {
                    content: [
                        { type: 'text', text: trimResponseText(response.links.join('\n')) },
                    ],
                    isError: false,
                };
            }
            case 'firecrawl_crawl': {
                if (!isCrawlOptions(args)) {
                    throw new Error('Invalid arguments for firecrawl_crawl');
                }
                const { url, ...options } = args;
                const response = await withRetry(async () => 
                // @ts-expect-error Extended API options including origin
                client.asyncCrawlUrl(url, { ...options, origin: 'mcp-server' }), 'crawl operation');
                if (!response.success) {
                    throw new Error(response.error);
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: trimResponseText(`Started crawl for ${url} with job ID: ${response.id}`),
                        },
                    ],
                    isError: false,
                };
            }
            case 'firecrawl_check_crawl_status': {
                if (!isStatusCheckOptions(args)) {
                    throw new Error('Invalid arguments for firecrawl_check_crawl_status');
                }
                const response = await client.checkCrawlStatus(args.id);
                if (!response.success) {
                    throw new Error(response.error);
                }
                const status = `Crawl Status:
Status: ${response.status}
Progress: ${response.completed}/${response.total}
Credits Used: ${response.creditsUsed}
Expires At: ${response.expiresAt}
${response.data.length > 0 ? '\nResults:\n' + formatResults(response.data) : ''}`;
                return {
                    content: [{ type: 'text', text: trimResponseText(status) }],
                    isError: false,
                };
            }
            case 'firecrawl_search': {
                if (!isSearchOptions(args)) {
                    throw new Error('Invalid arguments for firecrawl_search');
                }
                try {
                    const response = await withRetry(async () => client.search(args.query, { ...args, origin: 'mcp-server' }), 'search operation');
                    if (!response.success) {
                        throw new Error(`Search failed: ${response.error || 'Unknown error'}`);
                    }
                    // Format the results
                    const results = response.data
                        .map((result) => `URL: ${result.url}
Title: ${result.title || 'No title'}
Description: ${result.description || 'No description'}
${result.markdown ? `\nContent:\n${result.markdown}` : ''}`)
                        .join('\n\n');
                    return {
                        content: [{ type: 'text', text: trimResponseText(results) }],
                        isError: false,
                    };
                }
                catch (error) {
                    const errorMessage = error instanceof Error
                        ? error.message
                        : `Search failed: ${JSON.stringify(error)}`;
                    return {
                        content: [{ type: 'text', text: trimResponseText(errorMessage) }],
                        isError: true,
                    };
                }
            }
            case 'firecrawl_extract': {
                if (!isExtractOptions(args)) {
                    throw new Error('Invalid arguments for firecrawl_extract');
                }
                try {
                    const extractStartTime = Date.now();
                    safeLog('info', `Starting extraction for URLs: ${args.urls.join(', ')}`);
                    // Log if using self-hosted instance
                    if (FIRECRAWL_API_URL) {
                        safeLog('info', 'Using self-hosted instance for extraction');
                    }
                    const extractResponse = await withRetry(async () => client.extract(args.urls, {
                        prompt: args.prompt,
                        systemPrompt: args.systemPrompt,
                        schema: args.schema,
                        allowExternalLinks: args.allowExternalLinks,
                        enableWebSearch: args.enableWebSearch,
                        includeSubdomains: args.includeSubdomains,
                        origin: 'mcp-server',
                    }), 'extract operation');
                    // Type guard for successful response
                    if (!('success' in extractResponse) || !extractResponse.success) {
                        throw new Error(extractResponse.error || 'Extraction failed');
                    }
                    const response = extractResponse;
                    // Log performance metrics
                    safeLog('info', `Extraction completed in ${Date.now() - extractStartTime}ms`);
                    // Add warning to response if present
                    const result = {
                        content: [
                            {
                                type: 'text',
                                text: trimResponseText(JSON.stringify(response.data, null, 2)),
                            },
                        ],
                        isError: false,
                    };
                    if (response.warning) {
                        safeLog('warning', response.warning);
                    }
                    return result;
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    // Special handling for self-hosted instance errors
                    if (FIRECRAWL_API_URL &&
                        errorMessage.toLowerCase().includes('not supported')) {
                        safeLog('error', 'Extraction is not supported by this self-hosted instance');
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: trimResponseText('Extraction is not supported by this self-hosted instance. Please ensure LLM support is configured.'),
                                },
                            ],
                            isError: true,
                        };
                    }
                    return {
                        content: [{ type: 'text', text: trimResponseText(errorMessage) }],
                        isError: true,
                    };
                }
            }
            case 'firecrawl_deep_research': {
                if (!args || typeof args !== 'object' || !('query' in args)) {
                    throw new Error('Invalid arguments for firecrawl_deep_research');
                }
                try {
                    const researchStartTime = Date.now();
                    safeLog('info', `Starting deep research for query: ${args.query}`);
                    const response = await client.deepResearch(args.query, {
                        maxDepth: args.maxDepth,
                        timeLimit: args.timeLimit,
                        maxUrls: args.maxUrls,
                        // @ts-expect-error Extended API options including origin
                        origin: 'mcp-server',
                    }, 
                    // Activity callback
                    (activity) => {
                        safeLog('info', `Research activity: ${activity.message} (Depth: ${activity.depth})`);
                    }, 
                    // Source callback
                    (source) => {
                        safeLog('info', `Research source found: ${source.url}${source.title ? ` - ${source.title}` : ''}`);
                    });
                    // Log performance metrics
                    safeLog('info', `Deep research completed in ${Date.now() - researchStartTime}ms`);
                    if (!response.success) {
                        throw new Error(response.error || 'Deep research failed');
                    }
                    // Format the results
                    const formattedResponse = {
                        finalAnalysis: response.data.finalAnalysis,
                        activities: response.data.activities,
                        sources: response.data.sources,
                    };
                    return {
                        content: [
                            {
                                type: 'text',
                                text: trimResponseText(formattedResponse.finalAnalysis),
                            },
                        ],
                        isError: false,
                    };
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: 'text', text: trimResponseText(errorMessage) }],
                        isError: true,
                    };
                }
            }
            case 'firecrawl_generate_llmstxt': {
                if (!isGenerateLLMsTextOptions(args)) {
                    throw new Error('Invalid arguments for firecrawl_generate_llmstxt');
                }
                try {
                    const { url, ...params } = args;
                    const generateStartTime = Date.now();
                    safeLog('info', `Starting LLMs.txt generation for URL: ${url}`);
                    // Start the generation process
                    const response = await withRetry(async () => 
                    // @ts-expect-error Extended API options including origin
                    client.generateLLMsText(url, { ...params, origin: 'mcp-server' }), 'LLMs.txt generation');
                    if (!response.success) {
                        throw new Error(response.error || 'LLMs.txt generation failed');
                    }
                    // Log performance metrics
                    safeLog('info', `LLMs.txt generation completed in ${Date.now() - generateStartTime}ms`);
                    // Format the response
                    let resultText = '';
                    if ('data' in response) {
                        resultText = `LLMs.txt content:\n\n${response.data.llmstxt}`;
                        if (args.showFullText && response.data.llmsfulltxt) {
                            resultText += `\n\nLLMs-full.txt content:\n\n${response.data.llmsfulltxt}`;
                        }
                    }
                    return {
                        content: [{ type: 'text', text: trimResponseText(resultText) }],
                        isError: false,
                    };
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: 'text', text: trimResponseText(errorMessage) }],
                        isError: true,
                    };
                }
            }
            default:
                return {
                    content: [
                        { type: 'text', text: trimResponseText(`Unknown tool: ${name}`) },
                    ],
                    isError: true,
                };
        }
    }
    catch (error) {
        // Log detailed error information
        safeLog('error', {
            message: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
            tool: request.params.name,
            arguments: request.params.arguments,
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime,
        });
        return {
            content: [
                {
                    type: 'text',
                    text: trimResponseText(`Error: ${error instanceof Error ? error.message : String(error)}`),
                },
            ],
            isError: true,
        };
    }
    finally {
        // Log request completion with performance metrics
        safeLog('info', `Request completed in ${Date.now() - startTime}ms`);
    }
});
// Helper function to format results
function formatResults(data) {
    return data
        .map((doc) => {
        const content = doc.markdown || doc.html || doc.rawHtml || 'No content';
        return `URL: ${doc.url || 'Unknown URL'}
Content: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}
${doc.metadata?.title ? `Title: ${doc.metadata.title}` : ''}`;
    })
        .join('\n\n');
}
// Utility function to trim trailing whitespace from text responses
// This prevents Claude API errors with "final assistant content cannot end with trailing whitespace"
function trimResponseText(text) {
    return text.trim();
}
// Server startup
async function runLocalServer() {
    try {
        console.error('Initializing Firecrawl MCP Server...');
        const transport = new StdioServerTransport();
        // Detect if we're using stdio transport
        isStdioTransport = transport instanceof StdioServerTransport;
        if (isStdioTransport) {
            console.error('Running in stdio mode, logging will be directed to stderr');
        }
        await server.connect(transport);
        // Now that we're connected, we can send logging messages
        safeLog('info', 'Firecrawl MCP Server initialized successfully');
        safeLog('info', `Configuration: API URL: ${FIRECRAWL_API_URL || 'default'}`);
        console.error('Firecrawl MCP Server running on stdio');
    }
    catch (error) {
        console.error('Fatal error running server:', error);
        process.exit(1);
    }
}
async function runSSELocalServer() {
    let transport = null;
    const app = express();
    app.get('/sse', async (req, res) => {
        transport = new SSEServerTransport(`/messages`, res);
        res.on('close', () => {
            transport = null;
        });
        await server.connect(transport);
    });
    // Endpoint for the client to POST messages
    // Remove express.json() middleware - let the transport handle the body
    app.post('/messages', (req, res) => {
        if (transport) {
            transport.handlePostMessage(req, res);
        }
    });
    const PORT = process.env.PORT || 3000;
    console.log('Starting server on port', PORT);
    try {
        app.listen(PORT, () => {
            console.log(`MCP SSE Server listening on http://localhost:${PORT}`);
            console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
            console.log(`Message endpoint: http://localhost:${PORT}/messages`);
        });
    }
    catch (error) {
        console.error('Error starting server:', error);
    }
}
async function runSSECloudServer() {
    const transports = {};
    const app = express();
    app.get('/health', (req, res) => {
        res.status(200).send('OK');
    });
    app.get('/:apiKey/sse', async (req, res) => {
        const apiKey = req.params.apiKey;
        const transport = new SSEServerTransport(`/${apiKey}/messages`, res);
        //todo: validate api key, close if invalid
        const compositeKey = `${apiKey}-${transport.sessionId}`;
        transports[compositeKey] = transport;
        res.on('close', () => {
            delete transports[compositeKey];
        });
        await server.connect(transport);
    });
    // Endpoint for the client to POST messages
    // Remove express.json() middleware - let the transport handle the body
    app.post('/:apiKey/messages', express.json(), async (req, res) => {
        const apiKey = req.params.apiKey;
        const body = req.body;
        const enrichedBody = {
            ...body,
        };
        if (enrichedBody && enrichedBody.params && !enrichedBody.params._meta) {
            enrichedBody.params._meta = { apiKey };
        }
        else if (enrichedBody &&
            enrichedBody.params &&
            enrichedBody.params._meta) {
            enrichedBody.params._meta.apiKey = apiKey;
        }
        console.log('enrichedBody', enrichedBody);
        const sessionId = req.query.sessionId;
        const compositeKey = `${apiKey}-${sessionId}`;
        const transport = transports[compositeKey];
        if (transport) {
            await transport.handlePostMessage(req, res, enrichedBody);
        }
        else {
            res.status(400).send('No transport found for sessionId');
        }
    });
    const PORT = 3000;
    app.listen(PORT, () => {
        console.log(`MCP SSE Server listening on http://localhost:${PORT}`);
        console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
        console.log(`Message endpoint: http://localhost:${PORT}/messages`);
    });
}
if (process.env.CLOUD_SERVICE === 'true') {
    runSSECloudServer().catch((error) => {
        console.error('Fatal error running server:', error);
        process.exit(1);
    });
}
else if (process.env.SSE_LOCAL === 'true') {
    runSSELocalServer().catch((error) => {
        console.error('Fatal error running server:', error);
        process.exit(1);
    });
}
else {
    runLocalServer().catch((error) => {
        console.error('Fatal error running server:', error);
        process.exit(1);
    });
}
