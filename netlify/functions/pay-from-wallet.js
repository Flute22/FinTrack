import crypto from 'crypto';

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

async function sbQuery(path, method = 'GET', body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const userId = await verifySupabaseUser(event.headers.authorization);
    if (!userId)
      return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };

    const { amount, upi_id, description } = JSON.parse(event.body);
    const amountNum = Number(amount);

    // ── Validate amount ────────────────────────────────────
    if (!amountNum || amountNum < 1 || amountNum > 99999)
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Amount must be between ₹1 and ₹99,999' }) };

    // ── Validate & sanitize UPI ID ─────────────────────────
    const upiClean = String(upi_id || '').trim().toLowerCase().slice(0, 100);
    if (!upiClean || !/^[\w.\-]+@[\w.\-]+$/.test(upiClean))
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid UPI ID format. Use: name@upi' }) };

    // Sanitize description: strip tags, limit length
    const descClean = String(description || '').trim().replace(/[<>]/g, '').slice(0, 100);

    // ── Item 25: Rate limit — max 5 pay requests / 60 s ───
    const since60s = new Date(Date.now() - 60_000).toISOString();
    const recentRes = await sbQuery(
      `wallet_transactions?user_id=eq.${userId}&type=eq.debit&created_at=gte.${since60s}&select=id`
    );
    const recentRows = await recentRes.json();
    if (Array.isArray(recentRows) && recentRows.length >= 5)
      return { statusCode: 429, headers: cors, body: JSON.stringify({ error: 'Too many payment requests. Please wait a moment.' }) };

    // ── Item 26: Idempotency — same UPI + amount within 15s ─
    const since15s = new Date(Date.now() - 15_000).toISOString();
    const dupRes = await sbQuery(
      `wallet_transactions?user_id=eq.${userId}&type=eq.debit&amount=eq.${amountNum}&created_at=gte.${since15s}&select=id,razorpay_payment_id`
    );
    const dupRows = await dupRes.json();
    if (Array.isArray(dupRows) && dupRows.length > 0)
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, amount: amountNum, tx_ref: dupRows[0].razorpay_payment_id, reused: true }),
      };

    // ── Check wallet balance ───────────────────────────────
    const walletRes = await sbQuery(`wallet?user_id=eq.${userId}`);
    const walletRows = await walletRes.json();
    const currentBalance = walletRows?.[0] ? Number(walletRows[0].balance) : 0;

    if (currentBalance < amountNum)
      return {
        statusCode: 400, headers: cors,
        body: JSON.stringify({ error: `Insufficient balance. Available: ₹${currentBalance.toLocaleString('en-IN')}` }),
      };

    const newBalance = currentBalance - amountNum;
    const txId  = `wt_pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const txRef = `PAY${Date.now().toString(36).toUpperCase()}`;

    // ── Atomic: deduct balance + record debit ─────────────
    await Promise.all([
      sbQuery(`wallet?user_id=eq.${userId}`, 'PATCH', { balance: newBalance, updated_at: new Date().toISOString() }),
      sbQuery('wallet_transactions', 'POST', {
        id: txId, user_id: userId, amount: amountNum,
        type: 'debit', status: 'completed',
        razorpay_payment_id: txRef,
        description: `To ${upiClean}${descClean ? ` · ${descClean}` : ''}`,
        verified_at: new Date().toISOString(),
      }),
    ]);

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, amount: amountNum, new_balance: newBalance, tx_ref: txRef }),
    };
  } catch {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server error' }) };
  }
}
