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
let settingsCollection;

// Auto Request State (in-memory, loaded from DB on startup)
let autoRequestEnabled = false;

async function connectMongo() {
    try {
        await client.connect();
        db = client.db('tmovie_bot');
        allowedDomainsCollection = db.collection('allowed_domains');
        usersCollection = db.collection('users');
        settingsCollection = db.collection('settings');
        
        // Load auto-request setting from DB
        const setting = await settingsCollection.findOne({ key: 'auto_request' });
        if (setting) autoRequestEnabled = setting.enabled;
        console.log(`Connected to MongoDB successfully. Auto-Request: ${autoRequestEnabled ? 'ON' : 'OFF'}`);
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
        process.exit(1);
    }
}
connectMongo();

// Create a bot and explicitly allow chat_join_request updates
const bot = new TelegramBot(token, { 
    polling: {
        params: {
            allowed_updates: ["message", "callback_query", "chat_join_request", "my_chat_member"]
        }
    }
});

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

    // Save User in DB (only if not already exists)
    try {
        if (msg.from && !msg.from.is_bot) {
            await usersCollection.updateOne(
                { userId },
                { 
                    $setOnInsert: { 
                        userId, 
                        firstName: msg.from.first_name, 
                        username: msg.from.username,
                        joinedAt: new Date() 
                    }
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
• Manage Domains (/adddomain, /removedomain, /allowdomain)
• Chat Management (/clearchat, /lockchat, /unlockchat)
• Auto Request (/autorequest) - ${autoRequestEnabled ? '🟢 ON' : '🔴 OFF'}

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
🎯 磐𝗘𝗤𝗨𝗘𝗦𝗧 𝗔𝗡𝗬 𝗠𝗢𝗩𝗜𝗘 / 𝗦𝗘𝗥𝗜𝗘𝗦
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

📢 **User Management**
• \`/broadcast\` - *Use Case:* Send announcements to ALL users. (Reply to a message with /broadcast).

🛑 **Anti-Spam (Domain List)**
• \`/adddomain [domain]\` - *Use Case:* Whitelist a domain so its links are NOT deleted.
• \`/removedomain\` - *Use Case:* Remove a domain from whitelist.
• \`/allowdomain\` - *Use Case:* Check all whitelisted domains.

🛠️ **Group Management**
• \`/clearchat\` - *Use Case:* Delete last 100 messages in a group.
• \`/lockchat\` - *Use Case:* Restrict group to Admin Only messaging.
• \`/unlockchat\` - *Use Case:* Allow everyone to send messages.

🤖 **Auto Request**
• \`/autorequest\` - *Use Case:* Toggle auto-approve for join requests. When ON, bot auto-approves all join requests, saves users to DB, and sends them a welcome DM. Also shows all channels/groups where bot is admin.

📊 **Stats**
• \`/start\` - *Use Case:* View Admin Dashboard and bot uptime.
• \`/help\` - *Use Case:* Show this guide.

⚠️ **Note:** Admin only commands.`;

        return bot.sendMessage(chatId, helpMsg, { parse_mode: "Markdown" });
    }

    // COMMAND: /clearchat
    if (text === '/clearchat') {
        if (!isAdmin) return;
        
        const targetMessageId = msg.message_id;
        let deletedCount = 0;
        
        bot.sendMessage(chatId, "🧹 Clearing chat... (Last 100 messages)").then(async (statusMsg) => {
            for (let i = 0; i < 100; i++) {
                try {
                    await bot.deleteMessage(chatId, targetMessageId - i);
                    deletedCount++;
                } catch (e) {
                    // Ignore errors for messages already deleted or too old
                }
            }
            bot.sendMessage(chatId, `✅ Successfully cleared ${deletedCount} messages.`);
        });
        return;
    }

    // COMMAND: /lockchat
    if (text === '/lockchat') {
        if (!isAdmin) return;

        try {
            const chat = await bot.getChat(chatId);
            // Permissions check - if can_send_messages is false, it's already locked for members
            if (chat.permissions && chat.permissions.can_send_messages === false) {
                return bot.sendMessage(chatId, "Chat Already Locked", { reply_to_message_id: msg.message_id });
            }

            await bot.setChatPermissions(chatId, {
                can_send_messages: false,
                can_send_media_messages: false,
                can_send_polls: false,
                can_send_other_messages: false,
                can_add_web_page_previews: false,
                can_change_info: false,
                can_invite_users: false,
                can_pin_messages: false
            });
            return bot.sendMessage(chatId, "🔒 Chat is now LOCKED for members.");
        } catch (e) {
            console.error("Lock error:", e);
            return bot.sendMessage(chatId, "⚠️ Failed to lock chat. Make sure bot is an Admin.");
        }
    }

    // COMMAND: /unlockchat
    if (text === '/unlockchat') {
        if (!isAdmin) return;

        try {
            const chat = await bot.getChat(chatId);
            if (chat.permissions && chat.permissions.can_send_messages === true) {
                return bot.sendMessage(chatId, "Chat Already Unlocked", { reply_to_message_id: msg.message_id });
            }

            await bot.setChatPermissions(chatId, {
                can_send_messages: true,
                can_send_media_messages: true,
                can_send_polls: true,
                can_send_other_messages: true,
                can_add_web_page_previews: true,
                can_invite_users: true
            });
            return bot.sendMessage(chatId, "🔓 Chat is now UNLOCKED for everyone.");
        } catch (e) {
            console.error("Unlock error:", e);
            return bot.sendMessage(chatId, "⚠️ Failed to unlock chat.");
        }
    }

    // COMMAND: /removedomain
    if (text === '/removedomain') {
        if (!isAdmin) return;
        
        const domains = await allowedDomainsCollection.find({}).toArray();
        if (domains.length === 0) {
            return bot.sendMessage(chatId, "No domains are currently allowed to remove.");
        }

        const keyboard = domains.map(d => ([{
            text: `❌ ${d.domain}`,
            callback_data: `remove_domain:${d.domain}`
        }]));

        // Add Cancel Button
        keyboard.push([{ text: "◀️ Cancel", callback_data: "cancel_remove" }]);

        return bot.sendMessage(chatId, "Select a domain to remove from whitelisted list:", {
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    }

    // COMMAND: /autorequest
    if (text === '/autorequest') {
        if (!isAdmin) return;

        const statusText = autoRequestEnabled ? '🟢 Currently: ON' : '🔴 Currently: OFF';
        return bot.sendMessage(chatId, `🤖 **Auto Request Approve System**\n\n${statusText}\n\nSelect an option:`, {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ Auto Request ON", callback_data: "autoreq_on" }],
                    [{ text: "❌ Auto Request OFF", callback_data: "autoreq_off" }],
                    [{ text: "📋 All Channels & Groups", callback_data: "autoreq_list" }],
                    [{ text: "◀️ Cancel", callback_data: "autoreq_cancel" }]
                ]
            }
        });
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

// Callback Query Handler
bot.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const userId = query.from.id;

    // --- Cancel Buttons ---
    if (data === 'cancel_remove' || data === 'autoreq_cancel') {
        try {
            await bot.deleteMessage(chatId, query.message.message_id);
            return bot.answerCallbackQuery(query.id, { text: "Action Cancelled" });
        } catch (e) {
            return bot.answerCallbackQuery(query.id);
        }
    }

    // --- Domain Removal ---
    if (data.startsWith('remove_domain:')) {
        const isAdmin = await isUserAdmin(chatId, userId);
        if (!isAdmin) {
            return bot.answerCallbackQuery(query.id, { text: "⚠️ Unauthorized", show_alert: true });
        }

        const domain = data.split(':')[1];
        try {
            const result = await allowedDomainsCollection.deleteOne({ domain });
            if (result.deletedCount > 0) {
                await bot.answerCallbackQuery(query.id, { text: "Domain Remove Successfully" });
                await bot.editMessageText(`✅ **${domain}** removed successfully.`, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: "Markdown"
                });
            } else {
                await bot.answerCallbackQuery(query.id, { text: "Domain not found", show_alert: true });
            }
        } catch (e) {
            console.error("Error removing domain:", e);
            await bot.answerCallbackQuery(query.id, { text: "Error deleting domain", show_alert: true });
        }
    }

    // --- Auto Request ON ---
    if (data === 'autoreq_on') {
        const isAdmin = await isUserAdmin(chatId, userId);
        if (!isAdmin) return bot.answerCallbackQuery(query.id, { text: "⚠️ Unauthorized", show_alert: true });

        autoRequestEnabled = true;
        await settingsCollection.updateOne({ key: 'auto_request' }, { $set: { key: 'auto_request', enabled: true } }, { upsert: true });
        await bot.answerCallbackQuery(query.id, { text: "Auto Request is now ON" });
        return bot.editMessageText(`🤖 **Auto Request Approve System**\n\n🟢 Status: **ON**\n\nBot will now auto-approve all pending join requests and send a welcome DM to new users.`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown"
        });
    }

    // --- Auto Request OFF ---
    if (data === 'autoreq_off') {
        const isAdmin = await isUserAdmin(chatId, userId);
        if (!isAdmin) return bot.answerCallbackQuery(query.id, { text: "⚠️ Unauthorized", show_alert: true });

        autoRequestEnabled = false;
        await settingsCollection.updateOne({ key: 'auto_request' }, { $set: { key: 'auto_request', enabled: false } }, { upsert: true });
        await bot.answerCallbackQuery(query.id, { text: "Auto Request is now OFF" });
        return bot.editMessageText(`🤖 **Auto Request Approve System**\n\n🔴 Status: **OFF**\n\nBot will NOT auto-approve join requests anymore.`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown"
        });
    }

    // --- All Channels & Groups List ---
    if (data === 'autoreq_list') {
        const isAdmin = await isUserAdmin(chatId, userId);
        if (!isAdmin) return bot.answerCallbackQuery(query.id, { text: "⚠️ Unauthorized", show_alert: true });

        await bot.answerCallbackQuery(query.id, { text: "Fetching list..." });

        // We get bot's admin channels from the updates it has received (stored in DB)
        // Since Telegram API doesn't provide a direct "list my chats" for bots,
        // we track chats where bot receives messages.
        try {
            // Get unique chats the bot has interacted with from the users collection
            // We search for group/supergroup/channel chats tracked in a separate collection
            let botChatsCollection = db.collection('bot_chats');
            const chats = await botChatsCollection.find({}).toArray();

            if (chats.length === 0) {
                return bot.editMessageText(`📋 **All Channels & Groups**\n\nNo channels or groups tracked yet. Bot will start tracking once it receives messages in groups/channels.`, {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: "Markdown"
                });
            }

            let listText = `📋 **All Channels & Groups where Bot is active:**\n\n`;
            for (const c of chats) {
                const link = c.username ? `https://t.me/${c.username}` : '(Private - No Link)';
                const typeIcon = c.type === 'channel' ? '📢' : '👥';
                listText += `${typeIcon} **${c.title}** - ${link}\n`;
            }

            return bot.editMessageText(listText, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: "Markdown",
                disable_web_page_preview: true
            });
        } catch (e) {
            console.error("Error fetching bot chats:", e);
            return bot.editMessageText(`❌ Error fetching channels list.`, {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        }
    }
});

// --- Track Bot's Groups/Channels for /autorequest "All Channels" feature ---
// This is the BEST way to track which chats the bot is in
bot.on('my_chat_member', async (update) => {
    const chat = update.chat;
    const status = update.new_chat_member.status;

    try {
        const botChatsCollection = db.collection('bot_chats');
        
        if (status === 'administrator' || status === 'creator' || status === 'member') {
            // Bot was added or promoted
            await botChatsCollection.updateOne(
                { chatId: chat.id },
                { $set: {
                    chatId: chat.id,
                    title: chat.title,
                    type: chat.type,
                    username: chat.username || null,
                    status: status,
                    lastUpdated: new Date()
                }},
                { upsert: true }
            );
            console.log(`[TRACK] Bot is active in ${chat.type}: ${chat.title}`);
        } else if (status === 'left' || status === 'kicked') {
            // Bot was removed
            await botChatsCollection.deleteOne({ chatId: chat.id });
            console.log(`[TRACK] Bot was removed from ${chat.type}: ${chat.title}`);
        }
    } catch (e) {
        console.error("Error in my_chat_member tracking:", e);
    }
});

// Also keep message-based tracking as a backup for existing chats
bot.on('message', async (msg) => {
    if (msg.chat && (msg.chat.type === 'group' || msg.chat.type === 'supergroup' || msg.chat.type === 'channel')) {
        try {
            const botChatsCollection = db.collection('bot_chats');
            await botChatsCollection.updateOne(
                { chatId: msg.chat.id },
                { $set: {
                    chatId: msg.chat.id,
                    title: msg.chat.title,
                    type: msg.chat.type,
                    username: msg.chat.username || null,
                    lastSeen: new Date()
                }},
                { upsert: true }
            );
        } catch (e) {}
    }
});

// --- Auto Request Approve: chat_join_request Event ---
bot.on('chat_join_request', async (request) => {
    const reqChatId = request.chat.id;
    const reqUserId = request.from.id;
    const firstName = request.from.first_name || '';
    const username = request.from.username || null;

    console.log(`[JOIN REQUEST] User: ${firstName} (${reqUserId}) in Chat: ${request.chat.title}`);

    if (!autoRequestEnabled) {
        console.log(`[JOIN REQUEST] Skipping approval for ${reqUserId} because Auto-Request is OFF.`);
        return;
    }

    try {
        // Approve the join request
        await bot.approveChatJoinRequest(reqChatId, reqUserId);
        console.log(`[JOIN REQUEST] ✅ Approved: ${firstName} (${reqUserId})`);

        // Save user to MongoDB (only if not already exists)
        await usersCollection.updateOne(
            { userId: reqUserId },
            {
                $setOnInsert: {
                    userId: reqUserId,
                    firstName: firstName,
                    username: username,
                    joinedAt: new Date(),
                    joinedVia: request.chat.title
                }
            },
            { upsert: true }
        );

        // Send Welcome DM to the user
        const welcomeDM = `🚨🔥 This is 𝗕𝗔𝗖𝗞𝗨𝗣 𝗖𝗛𝗔𝗡𝗡𝗘𝗟 — 𝗠𝗨𝗦𝗧 𝗝𝗢𝗜𝗡 🔥🚨
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

        try {
            await bot.sendMessage(reqUserId, welcomeDM, { disable_web_page_preview: true });
        } catch (dmErr) {
            // User may have not started the bot, can't send DM
            console.log(`Could not DM user ${reqUserId}: ${dmErr.message}`);
        }

    } catch (err) {
        console.error(`Failed to approve join request for ${reqUserId}:`, err.message);
    }
});

console.log("TMovie Telegram Bot is running...");
