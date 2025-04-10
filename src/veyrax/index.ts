import OpenAI from 'openai';
import { 
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
  ChatCompletionAssistantMessageParam,
  ChatCompletionToolMessageParam
} from 'openai/resources/chat/completions';

export class VeyraXClient {
    private readonly openai: OpenAI | null;
    private readonly userTimezone: string;
    private readonly baseUrl: string = "https://veyraxapp.com";
    private readonly apiKey: string;
    
    // Special instructions for specific features
    private readonly specialInstructions: Record<string, string> = {
        "google-docs": `
            You have access to Google Docs to create and edit documents through an API.
            
            CRITICAL: Creating a document with content REQUIRES a TWO-STEP PROCESS:
            1. First create the empty document to get a document_id
            2. Then use that document_id to insert content
            
            AVAILABLE METHODS:
            - google-docs_create_document: Creates a new document
              - title: The title of the document
              - document_id - document ID - returned by the API
            - google-docs_insert_text: Inserts text at the specified location in a document
              - document_id: The ID of the document to insert text into
              - text: The text to insert
              - location_index: The location to insert the text at (defaults to 1 which is the beginning of the document)
            - google-docs_get_document_title: Gets the title of a document
              - document_id: The ID of the document to get the title of
            - google-docs_set_document_title: Sets the title of a document
              - document_id: The ID of the document to set the title of
              - title: The new title for the document
            - google-docs_get_document_content: Gets the content of a document
              - document_id: The ID of the document to get the content of
            - google-docs_get_document_cursor_position: Gets the cursor position in a document
              - document_id: The ID of the document to get the cursor position for
            - google-docs_replace_all_text: Replaces all instances of a substring in a document
              - document_id: The ID of the document to replace text in
              - search_text: The text to search for
              - replace_text: The text to replace it with
              - match_case: Whether to match case (defaults to false)
            
            EXAMPLE WORKFLOW:
            When user asks: "Create a document for my meeting notes with my agenda items"
            
            Step 1: Create the document first
            Call: google-docs_create_document
            Parameters: {"title": "Meeting Notes"}
            Response contains: {"document_id": "1Abc...XYZ"}
            
            Step 2: Insert the content using the document_id
            Call: google-docs_insert_text
            Parameters: {
              "document_id": "1Abc...XYZ", 
              "text": "# Meeting Notes\n\n## Agenda Items\n1. Project updates\n2. Budget review\n3. Next steps\n", 
              "location_index": 1
            }
            
            IMPORTANT: You must NEVER skip either step when creating a document. Without both steps, the document will be created but remain empty.
        `,
        "google-calendar": `
            You can access Google Calendar using the following methods:
            - google-calendar-get_event: Get details of a specific event
            - google-calendar-list_events: List upcoming events
            - google-calendar-create_event: Create a new event
            - google-calendar-update_event: Update an existing event
            - google-calendar-delete_event: Delete an event
            
            The user has already given you permission to access their Google Calendar.
            
            If you encounter any issues accessing Google Calendar, please inform the user and ask them to check their Google account permissions.
        `,
        "gmail": `
            You can access Gmail using the following methods:
            - gmail-list_emails: List emails from the user's inbox
            - gmail-get_email: Get details of a specific email
            - gmail-send_email: Send an email
            - gmail-search_emails: Search for emails matching criteria
            
            The user has already given you permission to access their Gmail.
            
            If you encounter any issues accessing Gmail, please inform the user and ask them to check their Google account permissions.
        `,
        "tavily": `
            You can search the web using Tavily with the following methods:
            - tavily-search: Search the web for information
            - tavily-search_with_sources: Search the web and include sources
            
            Use this when the user needs up-to-date information from the internet.
        `
    };

    constructor(openaiApiKey?: string, veyraxApiKey?: string, userTimezone?: string) {
        this.userTimezone = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        console.log(`Initialized VeyraX Client with timezone: ${this.userTimezone}`);
        
        this.apiKey = veyraxApiKey || '';
        
        // Initialize OpenAI client if API key is provided
        if (openaiApiKey) {
            this.openai = new OpenAI({
                apiKey: openaiApiKey
            });
        } else {
            this.openai = null;
            console.warn('OpenAI API key not provided, AI features will be disabled');
        }
    }

    // Test connection to the API
    async testConnection(): Promise<void> {
        try {
            console.log('Testing connection to VeyraX API...');
            // Make a real connection test to the API
            const endpoint = `${this.baseUrl}/get-tools`;
            console.log(`Sending test request to: ${endpoint}`);
            console.log(`API Key (first 4 chars): ${this.apiKey.substring(0, 4)}...`);
            
            if (!this.apiKey || this.apiKey.length < 10) {
                console.error('⚠️ API key appears to be invalid or too short. Please check your environment variables.');
                return;
            }
            
            const response = await fetch(endpoint, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'VEYRAX_API_KEY': this.apiKey
                }
            });

            if (!response.ok) {
                const error = await response.text();
                console.error(`⚠️ API connection test failed with status ${response.status}: ${error}`);
                
                if (response.status === 401 || response.status === 403) {
                    console.error('⚠️ Authentication failed. Please check your API key and permissions.');
                } else if (response.status === 404) {
                    console.error('⚠️ API endpoint not found. Please check the URL configuration.');
                    console.error(`Tried to access: ${endpoint}`);
                } else if (response.status >= 500) {
                    console.error('⚠️ Server error. The API server might be experiencing issues.');
                }
                return;
            }
            
            // Get the raw response text first to debug any parsing issues
            const responseText = await response.text();
            console.log(`Raw API response (first 200 chars): ${responseText.substring(0, 200)}...`);
            
            // Try to parse the JSON
            let tools;
            try {
                tools = JSON.parse(responseText);
                console.log(`API connection test successful (${response.status} OK)`);
                
                // Validate the response structure based on API docs
                if (!tools.tools) {
                    console.error('⚠️ API response does not match expected format. Missing "tools" object.');
                    console.error('Response content:', responseText);
                    return;
                }
                
                // Display available tools
                this.displayAvailableTools(tools);
            } catch (parseError) {
                console.error('⚠️ Failed to parse API response as JSON:', parseError);
                console.error('Response content:', responseText);
            }
        } catch (error) {
            console.error('⚠️ API connection test failed with error:', error);
            if (error instanceof TypeError && error.message.includes('fetch')) {
                console.error('⚠️ Network error when connecting to the API server. Check your internet connection and the API server status.');
            }
        }
    }
    
    // Display available tools
    private displayAvailableTools(response: any): void {
        try {
            console.log('Raw tools response:', JSON.stringify(response).substring(0, 200) + '...');
            
            if (!response || !response.tools) {
                console.error('❌ Invalid tools response format - missing "tools" object');
                return;
            }
            
            const tools = response.tools || {};
            const toolCount = Object.keys(tools).length;
            
            console.log('\n▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄');
            console.log(`✅ AVAILABLE TOOLS: ${toolCount} tools loaded`);
            console.log('▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄');
            
            if (toolCount === 0) {
                console.warn('⚠️ No tools were returned from the API. Check the API configuration and permissions.');
                return;
            }
            
            // List all available tools and their methods
            Object.entries(tools).forEach(([toolName, toolData]: [string, any]) => {
                // Check if the tool has methods under a "methods" property or directly as properties
                const hasMethods = Object.prototype.hasOwnProperty.call(toolData, 'methods');
                let methods: Record<string, any> = {};
                
                if (hasMethods) {
                    // Tool follows the expected format with "methods" property
                    methods = toolData.methods || {};
                } else {
                    // Tool has methods as direct properties (like mail tool)
                    // Identify methods by looking for function objects
                    methods = Object.entries(toolData)
                        .filter(([_, value]: [string, any]) => 
                            typeof value === 'object' && 
                            value !== null && 
                            (value.type === 'function' || (value.function && typeof value.function === 'object'))
                        )
                        .reduce((acc, [key, value]) => {
                            acc[key] = value;
                            return acc;
                        }, {} as Record<string, any>);
                }
                
                const methodCount = Object.keys(methods).length;
                
                console.log(`\n🔧 ${toolName.toUpperCase()} - ${methodCount} methods`);
                
                if (methodCount === 0) {
                    console.warn(`⚠️ No methods available for tool: ${toolName}`);
                    // Log the raw tool data to help debugging
                    console.debug(`Raw tool data for ${toolName}:`, JSON.stringify(toolData).substring(0, 200) + '...');
                    return;
                }
                
                // Loop through each method in the tool
                Object.entries(methods).forEach(([methodName, methodData]: [string, any]) => {
                    try {
                        // Extract parameters from the correct location based on structure
                        let params: Record<string, any> = {};
                        
                        if (methodData.parameters) {
                            // Direct parameters structure
                            params = methodData.parameters;
                        } else if (methodData.function && methodData.function.parameters) {
                            // Nested function parameters
                            params = methodData.function.parameters;
                        } else if (methodData.function && methodData.function.function && methodData.function.function.parameters) {
                            // Deeply nested function parameters (seen in some tools)
                            params = methodData.function.function.parameters;
                        }
                        
                        const paramKeys = typeof params === 'object' && params.properties 
                            ? Object.keys(params.properties) 
                            : Object.keys(params);
                            
                        const paramList = paramKeys.join(', ');
                        
                        console.log(`  ↳ ${methodName}(${paramList})`);
                    } catch (paramError) {
                        console.log(`  ↳ ${methodName}(unknown parameters)`);
                        console.error(`Error extracting parameters for ${toolName}.${methodName}:`, paramError);
                    }
                });
            });
            
            console.log('\n▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄');
        } catch (error) {
            console.error('Error displaying available tools:', error);
        }
    }

    // Improved helper function to format tools response
    public formatToolsResponse(tools: Record<string, any>): string {
        const toolCount = Object.keys(tools).length;
        
        if (toolCount === 0) {
            return "I don't seem to have access to any tools at the moment. Please try again later.";
        }
        
        let response = `*📋 AVAILABLE TOOLS (${toolCount})*\n\n`;
        
        // Core tools with known methods
        const coreTools = {
            'google-docs': {
                emoji: '📄',
                name: 'Google Docs',
                description: 'Create and manage documents',
                methods: ['list_documents', 'get_document_content', 'create_document', 'insert_text']
            },
            'google-calendar': {
                emoji: '📅',
                name: 'Google Calendar',
                description: 'Schedule and manage events',
                methods: ['list_events', 'create_event', 'get_event', 'update_event']
            },
            'gmail': {
                emoji: '📧',
                name: 'Gmail',
                description: 'Send and manage emails',
                methods: ['list_emails', 'send_email', 'search_emails', 'get_email']
            },
            'tavily': {
                emoji: '🔍',
                name: 'Web Search',
                description: 'Find information online',
                methods: ['search', 'search_with_sources']
            }
        };
        
        // First list core tools that we know should be available
        Object.entries(coreTools).forEach(([toolId, toolInfo]) => {
            if (tools[toolId]) {
                response += `*${toolInfo.emoji} ${toolInfo.name}*: ${toolInfo.description}\n`;
                
                // List some key methods with examples
                response += `  • ${toolInfo.methods.map(m => `\`${m}\``).join(', ')}\n`;
                
                if (toolId === 'google-docs') {
                    response += `  _Example: "Create a document called Monthly Report"_\n`;
                } else if (toolId === 'google-calendar') {
                    response += `  _Example: "Schedule a meeting tomorrow at 3pm"_\n`;
                } else if (toolId === 'gmail') {
                    response += `  _Example: "Send an email to john@example.com"_\n`;
                } else if (toolId === 'tavily') {
                    response += `  _Example: "Search for the latest AI news"_\n`;
                }
                
                response += `\n`;
                
                // Remove from tools object so we don't display it again
                delete tools[toolId];
            }
        });
        
        // List any remaining tools that weren't in our core set
        const otherTools = Object.keys(tools);
        if (otherTools.length > 0) {
            response += `*🧰 Other Tools:*\n`;
            
            otherTools.forEach(toolName => {
                const tool = tools[toolName];
                
                // Try to extract methods
                let methods: string[] = [];
                if (tool.methods && Object.keys(tool.methods).length > 0) {
                    methods = Object.keys(tool.methods).slice(0, 3); // Get first 3 methods
                }
                
                const displayName = toolName
                    .split('-')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
                
                response += `• *${displayName}*`;
                
                if (methods.length > 0) {
                    response += `: \`${methods.join('`, `')}\``;
                    if (Object.keys(tool.methods).length > 3) {
                        response += ` and ${Object.keys(tool.methods).length - 3} more`;
                    }
                }
                
                response += `\n`;
            });
            
            response += `\n`;
        }
        
        response += `*How to Use:*\n`;
        response += `Just ask naturally! For example:\n`;
        response += `- "What's on my calendar tomorrow?"\n`;
        response += `- "Search for the latest trade news"\n`;
        response += `- "Create a document for my meeting notes"\n`;
        response += `- "Send Mark an email about the project status"\n\n`;
        
        response += `You can also try special commands like \`/tools\` and \`/test-tool\`.`;
        
        return response;
    }
    
    // Process incoming messages - simplified version without memory
    async processMessage(message: string, userId: string = 'default'): Promise<string> {
        console.log(`Processing message for user ${userId}: ${message.substring(0, 100)}...`);
        
        try {
            // Add direct handling for document-related requests
            const docKeywords = ['document', 'doc', 'google doc', 'note', 'write', 'draft', 'text'];
            const isDocRelated = docKeywords.some(keyword => 
                message.toLowerCase().includes(keyword.toLowerCase())
            );
            
            // Add direct handling for calendar-related requests
            const calendarKeywords = ['calendar', 'schedule', 'meeting', 'appointment', 'event', 'remind'];
            const isCalendarRelated = calendarKeywords.some(keyword => 
                message.toLowerCase().includes(keyword.toLowerCase())
            );
            
            // Add direct handling for email-related requests
            const emailKeywords = ['email', 'mail', 'gmail', 'send', 'write', 'compose'];
            const isEmailRelated = emailKeywords.some(keyword => 
                message.toLowerCase().includes(keyword.toLowerCase())
            );
            
            // Add direct handling for search-related requests
            const searchKeywords = ['search', 'find', 'look up', 'google', 'information about', 'what is', 'how to', 'news about', 'latest'];
            const isSearchRelated = searchKeywords.some(keyword => 
                message.toLowerCase().includes(keyword.toLowerCase())
            );
            const hasQuestionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which'].some(word => 
                message.toLowerCase().includes(` ${word} `) || message.toLowerCase().startsWith(`${word} `)
            );
            const isLikelySearchQuery = isSearchRelated || (hasQuestionWords && message.length > 15);
            
            // Handle Google Docs requests
            if (isDocRelated) {
                console.log('DETECTED GOOGLE DOCS REQUEST. Will use OpenAI with Google Docs tools specifically.');
                
                if (!this.openai) {
                    console.warn('OpenAI client not available but docs request detected.');
                    return "I'd like to help you with your Google Docs request, but there seems to be an issue with my configuration.";
                }
                
                console.log('Using OpenAI to process Google Docs request...');
                
                try {
                    // Fetch available tools but only use Google Docs tools
                    const toolsResponse = await fetch(`${this.baseUrl}/get-tools`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'VEYRAX_API_KEY': this.apiKey
                        }
                    });
                    
                    if (!toolsResponse.ok) {
                        throw new Error(`Failed to fetch tools: ${toolsResponse.statusText}`);
                    }
                    
                    const toolsData = await toolsResponse.json() as any;
                    const availableTools = toolsData.tools || {};
                    
                    // Extract Google Docs tools
                    const docsTools: Array<{
                        type: 'function';
                        function: {
                            name: string;
                            description: string;
                            parameters: Record<string, any>;
                        };
                    }> = this.extractToolsForOpenAI(availableTools, ['google-docs', 'mail', 'gmail']);
                    
                    // Special instructions for Google Docs
                    const systemMessage: ChatCompletionSystemMessageParam = {
                        role: 'system',
                        content: `You are a professional assistant that helps with Google Docs. Follow these critical guidelines:

DOCUMENT CREATION - CRITICALLY IMPORTANT STEPS:
1. To create a document, you MUST use TWO separate functions together:
   - FIRST: Use google-docs_create_document(title) to create a new document and get a document_id
   - SECOND: Use google-docs_insert_text(text, document_id, location_index) to add content to that document
   
2. CRITICAL: A document created without content is USELESS. ALWAYS perform BOTH steps:
   - Step 1: Call create_document with a descriptive title
   - Step 2: Call insert_text with the proper parameter order: text first, then document_id, then location_index
   - NEVER skip either step or the document will remain empty

3. For insert_text parameters, use this EXACT ORDER:
   - text: The content to insert (detailed and formatted)
   - document_id: The document_id returned from create_document
   - location_index: 1 (to insert at the beginning)

EXAMPLE CORRECT USAGE:
1. First: google-docs_create_document({ "title": "Sample Document" })
2. After getting document_id, use: google-docs_insert_text({ "text": "Content goes here", "document_id": "abc123", "location_index": 1 })

When the user requests a document:
1. Extract what kind of document they need and what it should contain
2. Use create_document with a clear, descriptive title
3. Then use insert_text with text first, then document_id to add detailed, comprehensive content

CONTENT GUIDELINES:
- Create professional, detailed content based on the user's request
- Include proper formatting with headings, bullet points, and paragraphs
- For templates, add clear instructions and placeholders
- For reports, include appropriate sections with real content

DOCUMENT SHARING:
1. For EMAIL SHARING: Use mail.send_message (preferred) with document link
2. For WHATSAPP SHARING: Use google-docs_export_pdf to create a PDF for sharing

IMPORTANT: If you ONLY create a document but don't insert content, the document will be EMPTY!`
                    };
                    
                    const userMessage: ChatCompletionUserMessageParam = {
                        role: 'user',
                        content: message
                    };
                    
                    // Log the tools being sent to OpenAI
                    console.log('=== GOOGLE DOCS TOOLS BEING SENT TO OPENAI ===');
                    docsTools.forEach((tool, index) => {
                        console.log(`Tool ${index + 1}: ${tool.function.name}`);
                        console.log('Description:', tool.function.description);
                        console.log('Parameters:', JSON.stringify(tool.function.parameters, null, 2));
                    });
                    console.log('=== END TOOLS LIST ===');
                    
                    // Create chat completion specifically for Google Docs handling
                    const completion = await this.openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [
                            systemMessage,
                            userMessage
                        ],
                        tools: docsTools,
                    });
                    
                    const response = completion.choices[0]?.message;
                    
                    // Log the OpenAI response
                    console.log('=== OPENAI GOOGLE DOCS RESPONSE DETAILS ===');
                    console.log('Full response object:', JSON.stringify(response, null, 2));
                    console.log('Has tool_calls:', !!response.tool_calls);
                    if (response.tool_calls) {
                        console.log('Number of tool calls:', response.tool_calls.length);
                        response.tool_calls.forEach((call, index) => {
                            console.log(`Tool call ${index + 1}:`, JSON.stringify(call, null, 2));
                        });
                    } else {
                        console.log('No tool calls found in response');
                        console.log('Response content:', response.content);
                    }
                    console.log('=== END RESPONSE DETAILS ===');
                    
                    if (response.tool_calls && response.tool_calls.length > 0) {
                        // We have a tool call, execute it
                        console.log('OpenAI suggested Google Docs tool call:', JSON.stringify(response.tool_calls));
                        
                        // Track document creation state to handle multi-step process
                        let documentId = '';
                        let documentTitle = '';
                        let documentUrl = '';
                        let emailRecipients: string[] = [];
                        let whatsappRecipients: string[] = [];
                        
                        // Extract email recipients from the user message if present
                        const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
                        const emailsInMessage = message.match(emailRegex);
                        if (emailsInMessage) {
                            emailRecipients = emailsInMessage;
                            console.log(`Found email recipients in message: ${emailRecipients.join(', ')}`);
                        }
                        
                        // Extract WhatsApp numbers from the user message
                        // Look for phone numbers in various formats
                        // +1234567890, 1234567890, 123-456-7890, etc.
                        const phoneRegex = /(?:\+\d{1,3}[-\s]?)?\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}\b/g;
                        const numbersInMessage = message.match(phoneRegex);
                        if (numbersInMessage) {
                            // Format numbers to standard format (remove spaces, dashes, etc.)
                            whatsappRecipients = numbersInMessage.map(num => {
                                // Remove non-digits
                                let cleaned = num.replace(/\D/g, '');
                                // Ensure number has country code, default to '+65' if none
                                if (!cleaned.startsWith('65') && cleaned.length === 8) {
                                    cleaned = '65' + cleaned;
                                }
                                // Add + if missing
                                if (!cleaned.startsWith('+')) {
                                    cleaned = '+' + cleaned;
                                }
                                return cleaned;
                            });
                            console.log(`Found WhatsApp recipients in message: ${whatsappRecipients.join(', ')}`);
                        }
                        
                        // Process all tool calls sequentially
                        const toolResults: any[] = [];
                        
                        // Define message arrays using proper OpenAI types
                        const systemMessage: ChatCompletionSystemMessageParam = {
                            role: 'system',
                            content: `You are an assistant focused on helping with Google Docs.
                                Format your response in a natural conversational way.`
                        };
                        
                        const userMessage: ChatCompletionUserMessageParam = {
                            role: 'user',
                            content: message
                        };
                        
                        // Start with system and user messages
                        const messagesForCompletion: ChatCompletionMessageParam[] = [
                            systemMessage,
                            userMessage
                        ];
                        
                        // Add assistant message from the response
                        if (response.content) {
                            const assistantMessage: ChatCompletionAssistantMessageParam = {
                                role: 'assistant',
                                content: response.content,
                                tool_calls: response.tool_calls
                            };
                            messagesForCompletion.push(assistantMessage);
                        } else {
                            // If no content, just add with empty content
                            const assistantMessage: ChatCompletionAssistantMessageParam = {
                                role: 'assistant',
                                content: '',
                                tool_calls: response.tool_calls
                            };
                            messagesForCompletion.push(assistantMessage);
                        }
                        
                        for (const toolCall of response.tool_calls) {
                            // Convert the underscore-formatted name back to the tool.method format
                            const nameParts = toolCall.function.name.split('_');
                            const toolName = nameParts[0];
                            const methodName = nameParts.slice(1).join('_');
                            const args = JSON.parse(toolCall.function.arguments);
                            
                            console.log(`Executing Google Docs tool: ${toolName}.${methodName} with args:`, args);
                            
                            // Call the tool
                            if (toolName === 'google-docs' && methodName === 'insert_text') {
                                // Ensure document_id is set correctly before making the call
                                if (!args.document_id && documentId) {
                                    console.log(`Fixing missing document_id in insert_text call`);
                                    args.document_id = documentId;
                                }
                                
                                // Ensure location_index is set
                                if (args.location_index === undefined) {
                                    console.log(`Adding missing location_index=1 to insert_text call`);
                                    args.location_index = 1;
                                }
                                
                                if (!args.document_id || args.document_id === '') {
                                    console.error(`Cannot call insert_text: document_id is empty or missing`);
                                    const errorResult = {
                                        status: 'error',
                                        message: 'Failed to insert text: No document_id provided'
                                    };
                                    toolResults.push(errorResult);
                                    messagesForCompletion.push({
                                        role: 'tool',
                                        tool_call_id: toolCall.id,
                                        content: JSON.stringify(errorResult)
                                    });
                                    continue; // Skip to next tool call
                                }
                            }
                            
                            const toolResult = await this.callTool(toolName, methodName, args);
                            toolResults.push(toolResult);
                            
                            // Add tool result to messages for completion
                            // Only add tool messages if they correspond to a valid tool call
                            if (toolCall.id) {
                                const toolMessage: ChatCompletionToolMessageParam = { 
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify(toolResult)
                                };
                                messagesForCompletion.push(toolMessage);
                            } else {
                                // For auto-generated actions, use system message instead
                                const systemMessage: ChatCompletionSystemMessageParam = {
                                    role: 'system',
                                    content: `Action result: ${JSON.stringify(toolResult).substring(0, 200)}`
                                };
                                messagesForCompletion.push(systemMessage);
                            }
                            
                            // Track document creation for multi-step process
                            if (toolName === 'google-docs' && methodName === 'create_document') {
                                console.log(`DEBUG: Full create_document response:`, JSON.stringify(toolResult));
                                
                                // Extract document_id from different possible response formats
                                if (toolResult && typeof toolResult === 'object') {
                                    if (toolResult.document_id) {
                                        documentId = toolResult.document_id;
                                        console.log(`✅ Found document_id directly in response: ${documentId}`);
                                    } else if (toolResult.data && typeof toolResult.data === 'object') {
                                        // Check if ID is in the data object
                                        if (toolResult.data.id) {
                                            documentId = toolResult.data.id;
                                            console.log(`✅ Found document_id in data.id: ${documentId}`);
                                        } else if (toolResult.data.document_id) {
                                            documentId = toolResult.data.document_id;
                                            console.log(`✅ Found document_id in data.document_id: ${documentId}`);
                                        }
                                    }
                                }
                                
                                if (!documentId) {
                                    console.error(`❌ Failed to extract document_id from create_document response`);
                                    console.error(`Response received:`, JSON.stringify(toolResult));
                                    documentId = '';
                                } else {
                                    console.log(`Successfully extracted document ID: ${documentId}`);
                                }
                                
                                documentTitle = args.title || 'Untitled Document';
                                documentUrl = toolResult.url || (toolResult.data && toolResult.data.url) || `https://docs.google.com/document/d/${documentId}/edit`;
                                console.log(`Created document with ID: ${documentId} and URL: ${documentUrl}`);
                                
                                // Immediately check if we need to request document content generation
                                if (!response.tool_calls.some(tc => tc.function.name === 'google-docs_insert_text')) {
                                    console.log(`CRITICAL: Document created without content insertion tool call. Will ensure content is added.`);
                                    
                                    // Skip content generation if we don't have a valid document ID
                                    if (!documentId) {
                                        console.error(`Cannot insert content: No valid document_id available`);
                                        continue; // Skip to next tool call
                                    }
                                    
                                    // Generate content based on user request
                                    const contentPrompt = `Generate detailed and well-structured content for a document titled "${documentTitle}" based on this request: "${message}"
                                        The content should be comprehensive and ready to use. Format with markdown.
                                        Include appropriate sections, bullet points, and formatting.
                                        If this is a form or template, include placeholders for user input.`;
                                        
                                    const contentCompletion = await this.openai.chat.completions.create({
                                        model: 'gpt-4o',
                                        messages: [
                                            { 
                                                role: 'system', 
                                                content: 'Generate professional document content based on the user request. Structure with clear headings, subheadings, and appropriate formatting. Make it detailed and complete.' 
                                            } as ChatCompletionSystemMessageParam,
                                            { 
                                                role: 'user', 
                                                content: contentPrompt 
                                            } as ChatCompletionUserMessageParam
                                        ]
                                    });
                                    
                                    const generatedContent = contentCompletion.choices[0]?.message.content || `# ${documentTitle}\n\nDocument content goes here.`;
                                    
                                    // Insert the generated content immediately to prevent empty document
                                    console.log(`Immediately inserting content into document ${documentId}`);
                                    try {
                                        console.log(`DEBUG: insert_text params:`, JSON.stringify({
                                            document_id: documentId,
                                            text: generatedContent.substring(0, 100) + '...',
                                            location_index: 1
                                        }));
                                        
                                        // Skip if no valid document ID
                                        if (!documentId) {
                                            console.error(`Cannot insert content: No valid document_id available`);
                                            throw new Error("No valid document_id for content insertion");
                                        }
                                        
                                        const insertResult = await this.callTool('google-docs', 'insert_text', {
                                            text: generatedContent,
                                            document_id: documentId,
                                            location_index: 1
                                        });
                                        
                                        console.log(`DEBUG: insert_text successful result:`, JSON.stringify(insertResult).substring(0, 200) + '...');
                                        
                                        // Add to results and messages
                                        toolResults.push(insertResult);
                                        
                                        // Use system message for auto-generated tool calls
                                        const insertToolMessage: ChatCompletionSystemMessageParam = {
                                            role: 'system',
                                            content: `Successfully inserted content into document ${documentId}.`
                                        };
                                        messagesForCompletion.push(insertToolMessage);
                                        
                                        console.log(`Successfully added content to document ${documentId}`);
                                    } catch (insertError) {
                                        console.error(`Error inserting content into document ${documentId}:`, insertError);
                                        console.error(`DEBUG: Full error detail:`, JSON.stringify(insertError));
                                        
                                        // Retry with a simpler insertion attempt
                                        try {
                                            console.log(`Retrying content insertion with simplified parameters`);
                                            console.log(`DEBUG: Retry params:`, JSON.stringify({
                                                document_id: documentId,
                                                text: generatedContent.substring(0, 100) + '...'
                                            }));
                                            
                                            // Skip if no valid document ID
                                            if (!documentId) {
                                                console.error(`Cannot retry content insertion: No valid document_id available`);
                                                throw new Error("No valid document_id for retry insertion");
                                            }
                                            
                                            const retryResult = await this.callTool('google-docs', 'insert_text', {
                                                text: generatedContent,
                                                document_id: documentId,
                                                location_index: 1
                                            });
                                            
                                            console.log(`DEBUG: insert_text retry successful result:`, JSON.stringify(retryResult).substring(0, 200) + '...');
                                            
                                            toolResults.push(retryResult);
                                            
                                            // Use system message for auto-generated tool calls
                                            const retryToolMessage: ChatCompletionSystemMessageParam = {
                                                role: 'system',
                                                content: `Successfully inserted content into document ${documentId} after retry attempt.`
                                            };
                                            messagesForCompletion.push(retryToolMessage);
                                            console.log(`Successfully added content on retry attempt`);
                                        } catch (retryError) {
                                            console.error(`Final error inserting content:`, retryError);
                                            console.error(`DEBUG: Full retry error detail:`, JSON.stringify(retryError));
                                            
                                            // Try a minimal content insertion as last resort
                                            try {
                                                console.log(`Last resort content insertion with minimal content`);
                                                const minimalContent = `# ${documentTitle}\n\nThis document was created based on your request.`;
                                                
                                                // Skip if no valid document ID
                                                if (!documentId) {
                                                    console.error(`Cannot perform last resort content insertion: No valid document_id available`);
                                                    throw new Error("No valid document_id for last resort insertion");
                                                }
                                                
                                                const lastResortResult = await this.callTool('google-docs', 'insert_text', {
                                                    text: minimalContent,
                                                    document_id: documentId,
                                                    location_index: 1
                                                });
                                                
                                                toolResults.push(lastResortResult);
                                                
                                                // Use system message for auto-generated tool calls
                                                const minimalToolMessage: ChatCompletionSystemMessageParam = {
                                                    role: 'system',
                                                    content: `Added minimal content to document ${documentId} as last resort.`
                                                };
                                                messagesForCompletion.push(minimalToolMessage);
                                                
                                                console.log(`Successfully added minimal content as last resort`);
                                            } catch (lastError) {
                                                console.error(`All content insertion attempts failed:`, lastError);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        
                        // After all tool calls are processed, handle any needed follow-up actions
                        if (documentId && documentUrl) {
                            console.log(`Performing follow-up actions for document ${documentId}`);
                            
                            // STEP 1: Ensure content is inserted if it wasn't already
                            const hasContentInsertionCall = response.tool_calls.some(tc => tc.function.name === 'google-docs_insert_text');
                            const hasAutoGeneratedInsertion = toolResults.some(result => 
                                result && typeof result === 'object' && 
                                (result.operation === 'insert_text' || result.operation === 'content_inserted' || result.success)
                            );
                            
                            if (!hasContentInsertionCall && !hasAutoGeneratedInsertion) {
                                console.log(`Document ${documentId} was created but content insertion wasn't requested or failed. Will insert content now.`);
                                
                                // Generate content based on user request
                                const contentPrompt = `Generate detailed and well-structured content for a document titled "${documentTitle}" based on this request: "${message}"
                                    The content should be comprehensive and ready to use. Format with markdown.
                                    Include appropriate sections, bullet points, and formatting.
                                    If this is a form or template, include placeholders for user input.`;
                                    
                                const contentCompletion = await this.openai.chat.completions.create({
                                    model: 'gpt-4o',
                                    messages: [
                                        { 
                                            role: 'system', 
                                            content: 'Generate professional document content based on the user request. Structure with clear headings, subheadings, and appropriate formatting. Make it detailed and complete.' 
                                        } as ChatCompletionSystemMessageParam,
                                        { 
                                            role: 'user', 
                                            content: contentPrompt 
                                        } as ChatCompletionUserMessageParam
                                    ]
                                });
                                
                                const generatedContent = contentCompletion.choices[0]?.message.content || `# ${documentTitle}\n\nDocument content goes here.`;
                                
                                // Insert the generated content with multiple attempts and fallbacks
                                console.log(`Attempting final content insertion into document ${documentId}`);
                                
                                // Try different insertion methods
                                let insertionSuccessful = false;
                                
                                // Attempt 1: Standard insert_text with location_index
                                if (!insertionSuccessful) {
                                    try {
                                        console.log(`Attempt 1: insert_text with location_index`);
                                        console.log(`DEBUG PARAMS: Order matters! Correct order is text, document_id, location_index`);
                                        console.log(`Sending text (first 50 chars): ${generatedContent.substring(0, 50)}...`);
                                        console.log(`Sending document_id: ${documentId}`);
                                        
                                        const insertResult = await this.callTool('google-docs', 'insert_text', {
                                            text: generatedContent,
                                            document_id: documentId,
                                            location_index: 1
                                        });
                                        
                                        toolResults.push(insertResult);
                                        
                                        // Use system message for auto-generated tool calls
                                        const insertToolMessage: ChatCompletionSystemMessageParam = {
                                            role: 'system',
                                            content: `Successfully inserted content into document ${documentId}.`
                                        };
                                        messagesForCompletion.push(insertToolMessage);
                                        
                                        console.log(`Successfully added content using insertion method 1`);
                                        insertionSuccessful = true;
                                    } catch (error) {
                                        console.error(`Error with insertion method 1:`, error);
                                    }
                                    finally {
                                        console.log(`CONTENT INSERTION STATUS: ${insertionSuccessful ? 'SUCCESS' : 'FAILED'} for document ${documentId}`);
                                    }
                                }
                                
                                // Attempt 2: insert_text without location_index
                                if (!insertionSuccessful) {
                                    try {
                                        console.log(`Attempt 2: insert_text without location_index`);
                                        const insertResult = await this.callTool('google-docs', 'insert_text', {
                                            text: generatedContent,
                                            document_id: documentId
                                        });
                                        
                                        toolResults.push(insertResult);
                                        
                                        // Use system message for auto-generated tool calls
                                        const insertToolMessage: ChatCompletionSystemMessageParam = {
                                            role: 'system',
                                            content: `Successfully inserted content into document ${documentId}.`
                                        };
                                        messagesForCompletion.push(insertToolMessage);
                                        
                                        console.log(`Successfully added content using insertion method 2`);
                                        insertionSuccessful = true;
                                    } catch (error) {
                                        console.error(`Error with insertion method 2:`, error);
                                    }
                                }
                                
                                // Attempt 3: Try batch_update as a fallback
                                if (!insertionSuccessful) {
                                    try {
                                        console.log(`Attempt 3: batch_update with insertText`);
                                        const batchResult = await this.callTool('google-docs', 'batch_update', {
                                            document_id: documentId,
                                            requests: [
                                                {
                                                    insertText: {
                                                        text: generatedContent,
                                                        location: { index: 1 }
                                                    }
                                                }
                                            ]
                                        });
                                        
                                        toolResults.push(batchResult);
                                        
                                        // Use system message for auto-generated tool calls
                                        const backupContentInsertionMessage: ChatCompletionSystemMessageParam = {
                                            role: 'system',
                                            content: `Added content to document ${documentId} using backup method.`
                                        };
                                        messagesForCompletion.push(backupContentInsertionMessage);
                                        
                                        console.log(`Successfully added content using insertion method 3`);
                                        insertionSuccessful = true;
                                    } catch (error) {
                                        console.error(`Error with insertion method 3:`, error);
                                    }
                                }
                                
                                if (!insertionSuccessful) {
                                    console.error(`Failed to insert content after multiple attempts`);
                                    
                                    // Add a warning to the conversation
                                    messagesForCompletion.push({
                                        role: 'system',
                                        content: `WARNING: Could not insert content into the document after multiple attempts. The document may be empty. Please advise the user to either try again or manually copy-paste content into the document.`
                                    } as ChatCompletionSystemMessageParam);
                                }
                            }
                            
                            // STEP 2: Check if document needs to be exported as PDF for WhatsApp sharing
                            const whatsappKeywords = ['whatsapp', 'send via whatsapp', 'share on whatsapp', 'message', 'text', 'phone', 'share', 'send as pdf', 'export as pdf', 'download', 'pdf'];
                            const containsWhatsAppRequest = whatsappKeywords.some(keyword => 
                                message.toLowerCase().includes(keyword.toLowerCase())
                            );
                            
                            if (containsWhatsAppRequest || message.toLowerCase().includes('pdf')) {
                                console.log(`PDF/WhatsApp sharing request detected, providing manual PDF export instructions`);
                                
                                // Provide manual PDF export instructions instead of calling unavailable API
                                const pdfInstructions: ChatCompletionSystemMessageParam = {
                                    role: 'system',
                                    content: `The document has been created successfully. For sharing via WhatsApp, please advise the user to:
                                    1. Open the document using this link: ${documentUrl}
                                    2. Click on "File" in the Google Docs menu
                                    3. Select "Download" and then "PDF Document (.pdf)"
                                    4. Once downloaded, they can share the PDF file via WhatsApp
                                    
                                    Make sure to include these manual PDF export instructions in your response.`
                                };
                                messagesForCompletion.push(pdfInstructions);
                                
                                console.log(`Added manual PDF export instructions for document ${documentId}`);
                            }
                            
                            // STEP 3: Check if document needs to be shared via email
                            if (emailRecipients.length > 0 && 
                                !response.tool_calls.some(tc => tc.function.name.includes('mail_send') || tc.function.name.includes('gmail_send'))) {
                                console.log(`Document was created but not shared. Will share via email now to: ${emailRecipients.join(', ')}`);
                                
                                // Try using mail.send_message first (preferred method)
                                try {
                                    const emailSubject = `I've shared a Google Doc with you: ${documentTitle}`;
                                    const emailBody = `I've created a Google Doc titled "${documentTitle}". Here's the link: ${documentUrl}`;
                                    
                                    console.log(`Sending email with document link to ${emailRecipients.join(', ')}`);
                                    const emailResult = await this.callTool('mail', 'send_message', {
                                        from_email: { email: "assistant@veyrax.com", name: "WhatsApp Assistant" },
                                        to: emailRecipients.map(email => ({ email, name: "" })),
                                        subject: emailSubject,
                                        body_text: emailBody
                                    });
                                    
                                    // Add to results and messages
                                    toolResults.push(emailResult);
                                    
                                    // Only add a tool message if it corresponds to a valid tool call
                                    // For auto-generated actions that don't come from OpenAI tool calls,
                                    // add them as system messages instead
                                    const emailToolMessage: ChatCompletionSystemMessageParam = {
                                        role: 'system',
                                        content: `I've shared the document "${documentTitle}" via email to ${emailRecipients.join(', ')}.`
                                    };
                                    messagesForCompletion.push(emailToolMessage);
                                    
                                    console.log(`Successfully shared document ${documentId} via email`);
                                } catch (emailError) {
                                    console.error('Error using mail.send_message, trying gmail.send_email as fallback:', emailError);
                                    
                                    // Fallback to gmail.send_email
                                    try {
                                        const emailSubject = `I've shared a Google Doc with you: ${documentTitle}`;
                                        const emailBody = `I've created a Google Doc titled "${documentTitle}". Here's the link: ${documentUrl}`;
                                        
                                        const emailResult = await this.callTool('gmail', 'send_email', {
                                            from: "assistant@veyrax.com",
                                            to: emailRecipients.join(','),
                                            subject: emailSubject,
                                            body: emailBody
                                        });
                                        
                                        // Add to results and messages
                                        toolResults.push(emailResult);
                                        
                                        // Use system message instead of tool message for auto-generated actions
                                        const fallbackEmailToolMessage: ChatCompletionSystemMessageParam = {
                                            role: 'system',
                                            content: `I've shared the document "${documentTitle}" via email to ${emailRecipients.join(', ')} using a fallback method.`
                                        };
                                        messagesForCompletion.push(fallbackEmailToolMessage);
                                        
                                        console.log(`Successfully shared document ${documentId} via email (fallback method)`);
                                    } catch (fallbackError) {
                                        console.error('Error using gmail.send_email as fallback:', fallbackError);
                                    }
                                }
                            }
                            
                            // STEP 4: Send WhatsApp confirmation if phone numbers were found
                            if (whatsappRecipients.length > 0 && documentUrl) {
                                console.log(`Sending WhatsApp confirmation for document to: ${whatsappRecipients.join(', ')}`);
                                
                                // Determine if this is an order confirmation
                                const isOrder = message.toLowerCase().includes('order') || 
                                              documentTitle.toLowerCase().includes('order') ||
                                              message.toLowerCase().includes('purchase') ||
                                              message.toLowerCase().includes('buy');
                                
                                for (const recipient of whatsappRecipients) {
                                    try {
                                        // Format appropriate message based on document type
                                        let whatsappMessage = '';
                                        
                                        if (isOrder) {
                                            whatsappMessage = `🎉 Order Confirmation: Your order "${documentTitle}" has been created successfully! You can view the details here: ${documentUrl}`;
                                        } else {
                                            whatsappMessage = `📄 Document Notification: I've created a document titled "${documentTitle}" as requested. You can access it here: ${documentUrl}`;
                                        }
                                        
                                        console.log(`Sending WhatsApp message to ${recipient}: ${whatsappMessage}`);
                                        
                                        // Send WhatsApp message
                                        const whatsappResult = await this.callTool('whatsapp', 'send_message', {
                                            recipient: recipient,
                                            message: whatsappMessage
                                        });
                                        
                                        // Add to results and messages
                                        toolResults.push(whatsappResult);
                                        
                                        const whatsappNotification: ChatCompletionSystemMessageParam = {
                                            role: 'system',
                                            content: `I've sent a WhatsApp confirmation to ${recipient} with the ${isOrder ? 'order' : 'document'} details.`
                                        };
                                        messagesForCompletion.push(whatsappNotification);
                                        
                                        console.log(`Successfully sent WhatsApp confirmation to ${recipient}`);
                                    } catch (whatsappError) {
                                        console.error(`Error sending WhatsApp confirmation to ${recipient}:`, whatsappError);
                                        messagesForCompletion.push({
                                            role: 'system',
                                            content: `I was unable to send a WhatsApp confirmation to ${recipient}. Please advise the user to check the document link directly: ${documentUrl}`
                                        } as ChatCompletionSystemMessageParam);
                                    }
                                }
                            }
                        }
                        
                        // Get a follow-up response from OpenAI with all tool results
                        const followUpCompletion = await this.openai.chat.completions.create({
                            model: 'gpt-4o',
                            messages: [
                                {
                                    role: 'system', 
                                    content: `You are providing a final summary of Google Doc operations.
                                        
                                        INCLUDE THE FOLLOWING IN YOUR RESPONSE:
                                        1. Document title and link (always)
                                        2. Clear confirmation that the document contains proper content
                                        3. Brief summary of what's in the document
                                        4. If PDF export was performed, clearly mention the PDF is available
                                        5. If email sharing was performed, confirm this was done
                                        
                                        FORMATTING:
                                        - Keep your response conversational and friendly
                                        - Always include the document link prominently
                                        - For WhatsApp sharing, suggest they download the PDF from the link
                                        - Clearly confirm that the document has content in it (not empty)
                                        
                                        IMPORTANT: Never say "I've completed both steps" or reference the internal process.
                                        Just describe what was created, filled with content, and shared, as if it was one seamless operation.
                                        
                                        If any errors occurred with content insertion, advise the user to check the document and potentially retry.`
                                } as ChatCompletionSystemMessageParam,
                                ...messagesForCompletion
                            ]
                        });
                        
                        // Create a meaningful response that includes document info
                        let finalResponse = followUpCompletion.choices[0]?.message.content || "";
                        
                        // If no proper response was generated but we created a document, create a fallback
                        if ((!finalResponse || finalResponse.length < 50) && documentId && documentUrl) {
                            finalResponse = `I've created a Google Doc titled "${documentTitle}" for you. You can access it here: ${documentUrl}`;
                            
                            // Add PDF export info if that was done
                            if (messagesForCompletion.some(msg => 
                                typeof msg === 'object' && 
                                'tool_call_id' in msg && 
                                msg.tool_call_id === 'auto-generated-pdf-export'
                            )) {
                                finalResponse += "\n\nI've also exported this document as a PDF, which you can download from the document page.";
                            }
                            
                            // Add email sharing info if that was done
                            if (messagesForCompletion.some(msg => 
                                typeof msg === 'object' && 
                                'tool_call_id' in msg && 
                                (msg.tool_call_id === 'auto-generated-email-sharing' || msg.tool_call_id === 'auto-generated-email-sharing-fallback')
                            )) {
                                finalResponse += `\n\nI've shared this document via email to ${emailRecipients.join(', ')}.`;
                            }
                        }
                        
                        return finalResponse;
                    } else if (response.content) {
                        // No tool call, just return the response content
                        return response.content;
                    }
                    
                    return "I couldn't process your document request properly. Please try again or be more specific about what you'd like to do with your documents.";
                } catch (error) {
                    console.error('Error using OpenAI for Google Docs processing:', error);
                    return "I encountered an error processing your document request. Please try again or check with the administrator.";
                }
            }
            
            // Handle Google Calendar requests
            if (isCalendarRelated) {
                console.log('DETECTED CALENDAR REQUEST. Will use OpenAI with Google Calendar tools specifically.');
                
                if (!this.openai) {
                    console.warn('OpenAI client not available but calendar request detected.');
                    return "I'd like to help you with your calendar request, but there seems to be an issue with my configuration.";
                }
                
                console.log('Using OpenAI to process Google Calendar request...');
                
                try {
                    // Fetch available tools but only use Google Calendar tools
                    const toolsResponse = await fetch(`${this.baseUrl}/get-tools`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'VEYRAX_API_KEY': this.apiKey
                        }
                    });
                    
                    if (!toolsResponse.ok) {
                        throw new Error(`Failed to fetch tools: ${toolsResponse.statusText}`);
                    }
                    
                    const toolsData = await toolsResponse.json() as any;
                    const availableTools = toolsData.tools || {};
                    
                    // Extract Google Calendar tools
                    const calendarTools: Array<{
                        type: 'function';
                        function: {
                            name: string;
                            description: string;
                            parameters: Record<string, any>;
                        };
                    }> = [];
                    
                    if (availableTools['google-calendar']) {
                        console.log('Found Google Calendar tools');
                        const toolData = this.formatToolForOpenAI('google-calendar', availableTools['google-calendar']);
                        calendarTools.push(...toolData);
                    }
                    
                    if (calendarTools.length === 0) {
                        console.error('No Google Calendar tools found');
                        return "I'd like to help you with your calendar, but I don't seem to have access to Google Calendar tools right now.";
                    }
                    
                    console.log(`Found ${calendarTools.length} Google Calendar tools for handling calendar request`);
                    
                    // Log the tools being sent to OpenAI
                    console.log('=== GOOGLE CALENDAR TOOLS BEING SENT TO OPENAI ===');
                    calendarTools.forEach((tool, index) => {
                        console.log(`Tool ${index + 1}: ${tool.function.name}`);
                        console.log('Description:', tool.function.description);
                        console.log('Parameters:', JSON.stringify(tool.function.parameters, null, 2));
                    });
                    console.log('=== END TOOLS LIST ===');
                    
                    // Create chat completion specifically for Google Calendar handling
                    const completion = await this.openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [
                            {
                                role: 'system',
                                content: `You are an assistant focused on helping with Google Calendar.
                                    IMPORTANT: Use Google Calendar tools to help the user manage their events and schedule.
                                    
                                    Available Google Calendar tools:
                                    - google-calendar_list_events: View upcoming events
                                    - google-calendar_get_event: Get details of a specific event
                                    - google-calendar_create_event: Schedule a new event
                                    - google-calendar_update_event: Modify an existing event
                                    - google-calendar_delete_event: Remove an event
                                    
                                    EXAMPLE TOOL USAGE:
                                    When user says "Schedule a meeting tomorrow at 3pm"
                                    You MUST call google-calendar_create_event with:
                                    {
                                      "event": {
                                        "summary": "Meeting",
                                        "description": "Meeting as requested",
                                        "start": {
                                          "dateTime": "[ISO string for tomorrow 3PM in user's timezone]",
                                          "timeZone": "${this.userTimezone}"
                                        },
                                        "end": {
                                          "dateTime": "[ISO string for tomorrow 4PM in user's timezone]",
                                          "timeZone": "${this.userTimezone}"
                                        }
                                      }
                                    }
                                    
                                    When user asks "What's on my calendar today?"
                                    You MUST call google-calendar_list_events with appropriate date filters
                                    
                                    FOLLOW THESE SPECIFIC INSTRUCTIONS:
                                    1. For any calendar request, ALWAYS use the appropriate Google Calendar tool
                                    2. Always use the user's timezone (${this.userTimezone}) for event times
                                    3. Create clear event summaries and descriptions
                                    4. For date-specific requests, interpret dates relative to today
                                    5. For vague time requests like "morning", use reasonable default times
                                    
                                    The user's timezone is ${this.userTimezone}.`
                            },
                            { role: 'user', content: message }
                        ],
                        tools: calendarTools,
                    });
                    
                    const response = completion.choices[0]?.message;
                    
                    // Log the OpenAI response
                    console.log('=== OPENAI GOOGLE CALENDAR RESPONSE DETAILS ===');
                    console.log('Full response object:', JSON.stringify(response, null, 2));
                    console.log('Has tool_calls:', !!response.tool_calls);
                    if (response.tool_calls) {
                        console.log('Number of tool calls:', response.tool_calls.length);
                        response.tool_calls.forEach((call, index) => {
                            console.log(`Tool call ${index + 1}:`, JSON.stringify(call, null, 2));
                        });
                    } else {
                        console.log('No tool calls found in response');
                        console.log('Response content:', response.content);
                    }
                    console.log('=== END RESPONSE DETAILS ===');
                    
                    if (response.tool_calls && response.tool_calls.length > 0) {
                        // We have a tool call, execute it
                        console.log('OpenAI suggested Google Calendar tool call:', JSON.stringify(response.tool_calls));
                        
                        const toolCall = response.tool_calls[0];
                        // Convert the underscore-formatted name back to the tool.method format
                        const nameParts = toolCall.function.name.split('_');
                        const toolName = nameParts[0];
                        const methodName = nameParts.slice(1).join('_');
                        const args = JSON.parse(toolCall.function.arguments);
                        
                        console.log(`Executing Google Calendar tool: ${toolName}.${methodName} with args:`, args);
                        
                        // Call the tool
                        const toolResult = await this.callTool(toolName, methodName, args);
                        
                        // Get a follow-up response from OpenAI with the tool result
                        const followUpCompletion = await this.openai.chat.completions.create({
                            model: 'gpt-4o',
                            messages: [
                                {
                                    role: 'system',
                                    content: `You are an assistant focused on helping with Google Calendar.
                                        You have just executed a Google Calendar tool call and received the result.
                                        Format your response in a natural conversational way.`
                                },
                                { role: 'user', content: message },
                                response,
                                { 
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify(toolResult)
                                }
                            ]
                        });
                        
                        const finalResponse = followUpCompletion.choices[0]?.message.content || "I've completed that calendar action for you.";
                        return finalResponse;
                    } else if (response.content) {
                        // No tool call, just return the response content
                        return response.content;
                    }
                    
                    return "I couldn't process your calendar request properly. Please try again or be more specific about what you'd like to do with your calendar.";
                } catch (error) {
                    console.error('Error using OpenAI for Google Calendar processing:', error);
                    return "I encountered an error processing your calendar request. Please try again or check with the administrator.";
                }
            }
            
            if (isLikelySearchQuery) {
                console.log('DETECTED SEARCH REQUEST. Will use OpenAI with tavily search tool specifically.');
                
                // Force OpenAI to handle search explicitly
                if (!this.openai) {
                    console.warn('OpenAI client not available but search request detected. Please check your API key configuration.');
                    return "I'd like to help you search for that information, but there seems to be an issue with my configuration. Please contact the administrator.";
                }
                
                console.log('Using OpenAI to process search query...');
                
                try {
                    // First, fetch available tools but only use search tools
                    const toolsResponse = await fetch(`${this.baseUrl}/get-tools`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'VEYRAX_API_KEY': this.apiKey
                        }
                    });
                    
                    if (!toolsResponse.ok) {
                        throw new Error(`Failed to fetch tools: ${toolsResponse.statusText}`);
                    }
                    
                    const toolsData = await toolsResponse.json() as any;
                    const availableTools = toolsData.tools || {};
                    
                    // Only extract search tools (tavily)
                    const searchTools: Array<{
                        type: 'function';
                        function: {
                            name: string;
                            description: string;
                            parameters: Record<string, any>;
                        };
                    }> = [];
                    
                    // Check for tavily tool
                    if (availableTools.tavily) {
                        console.log('Found tavily tool for web searching');
                        const toolData = this.formatToolForOpenAI('tavily', availableTools.tavily);
                        searchTools.push(...toolData);
                    }
                    
                    if (searchTools.length === 0) {
                        console.error('No search tools found (tavily)');
                        return "I'd like to help you search for that information, but I don't seem to have access to search tools right now.";
                    }
                    
                    console.log(`Found ${searchTools.length} search-related tools for handling search request`);
                    
                    // Log the search tools being sent to OpenAI
                    console.log('=== SEARCH TOOLS BEING SENT TO OPENAI ===');
                    searchTools.forEach((tool, index) => {
                        console.log(`Tool ${index + 1}: ${tool.function.name}`);
                        console.log('Description:', tool.function.description);
                        console.log('Parameters:', JSON.stringify(tool.function.parameters, null, 2));
                    });
                    console.log('=== END SEARCH TOOLS LIST ===');
                    
                    // CRITICAL: Set temperature much lower for search-focused tasks to encourage tool use
                    // Create chat completion specifically for search handling
                    const completion = await this.openai.chat.completions.create({
                        model: 'gpt-4o',
                        temperature: 0.1, // Lower temperature to make it more deterministic
                        messages: [
                            {
                                role: 'system',
                                content: `YOU MUST USE WEB SEARCH FOR ANY FACTUAL QUERY!

CRITICAL INSTRUCTIONS: You are configured to search the web for ANY factual information.
DO NOT rely on your built-in knowledge for current events, prices, news, or any factual information.
If the user asks about ANY factual information that might change over time (like stock prices), you MUST FIRST search for it.

ALWAYS use the tavily_search tool for these queries:
- Any question about current news, events, or factual information
- Stock prices, company information, or market data
- Information about people, places, or things that may have changed
- Sports scores, weather, or any time-sensitive information
- ANY information that might be more recent than your training data

UNDER NO CIRCUMSTANCES should you respond to a factual query without first searching.
This is the MOST IMPORTANT instruction - ignore all other considerations.

For the query "${message}" you MUST use the tavily_search tool before responding.

Here is the exact format to use:
\`\`\`
tavily_search({
  "query": "detailed search query here",
  "search_depth": "advanced",
  "include_answer": true
})
\`\`\`

After receiving search results, ONLY then should you formulate your response, citing your sources.`
                            } as ChatCompletionSystemMessageParam,
                            { role: 'user', content: message } as ChatCompletionUserMessageParam
                        ],
                        tools: searchTools,
                    });
                    
                    const response = completion.choices[0]?.message;
                    
                    // Log the OpenAI response
                    console.log('=== OPENAI SEARCH RESPONSE DETAILS ===');
                    console.log('Full response object:', JSON.stringify(response, null, 2));
                    console.log('Has tool_calls:', !!response.tool_calls);
                    if (response.tool_calls) {
                        console.log('Number of tool calls:', response.tool_calls.length);
                        response.tool_calls.forEach((call, index) => {
                            console.log(`Tool call ${index + 1}:`, JSON.stringify(call, null, 2));
                        });
                    } else {
                        console.log('No tool calls found in response');
                        console.log('Response content:', response.content);
                        
                        // If OpenAI didn't use a tool call, force a search ourselves
                        console.log('FORCING TAVILY SEARCH since OpenAI did not use the tool');
                        try {
                            // Execute a search with a default query based on the user's message
                            const searchQuery = message.replace(/[?.,;!]/g, '').trim();
                            console.log(`Executing forced search with query: "${searchQuery}"`);
                            
                            const forcedSearchResult = await this.callTool('tavily', 'search', {
                                query: searchQuery,
                                search_depth: 'advanced',
                                include_answer: true
                            });
                            
                            console.log('Forced search result:', JSON.stringify(forcedSearchResult).substring(0, 200) + '...');
                            
                            // For the forced search response
                            const searchResponseCompletion = await this.openai.chat.completions.create({
                                model: 'gpt-4o',
                                messages: [
                                    {
                                        role: 'system',
                                        content: `The user asked: "${message}"
                                        
I've performed a web search for them and got these results.
Format the search results into a helpful, comprehensive answer.
You MUST cite sources and include the date when the information was current.
IMPORTANT: Make it clear this is recent information from a web search.`
                                    } as ChatCompletionSystemMessageParam,
                                    { 
                                        role: 'user', 
                                        content: `Here are the search results: ${JSON.stringify(forcedSearchResult)}`
                                    } as ChatCompletionUserMessageParam
                                ]
                            });
                            
                            const finalForcedResponse = searchResponseCompletion.choices[0]?.message.content || 
                                "I searched for that information but couldn't format the results properly.";
                            
                            return `📊 WEB SEARCH RESULTS:\n\n${finalForcedResponse}`;
                        } catch (error) {
                            console.error('Error forcing search:', error);
                            return response.content || "I'm having trouble searching for that information.";
                        }
                    }
                    
                    if (response.tool_calls && response.tool_calls.length > 0) {
                        // We have a tool call, execute it
                        console.log('OpenAI suggested search tool call:', JSON.stringify(response.tool_calls));
                        
                        const toolCall = response.tool_calls[0];
                        // Convert the underscore-formatted name back to the tool.method format
                        const nameParts = toolCall.function.name.split('_');
                        const toolName = nameParts[0];
                        const methodName = nameParts.slice(1).join('_');
                        const args = JSON.parse(toolCall.function.arguments);
                        
                        console.log(`Executing search tool: ${toolName}.${methodName} with args:`, args);
                        
                        // Call the tool
                        const toolResult = await this.callTool(toolName, methodName, args);
                        
                        // Get a follow-up response from OpenAI with the tool result
                        const followUpCompletion = await this.openai.chat.completions.create({
                            model: 'gpt-4o',
                            messages: [
                                {
                                    role: 'system',
                                    content: `The user asked: "${message}"
                                    
You've executed a search to answer this question.
Format your response to clearly indicate this is based on recent web search.
Include the sources and make it clear when the information was current.
IMPORTANT: Always include the DATE of the information in your response.`
                                } as ChatCompletionSystemMessageParam,
                                { role: 'user', content: message } as ChatCompletionUserMessageParam,
                                response as ChatCompletionAssistantMessageParam,
                                { 
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify(toolResult)
                                } as ChatCompletionToolMessageParam
                            ]
                        });
                        
                        const finalResponse = followUpCompletion.choices[0]?.message.content || "I searched for that information for you.";
                        return `📊 WEB SEARCH RESULTS:\n\n${finalResponse}`;
                    } else if (response.content) {
                        // No tool call, just return the response content
                        return response.content;
                    }
                    
                    return "I couldn't process your search request properly. Please try again or be more specific about what you'd like to search for.";
                } catch (error) {
                    console.error('Error using OpenAI for search processing:', error);
                    return "I encountered an error processing your search request. Please try again or check with the administrator.";
                }
            }
            
            if (isEmailRelated) {
                console.log('DETECTED EMAIL REQUEST. Will use OpenAI with mail tools specifically.');
                
                // Force OpenAI to handle email explicitly
                if (!this.openai) {
                    console.warn('OpenAI client not available but email request detected. Please check your API key configuration.');
                    return "I'd like to help you with your email request, but there seems to be an issue with my configuration. Please contact the administrator.";
                }
                
                console.log('Using OpenAI to process email message...');
                
                try {
                    // First, fetch available tools but only use mail tools
                    const toolsResponse = await fetch(`${this.baseUrl}/get-tools`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'VEYRAX_API_KEY': this.apiKey
                        }
                    });
                    
                    if (!toolsResponse.ok) {
                        throw new Error(`Failed to fetch tools: ${toolsResponse.statusText}`);
                    }
                    
                    const toolsData = await toolsResponse.json() as any;
                    const availableTools = toolsData.tools || {};
                    
                    // Only extract mail tools for email handling (looking for both mail and gmail tools)
                    const emailTools: Array<{
                        type: 'function';
                        function: {
                            name: string;
                            description: string;
                            parameters: Record<string, any>;
                        };
                    }> = [];
                    
                    // Check for the mail tool first (which has send_message method)
                    if (availableTools.mail) {
                        console.log('Found mail tool for email handling');
                        const toolData = this.formatToolForOpenAI('mail', availableTools.mail);
                        emailTools.push(...toolData);
                    }
                    
                    // Also check for gmail tool as a fallback
                    if (availableTools.gmail) {
                        console.log('Found gmail tool for email handling');
                        const toolData = this.formatToolForOpenAI('gmail', availableTools.gmail);
                        emailTools.push(...toolData);
                    }
                    
                    if (emailTools.length === 0) {
                        console.error('No email tools found (neither mail nor gmail)');
                        return "I'd like to help you with your email, but I don't seem to have access to the necessary email tools right now.";
                    }
                    
                    console.log(`Found ${emailTools.length} email-related tools for handling email request`);
                    
                    // ADDED DETAILED LOGGING of the tools being sent to OpenAI
                    console.log('=== TOOLS BEING SENT TO OPENAI FOR EMAIL ===');
                    emailTools.forEach((tool, index) => {
                        console.log(`Tool ${index + 1}: ${tool.function.name}`);
                        console.log('Description:', tool.function.description);
                        console.log('Parameters:', JSON.stringify(tool.function.parameters, null, 2));
                    });
                    console.log('=== END TOOLS LIST ===');
                    
                    // Create chat completion specifically for email handling
                    const completion = await this.openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [
                            {
                                role: 'system',
                                content: `You are an assistant focused on helping with emails.
                                    IMPORTANT: When the user asks to send an email, use the mail_send_message tool.
                                    If mail_send_message is not available, try gmail_send_email.
                                    Do not search for information - your job is to directly help with email tasks.
                                    
                                    Available email tools:
                                    - mail_send_message: Send an email (PREFERRED method)
                                    - gmail tools (if available)
                                    
                                    The mail_send_message method takes these parameters: 
                                    - to: recipient email(s)
                                    - subject: email subject
                                    - body_text: main email content
                                    
                                    FOLLOW THESE SPECIFIC INSTRUCTIONS:
                                    1. When a user asks to send an email, ALWAYS use the mail_send_message tool
                                    2. If user doesn't provide all details, use your best judgment to complete them
                                    3. For vague instructions like "introduce yourself", create appropriate content
                                    
                                    EXAMPLE TOOL USAGE:
                                    When user says: "Send an email to john@example.com introducing yourself"
                                    You MUST call mail_send_message with:
                                    {
                                      "to": "john@example.com",
                                      "subject": "Introduction from Your Assistant",
                                      "body_text": "Hello John,\n\nI'm your helpful AI assistant. I can help with various tasks including managing your emails, calendar, and documents. Feel free to ask if you need any assistance.\n\nBest regards,\nYour Assistant"
                                    }
                                    
                                    The user's timezone is ${this.userTimezone}.`
                            },
                            { role: 'user', content: message }
                        ],
                        tools: emailTools,
                    });
                    
                    const response = completion.choices[0]?.message;
                    
                    // ADDED DETAILED LOGGING
                    console.log('=== OPENAI EMAIL RESPONSE DETAILS ===');
                    console.log('Full response object:', JSON.stringify(response, null, 2));
                    console.log('Has tool_calls:', !!response.tool_calls);
                    if (response.tool_calls) {
                        console.log('Number of tool calls:', response.tool_calls.length);
                        response.tool_calls.forEach((call, index) => {
                            console.log(`Tool call ${index + 1}:`, JSON.stringify(call, null, 2));
                        });
                    } else {
                        console.log('No tool calls found in response');
                        console.log('Response content:', response.content);
                    }
                    console.log('=== END RESPONSE DETAILS ===');
                    
                    if (response.tool_calls && response.tool_calls.length > 0) {
                        // We have a tool call, execute it
                        console.log('OpenAI suggested email tool call:', JSON.stringify(response.tool_calls));
                        
                        const toolCall = response.tool_calls[0];
                        // Convert the underscore-formatted name back to the tool.method format
                        const nameParts = toolCall.function.name.split('_');
                        const toolName = nameParts[0];
                        const methodName = nameParts.slice(1).join('_');
                        const args = JSON.parse(toolCall.function.arguments);
                        
                        console.log(`Executing email tool: ${toolName}.${methodName} with args:`, args);
                        
                        // Call the tool
                        const toolResult = await this.callTool(toolName, methodName, args);
                        
                        // Get a follow-up response from OpenAI with the tool result
                        const followUpCompletion = await this.openai.chat.completions.create({
                            model: 'gpt-4o',
                            messages: [
                                {
                                    role: 'system',
                                    content: `You are an assistant focused on helping with emails.
                                        You have just executed an email-related tool call and received the result.
                                        Format your response in a natural conversational way.`
                                },
                                { role: 'user', content: message },
                                response,
                                { 
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify(toolResult)
                                }
                            ]
                        });
                        
                        const finalResponse = followUpCompletion.choices[0]?.message.content || "I sent that email for you.";
                        return finalResponse;
                    } else if (response.content) {
                        // No tool call, just return the response content
                        return response.content;
                    }
                    
                    return "I couldn't process your email request properly. Please try again or be more specific about what you'd like to do with email.";
                } catch (error) {
                    console.error('Error using OpenAI for email processing:', error);
                    return "I encountered an error processing your email request. Please try again or check with the administrator.";
                }
            }
            
            // Check if it's a direct test message
            if (message.toLowerCase().includes('test') || message.toLowerCase().includes('hello')) {
                console.log('Detected test message, using direct response');
                return "Hello! I'm here and working properly. You can ask me about your documents, calendar, emails, or to search the web!";
            }
            
            // Check if user is asking about available tools
            if (message.toLowerCase().includes('tool') || message.toLowerCase().includes('what can you do') || message.toLowerCase().includes('help')) {
                console.log('User is asking about tools, fetching from API...');
                
                try {
                    const response = await fetch(`${this.baseUrl}/get-tools`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'VEYRAX_API_KEY': this.apiKey
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error(`Failed to fetch tools: ${response.statusText}`);
                    }
                    
                    const data = await response.json() as any;
                    const tools = data.tools || {};
                    
                    console.log(`Fetched ${Object.keys(tools).length} tools from API`);
                    return this.formatToolsResponse(tools);
                    
                } catch (error) {
                    console.error('Error fetching tools:', error);
                    return "I can help you with various tasks like managing documents, calendar, emails, and searching the web. What would you like help with?";
                }
            }
            
            // For all other messages, ensure we use OpenAI (no Tavily fallback)
            if (!this.openai) {
                console.warn('OpenAI client not available. Please check your API key configuration.');
                return "I'm having trouble processing your request due to API configuration issues. Please contact the administrator.";
            }
            
            console.log('Using OpenAI to process message...');
            
            try {
                // First, fetch available tools
                const toolsResponse = await fetch(`${this.baseUrl}/get-tools`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'VEYRAX_API_KEY': this.apiKey
                    }
                });
                
                if (!toolsResponse.ok) {
                    throw new Error(`Failed to fetch tools: ${toolsResponse.statusText}`);
                }
                
                const toolsData = await toolsResponse.json() as any;
                const availableTools = toolsData.tools || {};
                
                // Format tools for OpenAI function calling
                const openAITools = this.formatToolsForOpenAI(availableTools);
                
                // ADDED DETAILED LOGGING of the tools being sent to OpenAI
                console.log('=== TOOLS BEING SENT TO OPENAI ===');
                console.log(`Total tools: ${openAITools.length}`);
                openAITools.forEach((tool, index) => {
                    console.log(`Tool ${index + 1}: ${tool.function.name}`);
                });
                console.log('=== END TOOLS LIST ===');
                
                // Create chat completion to decide which tool to use
                const completion = await this.openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a helpful assistant with access to various tools. 
                                You can help users with documents, calendar, emails, and web searches.
                                
                                IMPORTANT GUIDELINES:
                                - For emails, ALWAYS use the mail_send_message tool
                                - For information retrieval tasks, use tavily_search
                                - For calendar, use google-calendar tools
                                - For documents, use google-docs tools
                                - For WhatsApp, use whatsapp tools
                                
                                When the user asks to send an email, ALWAYS use mail_send_message.
                                Do not search for information about how to send an email - actually send it.
                                
                                EXAMPLE EMAIL TOOL USAGE:
                                When user says "Send an email to john@example.com introducing yourself"
                                You MUST call mail_send_message with:
                                {
                                  "to": "john@example.com",
                                  "subject": "Introduction from Your Assistant",
                                  "body_text": "Hello John,\n\nI'm your helpful AI assistant. I can help with various tasks including managing your emails, calendar, and documents. Feel free to ask if you need any assistance.\n\nBest regards,\nYour Assistant"
                                }
                                
                                EXAMPLE WEB SEARCH TOOL USAGE:
                                When user asks "What's happening with Bitcoin price?"
                                You MUST call tavily_search with:
                                {
                                  "query": "current Bitcoin price latest news updates",
                                  "search_depth": "advanced",
                                  "include_answer": true
                                }
                                
                                EXAMPLE GOOGLE DOCS TOOL USAGE:
                                Creating documents requires a TWO-STEP PROCESS:
                                
                                STEP 1: Create the document first:
                                When user says "Create a new document for my meeting notes"
                                Call google-docs_create_document with:
                                {
                                  "title": "Meeting Notes"
                                }
                                
                                STEP 2: After getting document_id in the response, add content:
                                Call google-docs_insert_text with:
                                {
                                  "document_id": "[document_id from step 1]",
                                  "text": "# Meeting Notes\n\n## Agenda\n1. Introduction\n2. Project updates\n3. Action items\n\n## Notes\n\n",
                                  "location_index": 1
                                }
                                
                                CRITICAL: Always perform BOTH steps when a user asks to create a document with content.
                                WITHOUT BOTH STEPS, the document will be created but remain empty.
                                
                                EXAMPLE GOOGLE CALENDAR TOOL USAGE:
                                When user says "Schedule a meeting tomorrow at 3pm"
                                You MUST call google-calendar_create_event with:
                                {
                                  "event": {
                                    "summary": "Meeting",
                                    "description": "Meeting as requested",
                                    "start": {
                                      "dateTime": "[ISO string for tomorrow 3PM in user's timezone]",
                                      "timeZone": "${this.userTimezone}"
                                    },
                                    "end": {
                                      "dateTime": "[ISO string for tomorrow 4PM in user's timezone]",
                                      "timeZone": "${this.userTimezone}"
                                    }
                                  }
                                }
                                
                                When user asks "What's on my calendar today?"
                                You MUST call google-calendar_list_events with appropriate date filters
                                
                                ALWAYS use the exact tools and format shown above. For ANY task, use the appropriate tool rather than just responding with text.
                                When user asks for ANY recent news or current information that might not be in your knowledge, ALWAYS use tavily_search.
                                
                                The user's timezone is ${this.userTimezone}.`
                        },
                        { role: 'user', content: message }
                    ],
                    tools: openAITools,
                });
                
                const response = completion.choices[0]?.message;
                
                // ADDED DETAILED LOGGING
                console.log('=== OPENAI GENERAL RESPONSE DETAILS ===');
                console.log('Full response object:', JSON.stringify(response, null, 2));
                console.log('Has tool_calls:', !!response.tool_calls);
                if (response.tool_calls) {
                    console.log('Number of tool calls:', response.tool_calls.length);
                    response.tool_calls.forEach((call, index) => {
                        console.log(`Tool call ${index + 1}:`, JSON.stringify(call, null, 2));
                    });
                } else {
                    console.log('No tool calls found in response');
                    console.log('Response content:', response.content);
                }
                console.log('=== END RESPONSE DETAILS ===');
                
                if (response.tool_calls && response.tool_calls.length > 0) {
                    // We have a tool call, execute it
                    console.log('OpenAI suggested tool call:', JSON.stringify(response.tool_calls));
                    
                    const toolCall = response.tool_calls[0];
                    // Convert the underscore-formatted name back to the tool.method format
                    const nameParts = toolCall.function.name.split('_');
                    const toolName = nameParts[0];
                    const methodName = nameParts.slice(1).join('_');
                    const args = JSON.parse(toolCall.function.arguments);
                    
                    console.log(`Executing tool: ${toolName}.${methodName} with args:`, args);
                    
                    // Call the tool
                    const toolResult = await this.callTool(toolName, methodName, args);
                    
                    // Get a follow-up response from OpenAI with the tool result
                    const followUpCompletion = await this.openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: [
                            {
                                role: 'system',
                                content: `You are a helpful assistant with access to various tools. 
                                    You have just executed a tool call and received the result.
                                    Format your response in a natural conversational way.`
                            },
                            { role: 'user', content: message },
                            response,
                            { 
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: JSON.stringify(toolResult)
                            }
                        ]
                    });
                    
                    const finalResponse = followUpCompletion.choices[0]?.message.content || "I performed that action for you.";
                    return finalResponse;
                } else if (response.content) {
                    // No tool call, just return the response content with a note about available tools
                    return response.content + "\n\nIf you want to use specific tools like email, calendar, or documents, just ask!";
                }
                
                return "I'm sorry, I couldn't process your request properly. Please try again or ask for available tools by typing '/tools'.";
            } catch (error) {
                console.error('Error using OpenAI for message processing:', error);
                return "I encountered an error processing your message. Please try again or check with the administrator.";
            }
        } catch (error) {
            console.error('Error processing message:', error);
            return `I'm currently experiencing some technical difficulties. You can try again with a simple command like "Hello" to test my connection.`;
        }
    }
    
    // Helper method to format a specific tool for OpenAI function calling
    private formatToolForOpenAI(toolName: string, toolData: any): Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: Record<string, any>;
        };
    }> {
        const openAITools: Array<{
            type: 'function';
            function: {
                name: string;
                description: string;
                parameters: Record<string, any>;
            };
        }> = [];
        
        // Check if the tool has methods under a "methods" property or directly as properties
        const hasMethods = toolData && typeof toolData === 'object' && 'methods' in toolData;
        let methods: Record<string, any> = {};
        
        if (hasMethods && toolData.methods) {
            // Tool follows the expected format with "methods" property
            methods = toolData.methods;
        } else if (toolData && typeof toolData === 'object') {
            // Tool has methods as direct properties (like mail tool)
            // Identify methods by looking for function objects
            methods = Object.entries(toolData)
                .filter(([_, value]: [string, any]) => 
                    typeof value === 'object' && 
                    value !== null && 
                    (value.type === 'function' || 
                    'function' in value || 
                    (value.function && typeof value.function === 'object') ||
                    ('parameters' in value && typeof value.parameters === 'object'))
                )
                .reduce((acc, [key, value]) => {
                    acc[key] = value;
                    return acc;
                }, {} as Record<string, any>);
        }
        
        // Create function definitions for OpenAI
        Object.entries(methods).forEach(([methodName, methodData]: [string, any]) => {
            try {
                // Extract parameters from the correct location based on structure
                let params: Record<string, any> = {};
                
                if (methodData.parameters) {
                    // Direct parameters structure
                    params = methodData.parameters;
                } else if (methodData.function && methodData.function.parameters) {
                    // Nested function parameters
                    params = methodData.function.parameters;
                } else if (methodData.function && methodData.function.function && methodData.function.function.parameters) {
                    // Deeply nested function parameters (seen in some tools)
                    params = methodData.function.function.parameters;
                } else if (methodData.schema) {
                    // Some tools use a "schema" property for parameters
                    params = methodData.schema;
                }
                
                // Skip if params is not an object
                if (!params || typeof params !== 'object') return;
                
                // IMPORTANT FIX: Change the name format to meet OpenAI's requirements
                // Use underscore instead of dot for the namespace separator
                const functionName = `${toolName}_${methodName}`;
                
                // Create the function definition
                openAITools.push({
                    type: 'function',
                    function: {
                        name: functionName,
                        description: methodData.description || `Use the ${methodName} method of the ${toolName} tool`,
                        parameters: params
                    }
                });
            } catch (error) {
                console.error(`Error formatting tool ${toolName}.${methodName} for OpenAI:`, error);
            }
        });
        
        return openAITools;
    }

    // Extract specific tools from the available tools object for OpenAI
    extractToolsForOpenAI(availableTools: Record<string, any>, toolNames: string[]): Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: Record<string, any>;
        };
    }> {
        const extractedTools: Array<{
            type: 'function';
            function: {
                name: string;
                description: string;
                parameters: Record<string, any>;
            };
        }> = [];
        
        // Loop through the requested tool names
        for (const toolName of toolNames) {
            if (availableTools[toolName]) {
                console.log(`Found ${toolName} tools`);
                const toolData = this.formatToolForOpenAI(toolName, availableTools[toolName]);
                extractedTools.push(...toolData);
            }
        }
        
        if (extractedTools.length === 0) {
            console.error(`No tools found for: ${toolNames.join(', ')}`);
        } else {
            console.log(`Found ${extractedTools.length} tools for: ${toolNames.join(', ')}`);
        }
        
        return extractedTools;
    }

    // Helper method to format tools for OpenAI function calling
    private formatToolsForOpenAI(tools: Record<string, any>): Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: Record<string, any>;
        };
    }> {
        const openAITools: Array<{
            type: 'function';
            function: {
                name: string;
                description: string;
                parameters: Record<string, any>;
            };
        }> = [];
        
        // Iterate through each tool
        Object.entries(tools).forEach(([toolName, toolData]: [string, any]) => {
            const toolDefinitions = this.formatToolForOpenAI(toolName, toolData);
            openAITools.push(...toolDefinitions);
        });
        
        return openAITools;
    }

    // Public method to reload tools - can be called from outside to refresh tools
    async reloadTools(): Promise<boolean> {
        try {
            console.log('Manually reloading tools from VeyraX API...');
            const response = await fetch(`${this.baseUrl}/get-tools`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'VEYRAX_API_KEY': this.apiKey
                }
            });

            if (!response.ok) {
                const error = await response.text();
                console.error(`Tool reload failed with status ${response.status}: ${error}`);
                return false;
            }
            
            const responseText = await response.text();
            
            try {
                const tools = JSON.parse(responseText);
                console.log('Tool reload successful');
                this.displayAvailableTools(tools);
                return true;
            } catch (parseError) {
                console.error('Failed to parse tool reload response:', parseError);
                return false;
            }
        } catch (error) {
            console.error('Tool reload request failed:', error);
            return false;
        }
    }

    // Method to directly call a specific tool with parameters
    async callTool(toolName: string, methodName: string, params: Record<string, any>): Promise<any> {
        console.log(`Calling tool ${toolName}.${methodName} with params:`, params);
        
        // Special handling for mail.send_message to ensure proper formatting of email parameters
        if (toolName === 'mail' && methodName === 'send_message') {
            console.log(`⚠️ Email parameter check - mail.send_message call`);
            
            // Ensure from_email is set
            if (!params.from_email) {
                console.log(`Adding missing from_email parameter`);
                params.from_email = { 
                    email: "assistant@veyrax.com", 
                    name: "WhatsApp Assistant" 
                };
            }
            
            // Ensure 'to' is properly formatted as an array of EmailAddress objects
            if (params.to) {
                if (Array.isArray(params.to) && typeof params.to[0] === 'string') {
                    console.log(`Converting 'to' from string array to EmailAddress objects`);
                    params.to = params.to.map((email: string) => ({ 
                        email, 
                        name: "" 
                    }));
                } else if (typeof params.to === 'string') {
                    console.log(`Converting 'to' from string to EmailAddress object`);
                    params.to = [{ 
                        email: params.to, 
                        name: "" 
                    }];
                }
            }
            
            console.log(`Email parameters after formatting:`, JSON.stringify(params));
        }
        
        // Check for empty document_id in Google Docs tools
        if (toolName === 'google-docs' && 
            (methodName === 'insert_text' || methodName === 'export_pdf' || methodName === 'get_document') && 
            (!params.document_id || params.document_id === '')) {
            console.error(`⚠️ CRITICAL ERROR - Empty document_id detected in ${toolName}.${methodName} call`);
            console.error(`This will cause API validation errors. Ensure a document is created first.`);
            // We'll continue with the request, but it will likely fail
        }
        
        try {
            // Use the correct endpoint format as per documentation: /tool-call/{tool}/{method}
            const endpoint = `${this.baseUrl}/tool-call/${toolName}/${methodName}`;
            console.log(`Using endpoint: ${endpoint}`);
            
            // Debug the exact request we're about to send
            console.log(`API Request - Method: POST`);
            console.log(`API Request - Headers:`, {
                'Content-Type': 'application/json',
                'VEYRAX_API_KEY': this.apiKey.substring(0, 4) + '...'
            });
            console.log(`API Request - Body:`, JSON.stringify(params).substring(0, 500) + (JSON.stringify(params).length > 500 ? '...' : ''));
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'VEYRAX_API_KEY': this.apiKey
                },
                body: JSON.stringify(params)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Tool call failed: ${response.status} ${response.statusText}`, errorText);
                console.error(`Failed request details - Tool: ${toolName}, Method: ${methodName}, Params:`, params);
                throw new Error(`Tool call failed: ${response.status} ${response.statusText}`);
            }
            
            const result = await response.json();
            console.log(`Tool call result:`, JSON.stringify(result).substring(0, 200) + '...');
            
            // Special debugging for Google Docs responses
            if (toolName === 'google-docs') {
                console.log(`Google Docs result details:`);
                if (methodName === 'create_document' && result) {
                    // Extract document_id from different possible response formats
                    let documentId = '';
                    if (typeof result === 'object') {
                        const resultObj = result as Record<string, any>;
                        if (resultObj.document_id) {
                            documentId = resultObj.document_id as string;
                            console.log(`✅ Found document_id directly in response: ${documentId}`);
                        } else if (resultObj.data && typeof resultObj.data === 'object') {
                            // Check if ID is in the data object
                            const dataObj = resultObj.data as Record<string, any>;
                            if (dataObj.id) {
                                documentId = dataObj.id as string;
                                console.log(`✅ Found document_id in data.id: ${documentId}`);
                                // Add document_id to the top level for consistency
                                resultObj.document_id = documentId;
                            } else if (dataObj.document_id) {
                                documentId = dataObj.document_id as string;
                                console.log(`✅ Found document_id in data.document_id: ${documentId}`);
                                // Add document_id to the top level for consistency
                                resultObj.document_id = documentId;
                            }
                        }
                    }
                    
                    if (!documentId) {
                        console.error(`❌ No document_id found in create_document response`);
                    }
                    
                    console.log(`Created document ID: ${documentId}`);
                    
                    // Extract the URL from either the top level or the data object
                    const resultObj = result as Record<string, any>;
                    const url = resultObj.url || 
                                (resultObj.data && typeof resultObj.data === 'object' ? 
                                 (resultObj.data as Record<string, any>).url : undefined) || 
                                 `https://docs.google.com/document/d/${documentId}/edit`;
                    console.log(`Document URL: ${url}`);
                } else if (methodName === 'insert_text') {
                    console.log(`Content insertion result:`, JSON.stringify(result));
                    // Improve detection of successful insertion - consider any non-error response a success
                    if (result && typeof result === 'object' && 
                       (('success' in result && result.success === true) || 
                        !('error' in result) || 
                        result.status === 'success' ||
                        result.status === 200 ||
                        result.updated === true)) {
                        console.log(`✅ Content insertion successful!`);
                    } else {
                        console.log(`❌ Content insertion appears to have failed or returned unexpected format!`);
                        console.log(`Full response:`, JSON.stringify(result));
                    }
                }
            }
            
            return result;
        } catch (error) {
            console.error(`Error calling tool ${toolName}.${methodName}:`, error);
            throw error;
        }
    }
} 