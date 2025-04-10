import OpenAI from 'openai';

export class VeyraXClient {
    private readonly openai: OpenAI | null;
    private readonly userTimezone: string;
    private readonly baseUrl: string = "https://veyraxapp.com";
    private readonly apiKey: string;
    
    // Special instructions for specific features
    private readonly specialInstructions: Record<string, string> = {
        "google-docs": `
            You can access Google Docs using the following methods:
            - google-docs-list_documents: List the user's Google Docs
            - google-docs-get_document_content: Get the content of a specific document
            - google-docs-create_document: Create a new Google Doc
            - google-docs-search_text: Search for text in a document
            - google-docs-insert_text: Insert text into a document
            - google-docs-replace_all_text: Replace all occurrences of text in a document
            - google-docs-batch_update: Perform multiple operations on a document
            
            The user has already given you permission to access their Google Docs.
            
            If you encounter any issues accessing Google Docs, please inform the user and ask them to check their Google account permissions.
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

    // Process incoming messages - simplified version without memory
    async processMessage(message: string, userId: string = 'default'): Promise<string> {
        console.log(`Processing message for user ${userId}: ${message.substring(0, 100)}...`);
        
        try {
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
                        console.error(`Failed to fetch tools: ${response.status}`);
                        return "I can help you with various tasks like managing documents, calendar, emails, and searching the web. However, I couldn't retrieve the specific tools right now. What would you like help with?";
                    }
                    
                    const responseText = await response.text();
                    const tools = JSON.parse(responseText).tools || {};
                    
                    // Generate dynamic response based on available tools
                    let toolsResponse = `I can help you with these tools:\n\n`;
                    
                    Object.entries(tools).forEach(([toolName, toolData]: [string, any]) => {
                        const methods = toolData.methods || {};
                        const methodNames = Object.keys(methods).slice(0, 4);
                        
                        if (toolName === 'google-docs') {
                            toolsResponse += `📄 Google Docs:\n`;
                        } else if (toolName === 'google-calendar') {
                            toolsResponse += `📅 Google Calendar:\n`;
                        } else if (toolName === 'gmail') {
                            toolsResponse += `📧 Gmail:\n`;
                        } else if (toolName === 'tavily') {
                            toolsResponse += `🔍 Web Search:\n`;
                        } else {
                            toolsResponse += `${toolName.charAt(0).toUpperCase() + toolName.slice(1)}:\n`;
                        }
                        
                        methodNames.forEach(methodName => {
                            toolsResponse += `   - ${methodName.replace(/_/g, ' ')}\n`;
                        });
                        
                        if (Object.keys(methods).length > 4) {
                            toolsResponse += `   - and ${Object.keys(methods).length - 4} more methods\n`;
                        }
                        
                        toolsResponse += '\n';
                    });
                    
                    toolsResponse += `Just let me know what you'd like to do!`;
                    return toolsResponse;
                } catch (error) {
                    console.error('Error fetching tools:', error);
                    return "I can help you with various tasks like managing documents, calendar, emails, and searching the web. What would you like help with?";
                }
            }
            
            // Check for Google Docs commands
            if (message.toLowerCase().includes('google doc') || 
                message.toLowerCase().includes('document') || 
                message.toLowerCase().includes('doc')) {
                
                console.log('Detected Google Docs related message, using direct response');
                
                if (message.toLowerCase().includes('list') || message.toLowerCase().includes('show me')) {
                    return `I can list your Google Docs. To do this, I would normally call the Google Docs API, but I'll simulate the response for now:

Here are your recent documents:
1. "Meeting Notes" - Last edited Apr 3, 2023
2. "Project Plan" - Last edited Mar 28, 2023
3. "Budget 2023" - Last edited Feb 15, 2023

Would you like me to open any of these documents?`;
                }
                
                if (message.toLowerCase().includes('create') || message.toLowerCase().includes('new')) {
                    const docNameMatch = message.match(/create.*document.*called\s+["']?([^"']+)["']?/i) || 
                                        message.match(/create.*document.*named\s+["']?([^"']+)["']?/i) ||
                                        message.match(/new.*document.*called\s+["']?([^"']+)["']?/i);
                    
                    const docName = docNameMatch ? docNameMatch[1] : "Untitled Document";
                    
                    return `I would create a new Google Doc called "${docName}" for you. In a real implementation, this would create the document via the Google Docs API. The document would be empty and ready for your content. Would you like me to add some initial content to this document?`;
                }
                
                return `I can help you with Google Docs. You can ask me to:
- List your documents
- Create a new document
- Get the content of a document
- Add content to a document

What would you like to do?`;
            }
            
            // Check for Google Calendar commands
            if (message.toLowerCase().includes('calendar') || 
                message.toLowerCase().includes('event') || 
                message.toLowerCase().includes('schedule')) {
                
                console.log('Detected Google Calendar related message, using direct response');
                
                if (message.toLowerCase().includes('list') || 
                    message.toLowerCase().includes('show') || 
                    message.toLowerCase().includes('what') || 
                    message.toLowerCase().includes('upcoming')) {
                    
                    return `I would list your upcoming Google Calendar events. In a real implementation, this would fetch data from the Google Calendar API. Here's a simulated response:

Upcoming events:
1. "Team Meeting" - Tomorrow, 10:00 AM - 11:00 AM
2. "Project Review" - Friday, 2:00 PM - 3:30 PM
3. "Client Call" - Next Monday, 9:30 AM - 10:00 AM

Would you like details about any specific event?`;
                }
                
                if (message.toLowerCase().includes('create') || message.toLowerCase().includes('add') || message.toLowerCase().includes('new')) {
                    return `I can help you create a new calendar event. Please provide details like:
- Event title
- Date and time
- Duration
- Any participants you want to invite

For example: "Create a meeting called Weekly Sync on Friday at 3pm for 1 hour"`;
                }
                
                return `I can help you with your Google Calendar. You can ask me to:
- List your upcoming events
- Show events for a specific day
- Create a new event
- Get details about an event

What would you like to do?`;
            }
            
            // Create the API request - simplified without memory
            const payload = {
                message,
                user: userId,
                timeZone: this.userTimezone,
                special_instructions: {
                    ...this.specialInstructions
                }
            };
            
            console.log('Sending chat request with payload:', JSON.stringify(payload).substring(0, 200) + '...');
            console.log(`Endpoint: ${this.baseUrl}/tool-call`);
            
            // Send request to API with timeout protection
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
            
            try {
                const response = await fetch(`${this.baseUrl}/tool-call`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'VEYRAX_API_KEY': this.apiKey
                    },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                console.log(`Chat API response status: ${response.status} ${response.statusText}`);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`Chat API error: ${errorText}`);
                    throw new Error(`API request failed with status: ${response.status}, message: ${errorText}`);
                }
                
                // Instead of direct parsing, let's first get the raw text
                const rawText = await response.text();
                console.log(`Raw API response (first 200 chars): ${rawText.substring(0, 200)}...`);
                
                // Then try to parse it
                let data;
                try {
                    data = JSON.parse(rawText) as Record<string, any>;
                    console.log('Successfully parsed JSON data');
                } catch (parseError) {
                    console.error('Failed to parse JSON response:', parseError);
                    return `I'm having trouble processing your request right now. Please try a simple command like "Hello" or "Test" to check if I'm working properly.`;
                }
                
                const responseText = data.response || 'I encountered an issue processing your request.';
                console.log(`Final response text (first 100 chars): ${responseText.substring(0, 100)}...`);
                return responseText;
            } catch (fetchError: unknown) {
                clearTimeout(timeoutId);
                if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                    console.error('API request timed out after 30 seconds');
                    return "I'm sorry, but my connection to the server timed out. Please try again with a simpler request or try again later.";
                }
                throw fetchError;
            }
        } catch (error) {
            console.error('Error processing message:', error);
            return `I'm currently experiencing some technical difficulties. You can try again with a simple command like "Hello" to test my connection.`;
        }
    }
    
    // Helper function to format Google Calendar events
    private formatCalendarEvent(event: any): string {
        if (!event) return 'No event information available.';
        
        let formatted = `📅 Event: ${event.summary || 'Untitled Event'}\n`;
        
        if (event.start && event.start.dateTime) {
            const startDate = new Date(event.start.dateTime);
            formatted += `🕒 Start: ${startDate.toLocaleString()}\n`;
        }
        
        if (event.end && event.end.dateTime) {
            const endDate = new Date(event.end.dateTime);
            formatted += `🕒 End: ${endDate.toLocaleString()}\n`;
        }
        
        if (event.location) {
            formatted += `📍 Location: ${event.location}\n`;
        }
        
        if (event.description) {
            formatted += `📝 Description: ${event.description}\n`;
        }
        
        if (event.attendees && event.attendees.length > 0) {
            formatted += `👥 Attendees:\n`;
            event.attendees.forEach((attendee: any) => {
                formatted += `  - ${attendee.email} (${attendee.responseStatus})\n`;
            });
        }
        
        return formatted;
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

    // Call a specific tool method using the correct URL format: /tool-call/{tool}/{method}
    async callTool(tool: string, method: string, params: any): Promise<any> {
        try {
            console.log(`Calling tool ${tool}.${method} with params:`, JSON.stringify(params).substring(0, 200) + '...');
            
            // According to VeyraX API docs, the format is /tool-call/{tool}/{method}
            const endpoint = `${this.baseUrl}/tool-call/${tool}/${method}`;
            console.log(`Tool call endpoint: ${endpoint}`);
            
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
                console.error(`Tool call failed with status ${response.status}: ${errorText}`);
                throw new Error(`Tool call failed: ${errorText}`);
            }
            
            const responseText = await response.text();
            let data;
            
            try {
                data = JSON.parse(responseText);
                return data;
            } catch (parseError) {
                console.error('Failed to parse tool response:', parseError);
                throw new Error('Invalid response format from tool call');
            }
        } catch (error) {
            console.error(`Error calling tool ${tool}.${method}:`, error);
            throw error;
        }
    }
} 