// api/auth/login.js
// Handle user login/signup with Supabase

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { email, password, action } = req.body

  try {
    if (action === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      })
      
      if (error) throw error
      
      return res.status(200).json({ 
        user: data.user,
        session: data.session 
      })
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      
      if (error) throw error
      
      return res.status(200).json({ 
        user: data.user,
        session: data.session 
      })
    }
  } catch (error) {
    return res.status(400).json({ error: error.message })
  }
}
