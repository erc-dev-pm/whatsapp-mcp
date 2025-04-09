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
            process.env.VEYRAX_API_KEY || '',
            process.env.USER_TIMEZONE || 'Asia/Singapore'
        );

        // Set up WhatsApp event handlers
        client.on('qr', (qr) => {
            console.log('QR Code received, generating...');
            qrcode.generate(qr, { small: true });
            console.log('Scan the QR code above with WhatsApp');
        });

        client.on('ready', () => {
            console.log('WhatsApp client is ready!');
        });

        client.on('message', async (message) => {
            try {
                // Ignore messages from groups
                if (message.from.includes('@g.us')) {
                    return;
                }

                console.log('Received message:', message.body);
                
                const response = await veyraxClient.processMessage(message.body, message.from);

                await message.reply(response);
            } catch (error) {
                console.error('Error processing message:', error);
                await message.reply('Sorry, I encountered an error while processing your message. Please try again.');
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