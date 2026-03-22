require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const http = require('http');

// Environment Variables
const token = process.env.TELEGRAM_BOT_TOKEN;
const siteApiToken = process.env.SITE_BOT_API_TOKEN;
const siteUrl = process.env.SITE_URL || 'https://tmovie.in'; 
const mongoUri = process.env.MONGODB_URI;
const adminTgId = process.env.ADMIN_TG_ID;
const port = process.env.PORT || 5050; // Added port for Koyeb health check

// This simple server is for Koyeb/Render health checks
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('Bot is running');
    res.end();
}).listen(port, () => {
    console.log(`Health check server is listening on port ${port}`);
});

if (!token || !siteApiToken || !mongoUri || !adminTgId) {
    console.error("Missing required environment variables. Please check your .env file.");
    process.exit(1);
}

// Bot Startup Time
const botStartTime = Date.now();

// MongoDB Setup
const client = new MongoClient(mongoUri);
let db;
let allowedDomainsCollection;
let usersCollection;

async function connectMongo() {
    try {
        await client.connect();
        db = client.db('tmovie_bot');
        allowedDomainsCollection = db.collection('allowed_domains');
        usersCollection = db.collection('users');
        console.log("Connected to MongoDB successfully.");
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
        process.exit(1);
    }
}
connectMongo();

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

// Cache for movies and series
let catalogCache = [];
let lastFetchTime = 0;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

async function getCatalog() {
    const now = Date.now();
    if (catalogCache.length > 0 && (now - lastFetchTime < CACHE_DURATION_MS)) {
        return catalogCache;
    }
    
    try {
        const response = await fetch(`${siteUrl}/botapi?token=${siteApiToken}`);
        if (!response.ok) return catalogCache; 
        
        const data = await response.json();
        if (data.status === 'success' && data.catalog) {
            catalogCache = data.catalog;
            lastFetchTime = now;
        }
    } catch (error) {
        console.error("Error fetching catalog from site:", error);
    }
    return catalogCache;
}

getCatalog(); // Pre-fetch

async function isUserAdmin(chatId, userId) {
    if (userId.toString() === adminTgId) return true;
    try {
        const member = await bot.getChatMember(chatId, userId);
        return ['administrator', 'creator'].includes(member.status);
    } catch (e) {
        return false;
    }
}

function getUptime() {
    let totalSeconds = Math.floor((Date.now() - botStartTime) / 1000);
    let days = Math.floor(totalSeconds / 86400);
    totalSeconds %= 86400;
    let hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    let minutes = Math.floor(totalSeconds / 60);
    let seconds = totalSeconds % 60;
    
    let uptimeStr = "";
    if (days > 0) uptimeStr += `${days}d `;
    if (hours > 0) uptimeStr += `${hours}h `;
    if (minutes > 0) uptimeStr += `${minutes}m `;
    uptimeStr += `${seconds}s`;
    
    return uptimeStr || "0s";
}

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text || "";

    // Save/Update User in DB
    try {
        if (msg.from && !msg.from.is_bot) {
            await usersCollection.updateOne(
                { userId },
                { 
                    $set: { 
                        userId, 
                        firstName: msg.from.first_name, 
                        username: msg.from.username,
                        lastActive: new Date() 
                    },
                    $setOnInsert: { joinedAt: new Date() }
                },
                { upsert: true }
            );
        }
    } catch (err) {
        console.error("Failed to save user info to DB:", err);
    }

    const isAdmin = await isUserAdmin(chatId, userId);

    // COMMAND: /start
    if (text.startsWith('/start')) {
        if (isAdmin) {
            const totalUsers = await usersCollection.countDocuments();
            const uptime = getUptime();
            const adminMsg = `👋 Welcome Admin!

🤖 Bot is running successfully.
You have Admin Access to manage the bot.

⚙️ Admin Controls:
• Broadcast Message (/broadcast replying to a message)
• Manage Domains (/adddomain, /allowdomain)

📊 Bot Status:
Users: ${totalUsers}
Uptime: Active ✅ (${uptime})`;

            return bot.sendMessage(chatId, adminMsg);
        } else {
            const promoMsg = `🚨🔥 This is 𝗕𝗔𝗖𝗞𝗨𝗣 𝗖𝗛𝗔𝗡𝗡𝗘𝗟 — 𝗠𝗨𝗦𝗧 𝗝𝗢𝗜𝗡 🔥🚨
🎬 Movies • 📺 Series • ⚡️ Instant Updates • 🎯 Requests

━━━━━━━━━━━━━━━━━━━━━━━
📢 𝗟𝗔𝗧𝗘𝗦𝗧 𝗨𝗣𝗗𝗔𝗧𝗘𝗦 𝗖𝗛𝗔𝗡𝗡𝗘𝗟
🚀 New Movies & Series First Here
👇👇 JOIN NOW 👇👇
https://t.me/+D4copzHym8Q4ZDM9

━━━━━━━━━━━━━━━━━━━━━━━
🎯 𝗥𝗘𝗤𝗨𝗘𝗦𝗧 𝗔𝗡𝗬 𝗠𝗢𝗩𝗜𝗘 / 𝗦𝗘𝗥𝗜𝗘𝗦
💬 Send Your Requests Anytime
👇👇 JOIN NOW 👇👇
https://t.me/+TYFPD96hMqU1NTRl

━━━━━━━━━━━━━━━━━━━━━━━
⚠️ Backup Channel — Don't Miss Updates
🔥 Fast Uploads
🍿 HD Movies & Web Series
📥 Direct Links
🚀 Daily Updates

💀 Join Fast Before Links Get Removed!`;

            return bot.sendMessage(chatId, promoMsg, { disable_web_page_preview: true });
        }
    }

    // COMMAND: /help
    if (text.startsWith('/help')) {
        if (!isAdmin) return;
        
        const helpMsg = `📖 **TMovie Bot Admin Help**

Here are the commands available for you:

• \`/start\` - View admin dashboard, total users, and bot uptime.
• \`/broadcast\` - Send a message to ALL users. 
  *(Usage: Reply to any message you want to send with /broadcast)*
• \`/adddomain [domain]\` - Add a domain to the allowed list (e.g., \`/adddomain google.com\`).
• \`/allowdomain\` - View the list of all whitelisted domains.
• \`/help\` - Show this help menu.

⚠️ **Note:** These commands are only accessible to the bot admin.`;

        return bot.sendMessage(chatId, helpMsg, { parse_mode: "Markdown" });
    }

    // COMMAND: /broadcast
    if (text.startsWith('/broadcast')) {
        if (!isAdmin) return;
        
        if (!msg.reply_to_message) {
            return bot.sendMessage(chatId, "⚠️ Please reply to a message with /broadcast to send it to all users.");
        }

        const allUsers = await usersCollection.find({}).toArray();
        if (allUsers.length === 0) {
            return bot.sendMessage(chatId, "No users found in database.");
        }

        let progressMsg = await bot.sendMessage(chatId, `⏳ Broadcast started...\nTotal Target: ${allUsers.length} users\nProgress: 0%`);

        let successCount = 0;
        let failCount = 0;
        const totalUsers = allUsers.length;

        for (let i = 0; i < totalUsers; i++) {
            const user = allUsers[i];
            
            try {
                await bot.copyMessage(user.userId, chatId, msg.reply_to_message.message_id);
                successCount++;
            } catch (err) {
                failCount++;
            }

            // Small delay to prevent rate limits
            await new Promise(r => setTimeout(r, 35));

            // Update progress every 50 users or at exactly 25% 50% 75% to avoid rate limits on editing
            if ((i + 1) % 50 === 0) {
                const percent = Math.floor(((i + 1) / totalUsers) * 100);
                try {
                    await bot.editMessageText(`⏳ Broadcasting in progress...\nSuccess: ${successCount} | Failed: ${failCount}\nProgress: ${percent}%`, {
                        chat_id: chatId,
                        message_id: progressMsg.message_id
                    });
                } catch (e) { /* Ignore edit limits */ }
            }
        }

        return bot.editMessageText(`✅ **Broadcast Completed!**\n\nTotal Users: ${totalUsers}\nSuccessfully Sent: ${successCount}\nFailed: ${failCount}`, {
            chat_id: chatId,
            message_id: progressMsg.message_id,
            parse_mode: "Markdown"
        });
    }

    // COMMAND: /adddomain <domain>
    if (text.startsWith('/adddomain')) {
        if (!isAdmin) return;
        const args = text.split(' ');
        if (args.length < 2) return bot.sendMessage(chatId, "Usage: /adddomain example.com");
        const domain = args[1].toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
        
        await allowedDomainsCollection.updateOne({ domain }, { $set: { domain, addedAt: new Date() } }, { upsert: true });
        return bot.sendMessage(chatId, `Domain ${domain} added to the allowed list.`);
    }

    // COMMAND: /allowdomain
    if (text === '/allowdomain') {
        if (!isAdmin) return;
        const domains = await allowedDomainsCollection.find({}).toArray();
        if (domains.length === 0) return bot.sendMessage(chatId, "No domains are currently allowed.");
        const list = domains.map(d => `- ${d.domain}`).join('\n');
        return bot.sendMessage(chatId, `Allowed Domains:\n${list}`);
    }

    // ANTI-SPAM LINK FILTER
    const hasUrlEntity = msg.entities && msg.entities.some(e => e.type === 'url' || e.type === 'text_link');
    if (hasUrlEntity && !isAdmin) {
        let containsUnauthorizedLink = false;
        const urlsToCheck = [];
        for (const entity of msg.entities) {
            if (entity.type === 'url') {
                urlsToCheck.push(text.substring(entity.offset, entity.offset + entity.length));
            } else if (entity.type === 'text_link') {
                urlsToCheck.push(entity.url);
            }
        }

        const allowedDb = await allowedDomainsCollection.find({}).toArray();
        const allowedList = allowedDb.map(d => d.domain);

        for (const urlStr of urlsToCheck) {
            try {
                const parsedUrl = new URL(urlStr.startsWith('http') ? urlStr : `http://${urlStr}`);
                const host = parsedUrl.hostname.toLowerCase();
                const isAllowed = allowedList.some(d => host === d || host.endsWith(`.${d}`));
                if (!isAllowed) {
                    containsUnauthorizedLink = true;
                    break; 
                }
            } catch (e) {
                containsUnauthorizedLink = true;
                break;
            }
        }

        if (containsUnauthorizedLink) {
            try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) {}
            return; 
        }
    }

    // MOVIE/SERIES SEARCH LOGIC
    if (!text || text.length < 3 || text.startsWith('/')) return; 

    const normalizedText = text.toLowerCase().trim();
    const catalog = await getCatalog();
    const sortedCatalog = [...catalog].sort((a, b) => b.name.length - a.name.length);

    let matchedItem = null;

    for (const item of sortedCatalog) {
        if (item.name.length <= 2) {
            if (normalizedText === item.name.toLowerCase()) {
                matchedItem = item;
                break;
            }
        } else {
            if (normalizedText.includes(item.name.toLowerCase())) {
                matchedItem = item;
                break;
            }
        }
    }

    if (matchedItem) {
        bot.sendMessage(
            chatId, 
            `Here is the link for ${matchedItem.name}:\n${matchedItem.url}`, 
            { reply_to_message_id: msg.message_id }
        );
    }
});

console.log("TMovie Telegram Bot is running...");
