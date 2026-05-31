import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({path: '.env.local'})

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function test() {
  const { data, error } = await supabase.from('customers').select('*').limit(1)
  console.log('Data:', data)
  console.log('Error:', error)
}
test()
