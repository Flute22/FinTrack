import crypto from 'crypto';

const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function verifySupabaseUser(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_KEY },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.id || null;
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  return res.json();
}

async function sbPost(path, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  // ── Env guard ──────────────────────────────────────────
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET)
    return { statusCode: 503, headers: cors, body: JSON.stringify({ error: 'Payment gateway not configured.' }) };

  try {
    const userId = await verifySupabaseUser(event.headers.authorization);
    if (!userId)
      return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };

    const { amount } = JSON.parse(event.body);
    const amountNum = Number(amount);
    if (!amountNum || amountNum < 1 || amountNum > 99999)
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Amount must be between ₹1 and ₹99,999' }) };

    const amountPaise = Math.round(amountNum * 100);
    const since60s    = new Date(Date.now() - 60_000).toISOString();
    const since15s    = new Date(Date.now() - 15_000).toISOString();

    // ── Item 25: Rate limit — max 5 pending orders / 60 s ──
    const recentAll = await sbGet(
      `wallet_transactions?user_id=eq.${userId}&status=eq.pending&created_at=gte.${since60s}&select=id`
    );
    if (Array.isArray(recentAll) && recentAll.length >= 5)
      return { statusCode: 429, headers: cors, body: JSON.stringify({ error: 'Too many requests. Please wait a moment and try again.' }) };

    // ── Item 26: Idempotency — same amount within 15 s ─────
    const recentDup = await sbGet(
      `wallet_transactions?user_id=eq.${userId}&status=eq.pending&amount=eq.${amountNum}&created_at=gte.${since15s}&select=id,razorpay_order_id`
    );
    if (Array.isArray(recentDup) && recentDup.length > 0 && recentDup[0].razorpay_order_id) {
      // Return existing order so the same Razorpay checkout can be resumed
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: recentDup[0].razorpay_order_id,
          amount: amountPaise,
          currency: 'INR',
          tx_id: recentDup[0].id,
          reused: true,
        }),
      };
    }

    // ── Create Razorpay order ──────────────────────────────
    const receiptId = `rcpt_${userId.slice(0, 8)}_${Date.now()}`;
    const auth      = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    const rzpRes    = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: receiptId, notes: { user_id: userId } }),
    });

    if (!rzpRes.ok)
      return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Payment gateway error. Please try again.' }) };

    const order = await rzpRes.json();

    // ── Record pending transaction ─────────────────────────
    const txId = `wt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await sbPost('wallet_transactions', {
      id: txId, user_id: userId, amount: amountNum,
      type: 'credit', status: 'pending', razorpay_order_id: order.id,
    });

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order.id, amount: amountPaise, currency: 'INR', tx_id: txId }),
    };
  } catch {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server error' }) };
  }
}
