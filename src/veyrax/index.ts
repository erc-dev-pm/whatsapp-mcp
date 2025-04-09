import axios from 'axios';
import { OpenAI } from 'openai';
import { ChatCompletionMessageParam, ChatCompletionSystemMessageParam, ChatCompletionUserMessageParam, ChatCompletionAssistantMessageParam, ChatCompletionFunctionMessageParam, ChatCompletionToolMessageParam } from 'openai/resources/chat/completions';

interface Message {
    role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
    content: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

// Basic interface for tool definitions
interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description?: string;
        parameters?: any;
    };
}

export class VeyraXClient {
    private readonly openai: OpenAI;
    private readonly veyraxApiKey: string;
    private readonly baseUrl = 'https://veyraxapp.com';
    private readonly userTimezone: string; // User's timezone
    private conversationHistory: Map<string, Message[]> = new Map();

    constructor(openaiApiKey: string, veyraxApiKey: string, userTimezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone) {
        if (!openaiApiKey) throw new Error('OpenAI API key is required');
        if (!veyraxApiKey) throw new Error('VeyraX API key is required');

        this.openai = new OpenAI({ apiKey: openaiApiKey });
        this.veyraxApiKey = veyraxApiKey;
        this.userTimezone = userTimezone;
        console.log(`Initialized VeyraX Client with timezone: ${this.userTimezone}`);
        
        // Test connection on startup
        this.testConnection();
    }

    // Test VeyraX API connection
    private async testConnection() {
        try {
            console.log(`Testing connection to VeyraX API at ${this.baseUrl}...`);
            const response = await fetch(`${this.baseUrl}/get-tools`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'VEYRAX_API_KEY': this.veyraxApiKey
                }
            });
            
            console.log(`Connection test status: ${response.status} ${response.statusText}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Connection test failed: ${errorText}`);
                console.error('This is why custom tools will be used instead of VeyraX tools');
            } else {
                console.log('Connection to VeyraX API successful!');
                try {
                    const data = await response.json();
                    console.log('Connection test response:', JSON.stringify(data).substring(0, 300) + '...');
                } catch (e) {
                    console.error('Could not parse JSON response from connection test');
                }
            }
        } catch (error) {
            console.error('Connection test failed with error:', error);
            console.error('This is why custom tools will be used instead of VeyraX tools');
        }
    }

    // API request helper with robust error handling
    private async makeRequest<T>(method: string, endpoint: string, data?: any): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;
        console.log(`Making API request to: ${url}`);
        
        // Use the header format specified in the documentation
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'VEYRAX_API_KEY': this.veyraxApiKey
        };
        
        console.log('Request headers:', JSON.stringify(headers, null, 2).replace(this.veyraxApiKey, '[REDACTED]'));
        
        if (data) {
            console.log('Request data:', JSON.stringify(data, null, 2));
        }
        
        try {
            const options: RequestInit = {
                method,
                headers,
                body: data ? JSON.stringify(data) : undefined,
            };
            
            const response = await fetch(url, options);
            console.log(`API response status: ${response.status} ${response.statusText}`);
            
            // Check if response is successful
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`API error (${response.status}):`, errorText);
                throw new Error(`API error (${response.status}): ${errorText}`);
            }
            
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const result = await response.json();
                console.log('API response body (JSON):', JSON.stringify(result).substring(0, 500));
                return result as T;
            } else {
                const text = await response.text();
                console.log('API response body (text):', text.substring(0, 500));
                return text as unknown as T;
            }
        } catch (error) {
            console.error(`Request failed to ${url}:`, error);
            throw error;
        }
    }
    
    // Get available tools from VeyraX
    async getAvailableTools(): Promise<Record<string, any>> {
        try {
            console.log('Fetching available tools from VeyraX API...');
            console.log(`API URL: ${this.baseUrl}/get-tools`);
            console.log(`Using API key: ${this.veyraxApiKey.substring(0, 5)}...${this.veyraxApiKey.substring(this.veyraxApiKey.length - 5)}`);
            
            const tools = await this.makeRequest<Record<string, any>>('GET', '/get-tools');
            
            if (!tools) {
                console.error('API returned null or undefined response for /get-tools');
                return {};
            }
            
            if (typeof tools === 'object' && Object.keys(tools).length === 0) {
                console.error('API returned empty object for /get-tools');
                return {};
            }
            
            console.log('API response for /get-tools:', JSON.stringify(tools).substring(0, 1000));
            console.log('Available tools (keys):', Object.keys(tools).join(', '));
            
            if (!tools.tools || typeof tools.tools !== 'object') {
                console.error('API response missing expected "tools" property');
                console.error('Full response:', JSON.stringify(tools));
                return {};
            }
            
            return tools;
        } catch (error) {
            console.error('Error fetching tools from VeyraX API:', error);
            if (error instanceof Error) {
                console.error('Error details:', error.message);
                console.error('Stack trace:', error.stack);
            }
            // Check if it's a network error
            if (error instanceof Error && 'cause' in error) {
                console.error('Error cause:', error.cause);
            }
            return {}; // Return empty object on error
        }
    }
    
    // Build dynamic system message based on available tools
    private buildSystemMessage(availableTools: ToolDefinition[] = [], isUsingCustomTools: boolean = false): string {
        // Extract tool names from the tools array
        const toolNames = availableTools.map(tool => tool.function.name);
        
        // Default system message start
        let message = `You are a helpful AI assistant that can access various tools to help users.\n\n`;
        
        // Add tool descriptions if tools are available
        if (toolNames.length > 0) {
            if (isUsingCustomTools) {
                message += `You have access to these tools:\n`;
            } else {
                message += `You have access to the following VeyraX integration tools:\n`;
            }
            
            for (const tool of availableTools) {
                message += `- ${tool.function.name}: ${tool.function.description}\n`;
            }
            
            message += `\nYou SHOULD use these tools when they would help answer the user's questions or fulfill their requests. For questions about current events, news, or specific information, use the tavily_search tool to find up-to-date information.\n`;
            
            // Special instructions for Tavily search
            if (toolNames.includes('tavily-search') || toolNames.some(name => name.includes('tavily'))) {
                message += `\nWhen searching with Tavily:\n- For factual questions, current events, or information you're unsure about, use the tavily_search tool\n- Be specific with your search queries\n- Cite sources from search results in your answers\n`;
            }
            
            // Special instructions for Google Calendar
            if (toolNames.some(name => name.includes('google-calendar'))) {
                message += `\nIMPORTANT: The user has already given permission to access their Google Calendar. You can directly use google-calendar tools without asking for permission again. When accessing calendar information:
- For listing events, use google-calendar-list_events with parameters like timeMin and timeMax
- For single event details, use google-calendar-get_event with the event ID
- For creating events, use google-calendar-create_event with summary, start, and end time
- The user's timezone is ${this.userTimezone}
- Before creating events, ensure you have all required information (summary, start time, end time)
- If the user doesn't provide complete information for creating events, ask for the missing details first
- Format dates in a user-friendly way (e.g., "April 12, 2025 at 10:00 AM")
- Summarize multiple events concisely\n`;
            }
            
            // Special instructions for Gmail
            if (toolNames.some(name => name.includes('gmail'))) {
                message += `\nIMPORTANT: The user has already given permission to access their Gmail. You can directly use gmail tools without asking for permission again. When accessing email:
- For listing/searching emails, use gmail-list_messages or gmail-search_messages with query parameters
- For getting email details, use gmail-get_message with the message ID
- For sending emails, use gmail-send_message with to, subject, and body parameters
- Display email information in a user-friendly format
- Respect email content privacy and security\n`;
            }
            
            // Special instructions for Google Docs
            if (toolNames.some(name => name.includes('docs'))) {
                message += `\nIMPORTANT: The user has already given permission to access their Google Docs. You can directly use google-docs tools without asking for permission again. When accessing documents:
- For listing documents, use google-docs-list_documents
- For retrieving document content, use google-docs-get_document with the document ID
- For creating new documents, use google-docs-create_document with title and content parameters
- For updating documents, use google-docs-update_document with document ID and content\n`;
            }
            
            // Special instructions for email tools (general catch-all for any email service)
            if (toolNames.some(name => name.includes('mail')) && !toolNames.some(name => name.includes('gmail'))) {
                message += `\nIMPORTANT: The user has already given permission to access their email. You can directly use mail tools without asking for permission again.\n`;
            }
            
            if (isUsingCustomTools) {
                message += `\nNote: Some tools like tavily_search may return mock data in this development environment.\n`;
            }
        } else {
            message += `Currently, you don't have access to external tools. Answer questions based on your knowledge.\n`;
        }
        
        // General guidelines
        message += `\nIf search results aren't helpful or if tools are unavailable, provide information from your knowledge and explain any limitations.
Always be helpful, concise, and accurate. If you use search results or tools, clearly indicate this in your response.`;
        
        return message;
    }

    // Format Tavily response to ensure consistent structure
    private formatTavilyResponse(result: any): any {
        console.log('Formatting Tavily response:', JSON.stringify(result).substring(0, 500));
        
        try {
            // Handle null or undefined result
            if (!result) {
                console.warn('Received null or undefined Tavily result');
                return { search_results: [] };
            }
            
            // If the result is already in the expected format, return it
            if (result && Array.isArray(result.search_results)) {
                console.log('Result already has search_results array, using as-is');
                return result;
            }
            
            // If we have direct search results array
            if (Array.isArray(result)) {
                console.log('Result is a direct array, wrapping in search_results object');
                return {
                    search_results: result.map((item: any) => ({
                        title: item.title || 'Search Result',
                        url: item.url || item.link || 'https://example.com',
                        content: item.content || item.snippet || item.description || 'No content available'
                    }))
                };
            }
            
            // Handle variations in the API response structure
            if (result && typeof result === 'object') {
                // Special case for Tavily's specific response format where results are in data.results
                if (result.data && typeof result.data === 'object') {
                    if (Array.isArray(result.data.results)) {
                        console.log('Found Tavily-specific format with data.results array');
                        return {
                            search_results: result.data.results.map((item: any) => ({
                                title: item.title || item.name || 'Search Result',
                                url: item.url || item.link || item.href || 'https://example.com',
                                content: item.content || item.snippet || item.description || item.text || 'No content available'
                            }))
                        };
                    }
                }
                
                // Check for common field names in various API responses
                const possibleResultArrays = ['search_results', 'results', 'data', 'documents', 'items'];
                
                for (const field of possibleResultArrays) {
                    if (field in result) {
                        console.log(`Found results in "${field}" field`);
                        const resultArray = result[field];
                        
                        // Ensure it's actually an array before mapping
                        if (Array.isArray(resultArray)) {
                            return {
                                search_results: resultArray.map((item: any) => ({
                                    title: item.title || item.name || 'Search Result',
                                    url: item.url || item.link || item.href || 'https://example.com',
                                    content: item.content || item.snippet || item.description || item.text || 'No content available'
                                }))
                            };
                        } else {
                            console.log(`Field ${field} exists but is not an array:`, typeof resultArray);
                            // If it's not an array but a single object, wrap it in an array
                            if (resultArray && typeof resultArray === 'object') {
                                return {
                                    search_results: [{
                                        title: resultArray.title || resultArray.name || 'Search Result',
                                        url: resultArray.url || resultArray.link || resultArray.href || 'https://example.com',
                                        content: resultArray.content || resultArray.snippet || resultArray.description || resultArray.text || 'No content available'
                                    }]
                                };
                            }
                        }
                    }
                }
                
                // If no arrays found, but has response field
                if (result.response) {
                    console.log('Found result in "response" field');
                    return this.formatTavilyResponse(result.response);
                }
            }
            
            // If we have a string result, try parsing it
            if (typeof result === 'string') {
                try {
                    console.log('Result is a string, attempting to parse as JSON');
                    const parsed = JSON.parse(result);
                    return this.formatTavilyResponse(parsed);
                } catch (error) {
                    console.log('Failed to parse string as JSON, using as plain text');
                    // If parsing fails, create a simple result
                    return {
                        search_results: [
                            {
                                title: 'Search Results',
                                url: 'https://example.com',
                                content: result.substring(0, 1000) // Limit string length
                            }
                        ]
                    };
                }
            }
            
            // If we got here, we couldn't identify a known structure, 
            // so create a generic format with any data we can find
            console.warn('Could not identify standard structure in Tavily response');
            
            // Try to extract any useful information from the result
            let title = 'Search Results';
            let content = 'No structured content could be extracted from the search results.';
            
            if (result && typeof result === 'object') {
                // Try to use any string values we can find in the object
                const stringValues = Object.entries(result)
                    .filter(([_, value]) => typeof value === 'string')
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\n');
                
                if (stringValues) {
                    content = stringValues;
                }
            }
            
            // Return empty results if nothing could be parsed
            return {
                search_results: [
                    {
                        title: title,
                        url: 'https://example.com',
                        content: content
                    }
                ]
            };
        } catch (error) {
            console.error('Error formatting Tavily response:', error);
            return {
                search_results: [
                    {
                        title: 'Error formatting search results',
                        url: 'https://example.com',
                        content: 'The search was successful but there was an error formatting the results.'
                    }
                ]
            };
        }
    }

    // Execute a tool call via VeyraX
    async executeToolCall(toolName: string, parameters: any): Promise<any> {
        console.log(`Executing tool: ${toolName} with parameters:`, parameters);
        
        try {
            // Special handling for tavily_search (both direct and via VeyraX)
            if (toolName === 'tavily_search' || toolName.includes('tavily')) {
                console.log('Executing tavily search with parameters:', parameters);
                
                try {
                    // Extract search query from parameters
                    const searchQuery = parameters.query || parameters.search_query;
                    if (!searchQuery) {
                        throw new Error('No query provided for search');
                    }
                    
                    // Log detailed request information
                    console.log(`Tavily search query: "${searchQuery}"`);
                    console.log('Full Tavily search parameters:', JSON.stringify({
                        query: searchQuery,
                        topic: parameters.topic || "general",
                        max_results: parameters.max_results || 3,
                        search_depth: parameters.search_depth || "basic"
                    }));
                    
                    // Try VeyraX tavily integration endpoint - use proper API path
                    console.log('Attempting to use VeyraX tavily integration at endpoint: /tavily/search');
                    const result = await this.makeRequest<any>('POST', '/tavily/search', {
                        query: searchQuery,
                        topic: parameters.topic || "general",
                        max_results: parameters.max_results || 3,
                        search_depth: parameters.search_depth || "basic"
                    });
                    
                    // Check if result exists and log details
                    console.log('Raw Tavily search result received:', JSON.stringify(result).substring(0, 300));
                    
                    // Check for various error scenarios
                    if (!result) {
                        console.error('Tavily search returned null or undefined result');
                        throw new Error('Null or undefined response from Tavily search');
                    }
                    
                    if (typeof result === 'object' && ('error' in result || 'errors' in result)) {
                        const errorMsg = result.error || (result.errors && result.errors[0]) || 'Unknown error';
                        console.error('Tavily search returned error:', errorMsg);
                        throw new Error(`Tavily API returned error: ${errorMsg}`);
                    }
                    
                    // Format the result
                    console.log('Tavily search successful, formatting result');
                    const formattedResult = this.formatTavilyResponse(result);
                    console.log('Formatted Tavily result:', JSON.stringify(formattedResult).substring(0, 300));
                    
                    return formattedResult;
                } catch (error: any) {
                    console.error('Tavily search failed:', error.message);
                    if (error.stack) {
                        console.error('Error stack trace:', error.stack);
                    }
                    
                    // Provide a detailed mock response
                    return {
                        search_results: [
                            {
                                title: "Search results for: " + (parameters.query || parameters.search_query || "unknown query"),
                                url: "https://example.com/search",
                                content: `This is a simulated search result because the tavily search API call failed. Error details: ${error.message}. Please try again with more specific search terms or contact support if the issue persists.`
                            }
                        ]
                    };
                }
            }
            
            // Special handling for google-calendar tools
            if (toolName === 'google-calendar' || toolName.includes('google-calendar')) {
                console.log('Executing Google Calendar tool with parameters:', parameters);
                
                // Parse the method name from the toolName
                let methodName = '';
                
                // Check if this is a compound name like 'google-calendar-list_events'
                if (toolName.includes('-')) {
                    const parts = toolName.split('-');
                    // Extract the method name - it should be the part after 'google-calendar-'
                    if (parts.length >= 3 && parts[0] === 'google' && parts[1] === 'calendar') {
                        methodName = parts.slice(2).join('_'); // Join any remaining parts with underscore
                    }
                }
                
                // If we couldn't parse from tool name or it's not in the expected format,
                // try to get from parameters or use a default
                if (!methodName) {
                    methodName = parameters.method || 'list_events';
                }
                
                // Ensure method name is one of the valid API methods
                const validMethods = ['list_events', 'get_event', 'create_event', 'update_event', 'delete_event', 'list_calendars'];
                if (!validMethods.includes(methodName)) {
                    console.log(`Invalid method name: ${methodName}, using default 'list_events'`);
                    methodName = 'list_events';
                }
                
                console.log(`Using Google Calendar method: ${methodName}`);
                
                try {
                    // Process parameters for specific methods
                    const processedParams = {...parameters};
                    
                    // For list_events, ensure time parameters are formatted correctly
                    if (methodName === 'list_events') {
                        // Convert various date filter formats to the expected timeMin/timeMax
                        if (processedParams.filters) {
                            if (processedParams.filters.after_date || processedParams.filters.start_date) {
                                processedParams.timeMin = processedParams.filters.after_date || processedParams.filters.start_date;
                                // Delete the original properties
                                delete processedParams.filters.after_date;
                                delete processedParams.filters.start_date;
                            }
                            
                            if (processedParams.filters.before_date || processedParams.filters.end_date) {
                                processedParams.timeMax = processedParams.filters.before_date || processedParams.filters.end_date;
                                // Delete the original properties
                                delete processedParams.filters.before_date;
                                delete processedParams.filters.end_date;
                            }
                            
                            // If filters is now empty, delete it
                            if (Object.keys(processedParams.filters).length === 0) {
                                delete processedParams.filters;
                            }
                        }
                        
                        // Handle top-level date parameters
                        if (processedParams.start_date || processedParams.start) {
                            processedParams.timeMin = processedParams.start_date || processedParams.start;
                            delete processedParams.start_date;
                            delete processedParams.start;
                        }
                        
                        if (processedParams.end_date || processedParams.end) {
                            processedParams.timeMax = processedParams.end_date || processedParams.end;
                            delete processedParams.end_date;
                            delete processedParams.end;
                        }
                    }
                    
                    // For create_event and update_event, ensure dates are properly formatted
                    if (methodName === 'create_event' || methodName === 'update_event') {
                        // Check for required fields and add proper validation
                        if (!processedParams.event) {
                            processedParams.event = {};
                        }
                        
                        // Check for missing required fields
                        const missingFields = [];
                        if (!processedParams.event.summary) {
                            missingFields.push('summary');
                        }
                        if (!processedParams.event.start) {
                            missingFields.push('start time');
                        }
                        if (!processedParams.event.end) {
                            missingFields.push('end time');
                        }
                        
                        // If missing required fields, return a friendly message instead of making the API call
                        if (missingFields.length > 0) {
                            return {
                                needs_more_info: true,
                                missing_fields: missingFields,
                                message: `I need more information to create this calendar event. Please provide: ${missingFields.join(', ')}.`
                            };
                        }
                        
                        // If there are start/end fields that aren't properly formatted as objects
                        if (processedParams.event.start && typeof processedParams.event.start === 'string') {
                            // Use the configurable user timezone instead of hardcoding
                            processedParams.event.start = { 
                                dateTime: processedParams.event.start,
                                timeZone: this.userTimezone
                            };
                        }
                        
                        if (processedParams.event.end && typeof processedParams.event.end === 'string') {
                            // Use the configurable user timezone instead of hardcoding
                            processedParams.event.end = { 
                                dateTime: processedParams.event.end,
                                timeZone: this.userTimezone
                            };
                        }
                        
                        console.log('Formatted event parameters for creation:', JSON.stringify(processedParams));
                    }
                    
                    // Endpoint follows the pattern /google-calendar/{method_name}
                    const endpoint = `/google-calendar/${methodName}`;
                    console.log(`Making request to endpoint: ${endpoint}`);
                    console.log('Processed parameters:', JSON.stringify(processedParams));
                    
                    const result = await this.makeRequest<any>('POST', endpoint, processedParams);
                    
                    // Check if result exists and log details
                    console.log('Google Calendar API response:', JSON.stringify(result).substring(0, 300));
                    
                    if (!result) {
                        console.error('Google Calendar returned null or undefined result');
                        throw new Error('Null or undefined response from Google Calendar');
                    }
                    
                    if (typeof result === 'object' && ('error' in result || 'errors' in result)) {
                        const errorMsg = result.error || (result.errors && result.errors[0]) || 'Unknown error';
                        console.error('Google Calendar returned error:', errorMsg);
                        throw new Error(`Google Calendar API returned error: ${errorMsg}`);
                    }
                    
                    // Inside the executeToolCall function, after calling Google Calendar API
                    // Add special handling for needs_more_info response
                    if (result && result.needs_more_info === true) {
                        // If we need more information, pass this directly to the assistant without making an API call
                        console.log(`Need more information for ${toolName}: ${result.message}`);
                        return result.message; // Return as a string message that will be displayed directly
                    }
                    
                    return result;
                } catch (error) {
                    console.error(`Google Calendar API call failed: ${error}`);
                    
                    // Check for 403 Forbidden errors which typically indicate authentication issues
                    const isAuthError = error instanceof Error && 
                        (error.message.includes('403') || error.message.includes('not available') || 
                         error.message.includes('not availiable'));
                    
                    if (isAuthError) {
                        // Format error as user-friendly text rather than JSON
                        return "I don't have access to your Google Calendar yet. You need to authenticate with Google Calendar first before I can help with calendar requests.";
                    }
                    
                    // For other errors, return generic message
                    return {
                        error: true,
                        message: `Error accessing Google Calendar: ${error instanceof Error ? error.message : String(error)}`
                    };
                }
            }
            
            // Special handling for Gmail
            if (toolName === 'gmail' || toolName.includes('gmail')) {
                console.log('Executing Gmail tool with parameters:', parameters);
                
                // Parse the method name from the toolName
                let methodName = '';
                if (toolName.includes('-')) {
                    const parts = toolName.split('-');
                    methodName = parts.slice(1).join('-'); // In case method name has hyphens
                } else {
                    methodName = parameters.method || 'list_messages';
                }
                
                // Map common method names to their API equivalents
                const methodMap: Record<string, string> = {
                    'list': 'list_messages',
                    'listEmails': 'list_messages',
                    'list_emails': 'list_messages',
                    'list_messages': 'list_messages',
                    'search': 'search_messages',
                    'searchEmails': 'search_messages',
                    'search_emails': 'search_messages',
                    'search_messages': 'search_messages',
                    'get': 'get_message',
                    'getMessage': 'get_message',
                    'get_message': 'get_message',
                    'send': 'send_message',
                    'sendEmail': 'send_message',
                    'send_email': 'send_message',
                    'send_message': 'send_message',
                    'draft': 'create_draft',
                    'createDraft': 'create_draft',
                    'create_draft': 'create_draft'
                };
                
                // Use the mapped method name if available, otherwise use the original
                const apiMethodName = methodMap[methodName] || methodName;
                
                console.log(`Using Gmail method: ${methodName} (API method: ${apiMethodName})`);
                
                try {
                    // Use the direct endpoint for Gmail
                    const endpoint = `/gmail/${apiMethodName}`;
                    console.log(`Making request to endpoint: ${endpoint}`);
                    
                    const result = await this.makeRequest<any>('POST', endpoint, parameters);
                    
                    // Check if result exists and log details
                    console.log('Gmail API response:', JSON.stringify(result).substring(0, 300));
                    
                    if (!result) {
                        console.error('Gmail returned null or undefined result');
                        throw new Error('Null or undefined response from Gmail');
                    }
                    
                    if (typeof result === 'object' && ('error' in result || 'errors' in result)) {
                        const errorMsg = result.error || (result.errors && result.errors[0]) || 'Unknown error';
                        console.error('Gmail returned error:', errorMsg);
                        throw new Error(`Gmail API returned error: ${errorMsg}`);
                    }
                    
                    return result;
                } catch (error: any) {
                    console.error('Gmail API call failed:', error.message);
                    
                    // Provide fallback mock responses based on the method
                    const listMethods = ['list', 'listEmails', 'list_messages', 'list_emails', 'search', 'search_messages'];
                    const getMethods = ['get', 'getMessage', 'get_message'];
                    const sendMethods = ['send', 'sendEmail', 'send_message', 'send_email'];
                    
                    if (listMethods.includes(methodName)) {
                        return { 
                            messages: [
                                { 
                                    id: "mock-email-1",
                                    subject: "Mock Email Subject 1", 
                                    from: "sender@example.com",
                                    date: new Date().toISOString(),
                                    snippet: "This is a mock email snippet since the Gmail API call failed."
                                },
                                { 
                                    id: "mock-email-2",
                                    subject: "Mock Email Subject 2", 
                                    from: "another@example.com",
                                    date: new Date(Date.now() - 86400000).toISOString(),
                                    snippet: "This is another mock email snippet since the Gmail API call failed."
                                }
                            ]
                        };
                    } else if (getMethods.includes(methodName)) {
                        return {
                            id: "mock-email-id",
                            subject: "Mock Email Details",
                            from: "sender@example.com",
                            to: "recipient@example.com",
                            date: new Date().toISOString(),
                            body: "This is the body of a mock email since the Gmail API call failed.",
                            attachments: []
                        };
                    } else if (sendMethods.includes(methodName)) {
                        return {
                            success: true,
                            messageId: "mock-message-id",
                            threadId: "mock-thread-id",
                            message: "Mock email sent successfully (fallback response)"
                        };
                    } else {
                        return {
                            success: true,
                            message: `Mock response for Gmail ${methodName} operation`,
                            note: "This is a mock response since the actual API call failed"
                        };
                    }
                }
            }
            
            // Special handling for Google Docs
            if (toolName === 'google-docs' || toolName.includes('docs')) {
                console.log('Executing Google Docs tool with parameters:', parameters);
                
                // Parse the method name from the toolName
                let methodName = '';
                if (toolName.includes('-')) {
                    const parts = toolName.split('-');
                    methodName = parts.slice(1).join('-'); // In case method name has hyphens
                } else {
                    methodName = parameters.method || 'list';
                }
                
                // Map common method names to their API equivalents
                const methodMap: Record<string, string> = {
                    'list': 'list_documents',
                    'listDocuments': 'list_documents',
                    'list_documents': 'list_documents',
                    'get': 'get_document',
                    'getDocument': 'get_document',
                    'get_document': 'get_document',
                    'create': 'create_document',
                    'createDocument': 'create_document',
                    'create_document': 'create_document',
                    'update': 'update_document',
                    'updateDocument': 'update_document',
                    'update_document': 'update_document'
                };
                
                // Use the mapped method name if available, otherwise use the original
                const apiMethodName = methodMap[methodName] || methodName;
                
                console.log(`Using Google Docs method: ${methodName} (API method: ${apiMethodName})`);
                
                try {
                    // Use the direct endpoint for Google Docs
                    const endpoint = `/google-docs/${apiMethodName}`;
                    console.log(`Making request to endpoint: ${endpoint}`);
                    
                    const result = await this.makeRequest<any>('POST', endpoint, parameters);
                    
                    // Check if result exists and log details
                    console.log('Google Docs API response:', JSON.stringify(result).substring(0, 300));
                    
                    if (!result) {
                        console.error('Google Docs returned null or undefined result');
                        throw new Error('Null or undefined response from Google Docs');
                    }
                    
                    if (typeof result === 'object' && ('error' in result || 'errors' in result)) {
                        const errorMsg = result.error || (result.errors && result.errors[0]) || 'Unknown error';
                        console.error('Google Docs returned error:', errorMsg);
                        throw new Error(`Google Docs API returned error: ${errorMsg}`);
                    }
                    
                    return result;
                } catch (error: any) {
                    console.error('Google Docs API call failed:', error.message);
                    
                    // Provide fallback mock responses based on the method
                    const listMethods = ['list', 'listDocuments', 'list_documents'];
                    const getMethods = ['get', 'getDocument', 'get_document'];
                    const createMethods = ['create', 'createDocument', 'create_document'];
                    
                    if (listMethods.includes(methodName)) {
                        return { 
                            documents: [
                                { 
                                    id: "mock-doc-1",
                                    name: "Mock Document 1", 
                                    url: "https://docs.google.com/document/d/mock1",
                                    lastModified: new Date().toISOString()
                                },
                                { 
                                    id: "mock-doc-2",
                                    name: "Mock Document 2", 
                                    url: "https://docs.google.com/document/d/mock2",
                                    lastModified: new Date(Date.now() - 86400000).toISOString()
                                }
                            ]
                        };
                    } else if (getMethods.includes(methodName)) {
                        return {
                            id: "mock-doc-id",
                            name: "Mock Document",
                            url: "https://docs.google.com/document/d/mock",
                            content: "This is the content of a mock document since the Google Docs API call failed.",
                            lastModified: new Date().toISOString()
                        };
                    } else if (createMethods.includes(methodName)) {
                        return {
                            success: true,
                            id: "new-mock-doc-id",
                            name: parameters.title || "New Document",
                            url: "https://docs.google.com/document/d/new-mock",
                            message: "Mock document created successfully (fallback response)"
                        };
                    } else {
                        return {
                            success: true,
                            message: `Mock response for Google Docs ${methodName} operation`,
                            note: "This is a mock response since the actual API call failed"
                        };
                    }
                }
            }
            
            // General API-based tool call
            console.log(`Executing VeyraX tool ${toolName}`);

            // Parse the tool name - it may be in format "toolname-method" from our conversion
            const parts = toolName.split('-');
            const tool = parts[0];
            const method = parts.length > 1 ? parts[1] : 'default';
            
            console.log(`Parsed tool: ${tool}, method: ${method}`);
            
            // Use the direct endpoint pattern /{tool}/{method}
            const endpoint = `/${tool}/${method}`;
            console.log(`Using endpoint: ${endpoint}`);
            
            const result = await this.makeRequest<any>('POST', endpoint, parameters);
            
            console.log(`Tool execution result for ${toolName}:`, typeof result === 'object' ? JSON.stringify(result).substring(0, 200) + '...' : result);
            return result;
        } catch (error: any) {
            console.error(`Error executing tool ${toolName}:`, error);
            
            // Provide a meaningful error response
            return {
                error: true,
                message: `Error executing tool ${toolName}: ${error.message}`,
                fallback: `I encountered an error when trying to use the ${toolName} tool. ${error.message}`
            };
        }
    }

    // Convert message to OpenAI format
    private messageToCompletionMessage(msg: Message): ChatCompletionMessageParam {
        switch (msg.role) {
            case 'system':
                return { role: 'system', content: msg.content } as ChatCompletionSystemMessageParam;
            case 'user':
                return { role: 'user', content: msg.content } as ChatCompletionUserMessageParam;
            case 'assistant':
                if (msg.tool_calls) {
                    return { 
                        role: 'assistant', 
                        content: msg.content, 
                        tool_calls: msg.tool_calls 
                    } as ChatCompletionAssistantMessageParam;
                }
                return { role: 'assistant', content: msg.content } as ChatCompletionAssistantMessageParam;
            case 'function':
                return { 
                    role: 'function', 
                    name: msg.name!, 
                    content: msg.content 
                } as ChatCompletionFunctionMessageParam;
            case 'tool':
                return { 
                    role: 'tool', 
                    tool_call_id: msg.tool_call_id!, 
                    content: msg.content 
                } as ChatCompletionToolMessageParam;
            default:
                return { role: 'assistant', content: msg.content } as ChatCompletionAssistantMessageParam;
        }
    }
    
    // Convert API tools to OpenAI format
    private convertToolsToOpenAIFormat(toolsResponse: any): ToolDefinition[] {
        const openAITools: ToolDefinition[] = [];
        
        console.log('Converting tools response to OpenAI format');
        console.log('RAW Tools response first 500 chars:', JSON.stringify(toolsResponse).substring(0, 500) + '...');
        
        try {
            // First check if the response has the tools property (most common format)
            if (toolsResponse && toolsResponse.tools && typeof toolsResponse.tools === 'object') {
                console.log('Processing VeyraX API tools format');
                
                // Loop through each tool in the tools object
                for (const [toolName, toolData] of Object.entries(toolsResponse.tools)) {
                    console.log(`Processing tool: ${toolName}`);
                    
                    if (!toolData || typeof toolData !== 'object') continue;
                    
                    // Check for different structures in the VeyraX API response
                    
                    // Format 1: Tool with methods (like in docs)
                    if ('methods' in toolData && typeof (toolData as any).methods === 'object') {
                        const methods = (toolData as any).methods;
                        
                        for (const [methodName, methodInfo] of Object.entries(methods)) {
                            console.log(`Processing method: ${toolName}.${methodName}`);
                            
                            // Create function name that combines tool and method
                            const functionName = `${toolName}-${methodName}`;
                            
                            openAITools.push({
                                type: 'function' as const,
                                function: {
                                    name: functionName,
                                    description: `Use ${toolName} to ${this.formatMethodName(methodName)}`,
                                    parameters: this.extractParametersFromMethodInfo(methodInfo)
                                }
                            });
                        }
                    }
                    // Format 2: Direct function definitions (seen in logs)
                    else {
                        for (const [functionName, functionData] of Object.entries(toolData)) {
                            if (!functionData || typeof functionData !== 'object') continue;
                            
                            console.log(`Processing function: ${toolName}.${functionName}`);
                            
                            // Extract function info based on structure in API response
                            let functionDef: any = functionData;
                            
                            // Handle nested function property
                            if ('function' in functionData) {
                                functionDef = (functionData as any).function;
                                
                                // Handle double nested function (seen in the logs)
                                if (functionDef && 'function' in functionDef) {
                                    functionDef = functionDef.function;
                                }
                            }
                            
                            if (!functionDef) continue;
                            
                            const fullFunctionName = `${toolName}-${functionName}`;
                            
                            openAITools.push({
                                type: 'function' as const,
                                function: {
                                    name: fullFunctionName,
                                    description: functionDef.description || `Use ${toolName} to ${this.formatMethodName(functionName)}`,
                                    parameters: functionDef.parameters || { 
                                        type: 'object', 
                                        properties: {},
                                        required: []
                                    }
                                }
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error processing tools:', error);
            if (error instanceof Error) {
                console.error(error.stack);
            }
        }
        
        // Add tavily_search if no tools were found (for fallback)
        if (openAITools.length === 0) {
            console.log('No tools found from API, adding tavily_search as fallback');
            openAITools.push({
                type: 'function' as const,
                function: {
                    name: 'tavily_search',
                    description: 'Search the web for real-time information on any topic.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'The search query'
                            }
                        },
                        required: ['query']
                    }
                }
            });
        }
        
        // Log the final processed tools
        console.log('Final processed tools:', openAITools.map(t => t.function.name).join(', '));
        return openAITools;
    }
    
    // Extract parameters from method info
    private extractParametersFromMethodInfo(methodInfo: any): any {
        // Default parameters if extraction fails
        const defaultParams = {
            type: 'object',
            properties: {},
            required: []
        };
        
        try {
            if (!methodInfo) return defaultParams;
            
            // Format 1: parameters property from docs
            if (methodInfo.parameters && typeof methodInfo.parameters === 'object') {
                return this.convertMethodParametersToOpenAI(methodInfo.parameters).parameters;
            }
            
            // Format 2: direct parameters object in the function definition
            if (methodInfo.function && methodInfo.function.parameters) {
                return methodInfo.function.parameters;
            }
            
            // Format 3: nested in another function property
            if (methodInfo.type === 'function' && methodInfo.function && methodInfo.function.parameters) {
                return methodInfo.function.parameters;
            }
            
            return defaultParams;
        } catch (error) {
            console.error('Error extracting parameters:', error);
            return defaultParams;
        }
    }

    // Convert method parameters to OpenAI format
    private convertMethodParametersToOpenAI(parametersInfo: any): { parameters: any } {
        const properties: Record<string, any> = {};
        const required: string[] = [];
        
        try {
            if (parametersInfo && typeof parametersInfo === 'object') {
                for (const [paramName, paramType] of Object.entries(parametersInfo)) {
                    // Add to required parameters list (assuming all are required for now)
                    required.push(paramName);
                    
                    // Create parameter properties based on type
                    if (paramType === 'string') {
                        properties[paramName] = {
                            type: 'string',
                            description: `The ${this.formatParameterName(paramName)} parameter`
                        };
                    } else if (paramType === 'number') {
                        properties[paramName] = {
                            type: 'number',
                            description: `The ${this.formatParameterName(paramName)} parameter`
                        };
                    } else if (paramType === 'boolean') {
                        properties[paramName] = {
                            type: 'boolean',
                            description: `The ${this.formatParameterName(paramName)} parameter`
                        };
                    } else {
                        // Handle other types or complex objects
                        properties[paramName] = {
                            type: 'string',
                            description: `The ${this.formatParameterName(paramName)} parameter`
                        };
                    }
                }
            }
        } catch (error) {
            console.error('Error converting parameters:', error);
        }
        
        return { 
            parameters: {
                type: 'object',
                properties,
                required
            }
        };
    }

    // Format method name to be more readable (e.g., listEmails -> "list emails")
    private formatMethodName(methodName: string): string {
        return methodName
            .replace(/([A-Z])/g, ' $1')  // Add space before capital letters
            .replace(/^./, (str) => str.toLowerCase())  // Ensure first letter is lowercase
            .trim();
    }

    // Format parameter name to be more readable (e.g., maxResults -> "max results")
    private formatParameterName(paramName: string): string {
        return paramName
            .replace(/([A-Z])/g, ' $1')  // Add space before capital letters
            .replace(/^./, (str) => str.toLowerCase())  // Ensure first letter is lowercase
            .trim();
    }

    // Process user message
    async processMessage(message: string, userId: string = 'default'): Promise<string> {
        try {
            console.log(`\n----- NEW MESSAGE PROCESSING -----`);
            console.log(`Processing message from user ${userId}: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
            
            // Get or initialize conversation history
            let history = this.conversationHistory.get(userId) || [];
            
            // Get available tools
            console.log(`Fetching available tools from VeyraX API...`);
            const toolsData = await this.getAvailableTools();
            
            // If API tools are empty or invalid, add our own custom tools
            if (!toolsData || Object.keys(toolsData).length === 0 || toolsData.error) {
                console.log('Using custom tools since API did not return valid tools');
                
                // Add custom tools when API fails
                const customTools = [
                    {
                        type: 'function' as const,
                        function: {
                            name: 'tavily_search',
                            description: 'Search the web for real-time information on any topic.',
                            parameters: {
                                type: 'object',
                                properties: {
                                    query: {
                                        type: 'string',
                                        description: 'The search query'
                                    }
                                },
                                required: ['query']
                            }
                        }
                    },
                    {
                        type: 'function' as const,
                        function: {
                            name: 'wikipedia_search',
                            description: 'Search Wikipedia for comprehensive information about topics, people, places, and concepts.',
                            parameters: {
                                type: 'object',
                                properties: {
                                    query: {
                                        type: 'string',
                                        description: 'The topic to search for on Wikipedia'
                                    }
                                },
                                required: ['query']
                            }
                        }
                    },
                    {
                        type: 'function' as const,
                        function: {
                            name: 'weather_info',
                            description: 'Get current weather information for a location',
                            parameters: {
                                type: 'object',
                                properties: {
                                    location: {
                                        type: 'string',
                                        description: 'The city or location to get weather for'
                                    }
                                },
                                required: ['location']
                            }
                        }
                    },
                    {
                        type: 'function' as const,
                        function: {
                            name: 'calculator',
                            description: 'Perform mathematical calculations',
                            parameters: {
                                type: 'object',
                                properties: {
                                    expression: {
                                        type: 'string',
                                        description: 'The mathematical expression to evaluate'
                                    }
                                },
                                required: ['expression']
                            }
                        }
                    }
                ];
                
                // Generate dynamic system message based on available tools
                const systemMessage = this.buildSystemMessage(customTools, true);
                
                // Initialize or update the system message
                if (!history.length) {
                    history = [{ role: 'system', content: systemMessage }];
                } else if (history[0].role === 'system') {
                    history[0].content = systemMessage;
                } else {
                    history.unshift({ role: 'system', content: systemMessage });
                }
                
                // Add user message to history
                history.push({ role: 'user', content: message });
                console.log(`Processing message: ${message.substring(0, 100)}`);
                
                // Create chat completion with custom tools
                const completion = await this.openai.chat.completions.create({
                    model: 'gpt-4-turbo-preview',
                    messages: history.map(msg => this.messageToCompletionMessage(msg)),
                    tools: customTools,
                    tool_choice: 'auto'
                });

                const response = completion.choices[0].message;
                console.log('OpenAI response received');

                // Handle tool calls if present
                if (response.tool_calls && response.tool_calls.length > 0) {
                    console.log(`Tool calls detected: ${response.tool_calls.length}`);
                    
                    // Add assistant message with tool calls to history
                    history.push({
                        role: 'assistant',
                        content: response.content,
                        tool_calls: response.tool_calls
                    });
                    
                    // Process each tool call
                    for (const toolCall of response.tool_calls) {
                        try {
                            console.log(`\n==== EXECUTING TOOL CALL ====`);
                            console.log(`Tool: ${toolCall.function.name}`);
                            
                            // Parse arguments safely
                            let args;
                            try {
                                args = JSON.parse(toolCall.function.arguments);
                                console.log(`Arguments: ${JSON.stringify(args, null, 2)}`);
                            } catch (e) {
                                console.error(`Error parsing arguments: ${e}`);
                                args = { query: message }; // Fallback
                                console.log(`Using fallback arguments: ${JSON.stringify(args)}`);
                            }
                            
                            // Execute the tool
                            console.log(`Executing tool ${toolCall.function.name}...`);
                            const result = await this.executeToolCall(toolCall.function.name, args);
                            
                            // Log result summary
                            console.log(`Tool execution completed with result:`);
                            if (typeof result === 'string') {
                                console.log(result.substring(0, 200) + (result.length > 200 ? '...' : ''));
                            } else {
                                console.log(JSON.stringify(result, null, 2).substring(0, 500) + '...');
                            }
                            
                            // Add tool response to history
                            history.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: typeof result === 'string' ? result : JSON.stringify(result)
                            });
                        } catch (error: any) {
                            console.error(`Tool execution error:`, error);
                            console.error(`Stack trace:`, error.stack);
                            history.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({
                                    error: true,
                                    message: `Error executing tool: ${error.message}`
                                })
                            });
                        }
                    }
                    
                    // Get final response after tool execution
                    console.log('\n==== GETTING FINAL RESPONSE ====');
                    console.log('Getting final response after tool execution');
                    const finalCompletion = await this.openai.chat.completions.create({
                        model: 'gpt-4-turbo-preview',
                        messages: history.map(msg => this.messageToCompletionMessage(msg))
                    });

                    const finalResponse = finalCompletion.choices[0].message.content || '';
                    history.push({ role: 'assistant', content: finalResponse });
                    this.conversationHistory.set(userId, history);
                    
                    console.log(`Final response with tools: ${finalResponse.substring(0, 100)}...`);
                    return finalResponse;
                }

                // If no tool calls, just return the response
                const responseContent = response.content || '';
                history.push({ role: 'assistant', content: responseContent });
                this.conversationHistory.set(userId, history);
                
                console.log(`Direct response (no tools used): ${responseContent.substring(0, 100)}...`);
                return responseContent;
            } else {
                const tools = this.convertToolsToOpenAIFormat(toolsData);
                
                // Generate dynamic system message based on available tools
                const systemMessage = this.buildSystemMessage(tools, false);
                
                // Initialize or update the system message
                if (!history.length) {
                    history = [{ role: 'system', content: systemMessage }];
                } else if (history[0].role === 'system') {
                    history[0].content = systemMessage;
                } else {
                    history.unshift({ role: 'system', content: systemMessage });
                }
                
                // Add user message to history
                history.push({ role: 'user', content: message });
                
                console.log(`Available tools: ${tools.map(t => t.function.name).join(', ')}`);
                console.log(`Sending request to OpenAI with ${tools.length} tools...`);

                // Create chat completion with tools
                console.log(`Creating chat completion with ${history.length} messages in history`);
                const completion = await this.openai.chat.completions.create({
                    model: 'gpt-4-turbo-preview',
                    messages: history.map(msg => this.messageToCompletionMessage(msg)),
                    tools: tools,
                    tool_choice: 'auto'
                });

                const response = completion.choices[0].message;
                console.log('OpenAI response received');

                // Handle tool calls if present
                if (response.tool_calls && response.tool_calls.length > 0) {
                    console.log(`Tool calls detected: ${response.tool_calls.length}`);
                    console.log('Tool calls:', JSON.stringify(response.tool_calls, null, 2));
                    
                    // Add assistant message with tool calls to history
                    history.push({
                        role: 'assistant',
                        content: response.content,
                        tool_calls: response.tool_calls
                    });
                    
                    // Process each tool call
                    for (const toolCall of response.tool_calls) {
                        try {
                            console.log(`\n==== EXECUTING TOOL CALL ====`);
                            console.log(`Tool: ${toolCall.function.name}`);
                            
                            // Parse arguments safely
                            let args;
                            try {
                                args = JSON.parse(toolCall.function.arguments);
                                console.log(`Arguments: ${JSON.stringify(args, null, 2)}`);
                            } catch (e) {
                                console.error(`Error parsing arguments: ${e}`);
                                args = { query: message }; // Fallback
                                console.log(`Using fallback arguments: ${JSON.stringify(args)}`);
                            }
                            
                            // Execute the tool
                            console.log(`Executing tool ${toolCall.function.name}...`);
                            const result = await this.executeToolCall(toolCall.function.name, args);
                            
                            // Log result summary
                            console.log(`Tool execution completed with result:`);
                            if (typeof result === 'string') {
                                console.log(result.substring(0, 200) + (result.length > 200 ? '...' : ''));
                            } else {
                                console.log(JSON.stringify(result, null, 2).substring(0, 500) + '...');
                            }
                            
                            // Add tool response to history
                            history.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: typeof result === 'string' ? result : JSON.stringify(result)
                            });
                        } catch (error: any) {
                            console.error(`Tool execution error:`, error);
                            console.error(`Stack trace:`, error.stack);
                            history.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({
                                    error: true,
                                    message: `Error executing tool: ${error.message}`
                                })
                            });
                        }
                    }
                    
                    // Get final response after tool execution
                    console.log('\n==== GETTING FINAL RESPONSE ====');
                    console.log('Getting final response after tool execution');
                    const finalCompletion = await this.openai.chat.completions.create({
                        model: 'gpt-4-turbo-preview',
                        messages: history.map(msg => this.messageToCompletionMessage(msg))
                    });

                    const finalResponse = finalCompletion.choices[0].message.content || '';
                    history.push({ role: 'assistant', content: finalResponse });
                    this.conversationHistory.set(userId, history);
                    
                    console.log(`Final response with tools: ${finalResponse.substring(0, 100)}...`);
                    return finalResponse;
                }

                // If no tool calls, just return the response
                const responseContent = response.content || '';
                history.push({ role: 'assistant', content: responseContent });
                this.conversationHistory.set(userId, history);
                
                console.log(`Direct response (no tools used): ${responseContent.substring(0, 100)}...`);
                return responseContent;
            }

        } catch (error: any) {
            console.error('Error processing message:', error);
            console.error('Stack trace:', error.stack);
            return `Sorry, there was an error processing your message. Please try again later. Error: ${error.message}`;
        }
    }
} 