# Multi-Account Setup Guide

## Problem
The 429 errors occur because the free tier Google account has exhausted its daily quota (~50-100 requests/day).

## Solution
Add multiple Google accounts to automatically rotate between them when one hits the quota limit.

## Quick Start

### 1. Add Additional Accounts

Run the built-in CLI command to add more Google accounts:

```bash
bun run src/main.ts add-account
```

This will:
- Open your browser for Google login
- Authenticate the new account
- Automatically add it to the rotation pool
- Save to `~/.anti-api/accounts.json`

Repeat this command for each additional account you want to add.

### 2. Check Current Accounts

The script will show all configured accounts. You can also check manually:

```bash
cat ~/.anti-api/accounts.json
```

### 3. Start the Server

The server will automatically use account rotation:

```bash
./anti-api-start.command
# or
bun run src/main.ts start
```

## How It Works

- When a request fails with 429 (quota exhausted), the system automatically switches to the next account
- Each account is marked as rate-limited for 60 seconds after a 429 error
- When all accounts are rate-limited, the system waits for the earliest one to become available
- Tokens are automatically refreshed when they expire

## Free Tier Limits

- **Free tier**: ~50-100 requests/day per account
- **Google AI Pro**: 1,500 requests/day
- **Quota resets**: Daily at midnight Pacific Time

## Tips

1. **Use multiple Google accounts** - Create 5-10 free Gmail accounts for 500-1000 requests/day total
2. **Wait for quota reset** - If you run out temporarily, quotas reset daily
3. **Upgrade to Google AI Pro** - Get 1,500 requests/day per account ($19.99/month)

## Troubleshooting

### All accounts showing 429
- All accounts have exhausted their daily quota
- Wait for quota reset (midnight PT)
- Add more accounts

### Account not working
- Check if the account has Antigravity/Gemini enabled
- Try logging into https://gemini.google.com with the account first
- Re-run `bun run src/main.ts add-account` to add the account again
