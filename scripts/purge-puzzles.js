// One-off utility: delete every message in the configured PUZZLES_CHANNEL_ID
// using the bot's own token (requires Manage Messages + Read Message History).
// Usage: node scripts/purge-puzzles.js
import 'dotenv/config';

const API_URL = process.env.FLUXER_API_URL || 'https://api.canary.fluxer.app';
const TOKEN = process.env.FLUXER_BOT_TOKEN;
const CHANNEL_ID = process.env.PUZZLES_CHANNEL_ID;

if (!TOKEN || !CHANNEL_ID) {
  console.error('Missing FLUXER_BOT_TOKEN or PUZZLES_CHANNEL_ID in .env');
  process.exit(1);
}

const headers = {
  Authorization: `Bot ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function fetchBatch(before) {
  const qs = new URLSearchParams({ limit: '100' });
  if (before) qs.set('before', before);
  const res = await fetch(`${API_URL}/channels/${CHANNEL_ID}/messages?${qs}`, { headers });
  if (!res.ok) {
    throw new Error(`fetch messages failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function deleteMessage(id) {
  const res = await fetch(`${API_URL}/channels/${CHANNEL_ID}/messages/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    const retryMs = Math.ceil((body.retry_after || 1) * 1000);
    await new Promise((r) => setTimeout(r, retryMs));
    return deleteMessage(id);
  }
  if (!res.ok && res.status !== 404) {
    console.error(`  failed to delete ${id}: ${res.status} ${await res.text()}`);
    return false;
  }
  return true;
}

async function main() {
  let total = 0;
  let before;
  for (;;) {
    const batch = await fetchBatch(before);
    if (!batch.length) break;
    for (const msg of batch) {
      const ok = await deleteMessage(msg.id);
      if (ok) total++;
      await new Promise((r) => setTimeout(r, 300)); // stay well under rate limits
    }
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }
  console.log(`Deleted ${total} message(s) from channel ${CHANNEL_ID}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
