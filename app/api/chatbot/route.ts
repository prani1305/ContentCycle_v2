import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Initialize OpenAI client
let openai: OpenAI;

try {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
  });
} catch (error) {
  console.error('Failed to initialize OpenAI client:', error);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, currentContent, platform, originalInput, conversationHistory = [] } = body;

    if (!message || !currentContent) {
      return NextResponse.json(
        { error: 'Message and current content are required' },
        { status: 400 }
      );
    }

    // Handle case where currentContent is an object (e.g. from ThemeCard)
    let processedContent = currentContent;
    if (typeof currentContent !== 'string') {
      if (typeof currentContent === 'object' && currentContent !== null) {
        // Try to extract text from common fields
        processedContent = currentContent.content ||
          currentContent.text ||
          currentContent.message ||
          currentContent.tweet ||
          currentContent.linkedin_post ||
          currentContent.instagram_post ||
          currentContent.short_blog ||
          currentContent.email ||
          currentContent.youtube_script ||
          currentContent.carousel ||
          JSON.stringify(currentContent, null, 2);
      } else {
        processedContent = String(currentContent);
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'API configuration error: OPENAI_API_KEY not set' },
        { status: 500 }
      );
    }

    // Build conversation context with reference to original input
    const systemPrompt = `You are an expert content editor specialized in ${platform || 'social media'} content. 
Your job is to modify the provided content based on user requests while maintaining the core message and value from the ORIGINAL INPUT.

${originalInput ? `ORIGINAL INPUT CONTENT (for reference):
---
${originalInput.substring(0, 2000)}
${originalInput.length > 2000 ? '... [truncated]' : ''}
---

CRITICAL: Always refer back to the original input content when making modifications. Ensure your changes align with the original message, tone, and intent while applying the requested modifications.` : ''}

Always return your response in JSON format with two fields:
1. "reply": A conversational response explaining what changes you made, referencing the original input when relevant
2. "modifiedContent": The updated content with the requested changes applied
3. "scores": An object containing 4 scores (0-100) for the modified content: "clarity", "tone", "structure", "length". Be STRICT with scoring. High scores (>80) should only be given for exceptional content.

IMPORTANT:
- Reference the original input content to maintain consistency with the source material
- Maintain the original intent and key messages from the original input
- Apply the requested changes naturally while staying true to the original content
- Keep the content appropriate for ${platform || 'the platform'}
- If the user asks for clarification, ask follow-up questions in the reply
- Always return valid JSON`;

    const messages: any[] = [
      {
        role: "system",
        content: systemPrompt
      }
    ];

    // Add conversation history
    conversationHistory.forEach((msg: any) => {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.role === 'assistant'
          ? `Previously I said: "${msg.content}". Here's the modified content: "${msg.modifiedContent || ''}"`
          : msg.content
      });
    });

    // Add current request with reference to original
    let userPrompt = `Current generated content to modify:\n\n${processedContent}\n\n`;
    if (originalInput) {
      userPrompt += `Remember: The original input content serves as your reference for maintaining consistency with the source material.\n\n`;
    }
    userPrompt += `User request: ${message}\n\nPlease modify the content according to the request, keeping in mind the original input content and maintaining its core message and intent. Return the result in JSON format with "reply", "modifiedContent", and "scores" fields.`;

    messages.push({
      role: "user",
      content: userPrompt
    });

    console.log('Calling OpenAI for content modification...');

    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: messages,
      response_format: { type: "json_object" },
      max_tokens: 2000,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(content);
    } catch (e) {
      // If response is not valid JSON, wrap it
      parsedResponse = {
        reply: content,
        modifiedContent: processedContent
      };
    }

    // Ensure we have both fields
    const result = {
      reply: parsedResponse.reply || parsedResponse.response || "I've made the requested changes to your content.",
      modifiedContent: parsedResponse.modifiedContent || parsedResponse.updatedContent || processedContent,
      scores: parsedResponse.scores || { clarity: 70, tone: 70, structure: 70, length: 70 }
    };

    // Ensure modifiedContent is a string
    if (typeof result.modifiedContent !== 'string') {
      if (typeof result.modifiedContent === 'object' && result.modifiedContent !== null) {
        // Check for Slide/Carousel format
        const keys = Object.keys(result.modifiedContent);
        const hasSlides = keys.some(k => k.toLowerCase().includes('slide'));

        if (hasSlides) {
          result.modifiedContent = keys.sort().map(key => {
            const slide = result.modifiedContent[key];
            if (typeof slide === 'object' && slide !== null) {
              const slideContent = Object.entries(slide)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n');
              return `${key.toUpperCase()}:\n${slideContent}`;
            }
            return `${key}: ${slide}`;
          }).join('\n\n---\n\n');
        } else {
          result.modifiedContent = result.modifiedContent.content ||
            result.modifiedContent.text ||
            JSON.stringify(result.modifiedContent, null, 2);
        }
      } else {
        result.modifiedContent = String(result.modifiedContent);
      }
    }

    console.log('Content modification completed');
    return NextResponse.json(result);

  } catch (error: any) {
    console.error('Chatbot API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to process your request: ' + (error.message || 'Unknown error'),
        reply: "I apologize, but I encountered an error processing your request. Please try again.",
        modifiedContent: null
      },
      { status: 500 }
    );
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

