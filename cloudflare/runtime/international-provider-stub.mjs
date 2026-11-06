// Only --international-provider-stub local tests use this boundary. It is not a
// production compatibility fix. Any moderation request remains unavailable.
const marker = 'INTERNATIONAL_TEST_TENCENT_STUB';
class Client {
  async TextModeration() { throw new Error(marker); }
  async ImageModeration() { throw new Error(marker); }
}
export const tms = { v20201229: { Client } };
export const ims = { v20201229: { Client } };
