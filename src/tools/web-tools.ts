import axios from 'axios'
import * as cheerio from 'cheerio'
import { PermissionManager } from '../permissions.js'

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export class WebTools {
  private readonly userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  private permissionManager: PermissionManager;

  constructor(permissionManager: PermissionManager) {
    this.permissionManager = permissionManager;
  }

  async fetch(url: string): Promise<string> {
    // Request permission before making network request
    const permission = await this.permissionManager.requestPermission({
      action: 'network_request',
      resource: url,
      details: 'Fetching web page content'
    });

    if (!permission.allowed) {
      throw new Error(`Permission denied: Cannot fetch ${url}`);
    }

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.userAgent
        },
        timeout: 10000
      })
      return response.data
    } catch (error) {
      throw new Error(`Failed to fetch ${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async fetchText(url: string): Promise<string> {
    try {
      const html = await this.fetch(url)
      const $ = cheerio.load(html)
      
      // Remove script and style elements
      $('script, style').remove()
      
      // Get text content
      return $('body').text().replace(/\s+/g, ' ').trim()
    } catch (error) {
      throw new Error(`Failed to extract text from ${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async search(query: string, maxResults: number = 10): Promise<string[]> {
    try {
      // Use DuckDuckGo HTML search (no API key required)
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ResearchBot/1.0)'
        },
        timeout: 10000
      })

      const $ = cheerio.load(response.data)
      const results: string[] = []

      // Extract search results from DuckDuckGo HTML
      $('.result').each((index, element) => {
        if (index >= maxResults) return false

        const titleEl = $(element).find('.result__a')
        const snippetEl = $(element).find('.result__snippet')
        const url = titleEl.attr('href')
        const title = titleEl.text().trim()
        const snippet = snippetEl.text().trim()

        if (title && snippet) {
          results.push(`**${title}**\n${snippet}\n${url || ''}`)
        }
      })

      if (results.length === 0) {
        return [`No results found for: "${query}"`]
      }

      return results
    } catch (error) {
      console.error('Web search failed:', error instanceof Error ? error.message : String(error))
      return [`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}. Try using web_fetch with a specific URL instead.`]
    }
  }

  extractLinks(html: string, baseUrl?: string): string[] {
    try {
      const $ = cheerio.load(html)
      const links: string[] = []
      
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href')
        if (href) {
          if (baseUrl && href.startsWith('/')) {
            links.push(new URL(href, baseUrl).toString())
          } else if (href.startsWith('http')) {
            links.push(href)
          }
        }
      })
      
      return links
    } catch (error) {
      throw new Error(`Failed to extract links: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  extractMetadata(html: string): Record<string, string> {
    try {
      const $ = cheerio.load(html)
      const metadata: Record<string, string> = {}
      
      // Extract title
      metadata.title = $('title').text().trim()
      
      // Extract meta tags
      $('meta').each((_, element) => {
        const name = $(element).attr('name') || $(element).attr('property')
        const content = $(element).attr('content')
        
        if (name && content) {
          metadata[name] = content
        }
      })
      
      return metadata
    } catch (error) {
      throw new Error(`Failed to extract metadata: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}