import { OpenAI } from 'openai';
import { ChatCompletionMessageParam, ChatCompletionSystemMessageParam, ChatCompletionUserMessageParam, ChatCompletionAssistantMessageParam, ChatCompletionFunctionMessageParam } from 'openai/resources/chat/completions';

interface Tool {
    name: string;
    description?: string;
    parameters: Record<string, any>;
}

interface Message {
    role: 'system' | 'user' | 'assistant' | 'function';
    content: string;
    name?: string;
}

interface VeyraXToolMethod {
    description?: string;
    parameters: Record<string, any>;
}

interface VeyraXTool {
    methods: Record<string, VeyraXToolMethod>;
}

interface VeyraXToolsResponse {
    tools: Record<string, VeyraXTool>;
}

interface VeyraXErrorResponse {
    error: string;
}

interface VeyraXFunctionDefinition {
    name: string;
    type: string;
    function: {
        name: string;
        description?: string;
        parameters: Record<string, any>;
    };
    description?: string;
    parameters?: Record<string, any>;
}

interface VeyraXToolData {
    type: 'function';
    function: VeyraXFunctionDefinition;
}

interface VeyraXMethodData {
    function: VeyraXFunctionDefinition;
}

interface VeyraXCategoryTools {
    [toolName: string]: VeyraXToolData | { [methodName: string]: VeyraXMethodData };
}

interface VeyraXResponse {
    [category: string]: VeyraXCategoryTools | any; // 'any' for special categories like 'examples'
}

export class VeyraXClient {
    private openai: OpenAI;
    private veyraxApiKey: string;
    private tools: Tool[] = [];
    private conversationHistory: Map<string, Message[]> = new Map();
    private readonly VEYRAX_SERVER_URL: string;

    constructor(openaiApiKey: string, veyraxApiKey: string) {
        if (!openaiApiKey) throw new Error('OpenAI API key is required');
        if (!veyraxApiKey) throw new Error('VeyraX API key is required');

        this.openai = new OpenAI({ apiKey: openaiApiKey });
        this.veyraxApiKey = veyraxApiKey;
        this.VEYRAX_SERVER_URL = process.env.VEYRAX_SERVER_URL || 'https://veyraxapp.com';

        console.log('Initialized VeyraX Client');
    }

    public async initializeTools(): Promise<void> {
        try {
            console.log('Initializing VeyraX tools...');
            await this.getAvailableTools();
            console.log(`Initialized ${this.tools.length} tools`);
        } catch (error) {
            console.error('Failed to initialize tools:', error);
            throw error; // Propagate the error up
        }
    }

    private async getAvailableTools(): Promise<Tool[]> {
        if (this.tools.length > 0) {
            return this.tools;
        }

        try {
            console.log('Fetching available tools from VeyraX...');
            
            const response = await fetch(`${this.VEYRAX_SERVER_URL}/get-tools`, {
                headers: {
                    'VEYRAX_API_KEY': this.veyraxApiKey,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('VeyraX API error:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText
                });
                throw new Error(`Failed to get tools: ${response.statusText} - ${errorText}`);
            }

            const data = await response.json() as VeyraXResponse;
            console.log('Received tools data from VeyraX');
            
            // Parse the new tool structure
            this.tools = Object.entries(data).flatMap(([category, categoryTools]) => {
                if (category === 'examples' || category === 'memories' || category === 'available_flows') {
                    return [];
                }
                
                return Object.entries(categoryTools as VeyraXCategoryTools).map(([toolName, toolData]) => {
                    // Handle both direct function tools and tools with methods
                    if ('type' in toolData && toolData.type === 'function') {
                        const functionData = toolData.function.function;
                        return {
                            name: `${category}.${toolName}`,
                            description: functionData.description || `Tool for ${toolName} operations`,
                            parameters: functionData.parameters || {}
                        };
                    } else {
                        // For tools with multiple methods
                        return Object.entries(toolData as Record<string, VeyraXMethodData>).map(([methodName, methodData]) => ({
                            name: `${category}.${toolName}.${methodName}`,
                            description: methodData.function?.function?.description || `Method ${methodName} for ${toolName}`,
                            parameters: methodData.function?.function?.parameters || {}
                        }));
                    }
                }).flat();
            });
            
            console.log(`Successfully initialized ${this.tools.length} tools`);
            return this.tools;
        } catch (error) {
            console.error('Error fetching tools:', error);
            throw error;
        }
    }

    private async executeToolWithVeyraX(name: string, method: string, params: any): Promise<any> {
        try {
            console.log(`Executing tool ${name}.${method} with params:`, params);
            const response = await fetch(`${this.VEYRAX_SERVER_URL}/tool-call/${name}/${method}`, {
                method: 'POST',
                headers: {
                    'VEYRAX_API_KEY': this.veyraxApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(params)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('VeyraX API error:', {
                    status: response.status,
                    statusText: response.statusText,
                    error: errorText
                });
                throw new Error(`Failed to invoke tool: ${errorText || response.statusText}`);
            }

            const result = await response.json();
            console.log(`Tool execution completed for ${name}.${method}`);
            return result;
        } catch (error) {
            console.error(`Error executing tool ${name}.${method}:`, error);
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
                    content: 'You are a helpful WhatsApp assistant.'
                }),
                ...history.map(msg => this.messageToCompletionMessage(msg))
            ];

            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4-turbo-preview',
                messages
            });

            const response = completion.choices[0].message;
            const content = response.content || 'No response generated';
            history.push({ role: 'assistant', content });
            return content;
        } catch (error) {
            console.error('Error processing message:', error);
            return 'Sorry, there was an error processing your message.';
        }
    }
} 