let config = require('./config');
const Lokka = require('lokka').Lokka;

const {
  buildData,
  buildPayload,
  sleep,
  buildRandomString,
  callCheckApi,
  sendAction
} = require('./test-helpers.js');

const {
  t,
  formatMessageFromData,
  getRedisClient,
  getGraphqlClient,
  getCheckSlackUser,
  verify,
  executeMutation,
  getTeamConfig
} = require('./helpers');

jest.setTimeout(120000);

test('connect to GraphQL', async () => {
  config.checkApi.httpAuth = 'user:pass';
  const client = getGraphqlClient();
  await sleep(3);
  config.checkApi.httpAuth = false;
  expect(client).toBeInstanceOf(Lokka);
});

test('translate string', () => {
  expect(t('foo_bar')).toBe('Foo bar');
});

test('translate string with capitals', () => {
  expect(t('foo_bar', true)).toBe('Foo Bar');
});

test('format message from Check API data', async () => {
  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,last_status_obj,last_status' });
  await callCheckApi('new_media_tag', { email, pm_id: pm.data.id, tag: 'test' });
  await callCheckApi('new_task', { email, pm_id: pm.data.id });
  const st = await callCheckApi('get', { class: 'dynamic', id: pm.data.last_status_obj.id, fields: 'graphql_id' });
  const callback_id = { last_status_id: st.data.graphql_id, team_slug: team.data.slug };

  const { outputData, callback } = await sendAction({ name: 'change_status', selected_options: [{ value: 'verified' }] }, callback_id);
});

test('format message from Check API data that contain a picture', async () => {
  const data = {
    dbid: 1,
    id: 'asdhjadshj',
    last_status: 'in_progress',
    created_at: new Date(),
    updated_at: new Date(),
    project: {
      title: 'Test'
    },
    oembed_metadata: {
      picture: 'https://picsum.photos/200/300',
      title: 'Test ' + buildRandomString(15),
      description: buildRandomString(51),
      permalink: 'http://checkmedia.org/test'
    },
    team: {
      name: 'Test Team',
      slug: 'test',
      get_languages: '["en"]',
      verification_statuses: {
        statuses: [
          {
            id: 'in_progress',
            style: {
              color: '#FFCC33'
            },
            label: 'In Progress'
          }
        ]
      },
    },
    last_status_obj: {
      id: 1
    },
    author_role: 'editor',
    user: {
      name: 'Test User',
      profile_image: 'https://picsum.photos/200',
      source: {
        image: 'https://picsum.photos/300'
      }
    }
  };
  let response = formatMessageFromData(data)[0];
  expect(response.title).toMatch('IN PROGRESS: Test');
  expect(response.author_name).toBe('Test User | Editor at Test Team');
  expect(response.author_icon).toBe('https://picsum.photos/300');
  data.user.source = null;
  response = formatMessageFromData(data)[0];
  expect(response.author_icon).toBe('https://picsum.photos/200');
});

test('team configuration', () => {
  let teamconf = getTeamConfig('T12345ABC');
  expect(teamconf).toEqual(expect.objectContaining({ verificationToken: '123456abcdef' }));
  teamconf = getTeamConfig('invalid');
  expect(teamconf).toEqual({});
});
