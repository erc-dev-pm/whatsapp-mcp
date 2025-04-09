import { OpenAI } from 'openai';
import { ChatCompletionMessageParam, ChatCompletionSystemMessageParam, ChatCompletionUserMessageParam, ChatCompletionAssistantMessageParam, ChatCompletionFunctionMessageParam } from 'openai/resources/chat/completions';

interface VeyraXToolMethod {
    parameters: Record<string, any>;
}

interface VeyraXTool {
    methods: Record<string, VeyraXToolMethod>;
}

interface VeyraXToolsResponse {
    tools: Record<string, VeyraXTool>;
}

interface Tool {
    name: string;
    method: string;
    description: string;
    parameters: Record<string, any>;
}

interface Message {
    role: 'system' | 'user' | 'assistant' | 'function';
    content: string;
    name?: string;
}

export class MCPClient {
    private openai: OpenAI;
    private mcpServerUrl: string;
    private mcpApiKey: string;
    private tools: Tool[] = [];
    private conversationHistory: Map<string, Message[]> = new Map();

    constructor(openaiApiKey: string, mcpApiKey: string, mcpServerUrl?: string) {
        if (!openaiApiKey) throw new Error('OpenAI API key is required');
        if (!mcpApiKey) throw new Error('MCP API key is required');

        this.openai = new OpenAI({ apiKey: openaiApiKey });
        this.mcpApiKey = mcpApiKey;
        this.mcpServerUrl = mcpServerUrl || 'https://veyraxapp.com';

        console.log('Initialized MCP Client with VeyraX MCP');
    }

    private getToolDescription(toolName: string): string {
        const descriptions: Record<string, string> = {
            'gmail': 'Gmail integration for sending and managing emails',
            'google-calendar': 'Google Calendar integration for managing events and schedules',
            'google-docs': 'Google Docs integration for document management',
            'tavily': 'Tavily web search integration for finding information online'
        };
        return descriptions[toolName] || `Integration for ${toolName}`;
    }

    private getMethodDescription(toolName: string, methodName: string): string {
        const descriptions: Record<string, Record<string, string>> = {
            'gmail': {
                'sendEmail': 'Send an email to specified recipients',
                'listEmails': 'List emails from your Gmail inbox'
            },
            'google-calendar': {
                'listEvents': 'List events from your Google Calendar',
                'createEvent': 'Create a new event in your Google Calendar'
            }
        };
        return descriptions[toolName]?.[methodName] || `${methodName} operation for ${toolName}`;
    }

    private formatParameterSchema(parameters: Record<string, any>): Record<string, any> {
        const typeMapping: Record<string, any> = {
            'string': { type: 'string' },
            'number': { type: 'number' },
            'boolean': { type: 'boolean' }
        };

        const required: string[] = [];
        const properties: Record<string, any> = {};

        for (const [key, type] of Object.entries(parameters)) {
            properties[key] = typeMapping[type as string] || { type: 'string' };
            required.push(key);
        }

        return {
            type: 'object',
            properties,
            required
        };
    }

    private async getAvailableTools(): Promise<Tool[]> {
        if (this.tools.length > 0) {
            return this.tools;
        }

        try {
            console.log('Fetching available tools from MCP server...');
            const response = await fetch(`${this.mcpServerUrl}/get-tools`, {
                headers: {
                    'VEYRAX_API_KEY': this.mcpApiKey,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to get tools: ${response.statusText}`);
            }

            const data = await response.json() as VeyraXToolsResponse;
            
            // Transform the tools into a flat list with tool.method format
            this.tools = Object.entries(data.tools).flatMap(([toolName, tool]) => 
                Object.entries(tool.methods).map(([methodName, method]) => ({
                    name: `${toolName}.${methodName}`,
                    method: methodName,
                    description: this.getMethodDescription(toolName, methodName),
                    parameters: this.formatParameterSchema(method.parameters)
                }))
            );

            console.log(`Fetched ${this.tools.length} tools:`, this.tools);
            return this.tools;
        } catch (error) {
            console.error('Error fetching tools:', error);
            return [];
        }
    }

    private async executeToolWithMCP(fullName: string, params: any): Promise<any> {
        try {
            const [toolName, methodName] = fullName.split('.');
            if (!toolName || !methodName) {
                throw new Error(`Invalid tool name format: ${fullName}`);
            }

            console.log(`Executing tool ${toolName}.${methodName} with params:`, params);
            const response = await fetch(`${this.mcpServerUrl}/tool-call/${toolName}/${methodName}`, {
                method: 'POST',
                headers: {
                    'VEYRAX_API_KEY': this.mcpApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(params)
            });

            if (!response.ok) {
                throw new Error(`Failed to invoke tool: ${response.statusText}`);
            }

            const result = await response.json();
            console.log(`Tool execution result:`, result);
            return result;
        } catch (error) {
            console.error(`Error executing tool:`, error);
            throw error;
        }
    }

    private messageToCompletionMessage(msg: Message): ChatCompletionMessageParam {
        switch (msg.role) {
            case 'system':
                return {
                    role: 'system',
                    content: msg.content
                } as ChatCompletionSystemMessageParam;
            case 'user':
                return {
                    role: 'user',
                    content: msg.content
                } as ChatCompletionUserMessageParam;
            case 'assistant':
                return {
                    role: 'assistant',
                    content: msg.content
                } as ChatCompletionAssistantMessageParam;
            case 'function':
                if (!msg.name) throw new Error('Function messages must have a name');
                return {
                    role: 'function',
                    name: msg.name,
                    content: msg.content
                } as ChatCompletionFunctionMessageParam;
            default:
                throw new Error(`Unknown message role: ${msg.role}`);
        }
    }

    public async processMessage(userId: string, message: string): Promise<string> {
        try {
            if (!this.conversationHistory.has(userId)) {
                this.conversationHistory.set(userId, []);
            }

            const history = this.conversationHistory.get(userId)!;
            history.push({ role: 'user', content: message });

            const tools = await this.getAvailableTools();

            console.log('Sending message to OpenAI with tools...');
            const messages: ChatCompletionMessageParam[] = [
                this.messageToCompletionMessage({
                    role: 'system',
                    content: `You are a helpful WhatsApp assistant with access to various tools:

1. Gmail - Send emails and manage your inbox
2. Google Calendar - Manage your calendar events and schedules
3. Google Docs - Create and manage documents
4. Tavily - Search the web for information

When a user asks for something that requires using these tools, use the appropriate tool to help them. Format responses concisely for WhatsApp.

Available tools: ${tools.map(t => t.name).join(', ')}`
                }),
                ...history.map(msg => this.messageToCompletionMessage(msg))
            ];

            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages,
                tools: tools.map(tool => ({
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.parameters
                    }
                }))
            });

            const response = completion.choices[0].message;
            
            if (response.tool_calls && response.tool_calls.length > 0) {
                console.log('OpenAI requested tool execution');
                for (const toolCall of response.tool_calls) {
                    const toolName = toolCall.function.name;
                    const params = JSON.parse(toolCall.function.arguments);
                    
                    try {
                        const result = await this.executeToolWithMCP(toolName, params);
                        
                        history.push({
                            role: 'function',
                            name: toolName,
                            content: JSON.stringify(result)
                        });
                        
                        const finalCompletion = await this.openai.chat.completions.create({
                            model: 'gpt-4',
                            messages: [
                                ...messages,
                                this.messageToCompletionMessage({
                                    role: 'function',
                                    name: toolName,
                                    content: JSON.stringify(result)
                                })
                            ],
                            tools: tools.map(tool => ({
                                type: 'function',
                                function: {
                                    name: tool.name,
                                    description: tool.description,
                                    parameters: tool.parameters
                                }
                            }))
                        });
                        
                        const finalResponse = finalCompletion.choices[0].message.content || 'No response generated';
                        history.push({ role: 'assistant', content: finalResponse });
                        return finalResponse;
                    } catch (error) {
                        console.error('Error executing tool:', error);
                        return 'Sorry, there was an error executing the requested tool.';
                    }
                }
            }

            const content = response.content || 'No response generated';
            history.push({ role: 'assistant', content });
            return content;
        } catch (error) {
            console.error('Error processing message:', error);
            return 'Sorry, there was an error processing your message.';
        }
    }
} 