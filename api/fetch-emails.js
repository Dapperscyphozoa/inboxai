// api/fetch-emails.js
// Fetch emails from Gmail and generate AI responses with user's communication style

import { google } from 'googleapis'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { accessToken, userStyle, tonePreference } = req.body

  try {
    // Initialize Gmail API
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: accessToken })
    
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
    
    // Fetch user's sent emails to learn their style
    let userWritingStyle = ''
    if (!userStyle) {
      const sentResponse = await gmail.users.messages.list({
        userId: 'me',
        q: 'in:sent',
        maxResults: 5
      })
      
      if (sentResponse.data.messages) {
        const sentBodies = []
        for (const msg of sentResponse.data.messages.slice(0, 3)) {
          const email = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full'
          })
          
          let body = ''
          if (email.data.payload.parts) {
            const textPart = email.data.payload.parts.find(p => p.mimeType === 'text/plain')
            if (textPart?.body?.data) {
              body = Buffer.from(textPart.body.data, 'base64').toString('utf-8')
              sentBodies.push(body)
            }
          }
        }
        
        if (sentBodies.length > 0) {
          userWritingStyle = `\n\nMIMIC THIS WRITING STYLE (use similar tone, formality, sentence length, word choice):\n${sentBodies.join('\n---\n')}`
        }
      }
    } else {
      userWritingStyle = `\n\nMIMIC THIS WRITING STYLE: ${userStyle}`
    }
    
    // Fetch unread emails
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 10
    })
    
    const messages = response.data.messages || []
    const emailsWithResponses = []
    
    // Process each email
    for (const message of messages) {
      const email = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'full'
      })
      
      const headers = email.data.payload.headers
      const subject = headers.find(h => h.name === 'Subject')?.value || ''
      const from = headers.find(h => h.name === 'From')?.value || ''
      
      // Get email body
      let body = ''
      if (email.data.payload.parts) {
        const textPart = email.data.payload.parts.find(p => p.mimeType === 'text/plain')
        if (textPart && textPart.body.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf-8')
        }
      } else if (email.data.payload.body.data) {
        body = Buffer.from(email.data.payload.body.data, 'base64').toString('utf-8')
      }
      
      // Define tone variations
      const tones = {
        professional: 'Professional and polished, suitable for business contexts',
        friendly: 'Warm and approachable while maintaining professionalism',
        casual: 'Relaxed and conversational, like talking to a colleague',
        formal: 'Highly professional and respectful, suitable for executives',
        enthusiastic: 'Energetic and positive, showing genuine interest',
        concise: 'Brief and to-the-point, respecting their time'
      }
      
      const selectedTone = tonePreference || 'professional'
      
      // Generate AI responses with user's style
      const aiResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `You are writing an email response that matches the USER'S personal communication style.

From: ${from}
Subject: ${subject}

Email to respond to:
${body.substring(0, 1000)}

${userWritingStyle}

Generate 3 response options with these specific tones:
1. ${tones[selectedTone]} (matching user's style)
2. More concise version (matching user's style) 
3. More detailed version (matching user's style)

CRITICAL: Write EXACTLY how this user writes. Match their:
- Sentence structure and length
- Word choice and vocabulary  
- Level of formality
- Use of greetings/sign-offs
- Paragraph breaks
- Punctuation style
- Any unique phrases they use

Return ONLY valid JSON:
{
  "responses": [
    {"label": "${selectedTone.charAt(0).toUpperCase() + selectedTone.slice(1)} (Your Style)", "text": "full email response"},
    {"label": "Concise (Your Style)", "text": "full email response"},
    {"label": "Detailed (Your Style)", "text": "full email response"}
  ]
}`
        }]
      })
      
      const responseText = aiResponse.content[0].text
      let aiResponses
      
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/)
        aiResponses = JSON.parse(jsonMatch ? jsonMatch[0] : responseText)
      } catch {
        aiResponses = { responses: [] }
      }
      
      emailsWithResponses.push({
        id: message.id,
        threadId: email.data.threadId,
        from,
        subject,
        body: body.substring(0, 500),
        aiResponses: aiResponses.responses || []
      })
    }
    
    return res.status(200).json({ 
      emails: emailsWithResponses,
      detectedStyle: userWritingStyle ? 'Learned from your sent emails' : 'Using default'
    })
    
  } catch (error) {
    console.error('Email fetch error:', error)
    return res.status(500).json({ error: error.message })
  }
}
