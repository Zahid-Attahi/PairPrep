export default {
  fetch(request: Request): Response {
    const path = new URL(request.url).pathname
    if (request.method === 'GET' && path === '/api/integrations') {
      return Response.json({ mode: 'pairprep-local-mock' })
    }
    if (request.method === 'POST') {
      switch (path) {
        case '/api/integrations/email/send':
          return Response.json({ success: true, data: {} })
        case '/api/integrations/openai/chat-completion':
          return Response.json({
            success: true,
            data: { choices: [{ message: { content: 'Mock coach: Which value would complete the target, and how could you look it up efficiently?' } }] },
          })
        case '/api/integrations/exa/search':
          return Response.json({
            success: true,
            data: { results: [{ title: 'Mock research result: JavaScript Map', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map' }] },
          })
      }
    }
    return Response.json({ error: 'This endpoint has no local mock.' }, { status: 404 })
  },
}
