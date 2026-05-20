import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mmzigliyulzwvqmlqhmx.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1temlnbGl5dWx6d3ZxbWxxaG14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNjMwNDcsImV4cCI6MjA5NDgzOTA0N30.pZGwuWq6sXZStoroG0B9izpIRD_Cs1rqa1wz84kusSQ';

export const db = createClient(SUPABASE_URL, SUPABASE_ANON);
