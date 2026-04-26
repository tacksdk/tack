import { afterEach, describe, expect, it, vi } from 'vitest'
import { submit, TackError } from '../headless'

const ENDPOINT = 'https://api.example.test'

function mockFetchOnce(json: unknown, status = 200) {
  const fake = {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Err',
    text: async () => JSON.stringify(json),
  }
  vi.stubGlobal('fetch', vi.fn(async () => fake as unknown as Response))
}

describe('headless submit()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts feedback without any prior init step', async () => {
    mockFetchOnce({ id: 'fbk_1', url: 'x', created_at: 'now' })
    const result = await submit({
      projectId: 'proj_test',
      endpoint: ENDPOINT,
      body: 'hello headless',
    })
    expect(result).toEqual({ id: 'fbk_1', url: 'x', created_at: 'now' })
  })

  it('throws when projectId is missing or non-string', async () => {
    await expect(
      submit({ projectId: '', body: 'x' } as unknown as Parameters<typeof submit>[0]),
    ).rejects.toThrow(/projectId/)
  })

  it('throws when body is missing or empty', async () => {
    await expect(
      submit({ projectId: 'proj_test', body: '' }),
    ).rejects.toThrow(/non-empty body/)
  })

  it('rejects with TackError on a server error envelope', async () => {
    mockFetchOnce(
      {
        error: {
          type: 'rate_limited',
          message: 'Slow down',
          doc_url: 'https://tacksdk.com/docs/tack/errors/rate_limited',
        },
      },
      429,
    )
    try {
      await submit({ projectId: 'proj_test', endpoint: ENDPOINT, body: 'hi' })
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(TackError)
      expect((err as TackError).type).toBe('rate_limited')
      expect((err as TackError).status).toBe(429)
    }
  })

  it('two consecutive calls can target different projects (no shared state)', async () => {
    const fakeOk = {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ id: 'a', url: 'u', created_at: 'now' }),
    }
    const fetchSpy = vi.fn(async () => fakeOk as unknown as Response)
    vi.stubGlobal('fetch', fetchSpy)

    await submit({ projectId: 'proj_one', endpoint: ENDPOINT, body: 'a' })
    await submit({ projectId: 'proj_two', endpoint: ENDPOINT, body: 'b' })

    const calls = fetchSpy.mock.calls as unknown as Array<[string, RequestInit]>
    const bodyOne = JSON.parse(calls[0][1].body as string)
    const bodyTwo = JSON.parse(calls[1][1].body as string)
    expect(bodyOne.projectId).toBe('proj_one')
    expect(bodyTwo.projectId).toBe('proj_two')
  })
})
