/**
 * Agent Tool Service
 * Handles:
 * - Converting IAO APIs to LLM tool definitions
 * - Executing tool calls (calling IAO APIs)
 * - Managing API responses
 */

import fetch from 'node-fetch'
import { decompress as decompressZstd } from 'fzstd'
import { Agent } from './firestoreAgentService.js'
import { ToolDefinition, ToolCall } from './llmService.js'

export interface ApiParameter {
  name: string
  type: string
  required: boolean
  description?: string
  example?: string
}

export interface ApiEntry {
  index: number
  slug: string
  name: string
  description?: string
  apiUrl?: string
  fee: string
  method?: string  // HTTP method (GET, POST, etc.)
  parameters?: ApiParameter[]  // API parameters for POST body or GET query
  createdAt: string
}

export interface IaoServer {
  id: string
  slug: string
  name: string
  symbol: string
  builder: string
  paymentToken: string
  apis: ApiEntry[]
}

export interface ToolExecutionResult {
  toolCallId: string
  toolName: string
  success: boolean
  result?: any
  error?: string
}

export class AgentToolService {
  private baseUrl: string
  private backendUrl: string

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl
    this.backendUrl = baseUrl
  }

  /**
   * Fetch all available IAO servers and APIs
   */
  async fetchAvailableServers(): Promise<IaoServer[]> {
    try {
      const response = await fetch(`${this.backendUrl}/api/servers?limit=100`)

      if (!response.ok) {
        throw new Error(`Failed to fetch servers: ${response.status}`)
      }

      const data = (await response.json()) as any
      // Handle different response formats: data.servers (current), data.data (alternative), or raw array
      return (data.servers || data.data || data) as IaoServer[]
    } catch (error) {
      console.error('Error fetching available servers:', error)
      return []
    }
  }

  /**
   * Get tools available for a specific agent
   */
  async getToolsForAgent(agent: Agent): Promise<ToolDefinition[]> {
    try {
      // Fetch all available servers
      const servers = await this.fetchAvailableServers()

      // Filter APIs based on agent's availableTools list
      const tools: ToolDefinition[] = []

      for (const availableToolString of agent.availableTools) {
        const [serverSlug, apiSlug] = availableToolString.split('/')

        // Find the server and API
        const server = servers.find(s => s.slug.toLowerCase() === serverSlug.toLowerCase())
        if (!server) {
          console.warn(`Server not found: ${serverSlug}`)
          continue
        }

        const api = server.apis.find(a => a.slug.toLowerCase() === apiSlug.toLowerCase())
        if (!api) {
          console.warn(`API not found: ${serverSlug}/${apiSlug}`)
          continue
        }

        // Create tool definition
        const toolName = `call_${serverSlug}_${apiSlug}`.replace(/-/g, '_').toLowerCase()

        // Build comprehensive description including usage examples
        let description = `${api.name || api.slug} - ${api.description || 'No description available'}`
        const httpMethod = (api.method || 'GET').toUpperCase()

        // Build input schema based on API parameters and method
        let inputSchema: any

        if (api.parameters && api.parameters.length > 0) {
          // API has defined parameters - use them for the schema
          const properties: Record<string, any> = {}
          const required: string[] = []

          for (const param of api.parameters) {
            properties[param.name] = {
              type: param.type === 'number' ? 'number' : 'string',
              description: param.description || param.name
            }
            if (param.required) {
              required.push(param.name)
            }
          }

          // For POST APIs, wrap in a 'body' property to make it clear these go in the request body
          if (httpMethod === 'POST') {
            inputSchema = {
              type: 'object',
              properties: {
                body: {
                  type: 'object',
                  description: 'JSON body for the POST request',
                  properties,
                  required
                }
              },
              required: ['body']
            }
          } else {
            // For GET APIs, parameters become query params
            inputSchema = {
              type: 'object',
              properties,
              required
            }
          }
        } else {
          // No defined parameters - use generic query string for GET, empty body for POST
          if (httpMethod === 'POST') {
            inputSchema = {
              type: 'object',
              properties: {
                body: {
                  type: 'object',
                  description: 'JSON body for the POST request'
                }
              },
              required: []
            }
          } else {
            // Extract and highlight usage examples from description
            const usageMatch = api.description?.match(/usage example[s]?:?\s*(.+)/i)
            let queryDescription = 'Query parameters for the API call (e.g., "base=USD" or "latitude=52.52&longitude=13.41")'

            if (usageMatch) {
              const examples = usageMatch[1]
              queryDescription = `Query parameters for the API call. Examples from docs: ${examples.slice(0, 200)}`
            }

            inputSchema = {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: queryDescription
                }
              },
              required: []
            }
          }
        }

        const tool: ToolDefinition = {
          name: toolName,
          description: `${description}\nHTTP Method: ${httpMethod}\nFee: ${api.fee} wei`,
          input_schema: inputSchema
        }

        tools.push(tool)
      }

      console.log(`✅ Loaded ${tools.length} tools for agent ${agent.id}`)
      return tools
    } catch (error) {
      console.error('Error getting tools for agent:', error)
      return []
    }
  }

  /**
   * Get API information for payment option display
   * Returns API metadata needed for payment buttons
   */
  async getApiInfo(serverSlug: string, apiSlug: string): Promise<{
    name: string;
    description: string;
    fee: string;
    tokenAddress: string;
    method: string;
  }> {
    try {
      const servers = await this.fetchAvailableServers()
      const server = servers.find(s => s.slug.toLowerCase() === serverSlug.toLowerCase())

      if (!server) {
        throw new Error(`Server ${serverSlug} not found`)
      }

      const api = server.apis.find(a => a.slug.toLowerCase() === apiSlug.toLowerCase())

      if (!api) {
        throw new Error(`API ${apiSlug} not found in ${serverSlug}`)
      }

      return {
        name: api.name || api.slug,
        description: api.description || 'No description available',
        fee: api.fee,
        tokenAddress: server.id,
        method: api.method || 'GET'
      }
    } catch (error) {
      console.error('Error getting API info:', error)
      throw error
    }
  }

  /**
   * Execute a tool call (call the IAO API)
   * Returns the API response
   */
  async executeTool(
    toolCall: ToolCall,
    agent: Agent
  ): Promise<ToolExecutionResult> {
    try {
      // Parse tool name to get serverSlug and apiSlug
      // Tool name format: call_serverSlug_apiSlug
      const toolNameParts = toolCall.name.replace('call_', '').split('_')

      if (toolNameParts.length < 2) {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          success: false,
          error: `Invalid tool name format: ${toolCall.name}`
        }
      }

      // Reconstruct slug from parts (accounts for slugs with underscores)
      // For now, assume simple pattern: call_{serverSlug}_{apiSlug}
      const serverSlug = toolNameParts[0]
      const apiSlug = toolNameParts.slice(1).join('_')

      console.log(`🔧 Executing tool: ${toolCall.name} (${serverSlug}/${apiSlug})`)

      // Get API info to determine HTTP method
      const apiInfo = await this.getApiInfo(serverSlug, apiSlug)
      const httpMethod = (apiInfo.method || 'GET').toUpperCase()

      // Build the API URL
      const apiUrl = `${this.backendUrl}/api/${serverSlug}/${apiSlug}`

      // Prepare request options based on HTTP method
      let requestUrl = apiUrl
      let requestBody: string | undefined

      if (httpMethod === 'POST') {
        // For POST, use body parameter or direct input as JSON body
        let bodyData = toolCall.input?.body || {}

        // If input has a 'query' string (LLM used GET format for POST API), parse it into fields
        if (toolCall.input?.query && typeof toolCall.input.query === 'string') {
          console.log(`⚠️ LLM sent query string format for POST API - converting to JSON body`)
          const queryStr = toolCall.input.query.replace(/^\?/, '') // Remove leading ? if present
          const params = new URLSearchParams(queryStr)
          for (const [key, value] of params.entries()) {
            bodyData[key] = value
          }
        } else if (!toolCall.input?.body && toolCall.input) {
          // If no 'body' wrapper and input has other keys, use them directly
          const { query, body, ...rest } = toolCall.input
          if (Object.keys(rest).length > 0) {
            bodyData = { ...bodyData, ...rest }
          }
        }

        requestBody = JSON.stringify(bodyData)
        console.log(`🌐 Calling API (POST): ${apiUrl}`)
        console.log(`📦 Request body: ${requestBody}`)
      } else {
        // For GET, use query parameter or build from input
        let queryParam = ''
        if (toolCall.input?.query) {
          const query = toolCall.input.query.trim()
          queryParam = query.startsWith('?') ? query : `?${query}`
        } else if (toolCall.input && !toolCall.input.body) {
          // Build query string from input object (excluding 'body' and 'query' keys)
          const params = new URLSearchParams()
          for (const [key, value] of Object.entries(toolCall.input)) {
            if (key !== 'body' && key !== 'query' && value !== undefined) {
              params.append(key, String(value))
            }
          }
          const paramStr = params.toString()
          if (paramStr) {
            queryParam = `?${paramStr}`
          }
        }
        requestUrl = `${apiUrl}${queryParam}`
        console.log(`🌐 Calling API (GET): ${requestUrl}`)
      }

      // Call the IAO API with timeout
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      const response = await fetch(requestUrl, {
        method: httpMethod,
        headers: {
          'Content-Type': 'application/json'
        },
        body: requestBody,
        signal: controller.signal
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const errorData = await response.text()
        throw new Error(`API returned ${response.status}: ${errorData}`)
      }

      // Check if response is zstd compressed
      const contentEncoding = response.headers.get('content-encoding') || ''
      const contentType = response.headers.get('content-type') || ''
      let result: any

      if (contentEncoding.toLowerCase().includes('zstd')) {
        console.log(`🗜️  API response is zstd compressed - decompressing...`)
        try {
          // Get compressed data as buffer
          const compressedData = await response.arrayBuffer()
          const compressedBuffer = Buffer.from(compressedData)

          // Decompress
          const decompressedBuffer = decompressZstd(compressedBuffer)
          const decompressedText = Buffer.from(decompressedBuffer).toString('utf-8')

          // Parse as JSON
          result = JSON.parse(decompressedText)
          console.log(`✅ Successfully decompressed and parsed zstd response`)
        } catch (decompressError: any) {
          throw new Error(`Failed to decompress zstd response: ${decompressError.message}`)
        }
      } else {
        // Normal JSON parsing for uncompressed or gzip/deflate responses (handled by node-fetch)
        result = await response.json()
      }

      // Extract the actual data from response (handle both wrapper and direct formats)
      const apiData = (result as any)?.data || result

      console.log(`✅ Tool executed successfully: ${toolCall.name}`)

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: true,
        result: apiData
      }
    } catch (error: any) {
      console.error(`❌ Tool execution failed: ${toolCall.name}`, error)

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: false,
        error: error.message || 'Unknown error'
      }
    }
  }

  /**
   * Execute multiple tool calls sequentially
   */
  async executeTools(
    toolCalls: ToolCall[],
    agent: Agent
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = []

    for (const toolCall of toolCalls) {
      const result = await this.executeTool(toolCall, agent)
      results.push(result)

      // Add a small delay between calls to avoid rate limiting
      if (toolCalls.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    return results
  }

  /**
   * Format tool execution results as a string for LLM consumption
   * This will be passed back to the LLM to continue the conversation
   */
  formatToolResults(results: ToolExecutionResult[]): string {
    let output = ''

    for (const result of results) {
      if (result.success) {
        output += `\n✅ ${result.toolName}:\n${JSON.stringify(result.result, null, 2)}`
      } else {
        output += `\n❌ ${result.toolName}: ${result.error}`
      }
    }

    return output.trim()
  }

  /**
   * Validate that agent has access to a tool
   */
  hasToolAccess(agent: Agent, toolName: string): boolean {
    // Tool name format: call_serverSlug_apiSlug
    // Must match the same normalization used in getToolsForAgent (line 98)
    const availableTools = agent.availableTools.map(t =>
      `call_${t.replace('/', '_').replace(/-/g, '_')}`.toLowerCase()
    )

    return availableTools.includes(toolName.toLowerCase())
  }

  /**
   * Get fee for an API call (in wei)
   */
  async getApiCallFee(serverSlug: string, apiSlug: string): Promise<string> {
    const apiInfo = await this.getApiInfo(serverSlug, apiSlug)
    return apiInfo?.fee || '0'
  }
}
