import { afterEach, describe, expect, it, vi } from 'vitest'
import { postFeedback } from '../transport'

const ENDPOINT = 'https://api.example.test'
const REQ = {
  projectId: 'proj_test',
  body: 'hi',
  url: 'https://host.test/',
  userAgent: 'jsdom',
  viewport: '800x600',
}

const okResponse = () =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({ id: 'fb_x', url: 'u', created_at: 'now' }),
  }) as unknown as Response

describe('postFeedback request URL', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('appends projectId as a query string param so cross-origin preflight resolves the project', async () => {
    // Server's CORS preflight reads projectId from the URL — preflight has no
    // body to read. Without this, every cross-origin call gets blocked by the
    // browser even when the origin IS allowlisted.
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        return okResponse()
      }),
    )
    await postFeedback({ endpoint: ENDPOINT, body: REQ })
    expect(calls[0]).toBe('https://api.example.test/api/v1/feedback?projectId=proj_test')
  })

  it('url-encodes projectId so the SDK does not silently depend on proj_ charset', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        return okResponse()
      }),
    )
    await postFeedback({
      endpoint: ENDPOINT,
      body: { ...REQ, projectId: 'proj with space&amp' },
    })
    expect(calls[0]).toBe(
      'https://api.example.test/api/v1/feedback?projectId=proj%20with%20space%26amp',
    )
  })
})
