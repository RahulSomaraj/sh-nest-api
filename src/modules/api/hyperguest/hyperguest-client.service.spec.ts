import { HyperGuestClientService } from './hyperguest-client.service';
import { HyperGuestApiError } from './hyperguest.types';

/**
 * HyperGuestClientService — transport, error envelope, 429 back-off and the
 * certification rails (property allow-list + hard-coded charge:false).
 */

const baseCfg = {
  enabled: true,
  token: 'tok-123',
  searchUrl: 'https://search.example/2.0/',
  bookUrl: 'https://book.example/2.0/',
  staticUrl: 'https://static.example/',
  certification: true,
  certPropertyId: 19912,
  agencyReference: 'stayhopper',
  timeoutMs: 5000,
};

const configWith = (overrides: Partial<typeof baseCfg> = {}) =>
  ({ get: jest.fn(() => ({ ...baseCfg, ...overrides })) }) as any;

function fetchResponse(
  body: unknown,
  { status = 200, headers = {} as Record<string, string> } = {},
) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  };
}

describe('HyperGuestClientService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  it('sends bearer auth + gzip headers on every call', async () => {
    fetchMock.mockResolvedValue(fetchResponse([]));
    const client = new HyperGuestClientService(configWith());

    await client.getHotels();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://static.example/hotels.json');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
    expect(init.headers['Accept-Encoding']).toBe('gzip, deflate');
  });

  it('throws a typed HyperGuestApiError on the HG error envelope, even with HTTP 200', async () => {
    fetchMock.mockResolvedValue(
      fetchResponse({ error: 'Price changed', errorCode: 'BN.402', errorDetails: [] }),
    );
    const client = new HyperGuestClientService(configWith());

    const err = await client
      .preBook({
        search: { dates: { from: '2026-08-01', to: '2026-08-02' }, propertyId: 19912, pax: [] },
        rooms: [],
      })
      .catch((e) => e);

    expect(err).toBeInstanceOf(HyperGuestApiError);
    expect(err.errorCode).toBe('BN.402');
    expect(err.isPriceChanged).toBe(true);
  });

  it('backs off and retries static requests on 429', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({}, { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(fetchResponse([{ hotel_id: 19912 }]));
    const client = new HyperGuestClientService(configWith());

    const hotels = await client.getHotels();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hotels).toEqual([{ hotel_id: 19912 }]);
  });

  it('certification rail: blocks any propertyId except 19912', async () => {
    const client = new HyperGuestClientService(configWith());

    await expect(
      client.search({
        checkIn: '2026-08-01',
        checkOut: '2026-08-02',
        propertyIds: [12345],
        guests: [{ adults: 2 }],
      }),
    ).rejects.toThrow(/certification mode/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows the certification property and serializes the guests grammar', async () => {
    fetchMock.mockResolvedValue(fetchResponse({ results: [] }));
    const client = new HyperGuestClientService(configWith());

    await client.search({
      checkIn: '2026-08-01',
      checkOut: '2026-08-02',
      propertyIds: [19912],
      guests: [{ adults: 2, childrenAges: [11, 12] }, { adults: 2 }],
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('guests=2-11%2C12.2');
    expect(url).toContain('propertyIds=19912');
  });

  it('hard rail: createBooking always sends charge:false and rejects charge:true', async () => {
    fetchMock.mockResolvedValue(fetchResponse({ content: { bookingId: 'b-1' } }));
    const client = new HyperGuestClientService(configWith());
    const body = {
      dates: { from: '2026-08-01', to: '2026-08-02' },
      propertyId: 19912,
      leadGuest: { contact: { email: 'x@y.z' } },
      paymentDetails: { type: 'credit_card' as const, details: {} },
      rooms: [],
    };

    await client.createBooking(body);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.paymentDetails.details.charge).toBe(false);

    await expect(
      client.createBooking({
        ...body,
        paymentDetails: { type: 'credit_card', details: { charge: true } },
      }),
    ).rejects.toThrow(/charge:true is forbidden/);
  });

  it('refuses to run at all when HG_ENABLED is off', async () => {
    const client = new HyperGuestClientService(configWith({ enabled: false }));

    await expect(client.getHotels()).rejects.toThrow(/disabled/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
