# TMovie Telegram Bot

This is a standalone Telegram bot designed to be hosted independently from the main TMovie Next.js frontend. 
It listens to messages in a Telegram Group and automatically replies with actual streaming links if a user explicitly mentions a movie or series title that is available on your site.

## How it works
The bot fetches the complete catalog of movies and series from your site's secure `/botapi` endpoint. It caches this list in-memory for 5 minutes.
When a user sends a message in the group containing a movie or series title, the bot cross-references the text with the cached catalog. If a match is found, it replies to the message with the direct site link.

## Deployment on render.com or koyeb.com

1. Create a new Web Service or Background Worker on Render/Koyeb.
2. Connect it to your GitHub repository (or upload this `Bot Code` folder directly).
3. Set the Root Directory to `Bot Code` (if deploying from the main repo).
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Set the following **Environment Variables**:
   * `TELEGRAM_BOT_TOKEN`: Your bot token given by BotFather in Telegram.
   * `SITE_BOT_API_TOKEN`: The token you generated in the TMovie Admin Dashboard -> Bot API Token tab.
   * `SITE_URL`: The full URL to your site (e.g. `https://yourdomain.com`).
   * `MONGODB_URI`: Your MongoDB connection string (e.g. `mongodb+srv://user:pass@cluster...`).
   * `ADMIN_TG_ID`: Your personal Telegram User ID (used for bot commands).

## Running Locally for Testing

1. Open a terminal in the `Bot Code` folder (`cd "Bot Code"`).
2. Run `npm install`.
3. Create a `.env` file in the `Bot Code` folder:
   ```env
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   SITE_BOT_API_TOKEN=your_generated_site_token
   SITE_URL=http://localhost:3000
   ```
4. Run `npm start`.
