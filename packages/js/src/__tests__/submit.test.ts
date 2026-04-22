import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { init, reset, submit, TackError } from '../index'

const ENDPOINT = 'https://api.example.test'

interface FetchMockInit {
  ok?: boolean
  status?: number
  statusText?: string
  json?: unknown
  text?: string
}

function mockFetchOnce(response: FetchMockInit) {
  const body = response.text ?? (response.json !== undefined ? JSON.stringify(response.json) : '')
  const fake = {
    ok: response.ok ?? true,
    status: response.status ?? 200,
    statusText: response.statusText ?? 'OK',
    text: async () => body,
  }
  vi.stubGlobal('fetch', vi.fn(async () => fake as unknown as Response))
}

describe('submit', () => {
  beforeEach(() => {
    reset()
    init({ projectId: 'proj_test', endpoint: ENDPOINT })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    reset()
  })

  it('posts to /v1/feedback with the configured projectId and Idempotency-Key', async () => {
    const fakeRes = {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'now' }),
    }
    const fetchSpy = vi.fn(async () => fakeRes as unknown as Response)
    vi.stubGlobal('fetch', fetchSpy)

    const result = await submit({ body: 'hello' })

    expect(result).toEqual({ id: 'fbk_1', url: 'x', created_at: 'now' })
    const call = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(call[0]).toBe(`${ENDPOINT}/v1/feedback`)
    const init2 = call[1] as RequestInit
    expect(init2.method).toBe('POST')
    const headers = init2.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Idempotency-Key']).toBeTruthy()
    const parsed = JSON.parse(init2.body as string)
    expect(parsed.projectId).toBe('proj_test')
    expect(parsed.body).toBe('hello')
  })

  it('throws TackError with typed error envelope on 4xx', async () => {
    mockFetchOnce({
      ok: false,
      status: 429,
      json: { error: { type: 'rate_limited', message: 'slow down', doc_url: 'u' } },
    })

    await expect(submit({ body: 'x' })).rejects.toMatchObject({
      name: 'TackError',
      type: 'rate_limited',
      status: 429,
    })
  })

  it('throws TackError with type=internal_error when body is not a valid envelope', async () => {
    mockFetchOnce({ ok: false, status: 500, text: 'oops' })
    const err = await submit({ body: 'x' }).catch((e: TackError) => e)
    expect(err).toBeInstanceOf(TackError)
    expect((err as TackError).type).toBe('internal_error')
  })

  it('requires init before submit', async () => {
    reset()
    await expect(submit({ body: 'x' })).rejects.toThrow(/init/)
  })

  it('requires a non-empty body', async () => {
    await expect(submit({ body: '' } as unknown as { body: string })).rejects.toThrow(/body/)
  })

  it('uses a user-provided idempotency key when supplied', async () => {
    const fakeRes = {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ id: 'fbk_1', url: 'x', created_at: 'now' }),
    }
    const fetchSpy = vi.fn(async () => fakeRes as unknown as Response)
    vi.stubGlobal('fetch', fetchSpy)

    await submit({ body: 'hi', idempotencyKey: 'my-key-123' })

    const headers = ((fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBe('my-key-123')
  })
})
