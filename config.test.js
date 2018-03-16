const config = require('./config');

test('well formed', () => {
  expect(config).toEqual(
    expect.objectContaining({
      checkApi: {
        url: expect.any(String),
        apiKey: expect.any(String),
        httpAuth: expect.any(String)
      },
      checkWeb: {
        url: expect.any(String),
      },
      slack: expect.any(Object),
      redisHost: expect.any(String),
      redisPrefix: expect.any(String),
      awsRegion: expect.any(String),
      googleImageSearchFunctionName: expect.any(String)
    })
  );
});
