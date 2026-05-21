import crypto from 'crypto';

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
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

async function supabaseQuery(path, method, body) {
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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' };
  if (!RAZORPAY_KEY_SECRET)
    return { statusCode: 503, headers: cors, body: JSON.stringify({ error: 'Payment gateway not configured.' }) };

  try {
    const userId = await verifySupabaseUser(event.headers.authorization);
    if (!userId) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = JSON.parse(event.body);

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing payment details' }) };
    }

    const expectedSig = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    // Timing-safe comparison prevents timing-based signature oracle attacks
    const sigBuffer  = Buffer.from(razorpay_signature, 'hex');
    const expBuffer  = Buffer.from(expectedSig, 'hex');
    const sigValid   = sigBuffer.length === expBuffer.length && crypto.timingSafeEqual(sigBuffer, expBuffer);
    if (!sigValid) {
      await supabaseQuery(
        `wallet_transactions?razorpay_order_id=eq.${razorpay_order_id}&user_id=eq.${userId}`,
        'PATCH',
        { status: 'failed' }
      );
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid payment signature' }) };
    }

    const txRes = await supabaseQuery(
      `wallet_transactions?razorpay_order_id=eq.${razorpay_order_id}&user_id=eq.${userId}&status=eq.pending`,
      'PATCH',
      { status: 'completed', razorpay_payment_id, verified_at: new Date().toISOString() }
    );
    const txRows = await txRes.json();
    if (!txRows?.length) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Transaction not found or already processed' }) };
    }

    const creditAmount = Number(txRows[0].amount);

    const walletRes = await supabaseQuery(`wallet?user_id=eq.${userId}`, 'GET');
    const walletRows = await walletRes.json();

    if (walletRows?.length) {
      const newBalance = Number(walletRows[0].balance) + creditAmount;
      await supabaseQuery(`wallet?user_id=eq.${userId}`, 'PATCH', {
        balance: newBalance,
        updated_at: new Date().toISOString(),
      });
    } else {
      await supabaseQuery('wallet', 'POST', {
        user_id: userId,
        balance: creditAmount,
        updated_at: new Date().toISOString(),
      });
    }

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, amount: creditAmount }),
    };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server error' }) };
  }
}
