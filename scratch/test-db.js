const SUPABASE_URL = 'https://mmzigliyulzwvqmlqhmx.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1temlnbGl5dWx6d3ZxbWxxaG14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjMwNDcsImV4cCI6MjA5NDgzOTA0N30.pZGwuWq6sXZStoroG0B9izpIRD_Cs1rqa1wz84kusSQ';

async function test() {
  try {
    // Check if we can query transactions or other tables using Anon Key (might be blocked by RLS if not authenticated)
    for (const table of ['transactions', 'budgets', 'prefs', 'wishlist']) {
      const url = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
      const res = await fetch(url, {
        headers: {
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`
        }
      });
      if (res.ok) {
        console.log(`${table} data:`, await res.json());
      } else {
        console.log(`${table} failed with status:`, res.status);
      }
    }
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

test();
