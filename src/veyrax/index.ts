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

// Interface for BBQ orders stored in memory
interface BBQOrderMemory {
    items: {
        name: string;
        quantity: number;
        unit: string;
        price: number;
    }[];
    customerId?: string;
    customerName?: string;
    orderDate?: string;
    orderId?: string;
}

export class VeyraXClient {
    private readonly openai: OpenAI;
    private readonly veyraxApiKey: string;
    private readonly baseUrl = 'https://veyraxapp.com';
    private readonly userTimezone: string; // User's timezone
    private conversationHistory: Map<string, Message[]> = new Map();
    private memoryEnabled: boolean = true;

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
            
            // Special instructions for Sticky BBQ orders using VeyraX Memory
            message += `\nIMPORTANT: For Sticky BBQ orders (including meat, ribs, briskets), use the VeyraX Memory feature. All order information is stored in memory, so you don't need to extract or recalculate it from the chat history. When dealing with Sticky BBQ orders:
- Use veyrax-memory-get to retrieve current order information for a customer
- Use veyrax-memory-add to add new items to an existing order
- Use veyrax-memory-update to update quantities or details of existing items
- Use veyrax-memory-clear to reset an order and start fresh
- All pricing calculations are automatic: Beef Brisket is $25.99/kg, Beef Ribs are $22.50/kg
- For invoice generation, use google-docs-create_document with title "Invoice for [Customer Name]"
- When the user mentions BBQ orders, meat quantities, or invoices, ALWAYS check memory first
- Memory handles customer information automatically, so you don't need to track this manually
- For order history or past orders, use veyrax-memory-get with the customer name
- Example: "Please create an invoice for Mr. Albert" should use memory data to generate the invoice rather than asking for quantities
- Memory persists between conversations, so you can reference previous orders\n`;
            
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
            if (toolNames.some(name => name.includes('google-docs'))) {
                message += `\nIMPORTANT: The user has already given permission to access their Google Docs. You can directly use google-docs tools without asking for permission again. When accessing documents:
- For listing documents, use google-docs-list_documents (Note: This endpoint has limited support)
- For retrieving document content, use google-docs-get_document_content with the document_id parameter
- For creating new documents, use google-docs-create_document with title and content parameters
- ALWAYS include both title and content when creating documents - the content parameter should contain the full text of the document
- For searching text in documents, use google-docs-search_text with document_id and search_term parameters
- For adding text to documents, use google-docs-insert_text with document_id, text and location parameters 
- For replacing text in documents, use google-docs-replace_all_text with document_id, text and replaceText parameters
- For batch updates to documents, use google-docs-batch_update with document_id and requests parameters
- ALWAYS specify the document_id as a parameter when working with existing documents
- If you get errors when accessing Google Docs, offer to create a new document instead using create_document
- For invoices or similar documents, make sure to include properly formatted tables with item descriptions, quantities, prices, and totals\n`;
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

    // Convert tools to OpenAI format
    private convertToolsToOpenAIFormat(apiResponse: Record<string, any>): ToolDefinition[] {
        console.log('Converting tools to OpenAI format...');
        const openAITools: ToolDefinition[] = [];
        
        try {
            // Add VeyraX Memory tools
            this.addVeyraXMemoryTools(openAITools);
            
            // Process other tools from API response
            if (apiResponse && apiResponse.tools) {
                const tools = apiResponse.tools;
                console.log('Processing tools from API response...');
                
                // Process each category of tools
                for (const [category, methods] of Object.entries(tools)) {
                    if (!methods || typeof methods !== 'object') continue;
                    
                    console.log(`Processing category: ${category} with ${Object.keys(methods).length} methods`);
                    
                    for (const [methodName, methodInfo] of Object.entries(methods as Record<string, any>)) {
                        try {
                            // Skip empty or invalid method info
                            if (!methodInfo) continue;
                            
                            console.log(`Processing method: ${category}-${methodName}`);
                            
                            // Extract parameters and build the tool definition
                            const parameters = this.extractParametersFromMethodInfo(methodInfo);
                            
                            // Use category-method format for function names
                            const functionName = `${category}-${methodName}`;
                            const description = methodInfo.description || `${this.formatMethodName(methodName)} functionality for ${category}`;
                            
                            openAITools.push({
                                type: 'function' as const,
                                function: {
                                    name: functionName,
                                    description: description,
                                    parameters: parameters
                                }
                            });
                            
                            console.log(`Added tool: ${functionName}`);
                        } catch (error) {
                            console.error(`Error processing method ${methodName} in category ${category}:`, error);
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
    
    // Add VeyraX Memory tool definitions
    private addVeyraXMemoryTools(tools: ToolDefinition[]): void {
        console.log('Adding VeyraX Memory tools...');
        
        // veyrax-memory-get: Retrieve memory content
        tools.push({
            type: 'function' as const,
            function: {
                name: 'veyrax-memory-get',
                description: 'Retrieve content from VeyraX Memory, such as Sticky BBQ order information for a customer.',
                parameters: {
                    type: 'object',
                    properties: {
                        customerName: {
                            type: 'string',
                            description: 'Name of the customer whose data to retrieve'
                        },
                        memoryKey: {
                            type: 'string',
                            description: 'Optional specific memory key to retrieve. Default is "sticky-bbq-current-order".'
                        }
                    },
                    required: ['customerName']
                }
            }
        });
        
        // veyrax-memory-add: Add new item to memory
        tools.push({
            type: 'function' as const,
            function: {
                name: 'veyrax-memory-add',
                description: 'Add new items to an existing order in VeyraX Memory.',
                parameters: {
                    type: 'object',
                    properties: {
                        customerName: {
                            type: 'string',
                            description: 'Name of the customer whose order to update'
                        },
                        itemName: {
                            type: 'string',
                            description: 'Name of the item to add to the order'
                        },
                        quantity: {
                            type: 'number',
                            description: 'Quantity of the item to add'
                        },
                        unit: {
                            type: 'string',
                            description: 'Unit of measurement (e.g., kg, pcs, bottle)'
                        },
                        price: {
                            type: 'number',
                            description: 'Price per unit of the item (optional, standard prices will be used if not provided)'
                        }
                    },
                    required: ['customerName', 'itemName', 'quantity']
                }
            }
        });
        
        // veyrax-memory-update: Update existing memory item
        tools.push({
            type: 'function' as const,
            function: {
                name: 'veyrax-memory-update',
                description: 'Update an existing item in a customer order stored in VeyraX Memory.',
                parameters: {
                    type: 'object',
                    properties: {
                        customerName: {
                            type: 'string',
                            description: 'Name of the customer whose order to update'
                        },
                        itemName: {
                            type: 'string',
                            description: 'Name of the item to update in the order'
                        },
                        quantity: {
                            type: 'number',
                            description: 'New quantity of the item'
                        },
                        price: {
                            type: 'number',
                            description: 'New price per unit (optional)'
                        }
                    },
                    required: ['customerName', 'itemName', 'quantity']
                }
            }
        });
        
        // veyrax-memory-clear: Clear memory
        tools.push({
            type: 'function' as const,
            function: {
                name: 'veyrax-memory-clear',
                description: 'Clear a customer order from VeyraX Memory to start fresh.',
                parameters: {
                    type: 'object',
                    properties: {
                        customerName: {
                            type: 'string',
                            description: 'Name of the customer whose order to clear'
                        },
                        confirmClear: {
                            type: 'boolean',
                            description: 'Confirmation to clear the order (must be true)'
                        }
                    },
                    required: ['customerName', 'confirmClear']
                }
            }
        });
        
        console.log('Added 4 VeyraX Memory tools');
    }

    // Execute a tool call
    async executeToolCall(toolName: string, args: any): Promise<any> {
        console.log(`Executing tool: ${toolName}`);
        console.log(`Tool arguments:`, JSON.stringify(args, null, 2));
        
        try {
            // Special handling for memory tools
            if (toolName.startsWith('veyrax-memory-')) {
                console.log('Handling memory tool call');
                return {
                    success: true,
                    message: `Memory operation for ${toolName} would be processed here`,
                    details: `This is a mock response for ${toolName}`
                };
            }
            
            // Special handling for Tavily search
            if (toolName === 'tavily_search' || toolName.includes('tavily')) {
                // Check if search query is provided
                if (args.query) {
                    console.log(`Executing Tavily search for: ${args.query}`);
                    
                    try {
                        // Try to use /tool-search endpoint for searches
                        const searchResult = await this.makeRequest('POST', '/tool-search', {
                            query: args.query
                        });
                        
                        // Format the response to ensure it has the expected structure
                        return this.formatTavilyResponse(searchResult);
                    } catch (searchError) {
                        console.error('Error with search API call, falling back to general tool call:', searchError);
                        // Fall back to general tool call if search fails
                    }
                }
            }
            
            // Determine if Google Calendar or Google Docs tool
            const isGoogleCalendar = toolName.includes('google-calendar');
            const isGoogleDocs = toolName.includes('google-docs');
            
            // Format method names and endpoints
            let category = '';
            let method = '';
            let endpoint = '';
            
            if (isGoogleCalendar) {
                // For Google Calendar, use underscores
                [category, method] = toolName.split('-');
                endpoint = `/google_calendar/${method}`;
            } else if (isGoogleDocs) {
                // For Google Docs, use underscores
                [category, ...method] = toolName.split('-');
                endpoint = `/google_docs/${method.join('_')}`;
            } else {
                // Generic case, use the tool name parts as-is
                const parts = toolName.split('-');
                category = parts[0];
                method = parts.slice(1).join('_');
                endpoint = `/${category}/${method}`;
            }
            
            console.log(`Parsed tool name: category=${category}, method=${method}, endpoint=${endpoint}`);
            
            // Make the API request
            try {
                const result = await this.makeRequest('POST', endpoint, args);
                console.log(`Tool execution successful for ${toolName}`);
                return result;
            } catch (error) {
                console.error(`Tool execution failed for ${toolName}:`, error);
                
                // Special mock response for Google Docs if API fails
                if (isGoogleDocs && method.includes('create_document')) {
                    console.log('Creating mock document response for Google Docs');
                    
                    // If it's an invoice, generate a more realistic invoice
                    if (args.title && args.title.toLowerCase().includes('invoice')) {
                        // Extract customer name from title if present
                        let customerName = 'Customer';
                        const customerMatch = args.title.match(/for\s+([A-Za-z\s\.]+)/i);
                        if (customerMatch && customerMatch[1]) {
                            customerName = customerMatch[1].trim();
                        }
                        
                        // Generate mock invoice
                        const mockInvoiceId = `doc-${Date.now().toString().substring(6)}`;
                        
                        return {
                            success: true,
                            message: `Document created: ${args.title}`,
                            document: {
                                id: mockInvoiceId,
                                title: args.title,
                                url: `https://docs.google.com/document/d/${mockInvoiceId}/edit`,
                                content: args.content || `# Invoice for ${customerName}\n\n[Invoice content would appear here]`
                            }
                        };
                    } else {
                        // Regular document mock response
                        const mockDocId = `doc-${Date.now().toString().substring(6)}`;
                        
                        return {
                            success: true,
                            message: `Document created: ${args.title}`,
                            document: {
                                id: mockDocId,
                                title: args.title,
                                url: `https://docs.google.com/document/d/${mockDocId}/edit`,
                                content: args.content || `# ${args.title}\n\n[Document content would appear here]`
                            }
                        };
                    }
                }
                
                // Return error response
                return {
                    error: true,
                    message: error instanceof Error ? error.message : 'Unknown error occurred',
                    details: 'Tool execution failed'
                };
            }
        } catch (error) {
            console.error(`Error executing tool ${toolName}:`, error);
            return {
                error: true,
                message: error instanceof Error ? error.message : 'Unknown error executing tool',
                details: 'Tool execution exception'
            };
        }
    }
    
    // Execute memory-related tools
    private async executeMemoryTool(toolName: string, args: any): Promise<any> {
        console.log(`Executing memory tool: ${toolName}`);
        const userId = args.userId || 'default';
        
        try {
            switch (toolName) {
                case 'veyrax-memory-get':
                    return await this.executeMemoryGet(userId, args);
                
                case 'veyrax-memory-add':
                    return await this.executeMemoryAdd(userId, args);
                    
                case 'veyrax-memory-update':
                    return await this.executeMemoryUpdate(userId, args);
                    
                case 'veyrax-memory-clear':
                    return await this.executeMemoryClear(userId, args);
                    
                default:
                    return {
                        error: true,
                        message: `Unknown memory tool: ${toolName}`
                    };
            }
        } catch (error) {
            console.error(`Error executing memory tool ${toolName}:`, error);
            return {
                error: true,
                message: error instanceof Error ? error.message : 'Unknown error executing memory tool'
            };
        }
    }
    
    // Memory tool implementations
    private async executeMemoryGet(userId: string, args: any): Promise<any> {
        console.log(`Executing memory-get for user ${userId}`);
        
        const customerName = args.customerName;
        const memoryKey = args.memoryKey || 'sticky-bbq-current-order';
        
        if (!customerName) {
            return {
                error: true,
                message: 'Customer name is required'
            };
        }
        
        try {
            // Get memory data
            const memoryData = await this.getMemoryContent(userId, memoryKey);
            
            if (!memoryData || !memoryData.items || memoryData.items.length === 0) {
                return {
                    success: true,
                    message: `No order found for customer "${customerName}"`,
                    order: null
                };
            }
            
            // If customer name doesn't match, return not found
            if (memoryData.customerName && 
                memoryData.customerName.toLowerCase() !== customerName.toLowerCase()) {
                return {
                    success: true,
                    message: `No order found for customer "${customerName}"`,
                    order: null
                };
            }
            
            // Calculate totals
            let totalPrice = 0;
            const itemsWithSubtotals = memoryData.items.map(item => {
                const subtotal = item.quantity * item.price;
                totalPrice += subtotal;
                return {
                    ...item,
                    subtotal
                };
            });
            
            return {
                success: true,
                message: `Found order for customer "${customerName}"`,
                order: {
                    ...memoryData,
                    items: itemsWithSubtotals,
                    totalPrice
                }
            };
        } catch (error) {
            console.error('Error retrieving memory:', error);
            return {
                error: true,
                message: 'Failed to retrieve memory data',
                details: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    
    private async executeMemoryAdd(userId: string, args: any): Promise<any> {
        console.log(`Executing memory-add for user ${userId}`);
        
        const customerName = args.customerName;
        const itemName = args.itemName;
        const quantity = parseFloat(args.quantity);
        
        if (!customerName || !itemName) {
            return {
                error: true,
                message: 'Customer name and item name are required'
            };
        }
        
        if (isNaN(quantity) || quantity <= 0) {
            return {
                error: true,
                message: 'Quantity must be a positive number'
            };
        }
        
        try {
            // Determine price if not provided
            let price = parseFloat(args.price);
            if (isNaN(price) || price <= 0) {
                // Default prices based on known items
                const lowerItemName = itemName.toLowerCase();
                if (lowerItemName.includes('brisket')) {
                    price = 25.99;
                } else if (lowerItemName.includes('rib')) {
                    price = 22.50;
                } else if (lowerItemName.includes('sauce')) {
                    price = 5.99;
                } else {
                    price = 15.99; // Default price for unknown items
                }
            }
            
            // Determine unit if not provided
            const unit = args.unit || (itemName.toLowerCase().includes('sauce') ? 'bottle' : 'kg');
            
            // Create the new item
            const newItem = {
                name: itemName,
                quantity,
                unit,
                price
            };
            
            // Update memory
            const result = await this.updateBBQOrderMemory(userId, {
                items: [newItem],
                customerName
            });
            
            if (result.success) {
                return {
                    success: true,
                    message: `Added ${quantity} ${unit} of ${itemName} to ${customerName}'s order`,
                    order: result.order
                };
            } else {
                return {
                    error: true,
                    message: 'Failed to add item to order',
                    details: result.message
                };
            }
        } catch (error) {
            console.error('Error adding to memory:', error);
            return {
                error: true,
                message: 'Failed to add item to memory',
                details: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    
    private async executeMemoryUpdate(userId: string, args: any): Promise<any> {
        console.log(`Executing memory-update for user ${userId}`);
        
        const customerName = args.customerName;
        const itemName = args.itemName;
        const quantity = parseFloat(args.quantity);
        
        if (!customerName || !itemName) {
            return {
                error: true,
                message: 'Customer name and item name are required'
            };
        }
        
        if (isNaN(quantity)) {
            return {
                error: true,
                message: 'Quantity must be a number'
            };
        }
        
        try {
            // Get existing order
            const memoryKey = 'sticky-bbq-current-order';
            let currentOrder = await this.getMemoryContent(userId, memoryKey);
            
            if (!currentOrder || !currentOrder.items || currentOrder.items.length === 0) {
                return {
                    error: true,
                    message: `No order found for customer "${customerName}"`
                };
            }
            
            // If customer name doesn't match, return error
            if (currentOrder.customerName && 
                currentOrder.customerName.toLowerCase() !== customerName.toLowerCase()) {
                return {
                    error: true,
                    message: `No order found for customer "${customerName}"`
                };
            }
            
            // Find the item to update
            const existingItemIndex = currentOrder.items.findIndex(
                item => item.name.toLowerCase() === itemName.toLowerCase()
            );
            
            if (existingItemIndex === -1) {
                return {
                    error: true,
                    message: `Item "${itemName}" not found in ${customerName}'s order`
                };
            }
            
            // Update the item
            const updatedItem = { ...currentOrder.items[existingItemIndex] };
            
            // If quantity is 0, remove the item
            if (quantity === 0) {
                currentOrder.items.splice(existingItemIndex, 1);
            } else {
                updatedItem.quantity = quantity;
                
                // Update price if provided
                if (args.price && !isNaN(parseFloat(args.price))) {
                    updatedItem.price = parseFloat(args.price);
                }
                
                currentOrder.items[existingItemIndex] = updatedItem;
            }
            
            // Save updated order
            const result = await this.setMemoryContent(userId, memoryKey, currentOrder);
            
            const actionText = quantity === 0 ? "Removed" : "Updated";
            
            return {
                success: true,
                message: `${actionText} ${itemName} in ${customerName}'s order`,
                order: currentOrder
            };
        } catch (error) {
            console.error('Error updating memory:', error);
            return {
                error: true,
                message: 'Failed to update item in memory',
                details: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    
    private async executeMemoryClear(userId: string, args: any): Promise<any> {
        console.log(`Executing memory-clear for user ${userId}`);
        
        const customerName = args.customerName;
        const confirmClear = args.confirmClear === true;
        
        if (!customerName) {
            return {
                error: true,
                message: 'Customer name is required'
            };
        }
        
        if (!confirmClear) {
            return {
                error: true,
                message: 'Confirmation is required to clear the order'
            };
        }
        
        try {
            // Clear the order by setting empty content
            const memoryKey = 'sticky-bbq-current-order';
            const emptyOrder: BBQOrderMemory = {
                items: [],
                customerName,
                orderDate: new Date().toISOString()
            };
            
            await this.setMemoryContent(userId, memoryKey, emptyOrder);
            
            return {
                success: true,
                message: `Cleared order for customer "${customerName}"`
            };
        } catch (error) {
            console.error('Error clearing memory:', error);
            return {
                error: true,
                message: 'Failed to clear memory',
                details: error instanceof Error ? error.message : 'Unknown error'
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
            // Check if conversation history exists for this user, if not create a new one
            if (!this.conversationHistory.has(userId)) {
                this.conversationHistory.set(userId, []);
            }

            // Add user message to conversation history
            const userMessage: Message = { role: 'user', content: message };
            this.conversationHistory.get(userId)!.push(userMessage);

            // Fetch available tools
            console.log('Fetching available tools from VeyraX API...');
            const tools = await this.getAvailableTools();
            
            // Convert tools to OpenAI format
            const formattedTools = this.convertToolsToOpenAIFormat(tools);
            console.log(`Available tools: ${formattedTools.map(t => t.function.name).join(', ')}`);

            // Get conversation history for this user
            const messages: Message[] = this.conversationHistory.get(userId) || [];

            // Create system message with available tools information
            const isUsingCustomTools = formattedTools.length > 0;
            const systemMessage = this.buildSystemMessage(formattedTools, isUsingCustomTools);
            
            // Add system message at the beginning if not already present
            if (messages.length === 0 || messages[0].role !== 'system') {
                messages.unshift({ role: 'system', content: systemMessage });
            } else {
                // Update system message with latest tools information
                messages[0].content = systemMessage;
            }

            // Convert messages to OpenAI format
            const completionMessages = messages.map(msg => this.messageToCompletionMessage(msg));

            console.log('Sending request to OpenAI with', formattedTools.length, 'tools...');
            console.log('Creating chat completion with', completionMessages.length, 'messages in history');
            
            // Make request to OpenAI
            let response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: completionMessages,
                tools: formattedTools.length > 0 ? formattedTools : undefined,
            });

            console.log('OpenAI response received');
            
            // Get the latest message from the response
            const responseMessage = response.choices[0].message;
            
            // Check if there are tool calls in the response
            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                console.log('Tool calls detected:', responseMessage.tool_calls.length);
                console.log('Tool calls:', JSON.stringify(responseMessage.tool_calls, null, 2));
                
                // Process each tool call
                for (const toolCall of responseMessage.tool_calls) {
                    console.log('\n==== EXECUTING TOOL CALL ====');
                    console.log('Tool:', toolCall.function.name);
                    console.log('Arguments:', toolCall.function.arguments);
                    
                    // Parse the arguments as JSON
                    const args = JSON.parse(toolCall.function.arguments);
                    
                    // Add userId to arguments
                    args.userId = userId;
                    
                    // For document creation, add order data from memory
                    if (toolCall.function.name.includes('google-docs') && 
                        toolCall.function.name.includes('create_document') && 
                        args.title && args.title.toLowerCase().includes('invoice')) {
                        
                        console.log('Invoice document creation detected, getting order data from memory');
                        
                        // Extract customer name from title if present
                        let customerName: string | undefined;
                        const customerMatch = args.title.match(/for\s+([A-Za-z\s\.]+)/i);
                        if (customerMatch && customerMatch[1]) {
                            customerName = customerMatch[1].trim();
                            console.log(`Extracted customer name from title: ${customerName}`);
                        }
                        
                        // Get order data from memory
                        const memoryOrder = await this.getBBQOrderFromMemory(userId, customerName);
                        
                        if (memoryOrder.brisket > 0 || memoryOrder.ribs > 0 || Object.keys(memoryOrder.other).length > 0) {
                            console.log('Using order data from memory for document creation');
                            
                            // If content is not provided, generate it based on memory data
                            if (!args.content || args.content.trim() === '') {
                                // Convert memory order to the format expected by generateInvoiceContent
                                const formattedOrder: BBQOrderMemory = {
                                    items: [],
                                    customerName: customerName || 'Customer'
                                };
                                
                                // Add brisket if present
                                if (memoryOrder.brisket > 0) {
                                    formattedOrder.items.push({
                                        name: 'Beef Brisket',
                                        quantity: memoryOrder.brisket,
                                        unit: 'kg',
                                        price: 25.99
                                    });
                                }
                                
                                // Add ribs if present
                                if (memoryOrder.ribs > 0) {
                                    formattedOrder.items.push({
                                        name: 'Beef Ribs',
                                        quantity: memoryOrder.ribs,
                                        unit: 'kg',
                                        price: 22.50
                                    });
                                }
                                
                                // Add other items if present
                                for (const [itemName, quantity] of Object.entries(memoryOrder.other)) {
                                    formattedOrder.items.push({
                                        name: itemName,
                                        quantity: quantity,
                                        unit: 'unit',
                                        price: 15.99  // Default price if not specified
                                    });
                                }
                                
                                args.content = await this.generateInvoiceContent(formattedOrder);
                                console.log('Generated invoice content from memory data');
                            }
                            
                            // Add quantities to args for backward compatibility
                            args.beefBrisketQty = memoryOrder.brisket;
                            args.beefRibsQty = memoryOrder.ribs;
                        } else {
                            // Fall back to extracted quantities if memory data not available
                            console.log('No order data found in memory, falling back to extracted quantities');
                            const extractedQuantities = await this.extractQuantitiesUsingLLM(message, userId);
                            args.beefBrisketQty = extractedQuantities.brisket;
                            args.beefRibsQty = extractedQuantities.ribs;
                        }
                        
                        console.log('Final document creation args:', args);
                    }
                    
                    // Execute the tool call
                    console.log(`Executing tool ${toolCall.function.name}...`);
                    const result = await this.executeToolCall(toolCall.function.name, args);
                    
                    console.log('Tool execution completed with result:', 
                        JSON.stringify(result).substring(0, 200) + 
                        (JSON.stringify(result).length > 200 ? '...' : ''));
                    
                    // Add the tool response to conversation history
                    this.conversationHistory.get(userId)!.push({
                        role: 'tool',
                        content: JSON.stringify(result),
                        tool_call_id: toolCall.id
                    });
                }
                
                // Get a new response from OpenAI with the tool results
                console.log('\n==== GETTING FINAL RESPONSE ====');
                console.log('Getting final response after tool execution');
                
                // Convert updated messages to OpenAI format
                const updatedMessages = this.conversationHistory.get(userId)!.map(msg => 
                    this.messageToCompletionMessage(msg)
                );
                
                // Make a new request to OpenAI
                response = await this.openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: updatedMessages,
                    tools: formattedTools.length > 0 ? formattedTools : undefined,
                });
            }
            
            // Get the final response
            const finalResponse = response.choices[0].message.content || '';
            console.log('Final response with tools:', finalResponse.substring(0, 100) + (finalResponse.length > 100 ? '...' : ''));
            
            // Add the final assistant response to conversation history
            this.conversationHistory.get(userId)!.push({
                role: 'assistant',
                content: finalResponse
            });
            
            return finalResponse;
        } catch (error) {
            console.error('Error processing message:', error);
            return 'I encountered an error processing your message. Please try again.';
        }
    }

    // Add custom VeyraX memory functions for Sticky BBQ orders
    private async getMemoryContent(userId: string, memoryKey: string): Promise<any> {
        try {
            if (!this.memoryEnabled) {
                console.log('Memory is disabled, returning mock data');
                return this.getMockMemoryContent(memoryKey);
            }

            console.log(`Fetching memory content for key: ${memoryKey}`);
            
            const response = await this.makeRequest<any>('GET', `/memory/get`, {
                userId: userId,
                key: memoryKey
            });
            
            return response;
        } catch (error) {
            console.error('Error fetching memory content:', error);
            // Return mock data as fallback
            return this.getMockMemoryContent(memoryKey);
        }
    }

    private async setMemoryContent(userId: string, memoryKey: string, content: any): Promise<any> {
        try {
            if (!this.memoryEnabled) {
                console.log('Memory is disabled, not setting content');
                return { success: true, message: 'Memory content saved (mock)' };
            }

            console.log(`Setting memory content for key: ${memoryKey}`);
            
            const response = await this.makeRequest<any>('POST', `/memory/set`, {
                userId: userId,
                key: memoryKey,
                content: content
            });
            
            return response;
        } catch (error) {
            console.error('Error setting memory content:', error);
            return { success: false, message: 'Failed to save memory content' };
        }
    }

    private getMockMemoryContent(memoryKey: string): any {
        console.log(`Generating mock memory content for key: ${memoryKey}`);
        
        // For BBQ order-related content
        if (memoryKey.includes('bbq-order') || memoryKey.includes('sticky-bbq')) {
            const mockOrder: BBQOrderMemory = {
                items: [
                    { name: 'Beef Brisket', quantity: 2, unit: 'kg', price: 25.99 },
                    { name: 'Beef Ribs', quantity: 1.5, unit: 'kg', price: 22.50 },
                    { name: 'BBQ Sauce', quantity: 1, unit: 'bottle', price: 5.99 }
                ],
                customerName: 'Albert',
                orderDate: new Date().toISOString(),
                orderId: `ORD-${Math.floor(Math.random() * 10000)}`
            };
            
            return mockOrder;
        }
        
        // Default empty content
        return { items: [] };
    }

    private async updateBBQOrderMemory(userId: string, orderData: Partial<BBQOrderMemory>): Promise<any> {
        try {
            const memoryKey = 'sticky-bbq-current-order';
            
            // Get existing order or create new one
            let currentOrder: BBQOrderMemory;
            try {
                currentOrder = await this.getMemoryContent(userId, memoryKey);
                if (!currentOrder || !currentOrder.items) {
                    currentOrder = {
                        items: [],
                        customerName: orderData.customerName || 'Customer',
                        orderDate: new Date().toISOString(),
                        orderId: `ORD-${Math.floor(Math.random() * 10000)}`
                    };
                }
            } catch (error) {
                currentOrder = {
                    items: [],
                    customerName: orderData.customerName || 'Customer',
                    orderDate: new Date().toISOString(),
                    orderId: `ORD-${Math.floor(Math.random() * 10000)}`
                };
            }
            
            // Update customer info if provided
            if (orderData.customerName) {
                currentOrder.customerName = orderData.customerName;
            }
            
            // Update or add items
            if (orderData.items && orderData.items.length > 0) {
                for (const newItem of orderData.items) {
                    const existingItemIndex = currentOrder.items.findIndex(
                        item => item.name.toLowerCase() === newItem.name.toLowerCase()
                    );
                    
                    if (existingItemIndex >= 0) {
                        // Update existing item
                        currentOrder.items[existingItemIndex].quantity = newItem.quantity;
                        currentOrder.items[existingItemIndex].price = newItem.price;
                    } else {
                        // Add new item
                        currentOrder.items.push(newItem);
                    }
                }
            }
            
            // Save updated order
            const result = await this.setMemoryContent(userId, memoryKey, currentOrder);
            
            return {
                success: true,
                message: 'Order updated successfully',
                order: currentOrder
            };
        } catch (error) {
            console.error('Error updating BBQ order memory:', error);
            return {
                success: false,
                message: 'Failed to update order',
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    // Use memory instead of LLM for BBQ orders
    async getBBQOrderFromMemory(userId: string, customerName?: string): Promise<{ brisket: number, ribs: number, other: Record<string, number> }> {
        try {
            console.log(`Getting BBQ order from memory for user ${userId}${customerName ? ` and customer ${customerName}` : ''}`);
            
            const memoryKey = 'sticky-bbq-current-order';
            const orderData = await this.getMemoryContent(userId, memoryKey);
            
            if (!orderData || !orderData.items || orderData.items.length === 0) {
                console.log('No BBQ order found in memory, returning zeros');
                return { brisket: 0, ribs: 0, other: {} };
            }
            
            // If customer name provided, verify it matches
            if (customerName && orderData.customerName && 
                orderData.customerName.toLowerCase() !== customerName.toLowerCase()) {
                console.log(`Customer name mismatch: ${orderData.customerName} vs ${customerName}`);
                return { brisket: 0, ribs: 0, other: {} };
            }
            
            console.log('Found BBQ order in memory:', JSON.stringify(orderData));
            
            // Extract quantities of specific items
            let brisketQty = 0;
            let ribsQty = 0;
            const otherItems: Record<string, number> = {};
            
            for (const item of orderData.items) {
                const itemName = item.name.toLowerCase();
                
                if (itemName.includes('brisket')) {
                    brisketQty = item.quantity;
                } else if (itemName.includes('rib')) {
                    ribsQty = item.quantity;
                } else {
                    otherItems[item.name] = item.quantity;
                }
            }
            
            return {
                brisket: brisketQty,
                ribs: ribsQty,
                other: otherItems
            };
        } catch (error) {
            console.error('Error getting BBQ order from memory:', error);
            return { brisket: 0, ribs: 0, other: {} };
        }
    }

    // Override this method to use memory first, then fall back to LLM if needed
    async extractQuantitiesUsingLLM(message: string, userId: string = 'default'): Promise<{ brisket: number, ribs: number }> {
        // First try to get quantities from memory
        if (message.toLowerCase().includes('sticky bbq') || 
            message.toLowerCase().includes('beef brisket') ||
            message.toLowerCase().includes('beef ribs') ||
            message.toLowerCase().includes('bbq order')) {
            
            console.log('BBQ-related message detected, trying to get quantities from memory');
            
            // Extract customer name from message if present
            let customerName: string | undefined;
            const customerMatch = message.match(/for\s+([A-Za-z\s\.]+)/i);
            if (customerMatch && customerMatch[1]) {
                customerName = customerMatch[1].trim();
                console.log(`Extracted customer name: ${customerName}`);
            }
            
            const memoryOrder = await this.getBBQOrderFromMemory(userId, customerName);
            
            if (memoryOrder.brisket > 0 || memoryOrder.ribs > 0 || Object.keys(memoryOrder.other).length > 0) {
                console.log('Using quantities from memory:', memoryOrder);
                return {
                    brisket: memoryOrder.brisket,
                    ribs: memoryOrder.ribs
                };
            }
        }
        
        // Fall back to LLM extraction if nothing found in memory
        try {
            console.log('No quantities found in memory, falling back to LLM extraction');
            console.log('Extracting quantities using LLM from message:', message.substring(0, 100) + '...');
            
            const extractionPrompt = [
                {
                    role: 'system' as const,
                    content: 'You are a helpful extraction assistant. Extract the quantity of beef brisket and beef ribs from the user\'s message. Return the result as a JSON object with "brisket" and "ribs" keys with numeric values in kg. If no quantity is specified for an item, use 0.'
                },
                {
                    role: 'user' as const,
                    content: message
                }
            ];
            
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: extractionPrompt,
                response_format: { type: 'json_object' }
            });
            
            const extractedContent = response.choices[0].message.content;
            console.log('LLM extraction response:', extractedContent);
            
            if (!extractedContent) {
                return { brisket: 0, ribs: 0 };
            }
            
            try {
                const extracted = JSON.parse(extractedContent);
                
                // Validate the extracted values
                const brisketQty = typeof extracted.brisket === 'number' ? 
                    extracted.brisket : 
                    (parseInt(extracted.brisket) || 0);
                    
                const ribsQty = typeof extracted.ribs === 'number' ? 
                    extracted.ribs : 
                    (parseInt(extracted.ribs) || 0);
                
                // If we extracted valid quantities, store them in memory for future use
                if (brisketQty > 0 || ribsQty > 0) {
                    const orderItems = [];
                    
                    if (brisketQty > 0) {
                        orderItems.push({
                            name: 'Beef Brisket',
                            quantity: brisketQty,
                            unit: 'kg',
                            price: 25.99
                        });
                    }
                    
                    if (ribsQty > 0) {
                        orderItems.push({
                            name: 'Beef Ribs',
                            quantity: ribsQty,
                            unit: 'kg',
                            price: 22.50
                        });
                    }
                    
                    // Extract customer name from message if present
                    let customerName = 'Customer';
                    const customerMatch = message.match(/for\s+([A-Za-z\s\.]+)/i);
                    if (customerMatch && customerMatch[1]) {
                        customerName = customerMatch[1].trim();
                    }
                    
                    // Store in memory
                    await this.updateBBQOrderMemory(userId, {
                        items: orderItems,
                        customerName: customerName
                    });
                    
                    console.log('Stored extracted quantities in memory');
                }
                
                return {
                    brisket: brisketQty,
                    ribs: ribsQty
                };
            } catch (parseError) {
                console.error('Failed to parse LLM extraction response:', parseError);
                return { brisket: 0, ribs: 0 };
            }
        } catch (error) {
            console.error('Error using LLM for extraction:', error);
            return { brisket: 0, ribs: 0 };
        }
    }

    private async generateInvoiceContent(orderData: BBQOrderMemory): Promise<string> {
        try {
            console.log('Generating invoice content from order data:', JSON.stringify(orderData));
            
            if (!orderData.items || orderData.items.length === 0) {
                console.log('No items in order data, returning generic invoice template');
                return `# Invoice\n\nNo items to display`;
            }
            
            // Generate invoice number and date
            const invoiceNumber = `INV-${Date.now().toString().substring(6)}`;
            const invoiceDate = new Date().toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
            
            // Calculate subtotals and grand total
            let grandTotal = 0;
            const itemsContent = orderData.items.map(item => {
                const subtotal = item.quantity * item.price;
                grandTotal += subtotal;
                return `| ${item.name} | ${item.quantity} ${item.unit} | $${item.price.toFixed(2)} | $${subtotal.toFixed(2)} |`;
            }).join('\n');
            
            // Generate the complete invoice content
            const content = `# Invoice for ${orderData.customerName || 'Customer'}
Invoice Number: ${invoiceNumber}
Date: ${invoiceDate}

## Sticky BBQ - Order Details

| Item | Quantity | Price | Subtotal |
|------|----------|-------|----------|
${itemsContent}
|      |          | **TOTAL** | **$${grandTotal.toFixed(2)}** |

Thank you for your business!

Sticky BBQ
123 BBQ Lane
BBQ City, TX 12345
Phone: (555) 123-4567
Email: orders@stickybbq.com
`;
            
            console.log('Generated invoice content:', content.substring(0, 200) + '...');
            return content;
        } catch (error) {
            console.error('Error generating invoice content:', error);
            return `# Invoice\n\nError generating invoice content`;
        }
    }
} 