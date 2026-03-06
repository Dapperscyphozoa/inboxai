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
      
      // Detect priority/urgency
      const urgencyKeywords = ['urgent', 'asap', 'immediate', 'emergency', 'critical', 'deadline', 'today', 'now'];
      const isPriority = urgencyKeywords.some(keyword => 
        subject.toLowerCase().includes(keyword) || body.toLowerCase().includes(keyword)
      );

      // Get user's custom instructions and signature
      const customInstructions = userStyle || '';
      const signature = '\n\n' + (customInstructions.signature || '');

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

      // Get custom response settings
      const responseCount = (customInstructions && customInstructions.responseCount) ? parseInt(customInstructions.responseCount) : 6;
      const customStyles = (customInstructions && customInstructions.customStyles) ? customInstructions.customStyles.split('\n').filter(s => s.trim()) : [];
      
      // Build response instructions (simpler approach)
      const defaultStyles = ['Professional', 'Concise', 'Detailed', 'Friendly', 'Direct', 'Casual', 'Consultative', 'Enthusiastic', 'Minimal'];
      const stylesToUse = customStyles.length > 0 ? customStyles : defaultStyles;
      
      // Generate AI responses with user's style and custom instructions
      const aiResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: `You are ghostwriting an email response. Write like a real human, not an AI.

From: ${from}
Subject: ${subject}
${isPriority ? 'PRIORITY: This email is URGENT - acknowledge urgency in response' : ''}

Email to respond to:
${body.substring(0, 1000)}

${userWritingStyle}

${customInstructions ? `CUSTOM INSTRUCTIONS (ALWAYS FOLLOW THESE):\n${customInstructions.openInstructions || customInstructions.custom || ''}\n` : ''}

CRITICAL RULES:
- NO pleasantries like "Thank you for reaching out" or "I hope this email finds you well"  
- NO corporate jargon
- Be direct and natural
- DO NOT include signature - it will be added automatically

Generate ${responseCount} different response options.

Return ONLY valid JSON with NO markdown, NO code blocks, NO extra text:
{"responses": [{"label": "Style1", "text": "response1"}, {"label": "Style2", "text": "response2"}]}

Make each response different in tone and length.`
        }]
      })
      
      const responseText = aiResponse.content[0].text
      let aiResponses
      
      try {
        // Remove markdown code blocks if present
        let cleanText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        // Try to find JSON object
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiResponses = JSON.parse(jsonMatch[0]);
        } else {
          aiResponses = JSON.parse(cleanText);
        }
        
        // Validate structure
        if (!aiResponses.responses || !Array.isArray(aiResponses.responses)) {
          throw new Error('Invalid response structure');
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError, 'Raw text:', responseText);
        // Create fallback responses
        aiResponses = {
          responses: [
            {
              label: "Professional",
              text: "I'll get back to you shortly with a detailed response."
            },
            {
              label: "Quick Reply",
              text: "Thanks for reaching out. Let me review this and respond soon."
            },
            {
              label: "Detailed",
              text: "Thank you for your message. I've received your inquiry and will provide a comprehensive response within 24 hours."
            }
          ]
        };
      }

      // Add signature to all responses
      if (signature.trim()) {
        aiResponses.responses = aiResponses.responses.map(r => ({
          ...r,
          text: r.text + signature
        }));
      }
      
      emailsWithResponses.push({
        id: message.id,
        threadId: email.data.threadId,
        from,
        subject,
        body: body.substring(0, 500),
        aiResponses: aiResponses.responses || [],
        priority: isPriority
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
