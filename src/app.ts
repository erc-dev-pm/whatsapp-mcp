import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { VeyraXClient } from './veyrax';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        console.log('Starting application...');
        
        // Initialize WhatsApp client
        console.log('Creating WhatsApp client...');
        const client = new Client({
            authStrategy: new LocalAuth({
                dataPath: process.env.WHATSAPP_SESSION_DATA_PATH
            })
        });

        // Initialize VeyraX client
        console.log('Creating VeyraX client...');
        const veyraxClient = new VeyraXClient(
            process.env.OPENAI_API_KEY || '',
            process.env.VEYRAX_API_KEY || ''
        );

        // Set up WhatsApp event handlers
        client.on('qr', (qr) => {
            console.log('QR Code received, generating...');
            qrcode.generate(qr, { small: true });
            console.log('Scan the QR code above with WhatsApp');
        });

        client.on('ready', async () => {
            console.log('WhatsApp client is ready!');
            try {
                console.log('Initializing VeyraX tools...');
                await veyraxClient.initializeTools();
                console.log('VeyraX tools initialized successfully');
            } catch (error) {
                console.error('Failed to initialize VeyraX tools:', error);
            }
        });

        client.on('message', async msg => {
            // Only ignore messages from self
            // The bot responds to both direct messages and group chats (messages with @g.us in the from field)
            if (msg.fromMe) {
                return;
            }
            
            // Log the message type (group or direct) for debugging
            const isGroupMessage = msg.from.includes('@g.us');
            console.log(`Received ${isGroupMessage ? 'GROUP' : 'DIRECT'} message from ${msg.from}: ${msg.body.substring(0, 100)}...`);
            
            try {
                // Special command to reload tools
                if (msg.body.toLowerCase().trim() === '/reload' || msg.body.toLowerCase().trim() === '/reload tools') {
                    console.log('Command received: /reload');
                    
                    await msg.reply('🔄 Attempting to reload tools from API...');
                    try {
                        // Try the reloadTools method first, then fallback to initializeTools if available
                        if (typeof veyraxClient.reloadTools === 'function') {
                            const success = await veyraxClient.reloadTools();
                            if (success) {
                                await msg.reply('✅ Tools reloaded successfully!');
                            } else {
                                await msg.reply('❌ Failed to reload tools. Please check logs for details.');
                            }
                        } else if (typeof veyraxClient.initializeTools === 'function') {
                            await veyraxClient.initializeTools();
                            await msg.reply('✅ Tools reloaded successfully!');
                        } else {
                            console.error('No tool reload method found in VeyraXClient');
                            await msg.reply('❌ Tool reloading not supported in this version.');
                        }
                    } catch (error) {
                        console.error('Failed to reload tools:', error);
                        await msg.reply('❌ Failed to reload tools. Please check logs for details.');
                    }
                    return;
                }

                // Get userId and message content for processing
                // For group messages, we use the group ID as the userId
                const userId = msg.from;
                const messageContent = msg.body;
                
                // Process the message with VeyraX
                const response = await veyraxClient.processMessage(messageContent, userId);
                console.log(`Sending reply to ${msg.from}: ${response.substring(0, 100)}...`);
                
                await msg.reply(response);
            } catch (error) {
                console.error('Error processing message:', error);
                await msg.reply('Sorry, I encountered an error while processing your message. Please try again.');
            }
        });

        // Initialize WhatsApp client
        console.log('Initializing WhatsApp client...');
        await client.initialize();
        
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