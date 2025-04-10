import { Client, LocalAuth } from '../index.js';
import qrcode from 'qrcode-terminal';
import { VeyraXClient } from './veyrax';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        console.log('Starting application...');
        
        // Check environment variables
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const veyraxApiKey = process.env.VEYRAX_API_KEY;
        const userTimezone = process.env.USER_TIMEZONE || 'Asia/Singapore';
        
        if (!openaiApiKey) {
            console.warn('⚠️ OPENAI_API_KEY is not set! AI features may be limited.');
        }
        
        if (!veyraxApiKey) {
            console.warn('⚠️ VEYRAX_API_KEY is not set! API connections will fail.');
        } else {
            console.log(`VEYRAX_API_KEY is set (starts with: ${veyraxApiKey.substring(0, 4)}...)`);
        }
        
        // Initialize WhatsApp client
        console.log('Creating WhatsApp client...');
        const client = new Client({
            authStrategy: new LocalAuth({
                dataPath: '.wwebjs_auth'
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ],
                timeout: 90000  // Increase timeout to 90 seconds
            },
            qrMaxRetries: 3
        });

        // Initialize VeyraX client
        console.log('Creating VeyraX client...');
        const veyraxClient = new VeyraXClient(
            openaiApiKey || '',
            veyraxApiKey || '',
            userTimezone
        );

        // Set up WhatsApp event handlers
        client.on('qr', (qr) => {
            console.log('QR Code received, generating...');
            qrcode.generate(qr, { small: true });
            console.log('\n▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄');
            console.log('█ SCAN QR CODE TO LOGIN █');
            console.log('▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀');
            console.log('1. Open WhatsApp on your phone');
            console.log('2. Tap Menu or Settings and select Linked Devices');
            console.log('3. Tap on "Link a Device"');
            console.log('4. Point your phone at this screen to scan the QR code');
        });

        client.on('ready', () => {
            console.log('===============================================');
            console.log('💬 WhatsApp client is ready! 💬');
            console.log('Bot is now online and ready to receive messages');
            console.log('===============================================');
        });

        client.on('authenticated', () => {
            console.log('WhatsApp client is authenticated!');
        });

        client.on('auth_failure', (msg) => {
            console.error('WhatsApp authentication failed:', msg);
            console.log('Try deleting the .wwebjs_auth directory and restart the application');
        });

        client.on('disconnected', (reason) => {
            console.log('WhatsApp client disconnected:', reason);
            console.log('Attempting to restart client...');
            // Attempt to restart client when disconnected
            client.initialize().catch(e => {
                console.error('Failed to restart after disconnect:', e);
                process.exit(1);
            });
        });

        // Log all message arrivals to ensure we're receiving them
        client.on('message_create', (message) => {
            console.log('MESSAGE_CREATE EVENT FIRED');
            console.log(`Message ID: ${message.id.id}`);
            console.log(`From: ${message.from}`);
            console.log(`Body: ${message.body}`);
        });

        // Log message acknowledgements
        client.on('message_ack', (message, ack) => {
            console.log(`Message ACK event: ${message.body.substring(0, 20)}... - ACK: ${ack}`);
        });

        client.on('message', async msg => {
            // Ignore group messages or messages from self
            if (msg.from.includes('@g.us') || msg.fromMe) {
                return;
            }
            
            console.log(`Received message from ${msg.from}: ${msg.body.substring(0, 100)}...`);
            
            try {
                // Special command to reload tools
                if (msg.body.toLowerCase().trim() === '/reload' || msg.body.toLowerCase().trim() === '/reload tools') {
                    console.log('Command received: /reload');
                    
                    await msg.reply('🔄 Attempting to reload tools from API...');
                    const reloadSuccess = await veyraxClient.reloadTools();
                    
                    if (reloadSuccess) {
                        await msg.reply('✅ Tools reloaded successfully!');
                    } else {
                        await msg.reply('❌ Failed to reload tools. Please check logs for details.');
                    }
                    return;
                }
                
                // Special command to test a specific tool
                if (msg.body.toLowerCase().startsWith('/test-tool')) {
                    console.log('Command received: /test-tool');
                    const parts = msg.body.split(' ');
                    
                    if (parts.length < 3) {
                        await msg.reply('⚠️ Usage: /test-tool <tool> <method> [params JSON]');
                        return;
                    }
                    
                    const tool = parts[1];
                    const method = parts[2];
                    let params = {};
                    
                    // Try to parse params if provided
                    if (parts.length > 3) {
                        try {
                            // Join the rest of the parts back together as a JSON string
                            const paramsJson = parts.slice(3).join(' ');
                            params = JSON.parse(paramsJson);
                        } catch (error) {
                            await msg.reply('⚠️ Invalid JSON parameters. Please provide valid JSON.');
                            return;
                        }
                    }
                    
                    await msg.reply(`🔧 Testing tool ${tool}.${method}...`);
                    
                    try {
                        const result = await veyraxClient.callTool(tool, method, params);
                        await msg.reply(`✅ Tool call success! Result:\n\n${JSON.stringify(result, null, 2)}`);
                    } catch (error) {
                        console.error('Error testing tool:', error);
                        await msg.reply(`❌ Tool call failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                    
                    return;
                }
                
                // Special command to list available tools
                if (msg.body.toLowerCase().trim() === '/tools' || msg.body.toLowerCase().trim() === '/test') {
                    console.log('Command received: /tools or /test');
                    // Fetch tools directly
                    try {
                        const response = await fetch(`${process.env.VEYRAX_URL || 'https://veyraxapp.com'}/get-tools`, {
                            method: 'GET',
                            headers: {
                                'Content-Type': 'application/json',
                                'VEYRAX_API_KEY': process.env.VEYRAX_API_KEY || ''
                            }
                        });
                        
                        if (!response.ok) {
                            await msg.reply(`Error fetching tools: ${response.status} ${response.statusText}`);
                            return;
                        }
                        
                        const data = await response.json() as { tools?: Record<string, any> };
                        const tools = data.tools || {};
                        const toolCount = Object.keys(tools).length;
                        
                        // Format a nice message with the available tools
                        let toolsMessage = `*🔧 Available Tools: ${toolCount}*\n\n`;
                        
                        if (toolCount === 0) {
                            // If no tools are returned from the API, show a default list of known tools
                            toolsMessage = `*🔧 Available Tools*\n\n`;
                            toolsMessage += `*google-docs* - Google Docs integration\n`;
                            toolsMessage += `  • list_documents\n`;
                            toolsMessage += `  • get_document_content\n`;
                            toolsMessage += `  • create_document\n\n`;
                            
                            toolsMessage += `*google-calendar* - Calendar integration\n`;
                            toolsMessage += `  • list_events\n`;
                            toolsMessage += `  • create_event\n`;
                            toolsMessage += `  • get_event\n\n`;
                            
                            toolsMessage += `*gmail* - Email integration\n`;
                            toolsMessage += `  • list_emails\n`;
                            toolsMessage += `  • send_email\n`;
                            toolsMessage += `  • search_emails\n\n`;
                            
                            toolsMessage += `*tavily* - Web search\n`;
                            toolsMessage += `  • search\n`;
                            toolsMessage += `  • search_with_sources\n\n`;
                            
                            toolsMessage += `Note: Tools may appear empty due to API connectivity. All tools should work when used.`;
                        } else {
                            // Display tools returned from the API
                            Object.keys(tools).forEach(toolName => {
                                const methods = tools[toolName].methods || {};
                                const methodCount = Object.keys(methods).length;
                                
                                toolsMessage += `*${toolName}* - ${methodCount} methods\n`;
                                
                                // List the first 3 methods as examples
                                const methodNames = Object.keys(methods).slice(0, 3);
                                methodNames.forEach(methodName => {
                                    toolsMessage += `  • ${methodName}\n`;
                                });
                                
                                if (Object.keys(methods).length > 3) {
                                    toolsMessage += `  • ... and ${Object.keys(methods).length - 3} more\n`;
                                }
                                
                                toolsMessage += '\n';
                            });
                        }
                        
                        toolsMessage += 'Ask me anything about your documents, calendar, emails, or to search the web!';
                        
                        await msg.reply(toolsMessage);
                        return;
                    } catch (error) {
                        console.error('Error fetching tools:', error);
                        await msg.reply('Error fetching available tools. Please try again later.');
                        return;
                    }
                }
                
                // Process regular messages
                const response = await veyraxClient.processMessage(msg.body, msg.from);
                console.log(`Sending reply to ${msg.from}: ${response.substring(0, 100)}...`);
                
                const reply = await msg.reply(response);
                console.log(`Reply sent with ID: ${reply.id._serialized}`);
            } catch (error) {
                console.error('Error processing message:', error);
                
                try {
                    await msg.reply('Sorry, I encountered an error processing your message. Please try again later.');
                } catch (replyError) {
                    console.error('Failed to send error reply:', replyError);
                }
            }
        });

        // Add a debug event to see ALL events from WhatsApp
        client.on('change_state', state => {
            console.log('WHATSAPP CLIENT STATE CHANGED TO:', state);
        });
        
        client.on('change_battery', batteryInfo => {
            console.log('BATTERY INFO CHANGED:', batteryInfo);
        });
        
        // Debug ANY event coming in
        const oldEmit = client.emit;
        client.emit = function() {
            console.log('⚡ EVENT:', arguments[0]);
            // @ts-ignore
            return oldEmit.apply(this, arguments);
        };

        // Handle process termination signals
        process.on('SIGINT', async () => {
            console.log('Received SIGINT. Closing WhatsApp client...');
            await client.destroy();
            process.exit(0);
        });
        
        process.on('SIGTERM', async () => {
            console.log('Received SIGTERM. Closing WhatsApp client...');
            await client.destroy();
            process.exit(0);
        });

        // Initialize WhatsApp client
        console.log('Initializing WhatsApp client...');
        await client.initialize();
        console.log('WhatsApp client initialization completed successfully');
        
        // Test the VeyraX connection
        console.log('Testing connection to VeyraX API...');
        await veyraxClient.testConnection();
        
        // Add a retry for tool loading if needed
        let retryCount = 0;
        const maxRetries = 3;
        const retryToolLoading = async () => {
            try {
                retryCount++;
                console.log(`Attempting to load tools (attempt ${retryCount} of ${maxRetries})...`);
                await veyraxClient.testConnection();
                
                // Wait 3 seconds between retries
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (error) {
                console.error(`Tool loading retry ${retryCount} failed:`, error);
            }
        };
        
        // Check if we should retry loading tools (we'll do this if the VEYRAX_RETRY_TOOLS env var is set)
        if (process.env.VEYRAX_RETRY_TOOLS === 'true' || process.env.VEYRAX_RETRY_TOOLS === '1') {
            console.log('VEYRAX_RETRY_TOOLS is enabled, will attempt to retry tool loading if needed');
            // We'll do the retries in the background after startup completes
            setTimeout(async () => {
                while (retryCount < maxRetries) {
                    await retryToolLoading();
                }
            }, 5000);
        }
        
        // Send a test message to verify functionality
        client.on('ready', async () => {
            try {
                // Wait 5 seconds after ready to ensure fully connected
                console.log('Waiting 5 seconds before sending test message...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                console.log('Sending self-test message...');
                // Send a message to yourself - replace with your number if needed
                const selfChat = await client.getChatById(client.info.wid._serialized);
                await selfChat.sendMessage('🤖 WhatsApp bot is now ONLINE and ready to process messages!');
                console.log('Self-test message sent successfully!');
            } catch (error) {
                console.error('Failed to send self-test message:', error);
            }
        });
        
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

// Start the application
main().catch(error => {
    console.error('Application failed to start:', error);
    process.exit(1);
}); 